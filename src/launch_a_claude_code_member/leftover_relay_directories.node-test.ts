// A sweep takes a leftover launch directory away, and never a live launch's (#124).
//
// The relay root holds every launch of this user at once, and more than one
// launcher writes into it, so a name proves nothing: each directory is judged by
// the record of the processes that held it. Real directories, real read-only
// copies, and real processes, alive and gone.
//
// A process of another user cannot be planted without root, so the uid half of
// the record's guard is left to its mode half here: a record this process made
// with another mode is the planted case, and the uid is read by the same check.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import {
  linuxProcessIdentities,
  procProcessIdentities,
  type NamespaceOfAProcess,
  type ProcessLookup,
} from '../linux_process_identity/process_identity_from_proc.ts'
import {
  LAUNCHER_RECORD_MODE,
  LAUNCHER_RECORD_NAME,
  type LaunchRecord,
  recordTheLauncher,
  recordTheMember,
  sweepLeftoverLaunchDirectories,
} from './leftover_relay_directories.ts'
import { removeTheTree } from './relay_copy.ts'

/** A relay root of this test's own, removed after it whatever its folders' modes. */
function relayRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-124-'))
  // A test that leaves a read-only copy behind cannot clear it with a plain rm,
  // which is the very thing #124 is about.
  t.after(() => removeTheTree(root))
  return root
}

/**
 * A directory shaped as a launch leaves it: the empty directory (#24) and the
 * read-only relay copy (#117), which is what makes a plain `rm -rf` fail.
 */
function launchShapedDirectory(root: string, name: string, record: LaunchRecord | undefined): string {
  const directory = join(root, name)
  mkdirSync(directory, { mode: 0o700 })
  mkdirSync(join(directory, 'nothing'), { mode: 0o500 })

  const relay = join(directory, 'relay')
  const hooks = join(relay, 'hooks')
  mkdirSync(hooks, { recursive: true, mode: 0o700 })
  writeFileSync(join(hooks, 'hooks.json'), '{}', { mode: 0o400 })
  chmodSync(hooks, 0o500)
  chmodSync(relay, 0o500)

  if (record !== undefined) writeTheRecord(directory, record)
  return directory
}

function writeTheRecord(directory: string, record: LaunchRecord): void {
  writeFileSync(join(directory, LAUNCHER_RECORD_NAME), JSON.stringify(record), { mode: LAUNCHER_RECORD_MODE })
}

/** The pid of a process that has ended, which the kernel no longer holds. */
async function aProcessThatHasEnded(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid
  assert.ok(pid !== undefined)
  await new Promise((resolve) => child.once('exit', resolve))
  return pid
}

/**
 * A process that stays alive until the test kills it: another session's
 * launcher, or a member whose launcher is gone.
 */
async function aLiveProcess(t: TestContext): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  assert.ok(child.pid !== undefined, 'the process this test starts has a pid')
  t.after(() => child.kill('SIGKILL'))
  await new Promise((resolve) => child.once('spawn', resolve))
  return child
}

/** Ends a process a test started, and waits for the kernel to have let it go. */
async function endIt(child: ChildProcess): Promise<void> {
  child.kill('SIGKILL')
  await once(child, 'exit')
}

/** The pid namespace this test process runs in, which the live kernel names. */
function thisNamespace(): string {
  const named = linuxProcessIdentities.pidNamespace()
  assert.ok(named !== undefined, 'the live kernel names the pid namespace this test is in')
  return named
}

/** The record of a process that has ended, under this boot's name, in this pid namespace. */
function deadRecord(pid: number): LaunchRecord {
  return { launcher: { pid, process_started_at: 'this-boot/1' }, namespace: thisNamespace() }
}

/**
 * A /proc of this test's own, holding one process; the boot id can be taken
 * away or put back, and it names its own pid namespace (or cannot).
 */
