// npm run stand-in:acp-agent -- '<script as JSON>'
//
// An ACP agent on stdio, answered from a script, for the tests of speak_acp_to_an_agent (macula-io/martha#541, packages 7-8, part B)
// and for a client driven by hand.
// It is run as a child over real pipes, the way the launcher runs the engine.
//
// It speaks as the recorded Goose engine does (src/know_the_goose_engines_facts/): a permission request offers the
// recording's permission_options in the engine's order, each with its kind as its id and its name, as the engine
// builds them (crates/goose/src/acp/server.rs, handle_tool_permission_request). A call the script names is named
// the engine's way, in its `tool_call` update's `_meta` and not in the request. It reads an answer as the engine does,
// by the id sent back; anything else is a cancel. After a call is answered, the call's update says what it heard, so a
// test reads the answer from the agent's side of the wire and not from the client's own record. A call with no id has
// no update the client can file, so its answer is said in the turn's text instead.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { argv, env, exit, stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'

import { STAND_IN_SESSION, THE_ENGINES_OPTIONS, theEnginesNamingOf, whatTheEngineMakesOf, type AStandInsSessionRow, type AStep, type AnAgentScript } from './the_stand_in_agents_script.ts'

type Json = Record<string, unknown>

const script = JSON.parse(argv[2] ?? '{"turns":[]}') as AnAgentScript
const waiting = new Map<number, (message: Json) => void>()
const prompts: string[] = []
let clientCapabilities: unknown
let nextId = 1000
/** How long the stand-in waits after a turn's answer before the steps it plays outside the turn. */
const A_PAUSE_AFTER_THE_ANSWER_MS = 50

const send = (message: Json): void => void stdout.write(`${JSON.stringify(message)}\n`)
const update = (sessionId: string, body: Json): void => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: body } })
const say = (sessionId: string, text: string): void => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })

function request(method: string, params: Json): Promise<Json> {
  const id = nextId++
  send({ jsonrpc: '2.0', id, method, params })
  return new Promise<Json>((settle) => waiting.set(id, settle))
}

/** The id the client answered with, read as the engine reads it, or a cancel. */
function answeredId(answer: Json): string {
  const outcome = (answer['result'] as { outcome?: { outcome?: string; optionId?: unknown } } | undefined)?.outcome
  return outcome?.outcome === 'selected' && typeof outcome.optionId === 'string' ? outcome.optionId : 'cancelled'
}

async function call(sessionId: string, step: Extract<AStep, { call: unknown }>): Promise<void> {
  const { id, title, input, name } = step.call
  const naming = name === undefined ? {} : { _meta: theEnginesNamingOf(name) }
  update(sessionId, { sessionUpdate: 'tool_call', toolCallId: id, title, kind: 'other', status: 'pending', rawInput: input, ...naming })
  const toolCall = { toolCallId: id, title, kind: 'other', status: 'pending', rawInput: input }
  const answer = await request('session/request_permission', { sessionId, toolCall, options: step.options ?? THE_ENGINES_OPTIONS })
  const made = whatTheEngineMakesOf(answeredId(answer))
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: id, status: made.runs === 1 ? 'completed' : 'failed', rawOutput: made })
  if (id === '') say(sessionId, JSON.stringify(made))
}

async function play(sessionId: string, step: AStep): Promise<void> {
  if ('say' in step) say(sessionId, step.say)
  else if ('call' in step) await call(sessionId, step)
  else if ('ask' in step) say(sessionId, JSON.stringify(await request(step.ask, { sessionId })))
  else if ('line' in step) stdout.write(`${step.line}\n`)
  else if ('echo' in step) say(sessionId, prompts.join('|'))
  else if ('capabilities' in step) say(sessionId, JSON.stringify(clientCapabilities))
  else if ('update' in step) update(sessionId, step.update)
  else if ('after_the_answer' in step) return
  else exit(0)
}

async function prompt(id: unknown, params: Json): Promise<void> {
  const sessionId = String(params['sessionId'])
  const blocks = (params['prompt'] as readonly { text?: string }[] | undefined) ?? []
  prompts.push(blocks.map((block) => block.text ?? '').join(''))
  const steps = script.turns[prompts.length - 1] ?? []
  for (const step of steps) await play(sessionId, step)
  send({ jsonrpc: '2.0', id, result: { stopReason: script.stopReason ?? 'end_turn' } })
  const late = steps.flatMap((step) => ('after_the_answer' in step ? step.after_the_answer : []))
  if (late.length === 0) return
  // A pause, so the answer is read and its turn closed before the late steps arrive: they come outside any turn.
  await new Promise((settle) => setTimeout(settle, A_PAUSE_AFTER_THE_ANSWER_MS))
  for (const step of late) await play(sessionId, step)
}

function greet(id: unknown, message: Json): void {
  clientCapabilities = (message['params'] as Json | undefined)?.['clientCapabilities']
  send({ jsonrpc: '2.0', id, result: { protocolVersion: script.protocolVersion ?? 1, agentCapabilities: {} } })
}

/** The store's writer, held open while the stand-in runs, as the engine holds its own. */
let writer: DatabaseSync | undefined

/** Writes the session's row the way the engine does when it opens a session: one row, in a WAL store. */
function writeTheSessionRow(row: AStandInsSessionRow, working_dir: string): void {
  const store = join(env[row.root_variable] ?? '', ...row.path)
  mkdirSync(dirname(store), { recursive: true })
  writer = new DatabaseSync(store)
  writer.exec('PRAGMA journal_mode = WAL')
  writer.exec(`CREATE TABLE "${row.table}" (${row.columns.map((column) => `"${column}" TEXT`).join(', ')})`)
  const fields: Record<string, string> = { ...row.fields, id: STAND_IN_SESSION, working_dir }
  const names = Object.keys(fields)
  writer.prepare(`INSERT INTO "${row.table}" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((name) => fields[name] ?? null))
}

function openASession(id: unknown, params: Json): void {
  if (script.session_row !== undefined) writeTheSessionRow(script.session_row, String(params['cwd']))
  const modes = script.currentModeId === undefined ? undefined : { currentModeId: script.currentModeId, availableModes: [] }
  send({ jsonrpc: '2.0', id, result: { sessionId: STAND_IN_SESSION, modes } })
}

function handle(message: Json): void {
  const { id, method } = message
  if (method === undefined && typeof id === 'number') waiting.get(id)?.(message)
  else if (method === 'initialize') greet(id, message)
  else if (method === 'session/new') openASession(id, (message['params'] ?? {}) as Json)
  else if (method === 'session/prompt') void prompt(id, (message['params'] ?? {}) as Json)
}

createInterface({ input: stdin }).on('line', (line) => {
  if (line.trim() !== '') handle(JSON.parse(line) as Json)
})
