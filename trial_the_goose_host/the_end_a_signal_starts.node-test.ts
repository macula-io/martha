// The two ends of a launch that happen outside its own run: the runner's TERM, and a handshake that throws
// (martha#737).
//
// The driver is the real one, spawned as the runner spawns it, against a stand-in engine that writes the engine logs
// the copy is made of and says where its own process group is. That is what lets a case say what the issue says: after
// the TERM the group is gone, the last line the engine wrote on TERM is in the evidence, and no result is written over
// a launch a signal ended.

import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { aPlaceFor } from './a_launch_the_trial_writes/a_launch_the_trial_writes.ts'
import { THE_KILL_WAIT_MS, THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS, THE_RUNNERS_KILL_AFTER_MS } from './drive_the_trial.ts'
import { THE_LAUNCH_BOUND_KEY } from './the_cap_a_line_gets/the_cap_a_line_gets.ts'
import { THE_ENGINE_LOGS, THE_TRANSCRIPT } from './the_evidence_it_keeps/the_evidence_says_why.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { skillsSwitchFilesSaying } from '../src/know_the_goose_engines_facts/an_engine_source_from_its_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../src/know_the_goose_engines_facts/recorded_goose_engine.ts'

const ROOT = dirname(dirname(new URL(import.meta.url).pathname))
const DRIVER = join(ROOT, 'trial_the_goose_host', 'drive_the_trial.ts')

const made: string[] = []

after(() => {
  for (const directory of made) removeTheTree(directory)
})

function aFreshDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'martha-737-signal-'))
  made.push(directory)
  return directory
}

const MS_IN_A_MINUTE = 60_000

/** How long the copy and the re-raise keep after the longest kill wait, inside what the runner allows after its TERM. */
const THE_LEAST_LEFT_AFTER_THE_KILL_MS = 5_000

/**
 * A message the launch cuts off before its newline: it sits in the pipe's buffer until the exchange is closed, which is
 * what the signal path has to do before it copies (martha#694, and #737's case for it).
 */
const A_MESSAGE_CUT_OFF = '{"jsonrpc":"2.0","method":"session/update","params":{"cut":"off"'

/**
 * An engine that writes one line of its own log, says which group it is in, and never answers the handshake. On TERM
 * it writes the line the copy has to catch, and lingers `lingerMs` before ending, so an end still working can be
 * signalled a second time while it waits for this group to die.
 *
 * Its shebang names the node that runs these tests: a launch hands the engine a PATH of the system's own, so an
 * engine found through PATH is one the launch cannot start.
 */
const anEngineThatKeepsStill = (lingerMs: number): string => [
  `#!${process.execPath}`,
  "import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
  "import { createInterface } from 'node:readline'",
  "const root = process.env.GOOSE_PATH_ROOT ?? ''",
  "const logs = root + '/state/logs/cli/2026-11-18'",
  'mkdirSync(logs, { recursive: true })',
  "const log = logs + '/engine.log'",
  "appendFileSync(log, 'the engine started\\n')",
  // A message without its newline, still in the pipe when the launch ends: only the explicit close keeps it.
  `process.stdout.write(${JSON.stringify(A_MESSAGE_CUT_OFF)})`,
  "process.on('SIGTERM', () => {",
  "  appendFileSync(log, 'the engine was told to end\\n')",
  `  setTimeout(() => process.exit(0), ${lingerMs})`,
  '})',
  "createInterface({ input: process.stdin }).on('line', () => undefined)",
  // Held open as a running engine is: closing the exchange alone must not be what ends it, or a case measures that
  // race instead of the end the launch runs.
  'setInterval(() => undefined, 1_000)',
  // The group it was started in, written last so a case that sees it knows the handler above is in place too. Read the
  // way the driver's own check reads it: this launch is a Linux one (strace, pgrep).
  "const stat = readFileSync('/proc/self/stat', 'utf8')",
  "const group = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[2] ?? String(process.pid)",
  "writeFileSync((process.env.HOME ?? '.') + '/the-group', group + '\\n')",
  '',
].join('\n')

/**
 * An engine that shakes hands and then keeps still: it answers `initialize` and `session/new`, so the line gets a turn
 * of its own, and answers no turn, so the line's own bound is what ends it. On TERM it writes the line the copy has to
 * catch and lingers `lingerMs` before ending, so the signal's end is still waiting for this group when the line reaches
 * its own end (martha#737's guard after `conduct`).
 */
