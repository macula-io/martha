// The trial run of macula-io/martha#541's first package: Goose as Martha's second host, nine lines observed on a
// pinned build, with nothing written to the owner's own home.
//
// This exists so the design's shape is proven on a real Goose before any adapter is written. It is a
// throwaway: the record beside it (the_trial_record.md) is the evidence, and this file is what produced it.
//
//   node trial_the_goose_host/drive_the_trial.ts --goose <binary built from macula-apps/goose> \
//     --goose-source <that fork's checkout> --model ministral-3:3b --evidence <dir> [--line <n,n|all>]
//
// Each line gets its own launch: a stand-in owner home full of markers, a GOOSE_PATH_ROOT and HOME written
// for it, a recording proxy between Goose and the local model, and strace over every file Goose opens.
// Run it with HOME set to the stand-in owner home; nothing of it reads or writes the real one.
//
// The launch places live outside the home (--launch, /var/tmp/martha-goose-trial by default) and the launch
// gets a PATH of its own: a checkout under the home makes any search for a repository walk up through the
// home, and the owner's own PATH finds a shell under the home before the system's.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { HOME_MARKERS, CHECKOUT_MARKERS, aPlaceFor, plant, writeTheConfig, type Place } from './a_launch_the_trial_writes.ts'
import { NoAnswerInTime, promptOver, setTheCapInHand, withTimeout } from './a_turn_with_goose.ts'
import { findingsIn, pathsIn, type TraceFindings } from './read_the_trace.ts'
import { RecordingProxy } from './record_what_goose_sends.ts'
import { GooseOverAcp, type Exchange } from './speak_acp_to_goose.ts'
import { TheModelPace, theCapFor, theLaunchesBoundMs, whyTheBoundCannotFit, type TheCapALineGets, type TheCapMadeOf } from './the_cap_a_line_gets.ts'
import { THE_ENGINE_LOGS, THE_TRANSCRIPT, theVerdictKeptWithItsExchange } from './the_evidence_says_why.ts'
import {
  lineEight, lineFive, lineFour, lineNine, lineOne, lineSix, lineThree, lineTwo, sevenAfterTheKill,
  type Line, type Observation, type Trial,
} from './the_nine_lines.ts'

/**
 * How long the launch waits for its own process group to die once it asks it to. On the signal path this wait is
 * spent inside what the runner allows after its own TERM, so the whole of that path — the close, this wait, the copy
 * and the re-raise — has to fit inside THE_RUNNERS_KILL_AFTER_MS (martha#737, whose test holds the room it needs).
 */
export const THE_KILL_WAIT_MS = 20_000

/**
 * What the fork's runner allows between its own TERM and its KILL (martha#737): `timeout --kill-after=30s` in the
 * fork's `martha/sync/run_the_trial_lines.sh:21`. This repository cannot read that script, so the value is cited and
 * not imported, and the script's own comment names this constant back (that is the fork's change, not this one).
 *
 * Only the signal path runs inside it: close the exchange, kill the group, copy the engine's logs, re-raise. It is not
 * the room below, which is what a turn leaves before that TERM is even sent.
 */
export const THE_RUNNERS_KILL_AFTER_MS = 30_000

/**
 * What the end of a launch does after the kill's wait: stop the proxy, read the trace, copy the engine's logs and
 * write the line's result. Nothing times these; this is an allowance, chosen as half the kill's wait, not a
 * measurement (PR 733 A2).
 */
export const THE_ALLOWANCE_FOR_WHAT_FOLLOWS_THE_KILL_MS = THE_KILL_WAIT_MS / 2

/**
 * The room a turn leaves for the end of its launch (PR 733 R2, A2): the kill's wait, at its longest, and the
 * allowance for what follows it. It must cover the whole end: the runner's `timeout` sends TERM at the launch's
 * bound, and `endTheLaunchOnSignal` keeps the engine's logs and then lets that TERM end node, so an end still
 * running then writes no result at all. A turn bounded by the whole launch would only ever fire after that.
 */
