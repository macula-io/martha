// Martha as the client of an ACP agent (macula-io/martha#541, packages 7-8, part B): JSON-RPC 2.0 over the agent's
// stdio, one message per line, as the Agent Client Protocol frames it.
//
// This exists so a member can work in an engine Martha drives rather than one Martha is a plugin inside (#541's
// gate question). Martha starts the agent, so the only prompts the agent sees are the ones sent here, and every tool
// call the agent asks about is answered here, from the gate's decision. What the protocol carries back (each tool
// call's updates, the text the model streamed, why a turn stopped) is kept per turn for the core to read.
//
// It stops at the protocol. It names no host and no gate: the caller hands in the decision for each call, and what a
// call means to the entry (ACalledTool) is mapped onto it by the adapter, not here. The rules it holds itself:
// - a permission request is answered only with a once-answer, or a cancel (answer_a_permission_once.ts);
// - a decision that throws, or a request it cannot read, is a refusal, never an allow;
// - it declares no file or terminal capability, and any other request the agent makes is answered "method not found";
// - a prompt whose first non-blank character would start an engine command (`!` or `/`) is never sent (#541 shape 2);
// - when the agent's output ends, every request still waiting fails by name, so no turn waits forever.

import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import { answerOnce, type ADecision, type AnOfferedOption, type TheOutcome } from './answer_a_permission_once.ts'

/** The ACP version this client speaks. An agent that answers with another is refused at initialize. */
export const ACP_PROTOCOL_VERSION = 1

/** The ACP methods the client sends, and the one request it answers. */
export const ACP = {
  initialize: 'initialize',
  newSession: 'session/new',
  prompt: 'session/prompt',
  cancel: 'session/cancel',
  update: 'session/update',
  requestPermission: 'session/request_permission',
} as const

/** The session updates a turn reads; every other kind is left for a later reader. */
export const UPDATE = { toolCall: 'tool_call', toolCallUpdate: 'tool_call_update', messageChunk: 'agent_message_chunk' } as const

/** JSON-RPC's code for a method the receiver does not have. */
export const METHOD_NOT_FOUND = -32601

/** The characters that, first in a turn, make the engine run a command instead of handing the text to the model. */
export const THE_COMMAND_STARTS: readonly string[] = ['!', '/']

/** A permission request as the gate is asked it. */
export interface APermissionRequest {
  readonly sessionId: string
  readonly toolCallId: string
  readonly title: string
  readonly rawInput: unknown
}

/** A permission request, and the outcome the client sent back. */
export interface APermissionAnswered extends APermissionRequest {
  readonly offered: readonly string[]
  readonly answered: TheOutcome
}

/** One tool call as the agent's updates told it, merged by its id; a field the agent never sent is absent. */
export interface AToolCall {
  readonly toolCallId: string
  readonly title?: string
  readonly kind?: string
  readonly status?: string
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
  readonly content?: unknown
}

/** A turn as it ended: why the agent stopped, the text the model streamed, its tool calls and what was asked. */
export interface ATurn {
  readonly stopReason: string
  readonly text: string
  readonly toolCalls: readonly AToolCall[]
  readonly asked: readonly APermissionAnswered[]
}

/** A session the agent opened, and the mode it says it runs in (undefined when it names none). */
export interface ASession {
  readonly sessionId: string
  readonly currentModeId: string | undefined
}

/** The gate's decision for one call. It may be slow; a throw or a rejection is a refusal. */
export type Decide = (request: APermissionRequest) => ADecision | Promise<ADecision>

interface Pending {
  readonly method: string
  readonly settle: (value: unknown) => void
  readonly fail: (error: Error) => void
}

