// `npm run test:mine`: the suite behind a gate, recorded before it can run a file, and stoppable when it is left on its
// own (martha#802).
//
// One case plants a repository of its own — its own test script, as the_single_file_run_is_the_suites_run.node-test.ts
// plants one — and runs the entry point over it. The planted repository's file is the suite's first act: it reads the
// record root and fails by name without a record there, so a runner that writes the record AFTER the gate is released
// finds nothing and this case goes red on every run, not only sometimes.
//
// The other cases hold what happens when the wrapper dies: killed with SIGTERM it forwards the signal, waits for the
// group to end and removes the record; killed with SIGKILL the record stays beside a live suite, which `npm run
// stop:my-run` then stops; and killed with SIGKILL together with its group, the record is reported stale and removed.
//
// Every plant is killed and every record removed whatever a case does, and every wait is on a condition, never a fixed
// sleep. No case runs the real suite: what the entry point does is the same whatever it starts.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { PROC_ROOT } from '../src/linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import { manifestOf } from './declared_in_package_json.ts'
import { testRunFlagsOf, withoutTheTestContext } from './every_test_run_ends.ts'
import { RECORDS_DIRECTORY, RECORD_FILE, type TheRecordOfATestRun } from './the_record_of_a_test_run.ts'

const NAME = 'run_the_tests_as_mine'

/** The repository this check lives in, whose own package.json the last case reads. */
const repository = join(import.meta.dirname, '..')

/** The entry point, at the path a member runs it by. */
const THE_RUNNER = 'prove_the_core/run_the_tests_as_mine.ts'

/** The command that stops a run, at the path a member runs it by. */
const THE_STOPPER = 'prove_the_core/stop_my_run.ts'

/**
 * Every file the entry point loads, at the path it loads it from, so a copy of it runs anywhere: the entry point itself,
 * the record, and the modules the two import. Nothing here imports a package, so a planted repository needs no
 * node_modules.
 */
const THE_FILES_THE_RUN_READS = [
  THE_RUNNER,
  THE_STOPPER,
  'prove_the_core/the_record_of_a_test_run.ts',
  'prove_the_core/declared_in_package_json.ts',
  'prove_the_core/the_words_one_run_gets.ts',
  'src/linux_process_identity/files_and_processes_on_this_machine.ts',
  'src/linux_process_identity/process_identity_from_proc.ts',
  'src/host_contract/host_contract.ts',
  'src/drive_the_recorded_host/short_relay_root.ts',
  'src/serve_the_relay_to_a_launch/relay_copy.ts',
] as const

/** How long a planted run gets to reach its first act, and how long a killed group gets to go. */
const A_RUN_STARTS_WITHIN_MS = 60_000
const A_GROUP_GOES_WITHIN_MS = 20_000
const POLL_MS = 50

/** A scratch directory under the temp directory, removed once the test has run. */
function aScratch(t: TestContext, name: string): string {
  const at = mkdtempSync(join(tmpdir(), `martha-802-mine-${name}-`))
  t.after(() => removeTheTree(at))
  return at
}

/** The planted suite's own file: its first act is to read the record root, and its one test waits when the case asks. */
const THE_PLANTED_SUITE = `import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const stat = readFileSync('/proc/self/stat', 'utf8')
const pgrp = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2])
let tokens = []
let record = null
try {
  tokens = readdirSync(process.env.THE_RECORDS)
  record = tokens.length === 1 ? JSON.parse(readFileSync(join(process.env.THE_RECORDS, tokens[0], process.env.THE_RECORD_FILE), 'utf8')) : null
} catch {
  tokens = []
}
writeFileSync(process.env.THE_SEEN, JSON.stringify({ tokens, record, pgrp, pid: process.pid, cwd: process.cwd() }))

test('the suite', () => (process.env.THE_HANGS === undefined ? undefined : new Promise(() => {})))
`

