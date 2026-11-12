// The recorded host, driven end to end by a scripted model (martha#132, and #129's recorder on top of it).
//
// This exists so a test can show what a real member does under Martha: the real `martha` command, the real
// Claude Code at the recorded version, the real relay, hooks and launcher. Only the model is a stand-in: a local
// HTTP server the host reaches through ANTHROPIC_BASE_URL, which answers each of the host's model requests by its
// number with a scripted turn (a tool call, or text that ends the turn).
//
// The host runs in a home made for the run, under a pseudo-terminal `script` owns, so `martha start` sees a
// terminal. The home holds the host's own record of a first run already done (onboarding, the stand-in's key
// answered, the checkout trusted), so no first-run question shows. The run types one thing: the owner's turn,
// once `martha start` says the member is up, since `martha start` passes the host no prompt. Nothing answers a
// question by keystroke: a run whose stand-in hears no request while the host shows nothing new fails, with the last
// screen drawn before it.
//
// A model request is one that offers tools: the host's side requests (a title, a summary) offer none, are
// answered with text and are not counted.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'

import { isRunnableFile } from './host_runs_the_relay.ts'
import { anyJournalHasALine, readTheNewestRelayJournal, relayJournalDirectory } from './keep_the_relays_journal.ts'
import { removeTheTree } from './relay_copy.ts'
import { waitWhileTheHostKeepsShowing, type ProgressWait } from './wait_while_the_host_keeps_showing.ts'
import { startedLine } from '../run_the_martha_command/run_the_martha_command.ts'
import { crewRowsDirectory, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/**
 * The state home a run's processes find Martha's state in, under the home the run is given. Exported so a run that
 * reads back what the launcher kept derives it here rather than spelling the shape a second time.
 */
export const stateHomeUnder = (home: string): string => join(home, '.local', 'state')

/**
 * Where a run derived from this home and checkout reads the crew's streams (martha#254): the same place the launcher
 * writes them, derived the launcher's way — the git common directory behind the checkout — so a run that reads a
 * member's rows reads the crew's, and never an empty directory of its own.
 */
export function crewRowsDirectoryOf(state_home: string, checkout: string): string {
  const rows = crewRowsDirectory(join(state_home, STATE_ROOT_NAME), checkout)
  if ('refusal' in rows) throw new Error(rows.refusal)
  return rows.path
}

/** The variable the relay CI job names the recorded host's binary in. */
export const RECORDED_HOST_VARIABLE = 'MARTHA_RECORDED_HOST'

/** The pseudo-terminal runner util-linux provides. */
const PTY_RUNNER = 'script'

/** The terminal type the host draws for. */
export const HOST_TERMINAL = 'xterm-256color'

/** The host's own command that ends its session. */
export const HOST_EXIT_COMMAND = '/exit'

/** The stand-in's key. The host keeps the last characters of a key it was told to use, and compares those. */
const STAND_IN_KEY = `sk-ant-api03-${'0'.repeat(80)}`
const KEY_TAIL_LENGTH = 20

/** Whether the terminal shows what martha start prints once `member` is up, as its startedLine writes it. */
const memberIsUp = (member: string, shown: string): boolean => plainTextOf(shown).includes(startedLine(member, ''))

/**
 * One request the host sent the model, as the stand-in received it. The two times are what a stall is read by
 * (martha#264): a request with no answer is the stand-in's side of a silence, an answered one with nothing after it
 * is the host's.
 */
export interface ModelRequest {
  /** 1 for the first request that offers tools, and so on. */
  readonly number: number
  readonly body: Readonly<Record<string, unknown>>
  /** When the stand-in had read the request whole. */
  readonly received_at: number
  /** When the stand-in handed the host its reply, or undefined while it has not. */
  answered_at?: number
}

/** What the stand-in answers one model request with. */
export type ScriptedTurn =
  | { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }
  | { readonly text: string }

/** The model's turns: answer request `number`, after doing what the run needs done first. */
export type ModelScript = (request: ModelRequest) => ScriptedTurn | Promise<ScriptedTurn>

export interface RecordedHostRun {
  /** The recorded host's binary: the CI job's MARTHA_RECORDED_HOST. */
  readonly claude: string
  /** The checkout the member works in, its crew declared and its config approved. */
  readonly checkout: string
  /** The owner's home for this run: made empty by the caller, removed by the caller. */
  readonly home: string
  /** The member to start. */
  readonly member: string
  /** What the owner types once the member is up. */
  readonly owner_turn: string
  readonly script: ModelScript
  /** How many model requests the run waits for before it ends the host itself; a stopped member ends it sooner. */
  readonly requests: number
  /**
   * Whether the run is done, asked of every request heard so far (martha#251, martha#253). A member's flow completes
   * here rather than at a count, because the host sends requests of its own — a suggestion for the owner's next turn
   * among them — so `requests` is a ceiling, never the flow's last step. A run given none ends at that ceiling.
   */
  readonly completesWhen?: (requests: readonly ModelRequest[]) => boolean
  /** How long the host may show nothing new before the run gives up on it; a host that is working is never cut off. */
  readonly silence_ms: number
}

export interface RecordedHostRan {
  readonly requests: readonly ModelRequest[]
  /** Everything the terminal showed. */
  readonly shown: string
  /** How martha start ended. */
  readonly exit_code: number | null
}

/**
 * A launch that stopped waiting, carrying what it had seen: the terminal and the requests the stand-in heard. It is
 * thrown where the wait gave up, so an observation can still report, by name, what a launch did see instead of only
 * that it threw (martha#251, martha#253).
 */
export class ALaunchThatStopped extends Error {
  readonly requests: readonly ModelRequest[]
  readonly shown: string

  constructor(why: string, seen: { readonly requests: readonly ModelRequest[]; readonly shown: string }) {
    super(why)
    this.name = 'ALaunchThatStopped'
    this.requests = [...seen.requests]
    this.shown = seen.shown
  }
}

/** What a launch had seen when it stopped waiting, or undefined for an error that is not that. */
export const whatTheLaunchSaw = (error: unknown): { readonly requests: readonly ModelRequest[]; readonly shown: string } | undefined =>
  error instanceof ALaunchThatStopped ? { requests: error.requests, shown: error.shown } : undefined

/** The repository's own `martha` command. */
const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

/** The variables a run's processes start with: its own home, the stand-in's address, and where it keeps its state. */
interface RunEnvironment {
  /** The one value the launcher finds its state in, and the one the run derives the journal's directory from (#240 r=1). */
  readonly XDG_STATE_HOME: string
  /** Where a run's processes find their commands, the recorded host's own link first (martha#304). */
  readonly PATH: string
  readonly [name: string]: string
}

/**
 * The recorded host's binary, refused by name when `claude` is not a file this machine can run (martha#304): a run
 * whose host path is wrong must stop, not fall through PATH to whichever other claude is installed and report that
 * host's results as the recorded one's.
 *
 * The path is made absolute once, here, before it is checked and returned: a relative path is looked for from this
 * process's folder, but the link `environmentOf` makes carries the same text into the run's `bin`, where a relative
 * target leads nowhere, so PATH fell through to the system claude (martha#304 r=1). The refusal names the path as the
 * variable held it, which is what a person has to fix.
 */
export function theRecordedHostAt(claude: string): string {
  const host = resolve(claude)
  if (isRunnableFile(host)) return host
  throw new Error(
    `${RECORDED_HOST_VARIABLE} names ${claude}, which is not an executable file: a run that went on would drive whichever claude PATH finds next, and its results would not be the recorded host's`,
  )
}

/**
 * The places a run's processes find their state and sockets in, under its home; exported so a case can read the PATH
 * it builds and the refusal a host it cannot run is given (martha#304).
 */
export function environmentOf(run: Pick<RecordedHostRun, 'claude' | 'home'>, base_url: string, runtime: string): RunEnvironment {
  const claude = theRecordedHostAt(run.claude)
  const bin = join(run.home, 'bin')
  mkdirSync(bin, { recursive: true })
  rmSync(join(bin, 'claude'), { force: true })
  symlinkSync(claude, join(bin, 'claude'))
  return {
    HOME: run.home,
    PATH: [bin, join(process.execPath, '..'), '/usr/bin', '/bin'].join(':'),
    TERM: HOST_TERMINAL,
    XDG_STATE_HOME: stateHomeUnder(run.home),
    XDG_RUNTIME_DIR: runtime,
    ANTHROPIC_BASE_URL: base_url,
    ANTHROPIC_API_KEY: STAND_IN_KEY,
  }
}

/**
 * The host's own record of a first run already done, in `home`: onboarding done, the stand-in's key answered yes,
 * and `checkout` trusted. Every key here is one the recorded host reads.
 */
export function firstRunDone(home: string, checkout: string): void {
  const record = {
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: [STAND_IN_KEY.slice(-KEY_TAIL_LENGTH)], rejected: [] },
    projects: { [checkout]: { hasTrustDialogAccepted: true } },
  }
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify(record)}\n`, { mode: 0o600 })
}

/** Runs `martha <args>` in `checkout` under a pseudo-terminal, typing `input`; its exit code and what it showed. */
export function marthaOnATerminal(run: Pick<RecordedHostRun, 'claude' | 'home' | 'checkout'>, args: readonly string[], input = ''): { readonly exit_code: number | null; readonly shown: string } {
  const runtime = mkdtempSync(join(tmpdir(), 'm-'))
  try {
    const command = [process.execPath, MARTHA, ...args].map(quoted).join(' ')
    const ran = spawnSync(PTY_RUNNER, ['-qefc', command, '/dev/null'], {
      cwd: run.checkout,
      env: environmentOf(run, 'http://127.0.0.1:9', runtime),
      input,
      encoding: 'utf8',
    })
    return { exit_code: ran.status, shown: ran.stdout + ran.stderr }
  } finally {
    // A launch killed mid-run leaves its read-only relay copy here (martha#117).
    removeTheTree(runtime)
  }
}

const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`

