// What Goose sent the model, kept: the proxy sits between Goose and the local Ollama and records every
// request body before passing it on, so a line can say exactly what the model was given — its tool list,
// its system prompt, the messages — instead of inferring it from the answer.
//
// This exists because the trial's questions are about what reaches the model (markers, tools, relayed
// text), and the only place that is visible without changing Goose is the request on its way out.

import { createServer, request as sendRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

/** One request as it arrived: what the line looks at afterwards. */
export interface Received {
  readonly method: string
  readonly path: string
  readonly body: string
}

/** A model endpoint that keeps every request and answers as the real one does. */
export class RecordingProxy {
  readonly received: Received[] = []
  readonly #target: URL
  #server: Server | undefined

  constructor(target: string) {
    this.#target = new URL(target)
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

  stop(): Promise<void> {
    return new Promise<void>((settle) => {
      this.#server?.close(() => settle())
    })
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.received.push({ method: request.method ?? '', path: request.url ?? '', body })
      this.#forward(request, response, body)
    })
  }

  #forward(request: IncomingMessage, response: ServerResponse, body: string): void {
    const headers = { ...request.headers, host: this.#target.host }
    const upstream = sendRequest(
      { hostname: this.#target.hostname, port: this.#target.port, path: request.url, method: request.method, headers },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers)
        answer.pipe(response)
      },
    )
    upstream.on('error', () => {
      response.writeHead(502, { 'content-type': 'text/plain' })
      response.end('the trial proxy could not reach the model')
    })
    upstream.end(body)
  }
}