const anEngineThatAnswersThenKeepsStill = (lingerMs: number): string => [
  `#!${process.execPath}`,
  "import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
  "import { createInterface } from 'node:readline'",
  "const root = process.env.GOOSE_PATH_ROOT ?? ''",
  "const logs = root + '/state/logs/cli/2026-11-18'",
  'mkdirSync(logs, { recursive: true })',
  "const log = logs + '/engine.log'",
  "appendFileSync(log, 'the engine started\\n')",
  "process.on('SIGTERM', () => {",
  "  appendFileSync(log, 'the engine was told to end\\n')",
  `  setTimeout(() => process.exit(0), ${lingerMs})`,
  '})',
  'const answers = {',
  '  initialize: { protocolVersion: 1 },',
  "  'session/new': { sessionId: 'a-session', modes: { currentModeId: 'default' } },",
  '}',
  "createInterface({ input: process.stdin }).on('line', (line) => {",
  '  const asked = JSON.parse(line)',
  "  if (asked.method === 'session/prompt') return",
  "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: asked.id, result: answers[asked.method] ?? {} }) + '\\n')",
  '})',
  // Held open as a running engine is, and the group written last so a case that sees it knows the handler is in place.
  'setInterval(() => undefined, 1_000)',
  "const stat = readFileSync('/proc/self/stat', 'utf8')",
  "const group = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[2] ?? String(process.pid)",
  "writeFileSync((process.env.HOME ?? '.') + '/the-group', group + '\\n')",
  '',
].join('\n')

/**
 * A fork checkout carrying the launch's bound where the runner's pins.env carries it, and the source the launch reads
 * its extension map from. The map declares the engine's skills extension, which is what the launch insists an engine
 * say before it will start one, and the two skills switch files the launch reads its skills lines from (martha#614):
 * these cases are about the end of a launch, so nothing else is declared.
 */
function aForkSaying(minutes: string): string {
  const fork = aFreshDirectory()
  const pins = join(fork, 'martha', 'sync', 'pins.env')
  mkdirSync(dirname(pins), { recursive: true })
  writeFileSync(pins, `${THE_LAUNCH_BOUND_KEY}=${minutes}\n`)
  const source = join(fork, 'crates', 'goose', 'src')
  const map = join(source, 'agents', 'platform_extensions', 'mod.rs')
  mkdirSync(dirname(map), { recursive: true })
  writeFileSync(map, [
    "pub fn platform_extensions() -> HashMap<&'static str, PlatformExtensionDef> {",
    '    map.insert(',
    '        crate::skills::EXTENSION_NAME,',
    '        PlatformExtensionDef {',
    '            default_enabled: true,',
    '            hidden: false,',
    '        },',
    '    );',
    '    map',
    '}',
    '',
  ].join('\n'))
  const skills = join(source, 'skills', 'client.rs')
  mkdirSync(dirname(skills), { recursive: true })
  writeFileSync(skills, 'pub static EXTENSION_NAME: &str = "skills";\n')
  for (const [path, text] of Object.entries(skillsSwitchFilesSaying(RECORDED_GOOSE_ENGINE))) {
    mkdirSync(dirname(join(fork, path)), { recursive: true })
    writeFileSync(join(fork, path), text)
  }
  return fork
}

/** A launch's bound, in the minutes pins.env gives, that leaves `leftMs` once the room its own end needs is taken. */
const aLaunchLeaving = (leftMs: number): string => String((THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS + leftMs) / MS_IN_A_MINUTE)

/** The group a pid leads, as the driver's own survivor check names it. */
function survivorsIn(group: string): string[] {
  const found = spawnSync('pgrep', ['-g', group], { encoding: 'utf8' })
  return (found.stdout ?? '').split('\n').map((one) => one.trim()).filter((one) => one !== '')
}

interface Launched {
  readonly evidence: string
  readonly launch: string
  readonly driver: ChildProcess
  readonly done: Promise<{ code: number | null; signal: NodeJS.Signals | null; said: string }>
}

/** The real driver, spawned the way the runner spawns it, with its own home and its own evidence. */
function launchOf(line: number, minutes: string, engineText: string): Launched {
  const work = aFreshDirectory()
  const engine = join(work, 'a-stand-in-engine.mjs')
  writeFileSync(engine, engineText)
  chmodSync(engine, 0o755)
  const evidence = join(work, 'evidence')
  const launch = join(work, 'launches')
  const home = join(work, 'home')
  mkdirSync(home, { recursive: true })
  // The driver is started by the path of the node running these tests, never by a name found through PATH: a launch
  // gives its own home and its own PATH, and the node that runs here is the one that is known to work under them.
  const driver = spawn(process.execPath, [
    DRIVER, '--goose', engine, '--goose-source', aForkSaying(minutes), '--model', 'a-model',
    '--evidence', evidence, '--launch', launch, '--line', String(line), '--ollama', 'http://127.0.0.1:9',
  ], { cwd: ROOT, env: { ...process.env, HOME: home } })
  let said = ''
  driver.stdout?.on('data', (chunk: Buffer) => { said += String(chunk) })
  driver.stderr?.on('data', (chunk: Buffer) => { said += String(chunk) })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; said: string }>((settle) => {
    driver.on('exit', (code, signal) => settle({ code, signal, said }))
  })
  return { evidence, launch, driver, done }
}