export const THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS = THE_KILL_WAIT_MS + THE_ALLOWANCE_FOR_WHAT_FOLLOWS_THE_KILL_MS

/**
 * When a launch started, counted as the runner's `timeout` counts it (PR 733 A2). The runner starts one node
 * process per line, so the first line's launch started with the process itself, before node had loaded the
 * driver, and not when the line got round to starting. A later line in the same process is covered by no
 * `timeout` of the runner's, so its launch starts when it does.
 */
export function whenTheLaunchStarted(lineInTheProcess: number): number {
  return lineInTheProcess === 0 ? Math.floor(performance.timeOrigin) : Date.now()
}

interface Options {
  readonly goose: string
  readonly gooseSource: string
  readonly model: string
  readonly evidence: string
  readonly launch: string
  readonly lines: readonly number[]
  readonly ollama: string
}

/** One line's launch while it runs: what conduct drives. */
export interface Running {
  readonly line: number
  readonly options: Options
  readonly place: Place
  readonly proxy: RecordingProxy
  readonly acp: GooseOverAcp
  readonly child: ChildProcess
  readonly tracePath: string
  readonly sessionId: string
  readonly currentMode: string
  /** The model's own pace, measured as this launch runs: what the line's bound is made from (martha#732). */
  readonly pace: TheModelPace
  /** The bound this line's turns are under, and what it was made of. */
  readonly cap: TheCapALineGets
}

/** The lines that ask the session something; line 7 is the kill, and the driver runs it. */
const LINES: Readonly<Record<number, Line>> = {
  1: lineOne, 2: lineTwo, 3: lineThree, 4: lineFour, 5: lineFive, 6: lineSix, 8: lineEight, 9: lineNine,
}

function optionsFrom(argv: readonly string[]): Options {
  const at = (name: string): string | undefined => {
    const found = argv.indexOf(name)
    return found === -1 ? undefined : argv[found + 1]
  }
  const goose = at('--goose')
  const source = at('--goose-source')
  const model = at('--model')
  const evidence = at('--evidence')
  if ([goose, source, model, evidence].some((one) => one === undefined)) {
    throw new Error('usage: --goose <binary> --goose-source <fork dir> --model <name> --evidence <dir> [--line <n,n|all>] [--ollama <url>]')
  }
  const asked = at('--line') ?? 'all'
  const lines = asked === 'all' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : asked.split(',').map((one) => Number(one))
  return {
    goose: goose!, gooseSource: source!, model: model!, evidence: evidence!,
    launch: at('--launch') ?? '/var/tmp/martha-goose-trial',
    lines, ollama: at('--ollama') ?? 'http://127.0.0.1:11434',
  }
}

/** What Goose is given: a home and a path root of the launch's own, a system PATH, and none of the owner's keys. */
function theEnvironment(place: Place): Record<string, string> {
  return {
    HOME: place.home,
    GOOSE_PATH_ROOT: place.root,
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/sh',
  }
}

