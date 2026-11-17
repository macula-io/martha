// A launcher a run left behind is named, and a launcher a run still holds is not (martha#559).
//
// The rule is pinned with no processes of its own, and the check that reads the machine is driven over a kernel the test
// plants: a real leftover on the machine that runs the suite is the machine's business (a run killed there yesterday
// fails this gate by name, which is its job), so nothing here depends on what this machine happens to hold.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { PROC_ROOT } from '../src/linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import {
  A_LAUNCH_HOME_PREFIX,
  A_LEFTOVER_STANDS_MS,
  A_SECOND_MS,
  startTicksIn,
  startedAtOf,
  theHomesLeft,
  theLaunchersLeft,
  theLineOf,
  type AHomeSeen,
  type AProcessSeen,
} from './the_launchers_a_run_left.ts'

/** The check under test, as a program of its own: the one the npm script and CI run. */
const THE_CHECK = 'prove_the_core/no_launcher_outlives_its_run.ts'

/** The moment the rule reads these as: a fixed one, so a test says nothing about how long it took to run. */
const NOW = Date.UTC(2026, 10, 17, 6, 0, 0)

/** The boot the planted kernel holds, in seconds since the epoch, as every real kernel holds its own. */
const THE_BOOT_IN_SECONDS = 1_790_000_000

/** Fields 3 and 4 are the state and the parent, so 5 to 21 come between the parent and the start, which is field 22. */
const FIELDS_BETWEEN_PARENT_AND_START = 21 - 4

/** How many clock ticks this kernel counts to a second, asked of the same source the check asks. */
const A_CLOCK_TICKS_PER_SECOND = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim())

/** How long a real child is left standing before its age is read: longer than any drift in reading a start. */
const A_CHILD_STANDS_MS = 3000

/** How far the child's own word for its start and the kernel's numbers for it may differ. */
const A_START_READING_DRIFT_MS = 1000

/** A process as the kernel lists it: its pid, its parent, what it runs, and how long it has stood. */
const aProc = (pid: number, ppid: number, command_line: string, started_at: number = NOW - 2 * A_LEFTOVER_STANDS_MS) =>
  ({ pid, ppid, command_line, started_at })

/** A home a test run made, under the temp dir the way a run makes one. */
const A_RUNS_HOME = join(tmpdir(), `${A_LAUNCH_HOME_PREFIX}aB3xY9`)

/** The chain a killed run leaves: the terminal `script`, the shell it starts, and the launcher itself. */
const A_KILLED_RUNS_CHAIN = [
  aProc(1, 0, '/sbin/init'),
  aProc(400, 1, '/usr/lib/systemd/systemd --user'),
  aProc(401, 400, `script -qec 'node' '${A_RUNS_HOME}/launcher.ts' /dev/null`),
  aProc(402, 401, `zsh -c node '${A_RUNS_HOME}/launcher.ts'`),
  aProc(403, 402, `node '${A_RUNS_HOME}/launcher.ts'`),
]

/** The same chain under the test runner that started it, which is a run nothing has left (#559). */
const theChainUnderALiveRun = () => [
  aProc(500, 1, 'node --test --test-timeout=60000 src/**/*.node-test.ts'),
  ...A_KILLED_RUNS_CHAIN.map((one) => (one.pid === 400 ? aProc(400, 500, one.command_line) : one)),
]

test('every process of a killed run\'s chain is named on its own, with the home it was started from (#559)', () => {
  const left = theLaunchersLeft(A_KILLED_RUNS_CHAIN, NOW)
  // The terminal, its shell and the launcher each name the home, and each is a process nothing will end: naming only one
  // of them would let a kill leave two behind while the gate reported clean.
  assert.deepEqual(left.map((one) => one.pid), [401, 402, 403])
  assert.deepEqual([...new Set(left.map((one) => one.home))], [A_RUNS_HOME])
  const theLauncher = left.find((one) => one.pid === 403)
  assert.ok(theLauncher !== undefined, 'the launcher itself is named')
  assert.ok(theLineOf(theLauncher).includes(`from ${A_RUNS_HOME}`), 'the line names the home the launcher runs from')
  assert.ok(theLineOf(theLauncher).includes(`${A_RUNS_HOME}/launcher.ts`), 'and what the process is running')
})

test('a run that is still there holds its launchers: nothing above them is left behind (#559)', () => {
  // The same chain, with the test runner that started it still alive above it: a run that has not gone has left
  // nothing, and a gate that named these would fail every suite that is running while another one asks.
  assert.deepEqual(theLaunchersLeft(theChainUnderALiveRun(), NOW), [])
})

