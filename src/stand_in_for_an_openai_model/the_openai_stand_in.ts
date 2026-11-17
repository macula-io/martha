// A stand-in for a model behind an OpenAI-compatible URL (macula-io/martha#541, package 10).
//
// This exists so a Goose member can be driven end to end with no model at all: the engine's OpenAI provider is
// pointed at this server (its host setting), and every request it sends is answered from a script and kept, so a
// test reads what the member's model was given instead of guessing it from an answer. It speaks the chat completions
// shape the engine's provider reads, streamed or whole as the request asks, and answers on the path the recorded
// engine posts to under a host, never one typed here.
//
// It is the OpenAI-shaped twin of the Claude Code stand-in (src/drive_the_recorded_host/, martha#264): the same
// script, the same record of when a request was read whole and when its reply went out, and the same rule that a
// request offering no tools (a title, a summary) is answered and never counted.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { ARefusedRequest, ModelRequest, ModelScript, ScriptedTurn } from '../drive_the_recorded_host/drive_the_recorded_host.ts'

export type { ARefusedRequest, ModelRequest, ModelScript, ScriptedTurn }

/** The path the recorded engine's OpenAI provider posts to under the host it is given. */
export const THE_PATH_THE_ENGINE_POSTS_TO = `/${RECORDED_GOOSE_ENGINE.openai_provider.default_base_path}`

/** What a request that offers no tools is answered with: the engine's own side asking, never the member's turn. */
export const A_SIDE_ANSWER: ScriptedTurn = { text: 'a side answer' }

/** The id the stand-in gives the tool call it makes in answer to request `number`, so a test names it from here. */
export const openAiStandInCallId = (number: number): string => `call_standin_${number}`

/** A running stand-in: the URL to give the engine as its host, and how to stop it. */
export interface TheOpenAiStandIn {
  readonly url: string
  close(): Promise<void>
}

const SSE = 'text/event-stream'
const JSON_TYPE = 'application/json'

/** Whether a request offers the model tools: the kind the stand-in scripts and counts. */
const offersTools = (body: Record<string, unknown>): boolean => Array.isArray(body['tools']) && body['tools'].length > 0

/** The assistant's message for a turn: text, or one call of a tool with its arguments as the JSON text OpenAI sends. */
function messageOf(turn: Exclude<ScriptedTurn, { refused: ARefusedRequest }>, number: number): Record<string, unknown> {
  if ('text' in turn) return { role: 'assistant', content: turn.text }
  const call = { index: 0, id: openAiStandInCallId(number), type: 'function', function: { name: turn.tool, arguments: JSON.stringify(turn.input) } }
  return { role: 'assistant', content: null, tool_calls: [call] }
}

const finishOf = (turn: ScriptedTurn): string => ('tool' in turn ? 'tool_calls' : 'stop')
const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }

/** A reply streamed as the chat completions API streams one: the message in one delta, then its finish, then the end. */
function streamOf(turn: Exclude<ScriptedTurn, { refused: ARefusedRequest }>, model: unknown, number: number): string {
  const id = `chatcmpl-standin-${number}`
  const chunk = (choice: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, ...choice }], ...extra })}\n\n`
  return [chunk({ delta: messageOf(turn, number) }), chunk({ delta: {}, finish_reason: finishOf(turn) }, { usage: USAGE }), 'data: [DONE]\n\n'].join('')
}

/** A reply whole, for a request that did not ask for a stream. */
function wholeOf(turn: Exclude<ScriptedTurn, { refused: ARefusedRequest }>, model: unknown, number: number): string {
  const choice = { index: 0, message: messageOf(turn, number), finish_reason: finishOf(turn) }
  return JSON.stringify({ id: `chatcmpl-standin-${number}`, object: 'chat.completion', model, choices: [choice], usage: USAGE })
}

/** The API's own body for a refused request. */
const refusalOf = (refused: ARefusedRequest): string => JSON.stringify({ error: { message: refused.message, type: refused.type, code: null } })

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
}

function record(heard: ModelRequest[], body: Record<string, unknown>): ModelRequest {
  const request: ModelRequest = { number: heard.length + 1, body, received_at: Date.now() }
  heard.push(request)
  return request
}

function refuse(response: ServerResponse, refused: ARefusedRequest): void {
  const headers: Record<string, string> = { 'content-type': JSON_TYPE }
  if (refused.retry_after !== undefined) headers['retry-after'] = String(refused.retry_after)
  response.writeHead(refused.status, headers).end(refusalOf(refused))
}

/** Answers one request from the script, and records when the reply went out (martha#264). */
async function answerWithTheScript(script: ModelScript, heard: ModelRequest[], body: Record<string, unknown>, response: ServerResponse): Promise<void> {
  const heardRequest = offersTools(body) ? record(heard, body) : undefined
  const turn = heardRequest === undefined ? A_SIDE_ANSWER : await script(heardRequest)
  const number = heardRequest?.number ?? 0
  if ('refused' in turn) refuse(response, turn.refused)
  else if (body['stream'] === true) response.writeHead(200, { 'content-type': SSE }).end(streamOf(turn, body['model'], number))
  else response.writeHead(200, { 'content-type': JSON_TYPE }).end(wholeOf(turn, body['model'], number))
  if (heardRequest !== undefined) heardRequest.answered_at = Date.now()
}

/** The stand-in: answers each chat completion that offers tools by its number, and every other one with text. */
export async function theOpenAiStandIn(script: ModelScript, heard: ModelRequest[], failed: (why: string) => void): Promise<TheOpenAiStandIn> {
  const answer = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = (request.url ?? '').split('?')[0]
    if (request.method !== 'POST' || path !== THE_PATH_THE_ENGINE_POSTS_TO) {
      response.writeHead(404).end()
      return
    }
    await answerWithTheScript(script, heard, await bodyOf(request), response)
  }
  const server = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      failed(`the stand-in could not answer: ${error instanceof Error ? error.message : String(error)}`)
      response.writeHead(500).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