function startGoose(place: Place, options: Options, line: number, tracePath: string): ChildProcess {
  const builtins = line === 4 ? ['--with-builtin', 'developer,summon'] : []
  return spawn('strace', ['-f', '-qq', '-e', 'trace=file', '-o', tracePath, '--', options.goose, 'acp', ...builtins], {
    cwd: place.checkout,
    env: theEnvironment(place),
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

async function shakeHands(acp: GooseOverAcp, place: Place): Promise<{ sessionId: string; currentMode: string }> {
  await acp.ask('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'martha-goose-trial', version: '0' },
  })
  const created = await acp.ask('session/new', { cwd: place.checkout, mcpServers: [] }) as {
    readonly sessionId?: string
    readonly modes?: { readonly currentModeId?: string }
  }
  const sessionId = created.sessionId ?? ''
  if (sessionId === '') throw new Error('goose created no session')
  return { sessionId, currentMode: created.modes?.currentModeId ?? 'no mode reported' }
}

/**
 * The engine never answered the handshake, inside what was left of the launch (PR 733 R2). A stall before the
 * first answer is the worst place to stall: the runner's own `timeout` would reap the launch and no result would
 * ever be written, so the run reads as a failure the fork never relaunches rather than as one it knows about.
 */
export class TheEngineNeverAnsweredTheHandshake extends Error {
  readonly ms: number
  constructor(ms: number) {
    super(ms <= 0
      ? 'the launch had no room left for the engine to shake hands in, less than the room its own end needs'
      : `the engine answered no handshake within the ${String(ms)} ms left of the launch`)
    this.name = 'TheEngineNeverAnsweredTheHandshake'
    this.ms = ms
  }
}

/** The handshake, bounded by what is left of the launch, refused by name rather than left to the runner. */
async function handOver(acp: GooseOverAcp, place: Place, remaining: () => number): Promise<{ sessionId: string; currentMode: string }> {
  const left = remaining()
  if (left <= 0) throw new TheEngineNeverAnsweredTheHandshake(left)
  try {
    return await withTimeout(shakeHands(acp, place), left)
  } catch (error) {
    if (error instanceof NoAnswerInTime) throw new TheEngineNeverAnsweredTheHandshake(left)
    throw error
  }
}

async function startARun(line: number, options: Options, launchedAt: number): Promise<Running> {
  const place = aPlaceFor(line, options.evidence, options.launch)
  if (line === 1) plant(place.ownerHome, HOME_MARKERS)
  if (line === 2) plant(place.checkout, CHECKOUT_MARKERS)
  const evidenceForLine = join(options.evidence, `line-${line}`)
  mkdirSync(evidenceForLine, { recursive: true })
  // The model's pace is measured from the proxy's chat answers, into the launch's own evidence, and becomes the
  // bound the line's turns are under: an idle bound, inside what is left of the launch (martha#732).
  const pace = new TheModelPace()
  const theLaunchesBound = theLaunchesBoundMs(options.gooseSource)
  const remaining = (): number => theLaunchesBound - (Date.now() - launchedAt) - THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS
  const cap = theCapFor(pace, remaining)
  const proxy = new RecordingProxy(options.ollama, { into: evidenceForLine, pace })
  const port = await proxy.start()
  writeTheConfig(place, options.model, `http://127.0.0.1:${port}`, options.gooseSource)
  const tracePath = join(evidenceForLine, 'trace.log')
  // The exchange is kept as it crosses, one line per message, in the launch's own evidence directory
  // (martha#694). Written empty first: a launch killed before its first message still leaves the file the
  // verdict is checked against, rather than a directory that looks as if nothing was asked for.
  const transcriptPath = join(evidenceForLine, THE_TRANSCRIPT)
  writeFileSync(transcriptPath, '')
  const keep = (exchange: Exchange): void => {
    appendFileSync(transcriptPath, `${JSON.stringify(exchange)}\n`)
  }
  // Recorded before the engine starts, so a launch killed during the handshake still has its logs kept; the
  // exchange joins it once it exists, so the SIGTERM path can keep what arrived before the kill (martha#694).
  theLaunchInHand = { root: place.root, into: evidenceForLine }
  const child = startGoose(place, options, line, tracePath)
  const acp = new GooseOverAcp(child, keep)
  theLaunchInHand = { root: place.root, into: evidenceForLine, child, close: () => acp.closeTheExchange() }
  try {
    const { sessionId, currentMode } = await handOver(acp, place, remaining)
    return { line, options, place, proxy, acp, child, tracePath, sessionId, currentMode, pace, cap }
  } catch (error) {
    // A launch with no handshake leaves nothing of its own behind: not its group, not the proxy's port, and its
    // engine's logs go into this line's evidence rather than being lost with the root (martha#737). The order is the
    // signal path's — close, kill, copy — and the explicit close is the fallback for the pipe's `end` (martha#694).
    // A launch a signal is already ending has had all three done for it, and a second kill would be the same end twice.
    if (!anEndIsUnderwayOnSignal) {
      acp.closeTheExchange()
      await killTheGroup(child).catch(() => undefined)
      keepTheEngineLogs(place.root, evidenceForLine)
      theLaunchInHand = undefined
    }
    await proxy.stop().catch(() => undefined)
    throw error
  }
}

function trialOf(running: Running): Trial {
  return {
    acp: running.acp,
    proxy: running.proxy,
    place: running.place,
    sessionId: running.sessionId,
    currentMode: running.currentMode,
    model: running.options.model,
    gooseSource: running.options.gooseSource,
  }
}

/**
 * What one launched line observed, and never a throw (martha#612): the line's own verdict, or what it threw recorded by
 * theObservationOfALineThatThrew, so a turn that got no answer in time is `not-observed` here, below every caller. The
 * lines are this trial's own unless a test gives its own.
 */
export async function conduct(running: Running, lines: Readonly<Record<number, Line>> = LINES): Promise<Observation> {
  return conductTheLine(running, lines).catch(theObservationOfALineThatThrew)
}

async function conductTheLine(running: Running, lines: Readonly<Record<number, Line>>): Promise<Observation> {
  setTheCapInHand(running.cap)
  try {
    return await theLineInHand(running, lines)
  } finally {
    setTheCapInHand(undefined)
  }
}

async function theLineInHand(running: Running, lines: Readonly<Record<number, Line>>): Promise<Observation> {
  if (running.line === 7) {
    running.acp.answers.next = 'allow_once'
    await promptOver(running.acp, running.sessionId, 'Use the shell tool to run: echo the launch has work to end')
    return { verdict: 'not-observed', say: 'the launch is running; what line 7 observes is the kill', evidence: { asked: running.acp.answers.asked.length } }
  }
  const line = lines[running.line]
  if (line === undefined) throw new Error(`the trial has no line ${running.line}`)
  return line(trialOf(running))
}

function survivorsIn(group: number): string[] {
  const found = spawnSync('pgrep', ['-g', String(group)], { encoding: 'utf8' })
  return (found.stdout ?? '').split('\n').map((one) => one.trim()).filter((one) => one !== '')
}

async function killTheGroup(child: ChildProcess, waitMs = THE_KILL_WAIT_MS): Promise<string[]> {
  const pid = child.pid ?? 0
  if (pid === 0) return ['the launch had no pid']
  try { process.kill(-pid, 'SIGTERM') } catch { /* it had already ended */ }
  await withTimeout(new Promise<void>((settle) => child.once('exit', () => settle())), waitMs).catch(() => undefined)
  const left = survivorsIn(pid)
  for (const one of left) try { process.kill(Number(one), 'SIGKILL') } catch { /* already gone */ }
  return left
}

function readTrace(place: Place, goose: string, tracePath: string): TraceFindings {
  if (!existsSync(tracePath)) return { opens: 0, underTheOwnerHome: [], underTheRealHome: ['no trace was written'] }
  const allowed = [dirname(resolve(goose)), place.base, dirname(resolve(tracePath))]
  return findingsIn(pathsIn(readFileSync(tracePath, 'utf8')), place.ownerHome, userInfo().homedir, allowed)
}

/**
 * The engine's own request logs, copied into the launch's evidence (martha#694).
 *
 * The engine writes them under its path root as it runs, and they are the other half of the exchange: the
 * transcript says what Martha and the engine told each other, these say what the engine asked the model.
 * Copied after the group is dead (so nothing is mid-write) and, on a launch killed at its bound, from the
 * SIGTERM handler below. Returns how many files were kept, which the result records; a launch that wrote none
 * keeps none, which is itself worth knowing.
 */
export function keepTheEngineLogs(root: string, into: string): number {
  const from = join(root, 'state', 'logs')
  if (!existsSync(from)) return 0
  const to = join(into, THE_ENGINE_LOGS)
  cpSync(from, to, { recursive: true, force: true })
  // The engine keeps its tracing log a folder down (logs/cli/<date>/), beside the request logs: count files, not entries.
  return readdirSync(to, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length
}

/** Where the launch in hand keeps its evidence, the root its engine writes its own logs under, and its group. */
let theLaunchInHand: TheLaunchInHand | undefined

/**
 * Set at the handler's entry, before it awaits anything (martha#737). The event loop keeps running while an end on a
 * signal waits for its group to die, so the line in progress can reach its own end in that window: this flag is what
 * keeps that end from killing the group a second time and from writing a verdict over the launch a signal is ending.
 */
let anEndIsUnderwayOnSignal = false

/**
 * The one end that happens outside the run's own code: the runner's TERM arrives while a line is still running —
 * during the handshake as readily as during a turn — and the group and the logs have to be dealt with before the
 * process dies. The order is `keepTheEngineLogs`'s own (martha#737): close the exchange, kill the group, copy the
 * logs, then raise the TERM again with the handler gone, so the launch still ends the way the runner prints it. All
 * of it fits inside what the runner allows after that TERM, THE_RUNNERS_KILL_AFTER_MS.
 *
 * The exchange is closed first for the reason #694 gives: a message that crossed without its newline is still in the
 * client's buffer, and it is the last thing the reader of the run needs. A launch whose engine never started has
 * nothing to close and no group to kill.
 *
 * The handler goes at the entry, not at the re-raise: a second TERM while this one is still working must not start a
 * second end. Node keeps the process alive while the end runs, and ends it at the TERM raised here.
 */
export async function endTheLaunchOnSignal(): Promise<void> {
  anEndIsUnderwayOnSignal = true
  process.removeListener('SIGTERM', onTheRunnersTerm)
  const launch = theLaunchInHand
  theLaunchInHand = undefined
  try {
    if (launch !== undefined) await endTheLaunch(launch)
  } finally {
    process.kill(process.pid, 'SIGTERM')
  }
}

/** The launch the driver holds while one line runs: where its evidence goes, the group its engine leads, its exchange. */
interface TheLaunchInHand {
  readonly root: string
  readonly into: string
  readonly child?: ChildProcess
  readonly close?: () => void
}

/** Close, kill, copy: the order the signal path and the throw path both take, on the launch the signal took away. */
async function endTheLaunch(launch: TheLaunchInHand): Promise<void> {
  launch.close?.()
  if (launch.child !== undefined) await killTheGroup(launch.child)
  keepTheEngineLogs(launch.root, launch.into)
}

/** What `main` registers: the exported end, driven from the signal that raised it. */
function onTheRunnersTerm(): void {
  void endTheLaunchOnSignal()
}

async function endARun(running: Running): Promise<{ trace: TraceFindings; groupLeft: string[]; engineLogs: number }> {
  const groupLeft = await killTheGroup(running.child)
  // The fallback for the pipe's own `end` event, which normally has flushed the last partial message already: a
  // launch whose stdout ended before any listener could run still keeps what crossed (martha#694). Keeps nothing twice.
  running.acp.closeTheExchange()
  await running.proxy.stop()
  const engineLogs = keepTheEngineLogs(running.place.root, join(running.options.evidence, `line-${running.line}`))
  theLaunchInHand = undefined
  return { trace: readTrace(running.place, running.options.goose, running.tracePath), groupLeft, engineLogs }
}

/** The verdict a line ends with: the mode it reported, what it saw, and what the trace found. */
function verdictOf(line: number, mode: string, observation: Observation, trace: TraceFindings, groupLeft: readonly string[]): Observation {
  const seven = line === 7 ? sevenAfterTheKill(groupLeft, Number(observation.evidence.asked ?? 0)) : undefined
  const chosen = seven ?? observation
  if (mode !== 'approve') return { verdict: 'fail', say: `goose reported mode ${mode}, not approve`, evidence: { ...chosen.evidence, mode } }
  const trespass = trace.underTheOwnerHome.length + trace.underTheRealHome.length
  if (trespass === 0) return { ...chosen, evidence: { ...chosen.evidence, opens: trace.opens } }
  return {
    verdict: 'fail',
    say: `${chosen.say}; the trace found ${trace.underTheOwnerHome.length} open(s) under the owner home and ${trace.underTheRealHome.length} under the real home`,
    evidence: { ...chosen.evidence, trace },
  }
}

/**
 * What a line that threw is recorded as (martha#612). A turn the cap ran out on observed nothing, so it is
 * `not-observed` and the fork's check gives the line its second launch, within the owner's two. Every other error
 * stays `fail`, a wrong answer above all, and is never launched again. A verdict a line reaches without throwing is its
 * own (../the_nine_lines.ts): a new kind of second chance is one more branch here, or in the line that decides it.
 */
export function theObservationOfALineThatThrew(error: unknown): Observation {
  if (error instanceof NoAnswerInTime) {
    return { verdict: 'not-observed', say: `the line observed nothing: ${error.message}, so it may be launched again`, evidence: { no_answer_within_ms: error.ms } }
  }
  return { verdict: 'fail', say: `the line could not be run: ${error instanceof Error ? error.message : String(error)}`, evidence: {} }
}

async function runLine(line: number, options: Options, launchedAt: number): Promise<void> {
  const evidenceForLine = join(options.evidence, `line-${line}`)
  mkdirSync(evidenceForLine, { recursive: true })
  let running: Running
  try {
    running = await startARun(line, options, launchedAt)
  } catch (error) {
    // A line a signal is ending writes no verdict (martha#737): that end has already killed the group and kept the
    // logs, and a result here would say the launch ended in a way it did not.
    if (anEndIsUnderwayOnSignal) return
    // A launch that never got as far as its line still leaves a verdict behind (PR 733 R2): a launch with no
    // result reads as a failure the fork never relaunches, and a kind of failure nobody can read.
    const observation = theObservationOfALineThatThrew(error)
    writeFileSync(join(evidenceForLine, 'result.json'), JSON.stringify({ line, ...observation }, null, 2))
    console.log(`line ${line}: ${observation.verdict} — ${observation.say}`)
    return
  }
  const observation = await conduct(running)
  // The same for a line that reached its own end while the signal's end was still running (martha#737): ending it
  // here would kill its group a second time and write the result the signal's end leaves out on purpose.
  if (anEndIsUnderwayOnSignal) return
  const { trace, groupLeft, engineLogs } = await endARun(running)
  const verdict = theVerdictKeptWithItsExchange(line, verdictOf(line, running.currentMode, observation, trace, groupLeft), evidenceForLine)
  const result = { line, ...verdict, trace, groupLeft, engineLogs, cap: theCapTheLineHad(running) }
  mkdirSync(evidenceForLine, { recursive: true })
  writeFileSync(join(evidenceForLine, 'result.json'), JSON.stringify(result, null, 2))
  console.log(`line ${line}: ${result.verdict} — ${result.say}`)
}

/**
 * What the line's bound was made of, as its result records it (martha#732): the model's own slowest chat answer
 * this launch measured, the margin over it, what was left of the launch, and the bound those made. Recorded
 * whether or not it fitted, since a line cut at the cap is told apart from one the model never answered by it.
 */
function theCapTheLineHad(running: Running): TheCapMadeOf & { readonly whyNot: string | undefined } {
  const made = running.cap.made()
  return { ...made, whyNot: whyTheBoundCannotFit(made) }
}

async function main(): Promise<void> {
  const options = optionsFrom(process.argv.slice(2))
  process.on('SIGTERM', onTheRunnersTerm)
  mkdirSync(options.evidence, { recursive: true })
  for (const [inTheProcess, line] of options.lines.entries()) await runLine(line, options, whenTheLaunchStarted(inTheProcess))
}

if (import.meta.main) await main()
