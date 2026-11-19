// `npm run stop:my-run`: the run this checkout started, and nothing else (martha#802).
//
// Every case plants real processes of the suite's own shape — node, with `--test`, running a file that waits forever — so
// what is held is the kernel's answer about a live group, never a stand-in. Each fails under its own name: two runs in
// one checkout are not confused and stopping one leaves the other; a reused pid is refused by the contract's own words;
// a group already gone is reported and its record removed; another checkout's token is refused and its run left alone;
// the walk by working directory finds the groups under the directory it is given and no others; a group half outside
// that directory is refused whole; and a group that holds this command itself is never signalled.
//
// Every plant is killed and every record removed whatever the case does, and the sweeps wait for the kernel rather than
// sleeping a fixed time. A killed run's processes are reaped by this file's own event loop, which is why the command is
// driven asynchronously: a blocking wait would leave its plants as unreaped zombies, and a group of zombies is still a
// group to the kernel.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { linuxProcessIdentities, PROC_ROOT } from '../src/linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import { withoutTheTestContext } from './every_test_run_ends.ts'
import { aNewToken, readTheRecord, removeTheRecord, writeTheRecord, type TheRecordOfATestRun } from './the_record_of_a_test_run.ts'

const NAME = 'stop_my_run'

/** The command a member runs, at the path it lives at. */
const THE_STOPPER = join(import.meta.dirname, 'stop_my_run.ts')

/** The suite's guard, which ends a test file's process once the run that started it is gone. */
const THE_GUARD = pathToFileURL(join(import.meta.dirname, 'every_test_run_ends.ts')).href

/** How long a plant gets to appear, and how long a killed group gets to go. */
const A_PLANT_APPEARS_WITHIN_MS = 20_000
const A_GROUP_GOES_WITHIN_MS = 10_000
const POLL_MS = 50

/** A scratch directory under the temp directory, removed once the test has run. */
function aScratch(t: TestContext, name: string): string {
  const at = mkdtempSync(join(tmpdir(), `martha-802-stop-${name}-`))
  t.after(() => removeTheTree(at))
  return at
}

/** The file a plant runs: one test that waits forever, a process that ends once the run that started it is gone, and,
 * when the case asks for it, a working directory it moves to and a SIGTERM it does not hear. A plant that does not hear
 * SIGTERM is not one that ends with its run: it is the case where the group outlives the signal, and only SIGKILL ends
 * it, which is what `--force` and the file's own cleanup send. */
const thePlantedFile = (planted: { elsewhere?: string; deaf?: boolean }): string => `import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
${planted.deaf === true ? '' : `import { endWithTheRun } from ${JSON.stringify(THE_GUARD)}`}
${planted.elsewhere === undefined ? '' : `process.chdir(${JSON.stringify(planted.elsewhere)})`}
${planted.deaf === true ? "process.on('SIGTERM', () => undefined)" : 'endWithTheRun((code) => process.exit(code))'}
if (process.env.THE_SEEN !== undefined) writeFileSync(process.env.THE_SEEN, JSON.stringify({ pid: process.pid, cwd: process.cwd() }))
test('waits forever', () => new Promise(() => {}))
`

/** A process of the suite's own shape, and where it was planted: the marker its file writes, and what it started. */
interface APlant {
  readonly pid: number
  readonly child: ChildProcess
  readonly seen: string
}

/**
 * A run of the suite: `node --test` over one planted file that waits forever, started in `where`. Detached, it leads a
 * group of its own and everything it starts joins that group; not detached, it joins the group this file runs in.
 */
function aPlant(t: TestContext, where: string, planted: { detached?: boolean; elsewhere?: string; deaf?: boolean }): APlant {
  const folder = aScratch(t, 'run')
  const file = join(folder, 'a_suite_that_waits.node-test.mjs')
  writeFileSync(file, thePlantedFile(planted))
  const seen = join(folder, 'seen')
  const child = spawn(process.execPath, ['--test', file], {
    cwd: where,
    detached: planted.detached ?? true,
    stdio: 'ignore',
    env: { ...withoutTheTestContext(process.env), THE_SEEN: seen },
  })
  const pid = child.pid
  assert.ok(pid !== undefined, `${NAME}: a planted run started no process`)
  const plant = { pid, child, seen }
  t.after(() => thePlantEnded(plant, planted.detached ?? true))
  return plant
}