/** Waits for what a launch does on its own clock, and says what never came rather than timing out anonymously. */
async function until<T>(what: string, found: () => T | undefined, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = found()
    if (value !== undefined) return value
    await new Promise<void>((settle) => { setTimeout(settle, 25) })
  }
  throw new Error(`the test waited ${String(ms)} ms for ${what} and it never came`)
}

/**
 * The group the launch's engine says it is in, waited for while the launch is still running. A launch that ends first
 * is a failure with the driver's own words in it, never a test that sits still and then says nothing useful.
 */
async function theGroupOf(launched: Launched): Promise<string> {
  const file = join(launched.launch, 'line-1', 'goose-home', 'the-group')
  const reading = (): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined)
  let ended: string | undefined
  void launched.done.then(({ said }) => { ended = said })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const group = reading()
    if (group !== undefined) return group
    if (ended !== undefined) throw new Error(`the launch ended before its engine said which group it is in: ${ended}`)
    await new Promise<void>((settle) => { setTimeout(settle, 25) })
  }
  throw new Error('the launch never started its engine')
}

/** The engine's own log, where the launch copies it into the line's evidence. */
const copiedEngineLog = (evidence: string, line: number): string =>
  join(evidence, `line-${String(line)}`, THE_ENGINE_LOGS, 'cli', '2026-11-18', 'engine.log')

const linesIn = (path: string): string[] => readFileSync(path, 'utf8').split('\n').filter((one) => one !== '')

/** The group an engine said it is in, read after its launch ended: that file outlives the launch's own root. */
const theGroupFileOf = (launched: Launched): string =>
  readFileSync(join(launched.launch, 'line-1', 'goose-home', 'the-group'), 'utf8').trim()

test('the kill wait leaves the copy and the re-raise 5 s of what the runner allows after its TERM (martha#737)', () => {
  const left = THE_RUNNERS_KILL_AFTER_MS - THE_KILL_WAIT_MS
  assert.ok(left >= THE_LEAST_LEFT_AFTER_THE_KILL_MS,
    `the signal path has ${String(left)} ms left after its kill's wait, and the copy and the re-raise need ${String(THE_LEAST_LEFT_AFTER_THE_KILL_MS)}`)
})

test('a launch the runner TERMs closes, kills its group, then keeps the engine\'s last line, and leaves no survivor (martha#737)', async () => {
  const it = launchOf(1, '10', anEngineThatKeepsStill(0))
  try {
    const group = await theGroupOf(it)
    it.driver.kill('SIGTERM')
    const { signal, said } = await it.done
    assert.equal(signal, 'SIGTERM', `the launch still ends the way the runner killed it: ${said}`)
    const copied = copiedEngineLog(it.evidence, 1)
    assert.ok(existsSync(copied), `the engine's logs are in the line's evidence: ${said}`)
    assert.deepEqual(linesIn(copied), ['the engine started', 'the engine was told to end'],
      'the copy was made after the group was dead, so the line the engine writes on TERM is in it')
    const kept = readFileSync(join(it.evidence, 'line-1', THE_TRANSCRIPT), 'utf8').split('\n').filter((one) => one !== '')
      .map((one) => JSON.parse(one) as { direction: string; message: unknown })
    assert.deepEqual(kept.filter(({ direction }) => direction === 'received').map(({ message }) => message),
      [{ text: A_MESSAGE_CUT_OFF }],
      'the exchange was closed before the copy, so the message that crossed without its newline is in the transcript')
    assert.deepEqual(survivorsIn(group), [], 'nothing of the launch outlived it')
  } finally {
    it.driver.kill('SIGKILL')
  }
})

