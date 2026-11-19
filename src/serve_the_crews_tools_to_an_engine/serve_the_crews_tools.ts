// The crew's tool server for a Goose member: an MCP server on stdio that offers the crew's tools and answers each call
// with the launcher's own answer (martha#541, packages 7-8 part C, C1).
//
// This exists so a member running in the Goose engine has the crew's tools, and so no answer to one of them is the
// server's own. The engine starts it from the entry its launch wrote into the config root
// (./the_tool_servers_entry.ts); the server speaks the protocol's newline-framed JSON-RPC on its stdin and stdout.
//
// What it offers is exactly CREW_TOOLS, read from the slice that defines them and never restated: their names, their
// descriptions and their schemas. What it answers is the launcher's: every `tools/call` is posted to the launch's own
// relay socket as the tool call the crew's mod posts on Claude Code (`toolCallBody`, `TOOL_ANSWER_PATH`), carrying
// this launch's token, and the answer is read with the mod's own reader (`heardToolAnswer`). So it decides nothing:
//   - a name outside CREW_TOOLS is refused by name, and the launcher is not asked;
//   - a call whose meta names no session is refused, since the launcher answers a call in a session and the server
//     has no session of its own to offer it;
//   - a launcher that refuses, cannot be reached, or answers in any shape but the one a yes takes, is a refusal the
//     model is shown as an error, never an answer the server made up.
// The session is the engine's own word for the call, under the key the recording names
// (`tool_call_session_key`), the same way the Claude Code relay takes the host's own record of a call.
//
// Started by its program, it reads the relay socket and the token from its environment and refuses to start without
// either. Its standard output carries the protocol alone; its standard error never carries the token.

import { request } from 'node:http'
import { env, exit, stderr, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'

import { CREW_TOOLS, type CrewTool } from '../a_crews_tools/a_crews_tools.ts'
import { RELAY_DEADLINE_MS, RELAY_SOCKET_VARIABLE, TOOL_ANSWER_PATH, heardToolAnswer, toolCallBody, type HeardToolAnswer } from '../claude_code_relay/hooks/relay_protocol.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { THE_TOKEN_HEADER } from '../serve_the_relay_to_a_launch/the_launchs_token.ts'
import { THE_CREWS_TOOL_SERVER, THE_TOKEN_VARIABLE } from './the_tool_servers_words.ts'

/** The version this server names itself by in its answer to `initialize`. */
export const THE_SERVERS_VERSION = '1'

/** The protocol version the server answers with when the engine names none. */
export const THE_PROTOCOL_VERSION = '2025-06-18'

/** JSON-RPC's own error codes, for a line that is not JSON, not a request, or names a method this server has not. */
export const NOT_JSON = -32700
export const NOT_A_REQUEST = -32600
export const NO_SUCH_METHOD = -32601

const JSON_RPC = '2.0'

/** The methods the server answers: the protocol's start, a ping, the list of tools and a call of one. */
export const METHODS = { initialize: 'initialize', ping: 'ping', list: 'tools/list', call: 'tools/call' } as const

/** Asks the launcher for one call's answer, given the call in the relay's words. */
export type AskTheLauncher = (body: Readonly<Record<string, unknown>>) => Promise<HeardToolAnswer>

/** What the server answers with: the tools it offers, the meta key the engine names a session under, and the launcher. */
export interface WhatTheServerAnswersWith {
  readonly tools: readonly CrewTool[]
  readonly session_key: string
  readonly ask: AskTheLauncher
}

type JsonObject = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A call's result the model is shown as an error: the refusal's words, and nothing run. */
const aRefusedCall = (why: string): JsonObject => ({ content: [{ type: 'text', text: why }], isError: true })

/**
 * The reply to one line the engine wrote, as one line, or undefined when the line is a notification, which takes none.
 * Never throws: whatever the launcher does, the engine hears a reply to every request it made.
 */
export async function theReplyTo(line: string, server: WhatTheServerAnswersWith): Promise<string | undefined> {
  const message = aMessageIn(line)
  if ('error' in message) return aReply(null, message)
  if (!('id' in message.request)) return undefined
  const id = message.request['id'] ?? null
  const method = message.request['method']
  if (typeof method !== 'string') return aReply(id, { error: { code: NOT_A_REQUEST, message: 'the request names no method' } })
  const answering = THE_ANSWERS.get(method)
  if (answering === undefined) return aReply(id, { error: { code: NO_SUCH_METHOD, message: `this server has no method ${method}` } })
  const params = isObject(message.request['params']) ? message.request['params'] : {}
  return aReply(id, { result: await answering(params, server) })
}

/** One line as a request's object, or the error a line that is not one gets. */
function aMessageIn(line: string): { readonly request: JsonObject } | { readonly error: JsonObject } {
  try {
    const parsed: unknown = JSON.parse(line)
    return isObject(parsed) ? { request: parsed } : { error: { code: NOT_A_REQUEST, message: 'the line is not a request' } }
  } catch {
    return { error: { code: NOT_JSON, message: 'the line is not JSON' } }
  }
}

/** What each method this server has answers with. */
const THE_ANSWERS: ReadonlyMap<string, (params: JsonObject, server: WhatTheServerAnswersWith) => Promise<unknown>> = new Map([
  [METHODS.initialize, async (params: JsonObject) => theStart(params)],
  [METHODS.ping, async () => ({})],
  [METHODS.list, async (_params: JsonObject, server: WhatTheServerAnswersWith) => ({ tools: server.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })],
  [METHODS.call, theCallAnswered],
])

function aReply(id: unknown, said: { readonly result: unknown } | { readonly error: JsonObject }): string {
  return JSON.stringify({ jsonrpc: JSON_RPC, id, ...said })
}

/** The answer to `initialize`: the engine's own protocol version back, the one capability this server has, its name. */
function theStart(params: JsonObject): JsonObject {
  const asked = params['protocolVersion']
  return {
    protocolVersion: typeof asked === 'string' && asked !== '' ? asked : THE_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: THE_CREWS_TOOL_SERVER, version: THE_SERVERS_VERSION },
  }
}

