// What Goose sent the model, kept: the proxy sits between Goose and the local Ollama and records every
// request body before passing it on, so a line can say exactly what the model was given — its tool list,
// its system prompt, the messages — instead of inferring it from the answer.
//
// This exists because the trial's questions are about what reaches the model (markers, tools, relayed
// text), and the only place that is visible without changing Goose is the request on its way out.

import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, request as sendRequest, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

import type { TheModelPace } from '../the_cap_a_line_gets/the_cap_a_line_gets.ts'
import { isAModelChat } from './a_turn_with_goose.ts'

/** The proxy's own log in the launch's evidence: every request, how long the model took, and how it answered. */
export const THE_PROXY_LOG = 'proxy.log'

/** One request as it arrived: what the line looks at afterwards. */
export interface Received {
  readonly method: string
  readonly path: string
  readonly body: string
}

/** One request as the proxy saw it end, which is also what the model's pace is measured from (martha#732). */
export interface AnAnsweredRequest {
  readonly path: string
  readonly status: number
  readonly ms: number
}

/** Where the proxy keeps its own log, and what measures the model's pace from it. */
export interface TheProxysBooks {
  /** The launch's evidence directory; the log is written there under THE_PROXY_LOG. */
  readonly into?: string
  /** What the answers are measured into, so a turn's bound follows the model's own pace. */
  readonly pace?: TheModelPace
}

/** A model endpoint that keeps every request and answers as the real one does. */
export class RecordingProxy {
  readonly received: Received[] = []
  readonly answered: AnAnsweredRequest[] = []
  readonly #target: URL
  readonly #books: TheProxysBooks
  #server: Server | undefined
  /** The requests this proxy has open to the model, and has not seen end or fail yet (martha#732). */
  readonly #openToTheModel = new Set<ClientRequest>()

  constructor(target: string, books: TheProxysBooks = {}) {
    this.#target = new URL(target)
    this.#books = books
  }

  /** Starts on a free loopback port and says which. */
  start(): Promise<number> {
    this.#server = createServer((request, response) => this.#handle(request, response))
    return new Promise<number>((settle) => {
      this.#server?.listen(0, '127.0.0.1', () => {
        const address = this.#server?.address()
        settle(typeof address === 'object' && address !== null ? address.port : 0)
      })
    })
  }

  /**
   * Ends the proxy, and every request it still has open to the model (martha#732): a launch whose turn was cut at
   * its bound stops the engine, and a request the model is still answering keeps the launch's node alive until the
   * model finishes — on the fork's run, until the runner reaped the launch at its whole bound, about nine minutes a
   * line, which is what put the job over its own limit at line 7. The driver ends with the verdict it wrote.
   */
  stop(): Promise<void> {
    for (const one of this.#openToTheModel) one.destroy()
    this.#openToTheModel.clear()
    return new Promise<void>((settle) => {
      this.#server?.close(() => settle())
    })
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const startedAt = Date.now()
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.received.push({ method: request.method ?? '', path: request.url ?? '', body })
      this.#forward(request, response, body, startedAt)
    })
  }

  #forward(request: IncomingMessage, response: ServerResponse, body: string, startedAt: number): void {
    const headers = { ...request.headers, host: this.#target.host }
    const upstream = sendRequest(
      { hostname: this.#target.hostname, port: this.#target.port, path: request.url, method: request.method, headers },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
        answer.on('end', () => this.#noteAnAnswer(request.url ?? '', answer.statusCode ?? 0, startedAt))
      },
    )
    this.#openToTheModel.add(upstream)
    upstream.on('close', () => this.#openToTheModel.delete(upstream))
    upstream.on('error', () => {
      response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('the trial proxy could not reach the model')
      this.#noteAnAnswer(request.url ?? '', 502, startedAt)
    })
    upstream.end(body)
  }

  /**
   * One answer landed: a chat answer is measured into the model's pace, which renews a turn's bound, and every
   * answer is written to the proxy's own log, so the evidence says what the model took as well as what it was
   * asked (martha#732). Only chat answers are measured: the engine asks the same endpoint what model it is
   * (`api/show`) before it ever chats, and that answer is about a millisecond — measured, it would set a bound
   * of about a millisecond for every turn (PR 733 R1).
   */
  #noteAnAnswer(path: string, status: number, startedAt: number): void {
    const answer = { path, status, ms: Date.now() - startedAt }
    this.answered.push(answer)
    if (isAModelChat(path)) this.#books.pace?.noteAnAnswer(answer.ms)
    if (this.#books.into === undefined) return
    appendFileSync(join(this.#books.into, THE_PROXY_LOG), `${JSON.stringify(answer)}\n`)
  }
}