/** The server-sent events of one streamed message holding `turn`. */
function streamOf(turn: ScriptedTurn, model: unknown, number: number): string {
  const message = { id: `msg_${number}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  const block =
    'tool' in turn
      ? [
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_standin_${number}`, name: turn.tool, input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.input) } },
        ]
      : [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: turn.text } },
        ]
  const events = [
    { type: 'message_start', message },
    ...block,
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool' in turn ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>)
}

/** Whether a request offers the model tools: the kind the stand-in scripts and counts, rather than answering itself. */
const offersTools = (body: Record<string, unknown>): boolean => Array.isArray(body['tools']) && body['tools'].length > 0

/**
 * Answers one model request with the turn its number names, and records when the reply went out: a silence after this
 * one is the host's side of it, not the stand-in's (martha#264).
 */
async function answerWithTheScript(script: ModelScript, heard: ModelRequest[], body: Record<string, unknown>, response: ServerResponse): Promise<void> {
  const heard_request = offersTools(body) ? record(heard, body) : undefined
  const turn: ScriptedTurn = heard_request === undefined ? { text: 'a side answer' } : await script(heard_request)
  response.writeHead(200, { 'content-type': 'text/event-stream' }).end(streamOf(turn, body['model'], heard.length))
  if (heard_request !== undefined) heard_request.answered_at = Date.now()
}

