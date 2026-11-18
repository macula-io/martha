// Talking to `goose acp`, which is the whole of Martha's side of the trial: one JSON-RPC message per
// line in and out (agent-client-protocol 2.2 frames ACP over stdio by lines), a permission request
// answered once, and every notification the agent sends kept for the record.
//
// Every message can also be handed to a keeper as it crosses the pipe (martha#694): a line that got no
// answer in time kept only its verdict, so the exchange that would have said why was dropped. The keeper
// is called as each message arrives or leaves, never at the end, so a launch killed at its bound still
// has everything up to the kill.
//
// This exists so the nine lines of macula-io/martha#541's first package can be observed on a real Goose build
// through the protocol Martha will use, without a Goose adapter being written first.

import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import { answerOnce, type AnOfferedOption, type TheOutcome } from '../src/speak_acp_to_an_agent/answer_a_permission_once.ts'
import { METHOD_NOT_FOUND } from '../src/speak_acp_to_an_agent/the_acp_client.ts'
/** One message across the pipe, as it crossed it. */
export interface Exchange {
  /** When it crossed, in milliseconds since the epoch, so two messages can be ordered. */
  readonly at: number
  /** Which way it went: `sent` is Martha's, `received` is the engine's. */
  readonly direction: 'sent' | 'received'
  /** The parsed message, or `{ text }` for a line that would not parse. */
  readonly message: Record<string, unknown>
}

/** Where the trial keeps the exchange: called once per message, as it crosses. */
export type KeepTheExchange = (exchange: Exchange) => void


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
  readonly options?: readonly (AnOfferedOption & { readonly optionId?: string })[]
}

const optionIds = (params: PermissionParams): string[] => (params.options ?? []).map((option) => option.optionId ?? '')

/** The answer given: the once-answer the line set when it is offered, else a cancel, never an "always" (martha#677). */
const chosen = (params: PermissionParams, wanted: OnceAnswer): TheOutcome =>
  answerOnce(params.options ?? [], wanted === 'allow_once' ? 'allow' : 'reject')

/** The outcome as the record names it: the option's id, or `cancelled`. */
const named = (outcome: TheOutcome): string => (outcome.outcome === 'selected' ? outcome.optionId : outcome.outcome)

const said = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Goose over ACP on stdio: ask it something, answer its permission requests, keep what it says. */
export class GooseOverAcp {
  readonly updates: Record<string, unknown>[] = []
  readonly answers: Answers = { next: 'reject_once', asked: [] }
  readonly notes: string[] = []
  readonly #stdin: Writable
  readonly #pending = new Map<number, Pending>()
  readonly #keep: KeepTheExchange
  #nextId = 1
  #buffered = ''

  constructor(child: ChildProcess, keep: KeepTheExchange = () => undefined) {
    this.#stdin = child.stdin as Writable
    this.#keep = keep
    const out = child.stdout as Readable
    out.setEncoding('utf8')
    out.on('data', (chunk: string) => this.#read(chunk))
    // The pipe's end is when everything written has been read: a message the kill cut off before its newline is
    // still in the buffer, and this keeps it (martha#694). Chunks can still be in flight when the child's exit is
    // seen, so this event is the right signal and the explicit close below is the fallback.
    out.on('end', () => this.closeTheExchange())
  }

  /**
   * The rest of the exchange: what arrived without a trailing newline, kept when the pipe ends or the launch is
   * killed. A line the kill cut off usually does not parse, so it is kept as its text, like any line that is not
   * JSON — that is the right record of a message cut off. Keeps nothing twice: the buffer is emptied either way.
   */
  closeTheExchange(): void {
    const rest = this.#buffered.trim()
    this.#buffered = ''
    if (rest !== '') this.#handleLine(rest)
  }

  /** One request, answered by the agent, whatever it is. */
  ask(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++
    const answered = new Promise<unknown>((settle, fail) => this.#pending.set(id, { settle, fail }))
    this.#send({ jsonrpc: '2.0', id, method, params })
    return answered
  }

  /** One message to the engine, kept before it goes, so a kill cannot lose it. */
  #send(message: Record<string, unknown>): void {
    this.#keep({ at: Date.now(), direction: 'sent', message })
    this.#stdin.write(`${JSON.stringify(message)}\n`)
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
      this.#keep({ at: Date.now(), direction: 'received', message: { text: trimmed.slice(0, 2000) } })
      this.notes.push(`not JSON: ${trimmed.slice(0, 200)}`)
      return
    }
    this.#keep({ at: Date.now(), direction: 'received', message: rpc as Record<string, unknown> })
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
      this.#refuse(rpc.id ?? 0, { code: METHOD_NOT_FOUND, message: `the trial has no answer for ${rpc.method ?? ''}` })
      return
    }
    const body = (rpc.params ?? {}) as PermissionParams
    const outcome = chosen(body, this.answers.next)
    this.#record(body, named(outcome))
    this.#reply(rpc.id ?? 0, outcome)
  }

  #record(body: PermissionParams, answered: string): Asked {
    const options = optionIds(body)
    const asked: Asked = {
      toolName: said(body.toolCall?.title) || said(body.toolCall?.toolCallId),
      toolCallId: said(body.toolCall?.toolCallId),
      title: said(body.toolCall?.title),
      options,
      answered,
    }
    this.answers.asked.push(asked)
    return asked
  }

  #reply(id: number, outcome: unknown): void {
    this.#send({ jsonrpc: '2.0', id, result: { outcome } })
  }

  /** A JSON-RPC error for a request the trial has no answer for, never a success that carries one. */
  #refuse(id: number, error: { readonly code: number; readonly message: string }): void {
    this.#stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, error })}\n`)
  }
}
