// A member a run left behind, found on this machine's real kernel (martha#472).
//
// The scan's own test hands it readings, which proves the rule and nothing about the machine. This one runs the
// launcher's own writer over a real child of this process, under a scratch home of its own, and then asks the real
// /proc: the record the launcher wrote names a member that is still running, and stops naming it once it has stopped.
// That is the case the whole package exists for, and no reading handed in can prove it.
//
// It lives in the machine's own directory beside the readings it drives: a launch record is written only by the
// launcher, the contract or the host glue (prove_the_core/only_the_launcher_writes_launch_records), and this directory
// is the glue that reads a machine's kernel and a home's state root.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchesIn, recordMemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { itFails, theLinesOf, whatARunLeft } from '../find_a_member_a_run_left_behind/the_leftovers_a_run_left.ts'
import { STATE_DIRECTORY_MODE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS, theReadingsThisMachineGives } from './read_a_kernel_and_a_home.ts'

const PROJECT = 'a-project-of-this-run'

/** What this machine's kernel says, as the scan reads it, over the real /proc. */
const theReadings = () => theReadingsThisMachineGives('/proc', THE_PLACES_A_STATE_ROOT_KEEPS)

test('a member a run started, still running under a run\'s home, is named on this machine\'s own kernel (martha#472)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-472-'))
  const home = join(scratch, 'run-home')
  const records = join(home, '.local', 'state', STATE_ROOT_NAME, PROJECT, THE_PLACES_A_STATE_ROOT_KEEPS.records_place)
  let child: ChildProcess | undefined
  try {
    mkdirSync(records, { recursive: true, mode: STATE_DIRECTORY_MODE })
    chmodSync(records, STATE_DIRECTORY_MODE)
    // A run's home, and no XDG_STATE_HOME, so the state root is derived from HOME as a run's is.
    const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home }
    delete env['XDG_STATE_HOME']
    child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore', env })
    const pid = child.pid
    assert.ok(pid !== undefined, 'the child a test starts has a pid')

    // The launcher's own writer, over the real kernel: the record names this pid and when the kernel says it started.
    assert.deepEqual(recordMemberLaunch(launchRecordsDirectory(records), linuxProcessIdentities, { member_name: 'Probe', node_id: 'a'.repeat(64), pid }), { recorded: true })
    const [written] = launchesIn(launchRecordsDirectory(records))
    assert.ok(written !== undefined, 'the record the launcher wrote is read back')

    const found = whatARunLeft(theReadings())
    const named = theLinesOf(found).filter((line) => line.includes(`(pid ${pid})`))
    assert.deepEqual(named, [`Probe started ${written.started_at ?? written.process_started_at} still runs (pid ${pid}) under a home no session of yours uses: ${home}`])
    assert.equal(itFails(found.find((one) => one.kind === 'left_behind' && one.pid === pid)!), true)

    child.kill('SIGKILL')
    child = undefined
    assert.deepEqual(whatARunLeft(theReadings()).filter((one) => one.pid === pid), [], 'a member that has stopped is named by nothing')
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    removeTheTree(scratch)
  }
})
