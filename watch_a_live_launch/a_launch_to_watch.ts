// The setup both live observations share: a home, a checkout and a crew that only the recorded host can say anything
// about (martha#251, martha#253).
//
// This exists so the two observations Raf runs by hand are the same shape and cannot drift apart: a home and a
// checkout made fresh, a crew declared and its config approved by the owner's own commands, the recorded host started
// by the real `martha start`, and the launcher's own record of what the member took in read back from the crew's rows.
// Everything a run makes sits under one directory the caller removes, and nothing here writes into this tree.
//
// The host is the one the adapter was recorded from, installed by the script beside this file: a run that finds no
// host refuses by name instead of quietly observing nothing.

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { INSTALL_WITHOUT_ASKING, PACKAGE_SWITCH, PINNED_INSTALLER } from '../src/claude_code_host/mesh_server_install.ts'
import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS, type RecordedMeshServer } from '../src/read_a_room_through_its_gate/mesh_server_tools.ts'
import {
  crewRowsDirectoryOf,
  firstRunDone,
  marthaOnATerminal,
  plainTextOf,
  RECORDED_HOST_VARIABLE,
  stateHomeUnder,
  type ModelRequest,
} from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import type { Ingestion } from '../src/refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { ROW_SUFFIX } from '../src/row_streams_directory/row_streams_directory.ts'
import { RECORD_LOST } from '../src/take_in_a_turn/take_in_a_turn.ts'

/** The owner's name in the checkout a run makes: git's own answer for who owns it, never a person. */
export const OWNER_NAME = 'martha-observation'
export const OWNER_EMAIL = 'martha-observation@example.invalid'

/** What the owner types to approve a config, once the gate has shown what it approves. */
const YES = 'yes\r'

/** One observation's home and the checkout inside it, both removed by the caller. */
export interface WatchedPlace {
  readonly home: string
  readonly checkout: string
}

/** What a run's checkout holds before `martha init` reads it. */
export interface CheckoutConfig {
  /** The member's settings, as JSON: its tool permissions among them. */
  readonly settings: unknown
  /** The member's `.mcp.json`: the servers it starts, each pinned. Left out when the observation needs none. */
  readonly servers?: unknown
  /** The house rules the declaration is given after `martha init` wrote it, when the observation needs any. */
  readonly house_rules?: Readonly<Record<string, unknown>>
}

/** The recorded host's binary, from the variable the script beside this file sets. */
export function theRecordedHost(): string {
  const host = process.env[RECORDED_HOST_VARIABLE]
  if (host === undefined || host === '') {
    throw new Error(`${RECORDED_HOST_VARIABLE} names no host: run this observation through the script beside it, which installs the recorded one`)
  }
  return host
}

const git = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', ['-c', `user.name=${OWNER_NAME}`, '-c', `user.email=${OWNER_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim()

/** Runs `martha <args>` in the place's checkout, typing `input`, and refuses when the command did. */
function marthaSaid(place: { readonly home: string; readonly checkout: string }, args: readonly string[], input = ''): string {
  const ran = marthaOnATerminal({ claude: theRecordedHost(), home: place.home, checkout: place.checkout }, args, input)
  if (ran.exit_code !== 0) throw new Error(`martha ${args.join(' ')} refused: ${plainTextOf(ran.shown)}`)
  return plainTextOf(ran.shown)
}

/** The declaration `martha init` wrote, with the house rules this observation turns on, written back as data. */
function declareHouseRules(checkout: string, rules: Readonly<Record<string, unknown>> | undefined): void {
  if (rules === undefined) return
  const path = join(checkout, '.crew', 'crew.json')
  const declaration = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  writeFileSync(path, `${JSON.stringify({ ...declaration, house_rules: rules }, null, 2)}\n`)
}

/** A home and a checkout for one observation: the owner's config committed, the crew declared and the config approved. */
export function aCheckoutToWatch(work: string, config: CheckoutConfig): WatchedPlace {
  const place = aCheckoutMadeIn(work, config)
  firstRunDone(place.home, place.checkout)
  marthaSaid(place, ['init'])
  declareHouseRules(place.checkout, config.house_rules)
  git(place.checkout, 'add', '--all')
  git(place.checkout, 'commit', '-q', '-m', 'the crew')
  marthaSaid(place, ['approve'], YES)
  return place
}

