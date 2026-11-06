// The Linux host glue keeps the promises the host contract asks of it (#42).
//
// These are the binder's file and kernel guarantees from martha#14 rounds 2 and 3,
// moved here with the code they prove. They run against the real directory store
// and a planted /proc, never against the test host, which vouches for nothing.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs, { chmodSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  binderOverLaunches,
  launchesIn,
  recordMemberLaunch,
  recordMemberStopped,
  type ProcessTable,
} from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  LAUNCH_RECORD_FILE_MODE,
  LAUNCH_RECORD_SUFFIX,
  STAGING_PREFIX,
  fileNameOf,
  keyOf,
  launchRecordsDirectory,
} from './launch_records_directory.ts'
import { linuxProcessIdentities, procProcessIdentities, startTimeIn } from './process_identity_from_proc.ts'

// Synthetic node ids and pids, never a real one: this repository is public.
const PLUTO = { member_name: 'Pluto', node_id: 'a'.repeat(64), pid: 4101 }
const NEPTUNUS = { member_name: 'Neptunus', node_id: 'b'.repeat(64), pid: 4102 }
const STARTED = '900100'
const ROW = { ...PLUTO, process_started_at: STARTED }

const kernel = (running: Readonly<Record<number, string>>): ProcessTable => ({
  identityOf: (pid) => running[pid] ?? null,
})

