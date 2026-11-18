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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { HOME_MARKERS, CHECKOUT_MARKERS, aPlaceFor, plant, writeTheConfig, type Place } from './a_launch_the_trial_writes.ts'
import { NoAnswerInTime, promptOver, withTimeout } from './a_turn_with_goose.ts'
import { findingsIn, pathsIn, type TraceFindings } from './read_the_trace.ts'
import { RecordingProxy } from './record_what_goose_sends.ts'
import { GooseOverAcp } from './speak_acp_to_goose.ts'
import {
  lineEight, lineFive, lineFour, lineNine, lineOne, lineSix, lineThree, lineTwo, sevenAfterTheKill,
  type Line, type Observation, type Trial,
} from './the_nine_lines.ts'

interface Options {
  readonly goose: string
  readonly gooseSource: string
  readonly model: string
  readonly evidence: string
  readonly launch: string
  readonly lines: readonly number[]
  readonly ollama: string
}

interface Running {
  readonly line: number
  readonly options: Options
  readonly place: Place
  readonly proxy: RecordingProxy
  readonly acp: GooseOverAcp
  readonly child: ChildProcess
  readonly tracePath: string
  readonly sessionId: string
  readonly currentMode: string
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

async function startARun(line: number, options: Options): Promise<Running> {
  const place = aPlaceFor(line, options.evidence, options.launch)
  if (line === 1) plant(place.ownerHome, HOME_MARKERS)
  if (line === 2) plant(place.checkout, CHECKOUT_MARKERS)
  const proxy = new RecordingProxy(options.ollama)
  const port = await proxy.start()
  writeTheConfig(place, options.model, `http://127.0.0.1:${port}`, options.gooseSource)
  const evidenceForLine = join(options.evidence, `line-${line}`)
  mkdirSync(evidenceForLine, { recursive: true })
  const tracePath = join(evidenceForLine, 'trace.log')
  const child = startGoose(place, options, line, tracePath)
  const acp = new GooseOverAcp(child)
  const { sessionId, currentMode } = await shakeHands(acp, place)
  return { line, options, place, proxy, acp, child, tracePath, sessionId, currentMode }
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

async function conduct(running: Running): Promise<Observation> {
  if (running.line === 7) {
    running.acp.answers.next = 'allow_once'
    await promptOver(running.acp, running.sessionId, 'Use the shell tool to run: echo the launch has work to end')
    return { verdict: 'not-observed', say: 'the launch is running; what line 7 observes is the kill', evidence: { asked: running.acp.answers.asked.length } }
  }
  const line = LINES[running.line]
  if (line === undefined) throw new Error(`the trial has no line ${running.line}`)
  return line(trialOf(running))
}

function survivorsIn(group: number): string[] {
  const found = spawnSync('pgrep', ['-g', String(group)], { encoding: 'utf8' })
  return (found.stdout ?? '').split('\n').map((one) => one.trim()).filter((one) => one !== '')
}

async function killTheGroup(child: ChildProcess, waitMs = 20000): Promise<string[]> {
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

async function endARun(running: Running): Promise<{ trace: TraceFindings; groupLeft: string[] }> {
  const groupLeft = await killTheGroup(running.child)
  await running.proxy.stop()
  return { trace: readTrace(running.place, running.options.goose, running.tracePath), groupLeft }
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

async function runLine(line: number, options: Options): Promise<void> {
  const running = await startARun(line, options)
  const observation = await conduct(running).catch(theObservationOfALineThatThrew)
  const { trace, groupLeft } = await endARun(running)
  const result = { line, ...verdictOf(line, running.currentMode, observation, trace, groupLeft), trace, groupLeft }
  const evidenceForLine = join(options.evidence, `line-${line}`)
  mkdirSync(evidenceForLine, { recursive: true })
  writeFileSync(join(evidenceForLine, 'result.json'), JSON.stringify(result, null, 2))
  console.log(`line ${line}: ${result.verdict} — ${result.say}`)
}

async function main(): Promise<void> {
  const options = optionsFrom(process.argv.slice(2))
  mkdirSync(options.evidence, { recursive: true })
  for (const line of options.lines) await runLine(line, options)
}

if (import.meta.main) await main()