/** A checkout with the owner's config committed, and nothing of Martha's yet. */
function aCheckoutMadeIn(work: string, config: CheckoutConfig): WatchedPlace {
  const home = join(work, 'home')
  const checkout = join(home, 'project')
  mkdirSync(join(checkout, '.claude'), { recursive: true })
  writeFileSync(join(checkout, 'README.md'), 'a project\n')
  writeFileSync(join(checkout, '.claude', 'settings.json'), `${JSON.stringify(config.settings, null, 2)}\n`)
  if (config.servers !== undefined) writeFileSync(join(checkout, '.mcp.json'), `${JSON.stringify(config.servers, null, 2)}\n`)
  git(checkout, 'init', '-q', '.')
  git(checkout, 'config', 'user.name', OWNER_NAME)
  git(checkout, 'config', 'user.email', OWNER_EMAIL)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the project the crew works in')
  return { home, checkout }
}

/** A directory one observation makes everything in, short enough that a relay's socket fits under it. */
export function anObservationDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'mw-'))
}

function readdirSafe(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

const byPosition = (one: string, other: string): number => Number.parseInt(one, 10) - Number.parseInt(other, 10)

/** The record one row file holds, or undefined when it holds none this reads. */
function aKeptRow(path: string): Record<string, unknown> | undefined {
  try {
    const kept: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof kept === 'object' && kept !== null && !Array.isArray(kept) ? (kept as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** The ingestions one kept row holds, in the order the record keeps them. */
function ingestionsIn(row: Record<string, unknown>): readonly Ingestion[] {
  const ingested = row['ingested']
  if (!Array.isArray(ingested)) return []
  return (ingested as Ingestion[]).filter((entry) => entry.path !== RECORD_LOST.path)
}

/** One stream's kept rows, in the order the stream holds them. */
const rowsOfAStream = (stream: string): readonly Record<string, unknown>[] =>
  readdirSafe(stream)
    .filter((name) => name.endsWith(ROW_SUFFIX))
    .sort(byPosition)
    .map((name) => aKeptRow(join(stream, name)))
    .filter((row): row is Record<string, unknown> => row !== undefined)

/**
 * Every ingestion the launcher kept for the members started in this place, in the order each session took them in.
 * A session's record is the WHOLE record in every row of its stream, so only a stream's last row is read: reading
 * them all would count one ingestion once per row after it.
 */
export function rowsTheLauncherKept(place: WatchedPlace): readonly Ingestion[] {
  const rows = crewRowsDirectoryOf(stateHomeUnder(place.home), place.checkout)
  return readdirSafe(rows)
    .map((stream) => rowsOfAStream(join(rows, stream)).at(-1))
    .filter((row): row is Record<string, unknown> => row !== undefined)
    .flatMap((row) => ingestionsIn(row))
}

/** What became of one check: PASS or FAIL by name, and a detail a person reads. */
export interface Report {
  check(what: string, holds: boolean, detail: string): void
  end(): number
}

/** The checks one observation makes, each named, and the exit status they come to. */
export function aReport(): Report {
  const passed: string[] = []
  const failed: string[] = []
  return {
    check: (what, holds, detail) => {
      ;(holds ? passed : failed).push(what)
      console.log(`${holds ? 'PASS' : 'FAIL'} ${what} — ${detail}`)
    },
    end: () => {
      console.log(`\n${passed.length} passed, ${failed.length} failed`)
      for (const what of failed) console.log(`  FAILED ${what}`)
      return failed.length === 0 ? 0 : 1
    },
  }
}

/** Removes what a run made, however it ended. */
export function sweep(paths: readonly string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true })
}

/** A tool call the model made, as the request that carries it shows it. */
export interface AToolCall {
  readonly id: string
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
}

const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

const objectOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** The messages of one model request that offer tools, as the host sent them. */
const messagesIn = (request: ModelRequest): readonly Record<string, unknown>[] =>
  listOf(request.body['messages']).map(objectOf).filter((message): message is Record<string, unknown> => message !== undefined)

/** Every tool call the model has made by this request, in the order it made them. */
export function toolCallsIn(request: ModelRequest): readonly AToolCall[] {
  return messagesIn(request)
    .flatMap((message) => listOf(message['content']))
    .map(objectOf)
    .filter((block): block is Record<string, unknown> => block !== undefined)
    .filter((block) => block['type'] === 'tool_use')
    .map((block) => ({ id: String(block['id']), tool: String(block['name']), input: objectOf(block['input']) ?? {} }))
}

/** The text of a tool result block, whether the host sent one string or a list of blocks. */
const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : listOf(content)
        .map(objectOf)
        .filter((block): block is Record<string, unknown> => block !== undefined && block['type'] === 'text')
        .map((block) => String(block['text']))
        .join('\n')

/** One tool result block's call and text, when the block is one. */
const aToolResult = (value: unknown): readonly [string, string] | undefined => {
  const block = objectOf(value)
  return block === undefined || block['type'] !== 'tool_result' ? undefined : [String(block['tool_use_id']), textOf(block['content'])]
}

/** Every tool result the model has been shown by this request, by the call it answers. */
export function toolResultsIn(request: ModelRequest): ReadonlyMap<string, string> {
  const results = messagesIn(request).flatMap((message) => listOf(message['content']).map(aToolResult))
  return new Map(results.filter((result): result is readonly [string, string] => result !== undefined))
}

/** The result the model was shown for the last call of `tool`, or undefined when it made none. */
export function theResultOfTheLastCallTo(request: ModelRequest, tool: string): string | undefined {
  const calls = toolCallsIn(request).filter((call) => call.tool === tool)
  const last = calls.at(-1)
  return last === undefined ? undefined : toolResultsIn(request).get(last.id)
}

/** The newest mesh server this tree recorded: the version a member's pin names, or why there is none to name. */
export function theNewestRecordedMeshServer(): RecordedMeshServer {
  const newest = RECORDED_MESH_SERVERS.at(-1)
  if (newest === undefined) throw new Error('this tree records no version of the mesh server, so an observation cannot start one')
  return newest
}

/** The words that start the newest recorded mesh server: the pin's own shape, shared by a member's config and a peer. */
export function theMeshServersCommand(): readonly [string, ...string[]] {
  const server = theNewestRecordedMeshServer()
  return [PINNED_INSTALLER, INSTALL_WITHOUT_ASKING, PACKAGE_SWITCH, `${MESH_SERVER_PACKAGE}@${server.server_version}`, server.server_bin]
}

/** A mesh server started as one agent, spoken to over its own protocol: the crew mate on the other end of a ring. */
export class APeerOnTheMesh {
  readonly #child
  readonly #waiting = new Map<number, (answer: unknown) => void>()
  #buffered = ''
  #next = 1

  constructor(command: readonly [string, ...string[]], home: string, agent: string) {
    this.#child = spawn(command[0], command.slice(1), {
      env: { PATH: process.env['PATH'] ?? '', HOME: home, MACULA_MCP_AGENT: agent },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child.stdout.setEncoding('utf8')
    this.#child.stdout.on('data', (chunk: string) => void this.#read(chunk))
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', () => undefined)
  }

  /** Asks the server one request and waits for its answer. */
  #call(method: string, params: unknown, what: string): Promise<unknown> {
    const id = this.#next++
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(id)
        reject(new Error(`${what} did not answer within ${PEER_SECONDS} s`))
      }, PEER_SECONDS * 1000)
      this.#waiting.set(id, (answer) => {
        clearTimeout(timer)
        resolve(answer)
      })
    })
  }

  /** The server's own handshake, then nothing this observation does not ask for. */
  async start(): Promise<this> {
    await this.#call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: PEER_CLIENT, version: PEER_CLIENT_VERSION } }, 'initialize')
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    return this
  }

  /** Calls one of its tools and answers with its text, or undefined when the tool said nothing this reads. */
  async tool(name: string, args: Readonly<Record<string, unknown>>): Promise<string | undefined> {
    const answer = (await this.#call('tools/call', { name, arguments: args }, name)) as { content?: { text?: unknown }[] }
    const text = answer?.content?.[0]?.text
    return typeof text === 'string' ? text : undefined
  }

  stop(): void {
    this.#child.kill('SIGKILL')
  }

  #read(chunk: string): void {
    this.#buffered += chunk
    const lines = this.#buffered.split('\n')
    this.#buffered = lines.pop() ?? ''
    for (const line of lines) this.#take(line)
  }

  #take(line: string): void {
    const answer = objectOf(tryParse(line))
    const id = answer?.['id']
    const waiting = typeof id === 'number' ? this.#waiting.get(id) : undefined
    if (waiting === undefined) return
    this.#waiting.delete(Number(id))
    waiting(answer?.['result'] ?? answer?.['error'])
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** How long a peer's own answer may take before the observation gives up on it. */
export const PEER_SECONDS = 120

/** The client the peer says it is to its server: this observation's own name, never a member's. */
const PEER_CLIENT = 'martha-observation'
const PEER_CLIENT_VERSION = '1'

/** The node id a hello answer carries, from the server's own answer. */
export function nodeIdIn(helloAnswer: string | undefined): string | undefined {
  const parsed = objectOf(tryParse(helloAnswer ?? ''))
  const id = parsed?.['node_id']
  return typeof id === 'string' ? id : undefined
}