test('a handshake that throws keeps its logs, kills its group, and leaves no root the next launch could take for its own (martha#737)', async () => {
  const it = launchOf(1, aLaunchLeaving(THE_LEAST_LEFT_AFTER_THE_KILL_MS), anEngineThatKeepsStill(0))
  try {
    const { code, said } = await it.done
    assert.equal(code, 0, `the throw is a verdict, not a crash: ${said}`)
    const copied = copiedEngineLog(it.evidence, 1)
    assert.ok(existsSync(copied), 'the engine\'s logs of a launch that never shook hands are kept, not lost with the root')
    assert.deepEqual(linesIn(copied), ['the engine started', 'the engine was told to end'],
      'the group was killed before the copy was made, so the line the engine wrote on the kill is in it')
    assert.deepEqual(survivorsIn(theGroupFileOf(it)), [], 'nothing of that launch outlived it')
    const verdict = JSON.parse(readFileSync(join(it.evidence, 'line-1', 'result.json'), 'utf8')) as { verdict: string }
    assert.equal(verdict.verdict, 'fail', 'a launch that never shook hands is a fail the fork does not relaunch')
    const fresh = aPlaceFor(1, it.evidence, it.launch)
    assert.deepEqual(readdirSync(fresh.root), [], 'a fresh place for this line holds none of the dead launch\'s files')
  } finally {
    it.driver.kill('SIGKILL')
  }
})

test('the line in progress writes no verdict while the signal\'s end is still running (martha#737)', async () => {
  // The handshake's own bound runs out while the end is waiting for this engine to die, so the run reaches its own
  // end in exactly the window the flag exists for. Left unguarded it writes a result over the launch the signal ended.
  // The engine lingers twice as long as the bound to spare, so the two are told apart on a slow host as well.
  const it = launchOf(1, aLaunchLeaving(3_000), anEngineThatKeepsStill(6_000))
  try {
    const group = await theGroupOf(it)
    it.driver.kill('SIGTERM')
    const { signal, said } = await it.done
    assert.equal(signal, 'SIGTERM', `the launch ends the way the runner killed it: ${said}`)
    const copied = copiedEngineLog(it.evidence, 1)
    assert.ok(existsSync(copied), `the end kept the engine's logs: ${said}`)
    assert.deepEqual(linesIn(copied), ['the engine started', 'the engine was told to end'], 'one kill, kept once')
    assert.ok(!existsSync(join(it.evidence, 'line-1', 'result.json')),
      `the line in progress wrote no verdict over the launch the signal ended: ${said}`)
    assert.deepEqual(survivorsIn(group), [], 'nothing of the launch outlived it')
  } finally {
    it.driver.kill('SIGKILL')
  }
})

test('a line that reaches its own end while the signal ends the launch writes no verdict, and kills nothing twice (martha#737)', async () => {
  // The handshake is answered and the turn is never, so the line's own bound ends it inside the window the signal's end
  // spends waiting for this engine to die: the end the guard after `conduct` exists for, with no result written over it.
  const it = launchOf(1, aLaunchLeaving(3_000), anEngineThatAnswersThenKeepsStill(6_000))
  try {
    const group = await theGroupOf(it)
    const transcript = join(it.evidence, 'line-1', THE_TRANSCRIPT)
    await until("the line's first turn to be sent", () => (readFileSync(transcript, 'utf8').includes('"session/prompt"') ? true : undefined))
    it.driver.kill('SIGTERM')
    const { signal, said } = await it.done
    assert.equal(signal, 'SIGTERM', `the launch still ends the way the runner killed it: ${said}`)
    const copied = copiedEngineLog(it.evidence, 1)
    assert.ok(existsSync(copied), `the end kept the engine's logs: ${said}`)
    assert.deepEqual(linesIn(copied), ['the engine started', 'the engine was told to end'], 'one kill reached the engine, so one end ran')
    assert.ok(!existsSync(join(it.evidence, 'line-1', 'result.json')),
      `the line that reached its own end wrote no verdict over the launch the signal ended: ${said}`)
    assert.deepEqual(survivorsIn(group), [], 'nothing of the launch outlived it')
  } finally {
    it.driver.kill('SIGKILL')
  }
})

test('a launch a signal is ending runs once: a second TERM kills and copies nothing more, and writes no result (martha#737)', async () => {
  const it = launchOf(1, '10', anEngineThatKeepsStill(300))
  try {
    const group = await theGroupOf(it)
    it.driver.kill('SIGTERM')
    const copied = copiedEngineLog(it.evidence, 1)
    await until('the end to have copied the engine\'s logs', () => (existsSync(copied) ? true : undefined))
    it.driver.kill('SIGTERM')
    const { said } = await it.done
    assert.deepEqual(linesIn(copied), ['the engine started', 'the engine was told to end'],
      `one kill reached the engine, so one end ran: ${said}`)
    assert.ok(!existsSync(join(it.evidence, 'line-1', 'result.json')),
      'no verdict is written over a launch a signal is ending')
    assert.deepEqual(survivorsIn(group), [], 'nothing of the launch outlived it')
  } finally {
    it.driver.kill('SIGKILL')
  }
})
