// The launcher's end of the relay: HTTP on one launch's Unix socket (#41).
//
// This exists so the member's relay can reach the core, and nothing it is not
// told to expect gets an answer that reads as a yes.
//
// A launch that hands its relay a token (a Goose launch, whose crew tool server is the relay's one caller, martha#541
// part C, C1) has every request without that token refused before anything reads its body: a process that is not this
// launch's own server cannot speak for the member. The token is compared in constant time, and a refusal never says it.
// A launch that hands none (Claude Code's, whose hooks are the relay) is served as before.
//
// One POST per event, its path naming the event (relay_protocol.ts). A request
// for any other path or method, or a body too large or not JSON, gets a status
// the relay reads as a refusal. While the launcher stops a member, the request
// that led to it is held open and never answered. A request that fails before it
// is answered is dropped, and the others are still served.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { RELAY_PATHS, RUN_PATH, TOOL_ANSWER_PATH, type RelayEvent } from '../claude_code_relay/hooks/relay_protocol.ts'
import { GIT_CALL_PATH, REF_TRANSACTION_PATH } from '../guard_the_git_a_member_runs/guard_protocol.ts'
import { theAnswerAGuardHears } from '../guard_the_git_a_member_runs/judge_a_guards_question.ts'
import { theBodyOf } from '../read_the_body_a_request_carries/read_the_body_a_request_carries.ts'
import type { MemberRelay } from '../answer_the_relay/answer_the_relay.ts'
import { isThisLaunchsToken, THE_TOKEN_HEADER } from './the_launchs_token.ts'

const EVENT_OF_PATH: ReadonlyMap<string, RelayEvent> = new Map(
  (Object.entries(RELAY_PATHS) as [RelayEvent, string][]).map(([event, path]) => [path, event]),
)

export interface RelayServer {
  /** Stops listening and drops every open request, answered or not. */
  close(): Promise<void>
}

/** The refusal a request without this launch's token gets. */
export const NOT_THIS_LAUNCHS_SERVER = "the request carries no token of this launch"

/** The status that refusal carries: the caller is not one this launch answers. */
const FORBIDDEN = 403

/**
 * Serves `relay` on a Unix socket at `socket_path`, which must not exist yet. With `token`, only a request that carries
 * it in THE_TOKEN_HEADER is answered at all.
 */
export function serveTheRelay(relay: MemberRelay, socket_path: string, token?: string): Promise<RelayServer> {
  // A request that fails before it is answered (the relay dropped it mid-body,
  // among others) gets no answer, which the relay hears as a no; the launcher
  // keeps serving the member's other requests.
  const server = createServer((request, response) => {
    if (token !== undefined && !isThisLaunchsToken(oneHeader(request.headers[THE_TOKEN_HEADER]), token)) {
      reply(response, FORBIDDEN, { refused: NOT_THIS_LAUNCHS_SERVER })
      return
    }
    void answerOne(relay, request, response).catch(() => response.destroy())
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket_path, () => {
      server.off('error', reject)
      resolve({ close: () => closeServer(server) })
    })
  })
}

/** A header sent once, or nothing: a header sent twice is not a token. */
const oneHeader = (value: string | string[] | undefined): string | undefined => (typeof value === 'string' ? value : undefined)

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
  if (request.method !== 'POST') return answerAnEvent(relay, request, response)
  if (request.url === RUN_PATH) return answeredWithItsBody(request, response, async (body) => ({ status: 200, body: await relay.run(body) }))
  if (request.url === TOOL_ANSWER_PATH) return answeredWithItsBody(request, response, async (body) => ({ status: 200, body: await relay.answerTool(body) }))
  if (request.url === GIT_CALL_PATH) return answeredWithItsBody(request, response, async (body) => theAnswerAGuardHears(await relay.judgeAGitCall(body)))
  if (request.url === REF_TRANSACTION_PATH) return answeredWithItsBody(request, response, async (body) => theAnswerAGuardHears(await relay.judgeARefTransaction(body)))
  return answerAnEvent(relay, request, response)
}

/**
 * The answer a request gets once its body is read as JSON: the one refusal every endpoint shares, and the status and
 * body the endpoint decides (a guard's question is a 400 when the launcher cannot read it, martha#562).
 */
async function answeredWithItsBody(
  request: IncomingMessage,
  response: ServerResponse,
  answering: (body: unknown) => Promise<{ readonly status: number; readonly body: unknown }>,
): Promise<void> {
  const body = await theBodyOf(request)
  if (body === undefined) return reply(response, 400, { refused: 'the body is not JSON the launcher reads' })
  const said = await answering(body)
  reply(response, said.status, said.body)
}

/** A hook event's request: the launcher's answer, or a refusal. */
async function answerAnEvent(relay: MemberRelay, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const event = EVENT_OF_PATH.get(request.url ?? '')
  if (request.method !== 'POST' || event === undefined) return reply(response, 404, { refused: 'no such event' })

  const body = await theBodyOf(request)
  if (body === undefined) return reply(response, 400, { refused: 'the body is not JSON the launcher reads' })

  const answer = await relay.answer(event, body)
  // A member being stopped gets no answer: its hook waits for the kill.
  if (answer.answered) reply(response, 200, answer.body)
}