test('a process that names no run\'s home is nothing to this rule (#559)', () => {
  assert.deepEqual(theLaunchersLeft([aProc(1, 0, '/sbin/init'), aProc(404, 1, 'node /srv/work/martha/some_test.ts')], NOW), [])
})

test('a pair a run beside this one has just started is not named: it is on its way somewhere (#559)', () => {
  // A suite running beside this one starts and ends `script` pairs the whole time, and some are reparented away from
  // their spawner while their run is alive and well. The wait is what tells those from a pair nothing is coming back
  // for: no test holds a launcher for this long.
  const justStarted = A_KILLED_RUNS_CHAIN.map((one) => aProc(one.pid, one.ppid, one.command_line, NOW - A_LEFTOVER_STANDS_MS / 2))
  assert.deepEqual(theLaunchersLeft(justStarted, NOW), [])
})

test('a home a run made is named once nothing names it and it has stood, and never before (#559)', () => {
  const named = new Set([`${A_RUNS_HOME}`])
  const anOldHome: AHomeSeen = { path: `${A_RUNS_HOME}2`, last_written_at: NOW - 2 * A_LEFTOVER_STANDS_MS }
  const aYoungHome: AHomeSeen = { path: `${A_RUNS_HOME}3`, last_written_at: NOW - A_LEFTOVER_STANDS_MS / 2 }
  assert.deepEqual(theHomesLeft([anOldHome, aYoungHome, { path: A_RUNS_HOME, last_written_at: NOW - 2 * A_LEFTOVER_STANDS_MS }], named, NOW), [anOldHome])
  assert.deepEqual(theHomesLeft([{ path: '/tmp/a-home-a-run-did-not-make', last_written_at: 0 }], named, NOW), [])
})

/** A temp dir the test plants, holding no home a run made: what the check reads when it is driven. */
function aPlantedTemp(t: { after: (what: () => void) => void }): string {
  const temp = mkdtempSync(join(tmpdir(), 'martha-planted-temp-'))
  t.after(() => removeTheTree(temp))
  return temp
}

/**
 * A kernel the test plants: one directory per process, holding the two files the check reads — the command line and the
 * stat line — and the kernel's own `stat` at the root, which holds the `btime` a start time is counted from. Never a
 * directory timestamp: the check must not read a process's age from one (review r=1, Jupiter), and a kernel planted
 * that way would keep the fault hidden.
 *
 * The start time is planted the kernel's way too: field 22, in the clock ticks the host kernel actually counts with.
 */
function aPlantedKernel(t: { after: (what: () => void) => void }, chain: readonly AProcessSeen[]): string {
  const proc = mkdtempSync(join(tmpdir(), 'martha-planted-proc-'))
  writeFileSync(join(proc, 'stat'), `cpu  0 0 0 0 0 0 0 0 0 0\nbtime ${THE_BOOT_IN_SECONDS}\nprocesses 1\n`)
  for (const one of chain) {
    const directory = join(proc, String(one.pid))
    mkdirSync(directory)
    writeFileSync(join(directory, 'cmdline'), `${one.command_line.split(' ').join('\0')}\0`)
    writeFileSync(join(directory, 'stat'), `${aStatLine(one.pid, one.ppid, one.started_at)}\n`)
  }
  t.after(() => removeTheTree(proc))
  return proc
}

/** A kernel's stat line for one process: fields 5 to 21 as the kernel leaves them, with field 22 the planted start. */
function aStatLine(pid: number, ppid: number, started_at: number): string {
  const ticks = Math.round(((started_at - THE_BOOT_IN_SECONDS * A_SECOND_MS) / A_SECOND_MS) * A_CLOCK_TICKS_PER_SECOND)
  // Fields 3 and 4, then 5 to 21 unfilled, then field 22: counted from the last closing parenthesis, index 19.
  return `${pid} (a process) S ${ppid} ${Array.from({ length: FIELDS_BETWEEN_PARENT_AND_START }, () => '0').join(' ')} ${ticks}`
}

