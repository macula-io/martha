// The launcher's end of the relay: HTTP on one launch's Unix socket (#41).
//
// This exists so the member's relay can reach the core, and nothing it is not
// told to expect gets an answer that reads as a yes.
//
// One POST per event, its path naming the event (relay_protocol.ts). A request
// for any other path or method, or a body too large or not JSON, gets a status
// the relay reads as a refusal. While the launcher stops a member, the request
// that led to it is held open and never answered. A request that fails before it
// is answered is dropped, and the others are still served.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { RELAY_PATHS, RUN_PATH, TOOL_ANSWER_PATH, type RelayEvent } from '../claude_code_relay/hooks/relay_protocol.ts'
import type { MemberRelay } from './answer_the_relay.ts'

/**
 * The largest body the launcher reads. A tool call carries its input whole (a
 * file the model writes, among others); past this the call is refused.
 */
export const LARGEST_RELAY_BODY = 32 * 1024 * 1024

const EVENT_OF_PATH: ReadonlyMap<string, RelayEvent> = new Map(
  (Object.entries(RELAY_PATHS) as [RelayEvent, string][]).map(([event, path]) => [path, event]),
)

export interface RelayServer {
  /** Stops listening and drops every open request, answered or not. */
  close(): Promise<void>
}

/** Serves `relay` on a Unix socket at `socket_path`, which must not exist yet. */
export function serveTheRelay(relay: MemberRelay, socket_path: string): Promise<RelayServer> {
  // A request that fails before it is answered (the relay dropped it mid-body,
  // among others) gets no answer, which the relay hears as a no; the launcher
  // keeps serving the member's other requests.
  const server = createServer((request, response) => void answerOne(relay, request, response).catch(() => response.destroy()))
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket_path, () => {
      server.off('error', reject)
      resolve({ close: () => closeServer(server) })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  response.end(text)
}

async function answerOne(relay: MemberRelay, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'POST' && request.url === RUN_PATH) return runOne(relay, request, response)
  if (request.method === 'POST' && request.url === TOOL_ANSWER_PATH) return answerAToolOne(relay, request, response)
  return answerAnEvent(relay, request, response)
}

/** A hook event's request: the launcher's answer, or a refusal. */
async function answerAnEvent(relay: MemberRelay, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const event = EVENT_OF_PATH.get(request.url ?? '')
  if (request.method !== 'POST' || event === undefined) return reply(response, 404, { refused: 'no such event' })

  const body = await bodyOf(request)
  if (body === undefined) return reply(response, 400, { refused: 'the body is not JSON the launcher reads' })

  const answer = await relay.answer(event, body)
  // A member being stopped gets no answer: its hook waits for the kill.
  if (answer.answered) reply(response, 200, answer.body)
}

/** The crew's mod asking for a core tool's answer (martha#254), or a refusal when the body is not JSON. */
async function answerAToolOne(relay: MemberRelay, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await bodyOf(request)
  if (body === undefined) return reply(response, 400, { refused: 'the body is not JSON the launcher reads' })
  reply(response, 200, await relay.answerTool(body))
}

/** `martha run`'s request: the run's answer, or a refusal when the body is not JSON. */
async function runOne(relay: MemberRelay, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await bodyOf(request)
  if (body === undefined) return reply(response, 400, { refused: 'the body is not JSON the launcher reads' })
  reply(response, 200, await relay.run(body))
}

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > LARGEST_RELAY_BODY) return undefined
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}