function fakeProc(
  t: TestContext,
  pid: number,
  boot: string | undefined,
  namespace: string | undefined = THIS_NAMESPACE,
): {
  lookupOf: (of_pid: number) => ProcessLookup
  pidNamespace: NamespaceOfAProcess
  setBoot: (id: string | undefined) => void
} {
  const root = mkdtempSync(join(tmpdir(), 'martha-124-proc-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const fields_after_command = Array.from({ length: 20 }, (_, index) => `${index + 3}`)
  mkdirSync(join(root, String(pid)))
  writeFileSync(join(root, String(pid), 'stat'), `${pid} (claude) ${fields_after_command.join(' ')} 0 0\n`)
  mkdirSync(join(root, 'sys', 'kernel', 'random'), { recursive: true })

  // `readlink` answers for a link whatever it points at, so the namespace needs no file behind it.
  mkdirSync(join(root, 'self', 'ns'), { recursive: true })
  if (namespace !== undefined) symlinkSync(namespace, join(root, 'self', 'ns', 'pid'))

  const bootFile = join(root, 'sys', 'kernel', 'random', 'boot_id')
  const setBoot = (id: string | undefined): void => {
    if (id === undefined) rmSync(bootFile, { force: true })
    else writeFileSync(bootFile, `${id}\n`)
  }
  setBoot(boot)

  const processes = procProcessIdentities(root)
  return { lookupOf: (of_pid) => processes.lookupOf(of_pid), pidNamespace: processes.pidNamespace, setBoot }
}

const BOOT = 'aaaaaaaa-2222-3333-4444-bbbbbbbbbbbb'
const A_PID_IN_A_FAKE_PROC = 4242
const STARTED = '22'

/** As `readlink /proc/self/ns/pid` writes them: a pid namespace for the fake kernel, and another beside it. */
const THIS_NAMESPACE = 'pid:[4026531836]'
const ANOTHER_NAMESPACE = 'pid:[4026531999]'

test('a launch records the processes that hold its directory: the launcher, then its member', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-124-launch-'))
  t.after(() => removeTheTree(directory))
  const launcher = { pid: process.pid, process_started_at: linuxProcessIdentities.identityOf(process.pid) }

  assert.equal(recordTheLauncher(directory), undefined, 'the record is written')
  assert.deepEqual(JSON.parse(readFileSync(join(directory, LAUNCHER_RECORD_NAME), 'utf8')), {
    launcher,
    namespace: thisNamespace(),
  })
  assert.equal(lstatSync(join(directory, LAUNCHER_RECORD_NAME)).mode & 0o777, LAUNCHER_RECORD_MODE, 'with the mode a sweep reads it by, whatever the umask')

  const member = await aLiveProcess(t)
  assert.equal(recordTheMember(directory, member.pid ?? 0), undefined, 'the member is added to the record')
  assert.deepEqual(JSON.parse(readFileSync(join(directory, LAUNCHER_RECORD_NAME), 'utf8')), {
    launcher,
    member: { pid: member.pid, process_started_at: linuxProcessIdentities.identityOf(member.pid ?? 0) },
    namespace: thisNamespace(),
  })
})

test('a sweep takes away a leftover whose launcher is gone, read-only copy and all, and leaves nothing in the relay root', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()
  assert.equal(linuxProcessIdentities.identityOf(gone), null, 'the process this test names is really gone')
  const leftover = launchShapedDirectory(root, 'a-leftover', deadRecord(gone))

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [leftover])
  assert.equal(existsSync(leftover), false, 'the leftover, its read-only copy included, is gone')
})

test("a sweep leaves another session's live launch alone, and takes it once that session is gone (#124)", async (t) => {
  const root = relayRoot(t)
  const other = await aLiveProcess(t)
  const live = join(root, 'another-sessions-launch')
  mkdirSync(live, { mode: 0o700 })
  assert.equal(recordTheLauncher(live, other.pid ?? 0), undefined)

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [], "a sweep spares another session's live launch")
  assert.equal(existsSync(live), true)
  assert.equal(existsSync(join(live, LAUNCHER_RECORD_NAME)), true)

  await endIt(other)
  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [live], 'and takes it once that session is dead')
})

test('a sweep acts on its own pid namespace and on no other (#124 r=3)', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()
  // These pids are gone in this namespace. A container sharing this runtime dir
  // -- a Wayland or PipeWire bind mount is enough -- numbers its pids elsewhere,
  // so the same record there can be a live launch this sweep cannot see.
  const elsewhere = launchShapedDirectory(root, 'a-launch-in-another-pid-namespace', {
    launcher: { pid: gone, process_started_at: 'this-boot/1' },
    namespace: ANOTHER_NAMESPACE,
  })
  const here = launchShapedDirectory(root, 'a-leftover-of-this-namespace', deadRecord(gone))

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [here], 'a pid is evidence only inside the namespace it was read in')
  assert.equal(existsSync(elsewhere), true, 'the other namespace writes into this root too, and its live launch looks exactly like this')
})