/** One call, answered by the launcher, or refused before the launcher is asked when it is not one the crew has. */
async function theCallAnswered(params: JsonObject, server: WhatTheServerAnswersWith): Promise<JsonObject> {
  const call = theCallAsked(params, server)
  if ('refused' in call) return aRefusedCall(call.refused)
  let heard: HeardToolAnswer
  try {
    heard = await server.ask(toolCallBody(call.session, call.name, call.args))
  } catch (error) {
    heard = { answered: false, why: error instanceof Error ? error.message : String(error) }
  }
  return heard.answered ? { content: [{ type: 'text', text: heard.answer }] } : aRefusedCall(`Martha did not answer ${call.name}: ${heard.why}`)
}

/** The tool, its arguments and the session a call names, or why the launcher is not asked about it. */
function theCallAsked(params: JsonObject, server: WhatTheServerAnswersWith): { readonly name: string; readonly args: JsonObject; readonly session: string } | { readonly refused: string } {
  const name = params['name']
  if (typeof name !== 'string' || !server.tools.some((tool) => tool.name === name)) {
    return { refused: `Martha offers no tool ${JSON.stringify(name)}: only the crew's own tools are served here.` }
  }
  const args = params['arguments'] ?? {}
  if (!isObject(args)) return { refused: `Martha did not run ${name}: its arguments are not an object.` }
  const session = (isObject(params['_meta']) ? params['_meta'] : {})[server.session_key]
  if (typeof session !== 'string' || session === '') return { refused: `Martha did not run ${name}: the engine named no session for the call.` }
  return { name, args, session }
}

/**
 * Asks the launcher on the relay socket at `socket_path`, carrying `token`: one POST of the call to the path the mod's
 * calls take, read the way the mod reads it. A socket that is not there, a launcher that gives no answer in the relay's
 * own deadline, or any status but a yes, is no answer.
 */
export function askTheLauncherOn(socket_path: string, token: string): AskTheLauncher {
  return (body) =>
    new Promise((resolve) => {
      const text = JSON.stringify(body)
      const asked = request(
        {
          socketPath: socket_path,
          path: TOOL_ANSWER_PATH,
          method: 'POST',
          timeout: RELAY_DEADLINE_MS,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), [THE_TOKEN_HEADER]: token },
        },
        (response) => {
          let heard = ''
          response.setEncoding('utf8')
          response.on('data', (part: string) => (heard += part))
          response.on('end', () => resolve(heardToolAnswer(response.statusCode ?? 0, heard)))
          response.on('error', (error) => resolve({ answered: false, why: error.message }))
        },
      )
      asked.on('timeout', () => asked.destroy(new Error(`the launcher gave no answer in ${String(RELAY_DEADLINE_MS)} ms`)))
      asked.on('error', (error) => resolve({ answered: false, why: error.message }))
      asked.end(text)
    })
}

/** Serves the engine on this process's stdin and stdout until the engine closes its end. */
function serveOnStdio(server: WhatTheServerAnswersWith): void {
  const lines = createInterface({ input: stdin, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (line.trim() === '') return
    void theReplyTo(line, server).then((reply) => {
      if (reply !== undefined) stdout.write(`${reply}\n`)
    })
  })
}

if (import.meta.main) {
  const socket_path = env[RELAY_SOCKET_VARIABLE]
  const token = env[THE_TOKEN_VARIABLE]
  if (socket_path === undefined || socket_path === '' || token === undefined || token === '') {
    // Names the variables, never their values: the token is in one of them.
    stderr.write(`${THE_CREWS_TOOL_SERVER}: not started, ${RELAY_SOCKET_VARIABLE} and ${THE_TOKEN_VARIABLE} must both be set\n`)
    exit(1)
  }
  serveOnStdio({ tools: CREW_TOOLS, session_key: RECORDED_GOOSE_ENGINE.tool_call_session_key, ask: askTheLauncherOn(socket_path, token) })
}
