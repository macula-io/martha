// What a member's place in a launch directory's record is written through (martha#124 r=4, #443 part 1): the one test of
// `recordedInsideTheHold`, beside the function it proves. The launcher keeps the tests of the launch it runs.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { LAUNCHER_RECORD_NAME, recordTheLauncher, type LaunchRecord } from '../sweep_leftover_launch_directories/leftover_relay_directories.ts'
import { recordedInsideTheHold } from './end_a_launch.ts'

test("a member is written into its launch directory's record inside the hold, and a write that fails refuses it (#124 r=4)", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-124-held-'))
  t.after(() => {
    chmodSync(directory, 0o700)
    removeTheTree(directory)
  })
  assert.equal(recordTheLauncher(directory), undefined, 'the launch records itself before the member is spawned')

  // A real child, alive while its place in the record is written and read back.
  const member = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => member.kill('SIGKILL'))
  await new Promise((resolve) => member.once('spawn', resolve))
  const pid = member.pid ?? 0
  assert.ok(pid > 0, 'the member is a process this test started')

  const held = recordedInsideTheHold(directory, pid, { recorded: true })
  assert.deepEqual(held, { admitted: true, recorded: { recorded: true }, inTheLaunchRecord: true }, 'the member runs only when its place is in the record')
  const record = JSON.parse(readFileSync(join(directory, LAUNCHER_RECORD_NAME), 'utf8')) as LaunchRecord
  assert.equal(record.member?.pid, pid, 'the record names the member, so a sweep cannot take the directory of a member still running')
  assert.equal(record.member?.process_started_at, linuxProcessIdentities.identityOf(pid))

  // A launch directory this user can no longer write: the member's place cannot be kept.
  chmodSync(directory, 0o500)
  const refused = recordedInsideTheHold(directory, pid, { recorded: true })
  chmodSync(directory, 0o700)
  assert.equal(refused.admitted, false, 'a member whose place cannot be written is refused, not run with no record of it')
  assert.match(refused.recorded.recorded ? 'it was recorded' : refused.recorded.refusal, /could not be written/)
  assert.equal((JSON.parse(readFileSync(join(directory, LAUNCHER_RECORD_NAME), 'utf8')) as LaunchRecord).member?.pid, pid, 'and the record is left as it was')
})