interface ATurnBeingHeard {
  text: string
  readonly toolCalls: Map<string, AToolCall>
  readonly asked: APermissionAnswered[]
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')
const objectOf = (value: unknown): Json => (isObject(value) ? value : {})

/** Whether a turn's text would start an engine command: its first non-blank character is one of THE_COMMAND_STARTS. */
export const startsACommand = (text: string): boolean => THE_COMMAND_STARTS.includes(text.trimStart().charAt(0))

/** The fields of a tool-call update the agent sent, with only the ones it named. */
function toolCallFields(update: Json): Partial<AToolCall> {
  const fields: Record<string, unknown> = {}
  for (const key of ['title', 'kind', 'status'] as const) if (typeof update[key] === 'string') fields[key] = update[key]
  for (const key of ['rawInput', 'rawOutput', 'content'] as const) if (key in update) fields[key] = update[key]
  return fields as Partial<AToolCall>
}

/** A permission request's params as the gate is asked them, or undefined when they do not name a session and a call. */
function requestOf(params: Json): APermissionRequest | undefined {
  const toolCall = objectOf(params['toolCall'])
  const sessionId = textOf(params['sessionId'])
  const toolCallId = textOf(toolCall['toolCallId'])
  if (sessionId === '' || toolCallId === '') return undefined
  return { sessionId, toolCallId, title: textOf(toolCall['title']), rawInput: toolCall['rawInput'] }
}

/** The options a request offers, as the chooser reads them. */
const optionsOf = (params: Json): readonly AnOfferedOption[] =>
  Array.isArray(params['options']) ? (params['options'] as unknown[]).map(objectOf) : []

/** The agent's side of one ACP connection: requests out, answers and the agent's own requests in. */
export class AcpClient {
  /** What the agent sent that this client does not read: a line that is not JSON, a request it has no answer for. */
  readonly notes: string[] = []
  readonly #to: Writable
  readonly #decide: Decide
  readonly #pending = new Map<number, Pending>()
  readonly #turns = new Map<string, ATurnBeingHeard>()
  #nextId = 1
  #buffered = ''
  #ended: string | undefined