const scratch = (t: TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-launches-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A fresh records directory, closed to everyone but its owner. */
const recordsDirectory = (t: TestContext, name = 'launches'): string => {
  const directory = join(scratch(t), name)
  mkdirSync(directory, { mode: 0o700 })
  return directory
}

const recordFile = (directory: string, key: string) => join(directory, fileNameOf(key))

const plantRecord = (path: string, row: unknown) =>
  writeFileSync(path, typeof row === 'string' ? row : JSON.stringify(row), { mode: LAUNCH_RECORD_FILE_MODE })

const bindsPluto = (directory: string) =>
  binderOverLaunches(launchRecordsDirectory(directory), kernel({ [PLUTO.pid]: STARTED }))({ sending_pid: PLUTO.pid })

// --- a key is never a path ----------------------------------------------------

test('a key becomes a file name that is never a path, and only such a name reads back as a key', () => {
  assert.equal(fileNameOf(PLUTO.member_name), `${PLUTO.member_name}${LAUNCH_RECORD_SUFFIX}`)

  for (const key of ['..', '.', '../Pluto', 'a/b', '%2E', 'Plu to', '.staging-x']) {
    const name = fileNameOf(key)
    assert.equal(name.includes('/'), false, key)
    assert.equal(name.startsWith('.'), false, key)
    assert.equal(keyOf(name), key, key)
  }
  assert.throws(() => fileNameOf(''))

  for (const name of ['notes.txt', LAUNCH_RECORD_SUFFIX, `..${LAUNCH_RECORD_SUFFIX}`, `%zz${LAUNCH_RECORD_SUFFIX}`, `Plu%74o${LAUNCH_RECORD_SUFFIX}`]) {
    assert.equal(keyOf(name), undefined, name)
  }
})

// --- C1 to C4: only what the launcher wrote is read ---------------------------

test('the launcher writes one record per member, only its owner may touch it, and the binder reads it back', (t) => {
  const directory = recordsDirectory(t)
  const processes = kernel({ [PLUTO.pid]: STARTED, [NEPTUNUS.pid]: STARTED })

  // Two launchers at once, each with its own view of the directory: neither
  // writes over the other's record, because there is no shared list.
  assert.deepEqual(recordMemberLaunch(launchRecordsDirectory(directory), processes, PLUTO), { recorded: true })
  assert.deepEqual(recordMemberLaunch(launchRecordsDirectory(directory), processes, NEPTUNUS), { recorded: true })

  assert.deepEqual(readdirSync(directory).sort(), [fileNameOf(NEPTUNUS.member_name), fileNameOf(PLUTO.member_name)])
  assert.equal(fs.statSync(recordFile(directory, PLUTO.member_name)).mode & 0o777, LAUNCH_RECORD_FILE_MODE)
  assert.equal(bindsPluto(directory), PLUTO.node_id)

  recordMemberStopped(launchRecordsDirectory(directory), PLUTO.member_name)
  assert.equal(bindsPluto(directory), null)
  assert.equal(launchesIn(launchRecordsDirectory(directory)).length, 1)
})

test('a staging file beside the records is passed over, not read and not refused', (t) => {
  const directory = recordsDirectory(t)
  plantRecord(recordFile(directory, PLUTO.member_name), ROW)
  plantRecord(join(directory, `${STAGING_PREFIX}half`), '{"member_na')

  assert.equal(bindsPluto(directory), PLUTO.node_id)
})

test('a records directory holding anything the launcher would not write vouches for nothing', (t) => {
  const planted: Readonly<Record<string, (directory: string) => void>> = {
    'not json': (directory) => plantRecord(recordFile(directory, PLUTO.member_name), 'Pluto is a member'),
    'a list, not a row': (directory) => plantRecord(recordFile(directory, PLUTO.member_name), [ROW]),
    'a row naming another member than its file': (directory) =>
      plantRecord(recordFile(directory, NEPTUNUS.member_name), ROW),
    'a record open to the group': (directory) => {
      const path = recordFile(directory, PLUTO.member_name)
      plantRecord(path, ROW)
      chmodSync(path, 0o660)
    },
    'a record that is a link to another file': (directory) => {
      const elsewhere = join(directory, '..', 'elsewhere.json')
      plantRecord(elsewhere, ROW)
      symlinkSync(elsewhere, recordFile(directory, PLUTO.member_name))
    },
    'a record that is a directory': (directory) => mkdirSync(recordFile(directory, PLUTO.member_name)),
    'a file that is not a record': (directory) => {
      plantRecord(recordFile(directory, PLUTO.member_name), ROW)
      writeFileSync(join(directory, 'notes.txt'), 'Pluto', { mode: LAUNCH_RECORD_FILE_MODE })
    },
    'a record whose name is not a key as the store writes one': (directory) => {
      plantRecord(recordFile(directory, PLUTO.member_name), ROW)
      plantRecord(join(directory, `Nept%75nus${LAUNCH_RECORD_SUFFIX}`), { ...ROW, member_name: NEPTUNUS.member_name })
    },
  }

  for (const [what, plant] of Object.entries(planted)) {
    const directory = recordsDirectory(t, what.replaceAll(' ', '-'))
    plant(directory)
    assert.equal(bindsPluto(directory), null, what)
  }
})

test('a records directory others may write into, or that is a link, vouches for nothing', (t) => {
  const open = recordsDirectory(t, 'open')
  plantRecord(recordFile(open, PLUTO.member_name), ROW)
  assert.equal(bindsPluto(open), PLUTO.node_id)

  chmodSync(open, 0o777)
  assert.equal(bindsPluto(open), null)
  chmodSync(open, 0o770)
  assert.equal(bindsPluto(open), null)
  assert.deepEqual(launchRecordsDirectory(open).all(), [])

  const real = recordsDirectory(t, 'real')
  plantRecord(recordFile(real, PLUTO.member_name), ROW)
  const linked = join(real, '..', 'linked')
  symlinkSync(real, linked)
  assert.equal(bindsPluto(linked), null)

  assert.equal(bindsPluto(join(real, '..', 'missing')), null)
})

test('a record swapped after it was checked is not the one read', (t) => {
  const directory = recordsDirectory(t)
  const path = recordFile(directory, PLUTO.member_name)
  plantRecord(path, ROW)

  // The planted swap: as soon as the store checks the record, another file
  // naming Neptunus's node id under Pluto's pid is renamed over it.
  const forged = join(directory, '..', 'forged.json')
  plantRecord(forged, { ...ROW, node_id: NEPTUNUS.node_id })
  const swap = () => {
    if (fs.existsSync(forged)) renameSync(forged, path)
  }
  const real_fstat = fs.fstatSync
  const real_lstat = fs.lstatSync
  t.mock.method(fs, 'fstatSync', (...args: Parameters<typeof fs.fstatSync>) => {
    swap()
    return real_fstat(...args)
  })
  t.mock.method(fs, 'lstatSync', (...args: Parameters<typeof fs.lstatSync>) => {
    if (args[0] === path) swap()
    return real_lstat(...args)
  })

  assert.equal(bindsPluto(directory), PLUTO.node_id)
  assert.equal(fs.existsSync(forged), false, 'the swap ran')
})

// --- C5, C6: the kernel's start time, boot included ---------------------------

test('the start time is read after the command name, whatever the name holds', () => {
  const fields_after_command = Array.from({ length: 20 }, (_, index) => `${index + 3}`)
  fields_after_command[19] = STARTED

  assert.equal(startTimeIn(`${PLUTO.pid} (a) b (c) ${fields_after_command.join(' ')} 0 0`), STARTED)
  assert.equal(startTimeIn('not a stat line'), null)
  assert.equal(startTimeIn(`${PLUTO.pid} (short) R 1 2`), null)
})

/** A /proc of our own: one process, one boot. */
const fakeProc = (t: TestContext, boot_id: string | undefined) => {
  const root = scratch(t)
  const fields_after_command = Array.from({ length: 20 }, (_, index) => `${index + 3}`)
  fields_after_command[19] = STARTED
  mkdirSync(join(root, String(PLUTO.pid)))
  writeFileSync(join(root, String(PLUTO.pid), 'stat'), `${PLUTO.pid} (claude) ${fields_after_command.join(' ')}\n`)
  mkdirSync(join(root, 'sys', 'kernel', 'random'), { recursive: true })
  const setBoot = (id: string | undefined) => {
    const path = join(root, 'sys', 'kernel', 'random', 'boot_id')
    if (id === undefined) rmSync(path, { force: true })
    else writeFileSync(path, `${id}\n`)
  }
  setBoot(boot_id)
  return { processes: procProcessIdentities(root), setBoot }
}

const BOOT = 'aaaaaaaa-2222-3333-4444-bbbbbbbbbbbb'
const NEXT_BOOT = '66666666-7777-8888-9999-000000000000'

/** The test host's launcher seam: these tests are about the kernel, not the files. */
const memoryStore = () => hostForTests().launcherRecords

test('the same pid with the same start ticks under another boot binds nobody', (t) => {
  const proc = fakeProc(t, BOOT)
  const store = memoryStore()
  assert.deepEqual(recordMemberLaunch(store, proc.processes, PLUTO), { recorded: true })
  assert.equal(binderOverLaunches(store, proc.processes)({ sending_pid: PLUTO.pid }), PLUTO.node_id)

  proc.setBoot(NEXT_BOOT)
  assert.equal(binderOverLaunches(store, proc.processes)({ sending_pid: PLUTO.pid }), null)
})

test('a boot that cannot be told is no boot: nothing is recorded and nobody binds', (t) => {
  for (const boot of [undefined, 'not a boot id', BOOT.toUpperCase()]) {
    const proc = fakeProc(t, boot)
    assert.equal(proc.processes.identityOf(PLUTO.pid), null, String(boot))
    assert.equal(recordMemberLaunch(memoryStore(), proc.processes, PLUTO).recorded, false, String(boot))
  }

  const proc = fakeProc(t, BOOT)
  const store = memoryStore()
  recordMemberLaunch(store, proc.processes, PLUTO)
  proc.setBoot(undefined)
  assert.equal(binderOverLaunches(store, proc.processes)({ sending_pid: PLUTO.pid }), null)
})

test('an identity names the boot as well as the start, so neither alone can match', (t) => {
  const proc = fakeProc(t, BOOT)
  const identity = proc.processes.identityOf(PLUTO.pid)

  assert.equal(identity?.includes(BOOT), true)
  assert.equal(identity?.includes(STARTED), true)
  assert.notEqual(identity, STARTED)
})

const hasProc = linuxProcessIdentities.identityOf(process.pid) !== null

test('on Linux, a running process has an identity that does not change, and an exited one has none', { skip: !hasProc }, () => {
  assert.equal(linuxProcessIdentities.identityOf(process.pid), linuxProcessIdentities.identityOf(process.pid))

  const exited = spawnSync(process.execPath, ['-e', '']).pid
  assert.equal(typeof exited, 'number')
  assert.equal(linuxProcessIdentities.identityOf(exited ?? 0), null)
  assert.equal(linuxProcessIdentities.identityOf(0), null)
})

test('end to end on Linux: this process launched as a member binds, through the records and the kernel', { skip: !hasProc }, (t) => {
  const store = launchRecordsDirectory(recordsDirectory(t))
  assert.deepEqual(recordMemberLaunch(store, linuxProcessIdentities, { ...PLUTO, pid: process.pid }), { recorded: true })

  assert.equal(binderOverLaunches(store, linuxProcessIdentities)({ sending_pid: process.pid }), PLUTO.node_id)
})