test('a process\'s age is read from the kernel\'s own start, never from the /proc directory\'s timestamp (#559 r=1)', async (t) => {
  // A real child on the real kernel, because this is the fault a planted kernel could not show: procfs stamps a
  // process's directory when the directory is first looked at, not when the process started, so a reader that took the
  // age from that stamp answered "just now" for a chain that had stood for hours (Jupiter, on host00: a 6 s old sleep
  // read 0.00 s). Here the child says when it started, it is left standing a while, and its age is read the way the
  // check reads it — from field 22 over CLK_TCK, added to the boot's btime.
  const child = spawn(process.execPath, ['-e', 'process.stdout.write(String(Date.now())); setInterval(() => undefined, 1 << 30)'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => child.kill('SIGKILL'))
  const saidItsStart = Number(
    await new Promise<string>((resolve) => child.stdout?.once('data', (chunk: Buffer) => resolve(chunk.toString()))),
  )
  await new Promise((resolve) => setTimeout(resolve, A_CHILD_STANDS_MS))
  const btime = readFileSync(join(PROC_ROOT, 'stat'), 'utf8')
    .split('\n')
    .find((one) => one.startsWith('btime '))
    ?.split(' ')[1]
  const ticks = startTicksIn(readFileSync(join(PROC_ROOT, String(child.pid), 'stat'), 'utf8'))
  assert.ok(ticks !== undefined, 'the kernel gave no start for a process that is running')
  const read = startedAtOf(ticks, Number(btime), A_CLOCK_TICKS_PER_SECOND)
  assert.ok(
    Math.abs(read - saidItsStart) < A_START_READING_DRIFT_MS,
    `the child says it started at ${saidItsStart} and the kernel's numbers read ${read}, ${Math.abs(read - saidItsStart)} ms apart`,
  )
  // And the reading is not the directory's stamp: that one is set when this line first looks, which is now.
  assert.ok(Math.abs(Date.now() - read) >= A_CHILD_STANDS_MS / 2, 'the age read is the age of a process that has stood')
})

test('the check fails by name over a kernel holding a killed run\'s chain, and answers 0 over the same chain still run (#559)', (t) => {
  const abandoned = aPlantedKernel(t, A_KILLED_RUNS_CHAIN)
  const found = spawnSync(process.execPath, [THE_CHECK, '--proc', abandoned, '--temp', aPlantedTemp(t)], { encoding: 'utf8' })
  assert.equal(found.status, 1, `the check failed to bite: ${found.stdout}${found.stderr}`)
  for (const one of [401, 402, 403]) assert.ok(found.stderr.includes(`pid ${one} still runs a launcher a run left behind`), `pid ${one} is not named: ${found.stderr}`)
  assert.ok(found.stderr.includes(`from ${A_RUNS_HOME}`), `no line says the home: ${found.stderr}`)
  assert.ok(found.stderr.includes('3 launcher(s)'), `no line counts them: ${found.stderr}`)

  const stillRun = aPlantedKernel(t, theChainUnderALiveRun())
  const clean = spawnSync(process.execPath, [THE_CHECK, '--proc', stillRun, '--temp', aPlantedTemp(t)], { encoding: 'utf8' })
  assert.equal(clean.status, 0, `the check failed a run that is still there: ${clean.stdout}${clean.stderr}`)
  assert.ok(clean.stderr.includes('no launcher outlives its run'), clean.stderr)
})

test('the check names a home a run made that nothing has named since, and none that a process still names (#559)', (t) => {
  // The home side of the same question: a launcher that ended without taking its home with it leaves a directory no
  // process names any more, and one a live launcher names is that launcher's for as long as it runs.
  const abandoned = join(aPlantedTemp(t), `${A_LAUNCH_HOME_PREFIX}aband1`)
  const named = join(aPlantedTemp(t), `${A_LAUNCH_HOME_PREFIX}named1`)
  const longAgo = (Date.now() - 2 * A_LEFTOVER_STANDS_MS) / 1000
  for (const home of [abandoned, named]) {
    mkdirSync(home)
    utimesSync(home, longAgo, longAgo)
  }
  const chain = [aProc(401, 400, `script -qec 'node' '${named}/launcher.ts' /dev/null`, Date.now())]
  const found = spawnSync(process.execPath, [THE_CHECK, '--proc', aPlantedKernel(t, chain), '--temp', dirname(abandoned)], { encoding: 'utf8' })
  assert.equal(found.status, 1, `the check failed to bite: ${found.stdout}${found.stderr}`)
  assert.ok(found.stderr.includes(`${abandoned} was left by a run whose launcher is gone`), `the abandoned home is not named: ${found.stderr}`)
  assert.equal(found.stderr.includes(named), false, `a home a live process names was named: ${found.stderr}`)
  assert.ok(found.stderr.includes('1 home(s)'), `no line counts them: ${found.stderr}`)
})

test('the check never passes because it could not look (#559)', (t) => {
  const notAKernel = mkdtempSync(join(tmpdir(), 'martha-not-a-proc-'))
  t.after(() => removeTheTree(notAKernel))
  // A directory the reader is handed holds no /proc: that is not an empty machine, and an empty answer here would say
  // the machine is clean without having read it.
  const refused = spawnSync(process.execPath, [THE_CHECK, '--proc', join(notAKernel, 'gone')], { encoding: 'utf8' })
  assert.equal(refused.status, 2, `the check answered a directory it could not read as if it were a kernel: ${refused.status}`)
  assert.ok(refused.stderr.includes('could not be made'), refused.stderr)
})