/** The stand-in model: answers each request offering tools by its number, and every other request with text. */
export async function theStandInModel(script: ModelScript, heard: ModelRequest[], failed: (why: string) => void): Promise<{ readonly url: string; close(): Promise<void> }> {
  const answer = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = request.url ?? ''
    if (request.method !== 'POST' || !url.startsWith('/v1/messages')) {
      response.writeHead(request.method === 'HEAD' ? 200 : 404).end()
      return
    }
    if (url.startsWith('/v1/messages/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: 1 }))
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

function record(heard: ModelRequest[], body: Record<string, unknown>): ModelRequest {
  const request: ModelRequest = { number: heard.length + 1, body, received_at: Date.now() }
  heard.push(request)
  return request
}

/**
 * Why a run read no journal, once the host has sent a model request: no launch in the project's state has a line in
 * its journal, so the wait is standing on the terminal alone and the false red #240 fixes would come back unnamed
 * (r=1). It asks the project, not the newest file: a member started beside the one the run watches writes its own
 * journal as it is made, and that empty file would otherwise fail the running member's run (martha#253).
 */
export function journalNeverWritten(heard: readonly ModelRequest[], directory: string): string | undefined {
  if (heard.length === 0 || anyJournalHasALine(directory)) return undefined
  return `The launcher wrote no line to the journal at ${directory} by the host's first model request, so this run read no journal: a tool that outlasts the silence budget would red it as it did before martha#240`
}

/** The terminal's text with its control sequences taken out, for a person reading a failure. */
export const plainTextOf = (shown: string): string =>
  shown
    .replaceAll(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replaceAll(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replaceAll(/\x1b[()][0-9A-Za-z]/g, '')
    .replaceAll(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

/** The character the host draws in front of the input box the owner's turn is typed into (martha#264). */
export const HOST_PROMPT_MARK = '❯'

/**
 * One of the host's streams, read as text as it arrives (martha#264). A character the host draws can straddle two
 * chunks, and half a character is not the character: a box mark cut in two would read as never drawn, and the run
 * would wait out its whole silence budget at a host that was ready. A decoder keeps the tail of one chunk for the next.
 */
export function textArrivingInChunks(): { readonly write: (chunk: Buffer) => string } {
  const decoder = new StringDecoder('utf8')
  return { write: (chunk) => decoder.write(chunk) }
}

/**
 * Whether the host has drawn the box the owner's turn is typed into (martha#264). Everything the terminal shows grows
 * the screen — `martha start`'s own two lines above the host's — so growth says nothing about the host being ready to
 * take a turn. Run 43030805227 typed the turn into a host still starting: the text sat in its box and no model request
 * was ever sent, and the red could only say the host had shown nothing new.
 */
export const theHostHasDrawnItsPrompt = (shown: string): boolean => plainTextOf(shown).includes(HOST_PROMPT_MARK)

/** What one run's waits are given: the terminal, the requests the stand-in heard, the launcher's journal, and time. */
export interface TheRunsView {
  /** Everything the terminal has shown so far. */
  readonly shown: () => string
  /** Every request the stand-in heard, live: the wait reads it at each look. */
  readonly heard: ModelRequest[]
  /** Where this run's launcher keeps its journal (martha#240). */
  readonly journal_directory: string
  /** Why the stand-in gave up, once it has. */
  readonly failure: () => string | undefined
  readonly silence_ms: number
  readonly run_started_at: number
}

/**
 * One wait of a run, wired the way the drive wires them (martha#240, martha#264). It is built here, not inside the
 * drive, so a case can take the very wait the drive would take and prove it is handed the stand-in's record — the
 * difference between a red that names the silent side and one that says only that the host showed nothing new.
 */
export function aWaitOfTheRun(what: string, holds: () => boolean, view: TheRunsView): ProgressWait {
  return {
    what,
    holds,
    cannotHappen: () => view.failure() ?? journalNeverWritten(view.heard, view.journal_directory),
    shown: view.shown,
    heard: () => view.heard.length,
    model: () => view.heard,
    journal: () => readTheNewestRelayJournal(view.journal_directory),
    silence_ms: view.silence_ms,
    run_started_at: view.run_started_at,
    now: Date.now,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }
}

/**
 * Starts `run.member` with `martha start` on a pseudo-terminal, types the owner's turn once it is up, and lets the
 * stand-in answer the host's model requests by `run.script`. Ends the host with its own exit command once
 * `run.requests` were answered, unless the member was stopped first. Rejects when the host has shown nothing new for
 * `run.silence_ms`, with the last screen (martha#210).
 */
export async function driveTheRecordedHost(run: RecordedHostRun): Promise<RecordedHostRan> {
  // A host path that names nothing runnable is refused here, before the stand-in's server and this run's directory are
  // made, so a run that cannot start leaves nothing behind (martha#304); `environmentOf` refuses it again, where the
  // link to the host is made.
  theRecordedHostAt(run.claude)
  // When the run began, for the elapsed figure a silence is reported with: four waits follow, and each counts its own
  // silence, so none of them may call its own time the run's (martha#210 r=1).
  const run_started_at = Date.now()
  const heard: ModelRequest[] = []
  let failure: string | undefined
  const model = await theStandInModel(run.script, heard, (why) => void (failure ??= why))
  const runtime = mkdtempSync(join(tmpdir(), 'm-'))
  const command = [process.execPath, MARTHA, 'start', run.member].map(quoted).join(' ')
  const environment = environmentOf(run, model.url, runtime)
  // Where the launcher keeps what it is doing (martha#240): derived from the state home this run hands the launcher, so
  // the run reads the path the launcher was told and cannot quietly read none (r=1).
  const journal_directory = relayJournalDirectory(environment.XDG_STATE_HOME, run.checkout)
  const terminal = spawn(PTY_RUNNER, ['-qefc', command, '/dev/null'], { cwd: run.checkout, env: environment, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  let shown = ''
  // Each stream is decoded as it arrives rather than chunk by chunk, so a character split across two chunks still
  // reads whole (martha#264). One decoder per stream, because a partial character on one is not the other's to finish.
  const speaking = { out: textArrivingInChunks(), err: textArrivingInChunks() }
  terminal.stdout.on('data', (chunk: Buffer) => void (shown += speaking.out.write(chunk)))
  terminal.stderr.on('data', (chunk: Buffer) => void (shown += speaking.err.write(chunk)))
  const ended = new Promise<number | null>((resolve) => terminal.once('exit', (code) => resolve(code)))
  let exit_code: number | null | undefined
  void ended.then((code) => void (exit_code = code))
  // A run whose journal stayed empty would fall back to the terminal alone without saying so: named here, where the
  // wait reads the journal, so the run fails by name rather than by the silence it should have replaced (r=1).
  const seen: TheRunsView = {
    shown: () => shown,
    heard,
    journal_directory,
    failure: () => failure,
    silence_ms: run.silence_ms,
    run_started_at,
  }
  const until = async (what: string, done: () => boolean): Promise<void> => {
    try {
      await waitWhileTheHostKeepsShowing(aWaitOfTheRun(what, done, seen))
    } catch (error) {
      throw new ALaunchThatStopped(
        `${error instanceof Error ? error.message : String(error)}. The terminal last showed:\n${plainTextOf(shown).slice(-2000)}`,
        { requests: heard, shown },
      )
    }
  }
  try {
    await until('started member', () => memberIsUp(run.member, shown) || exit_code !== undefined)
    if (exit_code === undefined) {
      // The owner types once the host has drawn its own box, not when anything at all has grown the screen (#264).
      await until('the host drawing its prompt', () => theHostHasDrawnItsPrompt(shown) || exit_code !== undefined)
      terminal.stdin.write(run.owner_turn)
      await new Promise((resolve) => setTimeout(resolve, 500))
      terminal.stdin.write('\r')
    }
    await until(`model request ${run.requests}`, () => heard.length >= run.requests || run.completesWhen?.(heard) === true || exit_code !== undefined)
    if (exit_code === undefined) {
      // The last turn ends in text; once the host has drawn it, end the host the way an owner does.
      await new Promise((resolve) => setTimeout(resolve, 2000))
      terminal.stdin.write(`${HOST_EXIT_COMMAND}\r`)
    }
    await until('end of martha start', () => exit_code !== undefined)
    return { requests: heard, shown, exit_code: exit_code ?? null }
  } finally {
    if (exit_code === undefined && terminal.pid !== undefined) process.kill(-terminal.pid, 'SIGKILL')
    await ended
    await model.close()
    // A launch killed mid-run leaves its read-only relay copy here (martha#117).
    removeTheTree(runtime)
  }
}