/** Ends a plant and whatever it started, and waits for the kernel to say so. Nothing this file starts outlives it. */
function thePlantEnded(plant: APlant, detached: boolean): void {
  try {
    // Never this file's own group: only a detached plant leads a group of its own.
    if (detached) process.kill(-plant.pid, 'SIGKILL')
    else process.kill(plant.pid, 'SIGKILL')
  } catch {
    // It ended on its own: what this wanted.
  }
}

/**
 * Waits until the planted file has loaded in the process that runs it — the marker the file writes as it starts. A run
 * is the `node --test` that leads the group and the worker it starts, and a signal sent before the file loaded reaches
 * only the leader: the group is then one process, and a case about a group that does not hear the signal proves nothing.
 */
async function untilThePlantedFileLoaded(plant: APlant): Promise<boolean> {
  return untilSeen(() => {
    try {
      return readFileSync(plant.seen, 'utf8').length > 0
    } catch {
      return false
    }
  }, A_PLANT_APPEARS_WITHIN_MS)
}

/** A record planted for `plant`, its directory removed once the test has run. */
function aPlantedRecord(t: TestContext, pid: number, worktree: string, identity: string): TheRecordOfATestRun {
  const record = { token: aNewToken(), pid, identity, worktree, started_at: new Date().toISOString() }
  writeTheRecord(record)
  t.after(() => removeTheRecord(record.token))
  return record
}

/** The stopper as a member runs it, in `where`, with the runtime directory the planted records live under. */
const theStopper = (args: readonly string[], where: string): Promise<{ status: number | null; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [THE_STOPPER, ...args], {
      cwd: where,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: withoutTheTestContext(process.env),
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
    child.once('close', (status) => resolve({ status, output }))
  })

/** A process's state and group, from the kernel, or nothing when it has gone. */
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