/** A repository planted under `where`: its own test script, its own one-file script, and the files the runner reads. */
function aPlantedRepository(where: string): void {
  writeFileSync(
    join(where, 'package.json'),
    JSON.stringify(
      { name: 'a-planted-run', private: true, type: 'module', scripts: { test: "node --test 'suite/*.node-test.mjs'", 'test:file': 'node --test' } },
      null,
      2,
    ),
  )
  for (const file of THE_FILES_THE_RUN_READS) {
    const there = join(where, file)
    mkdirSync(dirname(there), { recursive: true })
    copyFileSync(join(repository, file), there)
  }
  mkdirSync(join(where, 'suite'), { recursive: true })
  writeFileSync(join(where, 'suite', 'the_planted_suite.node-test.mjs'), THE_PLANTED_SUITE)
  // A file the whole-suite glob does not pick: only the one-file script can reach it, so a run that names it and still
  // passes the glob has run the wrong script.
  mkdirSync(join(where, 'elsewhere'), { recursive: true })
  writeFileSync(join(where, 'elsewhere', 'a_file_only_the_one_file_script_reaches.node-test.mjs'), THE_PLANTED_SUITE)
}

/** The record root as the planted run sees it: the one name the record module holds, never a second copy of it. */
const theRecordsUnder = (runtime: string): string => join(runtime, RECORDS_DIRECTORY)

/** The record a planted run wrote, read from the planted repository's own runtime directory, or nothing when none is
 * there: this file's own environment names another one, so the record module's reader is not this case's answer. */
const theRecordIn = (plant: APlant, token: string): TheRecordOfATestRun | undefined => {
  try {
    return JSON.parse(readFileSync(join(plant.records, token, RECORD_FILE), 'utf8')) as TheRecordOfATestRun
  } catch {
    return undefined
  }
}

/** A planted repository, its runtime directory, and the marker its suite writes. */
interface APlant {
  readonly where: string
  readonly seen: string
  readonly env: NodeJS.ProcessEnv
  readonly records: string
}

/** A planted repository under a scratch directory, with a runtime directory and a marker of its own. */
function aPlant(t: TestContext, name: string): APlant {
  const where = realpathSync(aScratch(t, `${name}-checkout`))
  const runtime = aScratch(t, `${name}-runtime`)
  const seen = join(where, 'seen.json')
  aPlantedRepository(where)
  const records = theRecordsUnder(runtime)
  return { where, seen, records, env: { ...withoutTheTestContext(process.env), XDG_RUNTIME_DIR: runtime, THE_RECORDS: records, THE_RECORD_FILE: RECORD_FILE, THE_SEEN: seen } }
}

/** What the planted suite saw when it started, or nothing when it has not started. */
const theSeen = (plant: APlant): { tokens: readonly string[]; record: TheRecordOfATestRun | null; pgrp: number; pid: number; cwd: string } | undefined => {
  try {
    return JSON.parse(readFileSync(plant.seen, 'utf8')) as { tokens: readonly string[]; record: TheRecordOfATestRun | null; pgrp: number; pid: number; cwd: string }
  } catch {
    return undefined
  }
}

/** Waits until `seen` answers true, or the deadline passes. */
async function untilSeen(seen: () => boolean, within_ms: number): Promise<boolean> {
  const deadline = Date.now() + within_ms
  while (Date.now() < deadline) {
    if (seen()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return seen()
}

/** A process's state line, or nothing when it has gone. */
const statOf = (pid: number): string | undefined => {
  try {
    return readFileSync(join(PROC_ROOT, String(pid), 'stat'), 'utf8')
  } catch {
    return undefined
  }
}

/** Whether the kernel still lists `pid` as a process that can do anything: a zombie holds nothing and is gone to this. */
function isRunning(pid: number): boolean {
  const stat = statOf(pid)
  if (stat === undefined) return false
  const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
  return state !== 'Z' && state !== 'X'
}

/** A command run to its end, its own answer and its two streams together. */
interface Ran {
  readonly status: number | null
  readonly output: string
}

/** Runs `node <file>` in a planted repository, with the environment a planted run gets. */
const aNodeRun = (plant: APlant, file: string, args: readonly string[]): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(plant.where, file), ...args], { cwd: plant.where, env: plant.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
    child.once('close', (status) => resolve({ status, output }))
  })

