// A launcher a run left behind is named, and a launcher a run still holds is not (martha#559).
//
// The rule is pinned with no processes of its own, and the check that reads the machine is driven over a kernel the test
// plants: a real leftover on the machine that runs the suite is the machine's business (a run killed there yesterday
// fails this gate by name, which is its job), so nothing here depends on what this machine happens to hold.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import {
  A_LAUNCH_HOME_PREFIX,
  A_LEFTOVER_STANDS_MS,
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
  assert.deepEqual(theLaunchersLeft([aProc(1, 0, '/sbin/init'), aProc(404, 1, 'node /home/someone/work/martha/some_test.ts')], NOW), [])
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
 * stat line — so the check is driven over a tree, never over the machine that runs the suite.
 */
function aPlantedKernel(t: { after: (what: () => void) => void }, chain: readonly AProcessSeen[]): string {
  const proc = mkdtempSync(join(tmpdir(), 'martha-planted-proc-'))
  for (const one of chain) {
    const directory = join(proc, String(one.pid))
    mkdirSync(directory)
    writeFileSync(join(directory, 'cmdline'), `${one.command_line.split(' ').join('\0')}\0`)
    writeFileSync(join(directory, 'stat'), `${one.pid} (a process) S ${one.ppid} 0 0 0\n`)
    // The kernel's own directory for a process holds when it started, which is what the check reads it for.
    utimesSync(directory, one.started_at / 1000, one.started_at / 1000)
  }
  t.after(() => removeTheTree(proc))
  return proc
}

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