/** Waits until `seen` answers true, or the deadline passes. */
async function untilSeen(seen: () => boolean, within_ms: number): Promise<boolean> {
  const deadline = Date.now() + within_ms
  while (Date.now() < deadline) {
    if (seen()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return seen()
}

/** A process that has ended: its pid, for a record nothing can name any more. */
async function aProcessThatHasEnded(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid as number
  await new Promise((resolve) => child.once('exit', resolve))
  return pid
}

test('#802: two runs in one checkout are not confused — one stops and the other keeps running', async (t) => {
  const where = realpathSync(aScratch(t, 'two-runs'))
  const one = aPlant(t, where, {})
  const other = aPlant(t, where, {})
  assert.equal(await untilThePlantedFileLoaded(one), true, `${NAME}: one planted run's file never loaded in its own process`)
  assert.equal(await untilThePlantedFileLoaded(other), true, `${NAME}: the other planted run's file never loaded in its own process`)
  const first = aPlantedRecord(t, one.pid, where, linuxProcessIdentities.identityOf(one.pid) ?? '')
  const second = aPlantedRecord(t, other.pid, where, linuxProcessIdentities.identityOf(other.pid) ?? '')
  const stopped = await theStopper(['--token', first.token], where)
  assert.equal(stopped.status, 0, `${NAME}: stopping one of two runs did not end it:\n${stopped.output}`)
  assert.equal(await untilSeen(() => !isRunning(one.pid), A_GROUP_GOES_WITHIN_MS), true, `${NAME}: the run it was told to stop is still there`)
  assert.equal(isRunning(other.pid), true, `${NAME}: stopping one run stopped the other run of the same checkout`)
  assert.equal(readTheRecord(first.token), undefined, `${NAME}: the stopped run's record was left behind`)
  assert.ok(readTheRecord(second.token) !== undefined, `${NAME}: the run that was not stopped lost its record`)
})

test('#802: a reused pid is refused in the contract\'s own words, and the process it now names lives', async (t) => {
  const where = realpathSync(aScratch(t, 'reused-pid'))
  const live = aPlant(t, where, {})
  const record = aPlantedRecord(t, live.pid, where, 'an-identity-another-process-held')
  const stopped = await theStopper(['--token', record.token], where)
  assert.equal(stopped.status, 2, `${NAME}: a record whose identity is not its process's was obeyed:\n${stopped.output}`)
  assert.match(stopped.output, new RegExp(`process ${live.pid} is no longer the process that was recorded`), `${NAME}: the refusal is not the contract's:\n${stopped.output}`)
  assert.equal(isRunning(live.pid), true, `${NAME}: a process another identity was recorded under was signalled`)
  assert.equal(readTheRecord(record.token), undefined, `${NAME}: the refused record was kept`)
})

test('#802: a group that is already gone is reported by name, and its record removed', async (t) => {
  const where = realpathSync(aScratch(t, 'gone-group'))
  const gone = await aProcessThatHasEnded()
  const record = aPlantedRecord(t, gone, where, 'an-identity')
  const stopped = await theStopper(['--token', record.token], where)
  assert.equal(stopped.status, 2, `${NAME}: a record whose group is gone was reported as stopped:\n${stopped.output}`)
  assert.match(stopped.output, new RegExp(`the group of process ${gone} is gone`), `${NAME}: the refusal did not name the group:\n${stopped.output}`)
  assert.equal(readTheRecord(record.token), undefined, `${NAME}: a record whose group is gone was kept`)
})

test('#802: another checkout\'s token is refused, and the run it names is left alone', async (t) => {
  const mine = realpathSync(aScratch(t, 'my-checkout'))
  const theirs = realpathSync(aScratch(t, 'their-checkout'))
  const live = aPlant(t, theirs, {})
  const record = aPlantedRecord(t, live.pid, theirs, linuxProcessIdentities.identityOf(live.pid) ?? '')
  const stopped = await theStopper(['--token', record.token], mine)
  assert.equal(stopped.status, 2, `${NAME}: a token from another checkout was obeyed:\n${stopped.output}`)
  assert.match(stopped.output, new RegExp(`was started in ${theirs}, which is not this one, so it was not signalled`), `${NAME}: the refusal did not name the checkout:\n${stopped.output}`)
  assert.equal(isRunning(live.pid), true, `${NAME}: another checkout's run was signalled`)
  assert.ok(readTheRecord(record.token) !== undefined, `${NAME}: another checkout's record was removed`)
  const unnamed = await theStopper([], mine)
  assert.equal(unnamed.status, 2, `${NAME}: a record of another checkout was taken as this checkout's own:\n${unnamed.output}`)
  assert.match(unnamed.output, /no test run of yours is recorded in .*; a run started with npm run test:mine is/, `${NAME}: the other checkout's record was not left out of this checkout's own:\n${unnamed.output}`)
  assert.equal(isRunning(live.pid), true, `${NAME}: a record of another checkout was stopped by a command that had to leave it alone`)
})

test('#802: with no token, one run is stopped and two are named rather than guessed between', async (t) => {
  const where = realpathSync(aScratch(t, 'no-token'))
  const none = await theStopper([], where)
  assert.equal(none.status, 2, `${NAME}: a checkout with no run recorded was answered as stopped:\n${none.output}`)
  assert.match(none.output, /no test run of yours is recorded in .*; a run started with npm run test:mine is/, `${NAME}: the empty answer is not its own:\n${none.output}`)
  const one = aPlant(t, where, {})
  const other = aPlant(t, where, {})
  const first = aPlantedRecord(t, one.pid, where, linuxProcessIdentities.identityOf(one.pid) ?? '')
  const second = aPlantedRecord(t, other.pid, where, linuxProcessIdentities.identityOf(other.pid) ?? '')
  const two = await theStopper([], where)
  assert.equal(two.status, 2, `${NAME}: two recorded runs were stopped without being named:\n${two.output}`)
  assert.match(two.output, new RegExp(`2 runs are recorded in .*: ${[first.token, second.token].sort().join(', ')}; name one with --token, or --all-mine`), `${NAME}: the two runs were not both named:\n${two.output}`)
  assert.equal(isRunning(one.pid) && isRunning(other.pid), true, `${NAME}: a run was stopped that the command only had to name`)
})

test('#802: the walk under one directory stops the suite there and not the same suite under another', async (t) => {
  const here = realpathSync(aScratch(t, 'by-cwd-here'))
  const there = realpathSync(aScratch(t, 'by-cwd-there'))
  const mine = aPlant(t, here, {})
  const theirs = aPlant(t, there, {})
  const stopped = await theStopper(['--by-cwd', here], here)
  assert.equal(stopped.status, 0, `${NAME}: the walk under ${here} did not stop the suite there:\n${stopped.output}`)
  assert.equal(await untilSeen(() => !isRunning(mine.pid), A_GROUP_GOES_WITHIN_MS), true, `${NAME}: the suite under the named directory is still there`)
  assert.equal(isRunning(theirs.pid), true, `${NAME}: the walk stopped the same suite under another directory`)
})

test('#802: a group with a process outside the directory is refused whole, and nothing is signalled', async (t) => {
  const inside = realpathSync(aScratch(t, 'half-inside'))
  const outside = realpathSync(aScratch(t, 'half-outside'))
  const plant = aPlant(t, inside, { elsewhere: outside })
  assert.equal(await untilSeen(() => statOf(plant.pid) !== undefined, A_PLANT_APPEARS_WITHIN_MS), true, `${NAME}: the planted run did not start`)
  const moved = await untilSeen(() => {
    try {
      return readFileSync(plant.seen, 'utf8').includes(outside)
    } catch {
      return false
    }
  }, A_PLANT_APPEARS_WITHIN_MS)
  assert.equal(moved, true, `${NAME}: the planted run's file never moved outside ${inside}, so this case proves nothing`)
  const stopped = await theStopper(['--by-cwd', inside], inside)
  assert.equal(stopped.status, 2, `${NAME}: a group half outside the directory was signalled:\n${stopped.output}`)
  assert.match(stopped.output, new RegExp(`runs outside ${inside}, so that group was not signalled`), `${NAME}: the refusal did not say why:\n${stopped.output}`)
  assert.equal(isRunning(plant.pid), true, `${NAME}: a group with a process outside the directory was signalled`)
})

test('#802: the walk never signals the group this command itself runs in', async (t) => {
  const where = realpathSync(aScratch(t, 'own-group'))
  const plant = aPlant(t, where, { detached: false })
  assert.equal(await untilSeen(() => statOf(plant.pid) !== undefined, A_PLANT_APPEARS_WITHIN_MS), true, `${NAME}: the planted run did not start`)
  const stopped = await theStopper(['--by-cwd', where], where)
  assert.equal(stopped.status, 2, `${NAME}: the walk answered as stopped for the group it runs in:\n${stopped.output}`)
  assert.match(stopped.output, new RegExp(`no process of the suite is running under ${where}`), `${NAME}: the refusal did not say what it found:\n${stopped.output}`)
  assert.equal(isRunning(plant.pid), true, `${NAME}: the walk signalled its own group, which would have ended the shell that called it`)
})

test('#802: the walk reads the kernel it is given, not this machine\'s (--proc)', async (t) => {
  const where = realpathSync(aScratch(t, 'planted-kernel-checkout'))
  const kernel = aScratch(t, 'planted-kernel')
  const group = 4242
  mkdirSync(join(kernel, String(group)))
  writeFileSync(join(kernel, String(group), 'stat'), `${group} (node) S 1 ${group} ${group} 0 -1 0 0 0`)
  writeFileSync(join(kernel, String(group), 'cmdline'), 'node\u0000--test\u0000src/**/*.node-test.ts\u0000')
  symlinkSync(where, join(kernel, String(group), 'cwd'))
  const stopped = await theStopper(['--by-cwd', where, '--proc', kernel], where)
  assert.equal(stopped.status, 2, `${NAME}: the planted kernel tree was not read:\n${stopped.output}`)
  assert.match(stopped.output, new RegExp(`the group of process ${group} is gone`), `${NAME}: the walk did not find the suite the planted tree holds:\n${stopped.output}`)
})

test('#802: a group that does not hear SIGTERM is reported still there, and its record kept', async (t) => {
  const where = realpathSync(aScratch(t, 'still-there'))
  const deaf = aPlant(t, where, { deaf: true })
  assert.equal(await untilThePlantedFileLoaded(deaf), true, `${NAME}: the planted run's file never loaded, so the group held only its leader and this case proves nothing`)
  const record = aPlantedRecord(t, deaf.pid, where, linuxProcessIdentities.identityOf(deaf.pid) ?? '')
  const waited = await theStopper(['--token', record.token], where)
  assert.equal(waited.status, 1, `${NAME}: a group still there after the wait was not reported as such:\n${waited.output}`)
  assert.ok(readTheRecord(record.token) !== undefined, `${NAME}: a run still there after the wait lost its record, so its handle is gone`)
})

test('#802: with --force, a group that does not hear SIGTERM is killed and its record removed', async (t) => {
  const where = realpathSync(aScratch(t, 'forced'))
  const deaf = aPlant(t, where, { deaf: true })
  assert.equal(await untilThePlantedFileLoaded(deaf), true, `${NAME}: the planted run's file never loaded, so the group held only its leader and this case proves nothing`)
  const record = aPlantedRecord(t, deaf.pid, where, linuxProcessIdentities.identityOf(deaf.pid) ?? '')
  const forced = await theStopper(['--token', record.token, '--force'], where)
  assert.equal(forced.status, 0, `${NAME}: --force did not end the group:\n${forced.output}`)
  assert.equal(readTheRecord(record.token), undefined, `${NAME}: the record of a run --force ended was kept`)
})