test('a sweep leaves alone a record that names no pid namespace, or no namespace at all (#124 r=3)', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()
  const launcher = { pid: gone, process_started_at: 'this-boot/1' }
  // A record an earlier Martha wrote, with the namespace field to come later.
  const older = launchShapedDirectory(root, 'a-record-from-before-the-namespace', undefined)
  writeFileSync(join(older, LAUNCHER_RECORD_NAME), JSON.stringify({ launcher }), { mode: LAUNCHER_RECORD_MODE })
  // A record whose namespace is not one the kernel could have written.
  const nonsense = launchShapedDirectory(root, 'a-record-that-names-no-namespace', { launcher, namespace: 'not-a-namespace' })

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [], 'a record a sweep cannot place in a namespace is not one it can vouch for')
  for (const kept of [older, nonsense]) assert.equal(existsSync(kept), true, kept)
})

test('a sweep of a process that cannot name its own pid namespace sweeps nothing (#124 r=3)', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()
  const dead = launchShapedDirectory(root, 'a-leftover', deadRecord(gone))

  assert.deepEqual(
    sweepLeftoverLaunchDirectories(root, linuxProcessIdentities.lookupOf, () => undefined),
    [],
    'without a namespace of its own, a sweep cannot place any record',
  )
  assert.equal(existsSync(dead), true)
  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [dead], 'and with it, the same leftover goes')
})

test("a launch that cannot be given a pid namespace's name is refused, and records nothing (#124 r=4)", (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-124-launch-'))
  t.after(() => removeTheTree(directory))

  const refused = recordTheLauncher(directory, process.pid, () => undefined)

  // No record means no sweep can ever vouch for the directory, so the launch
  // stops here rather than starting a member it could only refuse later, with
  // "launcher.json could not be read back" naming a cause that is not the cause.
  assert.match(refused ?? '', /pid namespace/, 'a launch that cannot say which pid namespace it is in has no record a sweep could act on')
  assert.equal(existsSync(join(directory, LAUNCHER_RECORD_NAME)), false, 'so it is refused before its member is spawned, not recorded and then killed')
  assert.equal(recordTheLauncher(directory), undefined, 'and the same directory records fine when the kernel names the namespace')
})

test('a launch whose own process the kernel cannot name is refused too, and records nothing (#124 r=4)', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-124-launch-'))
  t.after(() => removeTheTree(directory))
  const gone = await aProcessThatHasEnded()

  assert.match(recordTheLauncher(directory, gone) ?? '', /could not be named/, 'a pid this kernel does not hold leaves nothing to record')
  assert.equal(existsSync(join(directory, LAUNCHER_RECORD_NAME)), false)
})

test('a directory stays while the member of a killed launcher lives, and goes once the member does (#124)', async (t) => {
  const root = relayRoot(t)
  const goneLauncher = await aProcessThatHasEnded()
  const member = await aLiveProcess(t)
  const leftover = launchShapedDirectory(root, 'a-member-outliving-its-launcher', deadRecord(goneLauncher))
  assert.equal(recordTheMember(leftover, member.pid ?? 0), undefined)

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [], 'the member still loads its relay copy from this directory')
  assert.equal(existsSync(leftover), true)

  await endIt(member)
  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [leftover], 'with both gone the directory is a leftover')
})

test('a sweep takes away a directory whose pid the kernel gave to another process since', async (t) => {
  const root = relayRoot(t)
  const recycled = launchShapedDirectory(root, 'a-recycled-pid', deadRecord(process.pid))

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [recycled], 'another start time under the same pid is another process')
})

test('a sweep removes nothing it cannot prove, and a read that failed is not proof (#124)', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()
  const notTelling = (): ProcessLookup => ({ found: 'unknown', why: 'EMFILE: too many open files' })
  const readFailed = launchShapedDirectory(root, 'a-read-that-failed', deadRecord(gone))

  assert.deepEqual(sweepLeftoverLaunchDirectories(root, notTelling), [], 'a read that could not say leaves the directory')
  assert.equal(existsSync(readFailed), true)
})

test('a sweep of a kernel that cannot name this boot sweeps nothing (#124)', (t) => {
  const root = relayRoot(t)
  const proc = fakeProc(t, A_PID_IN_A_FAKE_PROC, undefined)
  const dead = launchShapedDirectory(root, 'a-dead-pid', deadRecord(999_999))

  assert.deepEqual(sweepLeftoverLaunchDirectories(root, proc.lookupOf), [], 'no boot id means this kernel cannot tell a stale pid from a gone one')
  assert.equal(existsSync(dead), true, 'so the leftover stays until a sweep can prove it is one')

  proc.setBoot(BOOT)
  assert.deepEqual(sweepLeftoverLaunchDirectories(root, proc.lookupOf), [dead], 'with the boot id read, a gone pid is proven gone')
})