/** The entry point started, and not waited for: a case that must signal it while it runs. */
const theRunnerStarted = (plant: APlant, extra: NodeJS.ProcessEnv): ChildProcess =>
  spawn(process.execPath, [join(plant.where, THE_RUNNER)], { cwd: plant.where, env: { ...plant.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'], detached: false })

/** Waits for a child to end, whatever ended it. */
const theEndOf = (child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))

/** Ends a planted run and everything it started, whatever a case left behind. */
const theRunEnded = (record: TheRecordOfATestRun | null, runner: ChildProcess | undefined): void => {
  try {
    if (record !== null) process.kill(-record.pid, 'SIGKILL')
    else runner?.kill('SIGKILL')
  } catch {
    // It ended on its own: what this wanted.
  }
}

test('#802: the record is there before the suite runs its first file, and names the run\'s group', async (t) => {
  const plant = aPlant(t, 'records-first')
  const ran = await aNodeRun(plant, THE_RUNNER, [])
  assert.equal(ran.status, 0, `${NAME}: the planted run failed:\n${ran.output}`)
  const seen = theSeen(plant)
  assert.ok(seen !== undefined, `${NAME}: the planted suite never ran`)
  assert.notEqual(seen.record, null, `${NAME}: no record was there when the suite ran its first file: the record is written after the gate is released`)
  const record = seen.record as TheRecordOfATestRun
  assert.equal(seen.pgrp, record.pid, `${NAME}: the suite does not run in the group the record names (group ${seen.pgrp}, record ${record.pid})`)
  assert.equal(seen.cwd, plant.where, `${NAME}: the suite ran in ${seen.cwd}, not the checkout`)
  assert.equal(record.worktree, plant.where, `${NAME}: the record names ${record.worktree}, not the checkout the run was started in`)
  assert.equal(theRecordIn(plant, record.token), undefined, `${NAME}: a run that ended left its record behind`)
})

test('#802: with files named, the run goes through the one-file script, in the record\'s group', async (t) => {
  const plant = aPlant(t, 'one-file')
  const ran = await aNodeRun(plant, THE_RUNNER, ['elsewhere/a_file_only_the_one_file_script_reaches.node-test.mjs'])
  assert.equal(ran.status, 0, `${NAME}: the planted one-file run failed:\n${ran.output}`)
  const seen = theSeen(plant)
  assert.ok(seen !== undefined, `${NAME}: the file only the one-file script reaches never ran, so the run did not go through it`)
  assert.notEqual(seen.record, null, `${NAME}: the one-file run wrote no record before its file`)
  assert.equal(seen.pgrp, (seen.record as TheRecordOfATestRun).pid, `${NAME}: the one-file run is not in the group its record names`)
})

test('#802: SIGTERM to the wrapper ends the suite and removes the record', async (t) => {
  const plant = aPlant(t, 'sigterm')
  const runner = theRunnerStarted(plant, { THE_HANGS: '1' })
  let record: TheRecordOfATestRun | null = null
  t.after(() => theRunEnded(record, runner))
  assert.equal(await untilSeen(() => theSeen(plant)?.record != null, A_RUN_STARTS_WITHIN_MS), true, `${NAME}: the planted run wrote no record`)
  record = theSeen(plant)?.record ?? null
  runner.kill('SIGTERM')
  const ended = await theEndOf(runner)
  assert.equal(ended.code, 143, `${NAME}: a wrapper given SIGTERM ended with ${ended.code}, not 128+15`)
  assert.equal(await untilSeen(() => !isRunning((record as TheRecordOfATestRun).pid), A_GROUP_GOES_WITHIN_MS), true, `${NAME}: the run outlived the wrapper that forwarded the signal`)
  assert.equal(theRecordIn(plant, (record as TheRecordOfATestRun).token), undefined, `${NAME}: a run ended by a forwarded signal left its record behind`)
})

test('#802: SIGKILL to the wrapper leaves the run and its record, and stop:my-run ends it', async (t) => {
  const plant = aPlant(t, 'sigkill-wrapper')
  const runner = theRunnerStarted(plant, { THE_HANGS: '1' })
  let record: TheRecordOfATestRun | null = null
  t.after(() => theRunEnded(record, runner))
  assert.equal(await untilSeen(() => theSeen(plant)?.record != null, A_RUN_STARTS_WITHIN_MS), true, `${NAME}: the planted run wrote no record`)
  record = theSeen(plant)?.record ?? null
  runner.kill('SIGKILL')
  await theEndOf(runner)
  assert.equal(await untilSeen(() => theSeen(plant) !== undefined, A_RUN_STARTS_WITHIN_MS), true, `${NAME}: the planted suite never ran`)
  assert.equal(isRunning((record as TheRecordOfATestRun).pid), true, `${NAME}: killing the wrapper also ended the suite, so this case proves nothing`)
  assert.ok(theRecordIn(plant, (record as TheRecordOfATestRun).token) !== undefined, `${NAME}: a wrapper killed outright took the record of a live run with it`)
  const stopped = await aNodeRun(plant, THE_STOPPER, ['--token', (record as TheRecordOfATestRun).token])
  assert.equal(stopped.status, 0, `${NAME}: the record of a live run was not obeyed:\n${stopped.output}`)
  assert.equal(await untilSeen(() => !isRunning((record as TheRecordOfATestRun).pid), A_GROUP_GOES_WITHIN_MS), true, `${NAME}: the run the record named is still there`)
  assert.equal(theRecordIn(plant, (record as TheRecordOfATestRun).token), undefined, `${NAME}: the stopped run's record was left behind`)
})

test('#802: SIGKILL to the wrapper and its group leaves a record reported stale and removed', async (t) => {
  const plant = aPlant(t, 'sigkill-both')
  const runner = theRunnerStarted(plant, { THE_HANGS: '1' })
  let record: TheRecordOfATestRun | null = null
  t.after(() => theRunEnded(record, runner))
  assert.equal(await untilSeen(() => theSeen(plant)?.record != null, A_RUN_STARTS_WITHIN_MS), true, `${NAME}: the planted run wrote no record`)
  record = theSeen(plant)?.record ?? null
  runner.kill('SIGKILL')
  await theEndOf(runner)
  process.kill(-(record as TheRecordOfATestRun).pid, 'SIGKILL')
  assert.equal(await untilSeen(() => !isRunning((record as TheRecordOfATestRun).pid), A_GROUP_GOES_WITHIN_MS), true, `${NAME}: the planted group did not end`)
  const stopped = await aNodeRun(plant, THE_STOPPER, ['--token', (record as TheRecordOfATestRun).token])
  assert.equal(stopped.status, 2, `${NAME}: a record whose group is gone was reported as stopped:\n${stopped.output}`)
  assert.match(stopped.output, /the group of process \d+ is gone/, `${NAME}: the refusal did not name the group:\n${stopped.output}`)
  assert.equal(theRecordIn(plant, (record as TheRecordOfATestRun).token), undefined, `${NAME}: a record whose group is gone was kept`)
})

test('#802: test:mine states none of the bounds the test script states (mutant: a bound carried in test:mine)', () => {
  const manifest = manifestOf(repository)
  const bounds = testRunFlagsOf(manifest)
  assert.ok(bounds.length > 0, `${NAME}: the test script states no bound, so this check would prove nothing`)
  const names = bounds.map((bound) => bound.split('=')[0] as string)
  const words = (manifest.scripts['test:mine'] ?? '').split(/\s+/).filter((word) => word !== '')
  const carried = words.filter((word) => names.includes(word.split('=')[0] as string))
  assert.deepEqual(carried, [], `${NAME}: test:mine carries a bound of its own, which npm test does not: ${carried.join(' ')}`)
  assert.ok(existsSync(join(repository, THE_RUNNER)), `${NAME}: test:mine runs no file this repository holds`)
})

test('#802: every file the planted run reads imports only node\'s own modules and the files copied with it', () => {
  const beyond = THE_FILES_THE_RUN_READS.filter((file) => file.endsWith('.ts')).flatMap((file) =>
    readFileSync(join(repository, file), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('import ') && line.includes('from '))
      .map((line) => /from '([^']+)'/.exec(line)?.[1] ?? '')
      .filter((name) => !name.startsWith('node:') && !(THE_FILES_THE_RUN_READS as readonly string[]).includes(join(dirname(file), name)))
      .map((name) => `${file} imports ${name}`),
  )
  assert.deepEqual(beyond, [], 'a module the planted run copies imports what the copy does not hold')
})