  constructor(from: Readable, to: Writable, decide: Decide) {
    this.#to = to
    this.#decide = decide
    from.setEncoding('utf8')
    from.on('data', (chunk: string) => this.#read(chunk))
    from.on('end', () => this.#end('the agent\'s output ended'))
    from.on('close', () => this.#end('the agent\'s output closed'))
    to.on('error', (error: Error) => this.#end(`the agent's input failed: ${error.message}`))
  }

  /** A client over a child's stdio, which the launcher started with both piped. */
  static overAChild(child: ChildProcess, decide: Decide): AcpClient {
    if (child.stdout === null || child.stdin === null) throw new Error('the agent was started without piped stdio')
    return new AcpClient(child.stdout, child.stdin, decide)
  }

  /** Opens the connection: this client's version, and no file or terminal capability, so the agent asks for none. */
  async initialize(): Promise<void> {
    const answer = objectOf(await this.#ask(ACP.initialize, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    }))
    if (answer['protocolVersion'] !== ACP_PROTOCOL_VERSION) {
      throw new Error(`the agent speaks ACP version ${String(answer['protocolVersion'])}, and this client speaks ${ACP_PROTOCOL_VERSION}`)
    }
  }

  /** A new session in `cwd`, with the tool servers the caller names, and the mode the agent says it runs. */
  async newSession(cwd: string, mcpServers: readonly unknown[] = []): Promise<ASession> {
    const answer = objectOf(await this.#ask(ACP.newSession, { cwd, mcpServers }))
    const sessionId = textOf(answer['sessionId'])
    if (sessionId === '') throw new Error(`the agent opened a session and named no id: ${JSON.stringify(answer)}`)
    const mode = objectOf(answer['modes'])['currentModeId']
    return { sessionId, currentModeId: typeof mode === 'string' ? mode : undefined }
  }

  /** One turn: the text sent as the session's prompt, answered when the agent ends the turn. */
  async prompt(sessionId: string, text: string): Promise<ATurn> {
    if (startsACommand(text)) throw new Error(`a turn may not start with ${THE_COMMAND_STARTS.join(' or ')}: the engine would run it as a command (martha#541 shape 2)`)
    if (this.#turns.has(sessionId)) throw new Error(`session ${sessionId} already has a turn running`)
    const turn: ATurnBeingHeard = { text: '', toolCalls: new Map(), asked: [] }
    this.#turns.set(sessionId, turn)
    try {
      const answer = objectOf(await this.#ask(ACP.prompt, { sessionId, prompt: [{ type: 'text', text }] }))
      return { stopReason: textOf(answer['stopReason']), text: turn.text, toolCalls: [...turn.toolCalls.values()], asked: turn.asked }
    } finally {
      this.#turns.delete(sessionId)
    }
  }

  /** Asks the agent to stop the session's turn; the turn still ends with the agent's answer to its prompt. */
  cancel(sessionId: string): void {
    this.#send({ jsonrpc: '2.0', method: ACP.cancel, params: { sessionId } })
  }

  /** Ends the agent's input: the launcher's way of saying the connection is over. */
  end(): void {
    this.#to.end()
  }

  #ask(method: string, params: unknown): Promise<unknown> {
    if (this.#ended !== undefined) return Promise.reject(new Error(`${method} not sent: ${this.#ended}`))
    const id = this.#nextId++
    const answered = new Promise<unknown>((settle, fail) => this.#pending.set(id, { method, settle, fail }))
    this.#send({ jsonrpc: '2.0', id, method, params })
    return answered
  }

  #send(message: Json): void {
    if (this.#ended === undefined) this.#to.write(`${JSON.stringify(message)}\n`)
  }

  #end(why: string): void {
    if (this.#ended !== undefined) return
    this.#ended = why
    for (const [id, pending] of this.#pending) pending.fail(new Error(`${pending.method} (request ${id}) never answered: ${why}`))
    this.#pending.clear()
  }

  #read(chunk: string): void {
    this.#buffered += chunk
    const lines = this.#buffered.split('\n')
    this.#buffered = lines.pop() ?? ''
    for (const line of lines) this.#handle(line.trim())
  }

  #handle(line: string): void {
    if (line === '') return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      this.notes.push(`not JSON: ${line.slice(0, 200)}`)
      return
    }
    if (!isObject(message)) this.notes.push(`not a JSON-RPC message: ${line.slice(0, 200)}`)
    else if (typeof message['method'] !== 'string') this.#settle(message)
    else if ('id' in message) void this.#answerTheAgent(message['id'], message['method'], objectOf(message['params']))
    else if (message['method'] === ACP.update) this.#hear(objectOf(message['params']))
  }

  #settle(message: Json): void {
    const id = message['id']
    const pending = typeof id === 'number' ? this.#pending.get(id) : undefined
    if (pending === undefined || typeof id !== 'number') {
      this.notes.push(`an answer to no request: ${JSON.stringify(message).slice(0, 200)}`)
      return
    }
    this.#pending.delete(id)
    if ('error' in message) pending.fail(new Error(`the agent refused ${pending.method}: ${textOf(objectOf(message['error'])['message'])}`))
    else pending.settle(message['result'])
  }

  #hear(params: Json): void {
    const turn = this.#turns.get(textOf(params['sessionId']))
    const update = objectOf(params['update'])
    const kind = update['sessionUpdate']
    if (turn === undefined) return
    if (kind === UPDATE.messageChunk) turn.text += textOf(objectOf(update['content'])['text'])
    if (kind !== UPDATE.toolCall && kind !== UPDATE.toolCallUpdate) return
    const toolCallId = textOf(update['toolCallId'])
    if (toolCallId === '') return
    turn.toolCalls.set(toolCallId, { ...turn.toolCalls.get(toolCallId), ...toolCallFields(update), toolCallId })
  }

  async #answerTheAgent(id: unknown, method: string, params: Json): Promise<void> {
    if (method !== ACP.requestPermission) {
      this.notes.push(`a request this client has no answer for: ${method}`)
      this.#send({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `the client has no ${method}` } })
      return
    }
    const answered = await this.#answerPermission(params)
    this.#send({ jsonrpc: '2.0', id, result: { outcome: answered } })
  }

  /** The outcome for one permission request: the gate's decision as a once-answer, a cancel for anything unread. */
  async #answerPermission(params: Json): Promise<TheOutcome> {
    const request = requestOf(params)
    const turn = request === undefined ? undefined : this.#turns.get(request.sessionId)
    if (request === undefined || turn === undefined) {
      this.notes.push(`a permission request outside a turn, or naming no call, was cancelled: ${JSON.stringify(params).slice(0, 200)}`)
      return { outcome: 'cancelled' }
    }
    const offered = optionsOf(params)
    const answered = answerOnce(offered, await this.#decided(request))
    turn.asked.push({ ...request, offered: offered.map((option) => textOf(option.optionId)), answered })
    return answered
  }

  async #decided(request: APermissionRequest): Promise<ADecision> {
    try {
      return (await this.#decide(request)) === 'allow' ? 'allow' : 'reject'
    } catch (error) {
      this.notes.push(`the decision for ${request.toolCallId} failed, so the call is refused: ${(error as Error).message}`)
      return 'reject'
    }
  }
}