test('a sweep of the same kernel leaves a process it can name, and takes one that is gone (#124)', async (t) => {
  const root = relayRoot(t)
  const proc = fakeProc(t, A_PID_IN_A_FAKE_PROC, BOOT)
  const held = launchShapedDirectory(root, 'a-held-pid', {
    launcher: { pid: A_PID_IN_A_FAKE_PROC, process_started_at: `${BOOT}/${STARTED}` },
    namespace: thisNamespace(),
  })
  const gone = await aProcessThatHasEnded()
  const dead = launchShapedDirectory(root, 'a-gone-pid', deadRecord(gone))

  assert.deepEqual(sweepLeftoverLaunchDirectories(root, proc.lookupOf), [dead], 'the pid the kernel holds stays, the one it does not goes')
  assert.equal(existsSync(held), true)
})

test('a sweep reads a record by the namespace the kernel itself names, not by the record alone (#124 r=3)', (t) => {
  const root = relayRoot(t)
  const proc = fakeProc(t, A_PID_IN_A_FAKE_PROC, BOOT)
  const mine = launchShapedDirectory(root, 'a-gone-pid-of-this-namespace', {
    launcher: { pid: 999_999, process_started_at: `${BOOT}/1` },
    namespace: THIS_NAMESPACE,
  })
  const theirs = launchShapedDirectory(root, 'a-gone-pid-of-another-namespace', {
    launcher: { pid: 999_998, process_started_at: `${BOOT}/1` },
    namespace: ANOTHER_NAMESPACE,
  })
  const unreadable = fakeProc(t, A_PID_IN_A_FAKE_PROC, BOOT, undefined)

  assert.deepEqual(
    sweepLeftoverLaunchDirectories(root, proc.lookupOf, proc.pidNamespace),
    [mine],
    'the kernel names its namespace, so only the record of that namespace goes',
  )
  assert.equal(existsSync(theirs), true)
  assert.deepEqual(
    sweepLeftoverLaunchDirectories(root, unreadable.lookupOf, unreadable.pidNamespace),
    [],
    'a kernel that will not name its own namespace leaves every directory',
  )
})

test('a sweep leaves alone what it cannot vouch for: no record, and what is not a directory', (t) => {
  const root = relayRoot(t)
  const noRecord = launchShapedDirectory(root, 'no-record-at-all', undefined)
  const aFile = join(root, 'not-a-launch')
  writeFileSync(aFile, 'the owner put this here')

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [], 'nothing is guessed at')
  assert.equal(existsSync(noRecord), true)
  assert.equal(existsSync(aFile), true)
})

test('a sweep leaves alone a record it cannot vouch for: a link, another mode, and a launch-shaped link (#124)', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()

  // A record that is a link to a real record, naming a process that is gone.
  const recordFile = join(root, 'a-record-outside-any-launch.json')
  writeFileSync(recordFile, JSON.stringify(deadRecord(gone)), { mode: LAUNCHER_RECORD_MODE })
  const linkedRecord = join(root, 'a-record-that-is-a-link')
  mkdirSync(linkedRecord, { mode: 0o700 })
  symlinkSync(recordFile, join(linkedRecord, LAUNCHER_RECORD_NAME))

  // A record this user could read, written with another mode.
  const otherMode = launchShapedDirectory(root, 'a-record-with-another-mode', deadRecord(gone))
  chmodSync(join(otherMode, LAUNCHER_RECORD_NAME), 0o644)

  // An entry that is a link to a launch-shaped directory outside the relay root,
  // which a sweep must not follow out of its own root.
  const outside = mkdtempSync(join(tmpdir(), 'martha-124-outside-'))
  t.after(() => removeTheTree(outside))
  const target = launchShapedDirectory(outside, 'a-launch-shape-outside', deadRecord(gone))
  const pointedAt = join(root, 'an-entry-that-is-a-link')
  symlinkSync(target, pointedAt)

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [], 'a record only the launch wrote, with only the mode it writes, is the only thing a sweep acts on')
  for (const kept of [linkedRecord, otherMode, target, pointedAt, recordFile]) assert.equal(existsSync(kept), true, kept)
})

test('a sweep of a relay root that is not there yet removes nothing and throws nothing', (t) => {
  const root = relayRoot(t)
  assert.deepEqual(sweepLeftoverLaunchDirectories(join(root, 'not-made-yet')), [])
})
