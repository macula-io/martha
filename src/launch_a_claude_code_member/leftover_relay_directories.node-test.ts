// A sweep takes a leftover launch directory away, and never a live launch's (#124).
//
// The relay root holds every launch of this user at once, and more than one
// launcher writes into it, so a name proves nothing: each directory is judged by
// the record of the process that made it. Real directories, real read-only
// copies, and real processes, alive and gone.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import {
  LAUNCHER_RECORD_MODE,
  LAUNCHER_RECORD_NAME,
  recordTheLauncher,
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
function launchShapedDirectory(root: string, name: string, record: unknown): string {
  const directory = join(root, name)
  mkdirSync(directory, { mode: 0o700 })
  mkdirSync(join(directory, 'nothing'), { mode: 0o500 })

  const relay = join(directory, 'relay')
  const hooks = join(relay, 'hooks')
  mkdirSync(hooks, { recursive: true, mode: 0o700 })
  writeFileSync(join(hooks, 'hooks.json'), '{}', { mode: 0o400 })
  chmodSync(hooks, 0o500)
  chmodSync(relay, 0o500)

  if (record !== undefined) {
    writeFileSync(join(directory, LAUNCHER_RECORD_NAME), JSON.stringify(record), { mode: LAUNCHER_RECORD_MODE })
  }
  return directory
}

/** The pid of a process that has ended, which the kernel no longer holds. */
async function aProcessThatHasEnded(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = child.pid
  assert.ok(pid !== undefined)
  await new Promise((resolve) => child.once('exit', resolve))
  return pid
}

test('a launch records the process that made its directory, so a later sweep can tell it is dead', (t) => {
  const root = relayRoot(t)
  const directory = join(root, 'a-launch')
  mkdirSync(directory, { mode: 0o700 })

  assert.equal(recordTheLauncher(directory), undefined, 'the record is written')

  const record: unknown = JSON.parse(readFileSync(join(directory, LAUNCHER_RECORD_NAME), 'utf8'))
  assert.deepEqual(record, { pid: process.pid, process_started_at: linuxProcessIdentities.identityOf(process.pid) })
})

test('a sweep takes away a leftover whose launcher is gone, read-only copy and all, and leaves nothing in the relay root', async (t) => {
  const root = relayRoot(t)
  const gone = await aProcessThatHasEnded()
  assert.equal(linuxProcessIdentities.identityOf(gone), null, 'the process this test names is really gone')
  const leftover = launchShapedDirectory(root, 'a-leftover', { pid: gone, process_started_at: 'this-boot/1' })

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [leftover])
  assert.equal(existsSync(leftover), false, 'the leftover, its read-only copy included, is gone')
})

test("a sweep leaves a live launch's directory alone: another launch's root stays put (#124)", (t) => {
  const root = relayRoot(t)
  const live = join(root, 'a-live-launch')
  mkdirSync(live, { mode: 0o700 })
  assert.equal(recordTheLauncher(live), undefined)

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [], 'a live launch is not a leftover')
  assert.equal(existsSync(live), true)
  assert.equal(existsSync(join(live, LAUNCHER_RECORD_NAME)), true)
})

test('a sweep takes away a directory whose pid the kernel gave to another process since', async (t) => {
  const root = relayRoot(t)
  const recycled = launchShapedDirectory(root, 'a-recycled-pid', { pid: process.pid, process_started_at: 'this-boot/1' })

  assert.deepEqual(sweepLeftoverLaunchDirectories(root), [recycled], 'another start time under the same pid is another process')
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

test('a sweep of a relay root that is not there yet removes nothing and throws nothing', (t) => {
  const root = relayRoot(t)
  assert.deepEqual(sweepLeftoverLaunchDirectories(join(root, 'not-made-yet')), [])
})
