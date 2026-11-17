// Talking to `goose acp`, which is the whole of Martha's side of the trial: one JSON-RPC message per
// line in and out (agent-client-protocol 2.2 frames ACP over stdio by lines), a permission request
// answered once, and every notification the agent sends kept for the record.
//
// This exists so the nine lines of macula-io/martha#541's first package can be observed on a real Goose build
// through the protocol Martha will use, without a Goose adapter being written first.

import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

/** A permission request as Goose asks it: which tool, and the answers it offers. */
export interface Asked {
  readonly toolName: string
  readonly toolCallId: string
  readonly title: string
  readonly options: readonly string[]
  readonly answered: string
}

/** The one answer a line may give: never an "always" answer, which would save a rule past the client. */
export type OnceAnswer = 'allow_once' | 'reject_once'

/** What a line sets before each turn, and what the client answered each time. */
export interface Answers {
  next: OnceAnswer
  readonly asked: Asked[]
}

interface Pending {
  readonly settle: (value: unknown) => void
  readonly fail: (error: Error) => void
}

interface Rpc {
  readonly id?: number
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

/** A permission request's params, as much of them as the trial reads. */
interface PermissionParams {
  readonly toolCall?: { readonly title?: unknown; readonly toolCallId?: unknown }
  readonly options?: readonly { readonly optionId?: string }[]
}

const optionIds = (params: PermissionParams): string[] => (params.options ?? []).map((option) => option.optionId ?? '')

/** The answer given among the options offered: the one the line set, else the first, never an "always". */
const chosen = (options: readonly string[], wanted: OnceAnswer): string =>
  options.includes(wanted) ? wanted : options[0] ?? 'reject_once'

const said = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Goose over ACP on stdio: ask it something, answer its permission requests, keep what it says. */
export class GooseOverAcp {
  readonly updates: Record<string, unknown>[] = []
  readonly answers: Answers = { next: 'reject_once', asked: [] }
  readonly notes: string[] = []
  readonly #stdin: Writable
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  #buffered = ''

  constructor(child: ChildProcess) {
    this.#stdin = child.stdin as Writable
    const out = child.stdout as Readable
    out.setEncoding('utf8')
    out.on('data', (chunk: string) => this.#read(chunk))
  }

  /** One request, answered by the agent, whatever it is. */
  ask(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++
    const answered = new Promise<unknown>((settle, fail) => this.#pending.set(id, { settle, fail }))
    this.#stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return answered
  }

  /** Ends the agent's input: the launcher's way of saying the session is over. */
  stop(): void {
    this.#stdin.end()
  }

  #read(chunk: string): void {
    this.#buffered += chunk
    const lines = this.#buffered.split('\n')
    this.#buffered = lines.pop() ?? ''
    for (const line of lines) this.#handleLine(line)
  }

  #handleLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    let rpc: Rpc
    try {
      rpc = JSON.parse(trimmed) as Rpc
    } catch {
      this.notes.push(`not JSON: ${trimmed.slice(0, 200)}`)
      return
    }
    if (rpc.method !== undefined && rpc.id !== undefined) this.#answerServerRequest(rpc)
    else if (rpc.method !== undefined) this.updates.push(rpc as Record<string, unknown>)
    else this.#settle(rpc)
  }

  #settle(rpc: Rpc): void {
    const pending = rpc.id === undefined ? undefined : this.#pending.get(rpc.id)
    if (pending === undefined || rpc.id === undefined) return
    this.#pending.delete(rpc.id)
    const failure = rpc.error?.message
    if (failure === undefined) pending.settle(rpc.result)
    else pending.fail(new Error(`goose refused ${rpc.id}: ${failure}`))
  }

  #answerServerRequest(rpc: Rpc): void {
    if (rpc.method !== 'session/request_permission') {
      this.notes.push(`unexpected request from goose: ${rpc.method ?? ''}`)
      this.#reply(rpc.id ?? 0, { code: -32601, message: `the trial has no answer for ${rpc.method ?? ''}` })
      return
    }
    const asked = this.#record(rpc.params)
    this.#reply(rpc.id ?? 0, { outcome: 'selected', optionId: asked.answered })
  }

  #record(params: unknown): Asked {
    const body = (params ?? {}) as PermissionParams
    const options = optionIds(body)
    const asked: Asked = {
      toolName: said(body.toolCall?.title) || said(body.toolCall?.toolCallId),
      toolCallId: said(body.toolCall?.toolCallId),
      title: said(body.toolCall?.title),
      options,
      answered: chosen(options, this.answers.next),
    }
    this.answers.asked.push(asked)
    return asked
  }

  #reply(id: number, outcome: unknown): void {
    this.#stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { outcome } })}\n`)
  }
}
