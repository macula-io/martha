// A member a run left behind, found on this machine's real kernel (martha#472).
//
// The scan's own test hands it readings, which proves the rule and nothing about the machine. This one runs the
// launcher's own writer over a real child of this process, under a scratch home of its own, and then runs the GATE's
// own entry point, as `npm run check:no-member-outlives-its-run` runs it, over the real /proc: it answers 1 and names
// that child, in its exact line. A records directory another user may write into is a place it will not vouch for, and
// the same child is then a line saying so and nothing else. Once the child has stopped, no line names it. That is the
// case the whole package exists for, and no reading handed in can prove it.
//
// It lives in the machine's own directory beside the readings it drives: a launch record is written only by the
// launcher, the contract or the host glue (prove_the_core/one_place_does_it/only_the_launcher_writes_launch_records), and this directory
// is the glue that reads a machine's kernel and a home's state root.

import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { launchesIn, recordMemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { STATE_DIRECTORY_MODE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { NOT_OURS } from './launch_records_under_a_state_root.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../find_a_homes_state_root/find_a_homes_state_root.ts'

const PROJECT = 'a-project-of-this-run'

/** The gate's own entry point, run the way package.json runs it. */
const THE_GATE = join(import.meta.dirname, '..', 'check_no_member_outlives_its_run', 'main.ts')

/** A refresh of the gate over this machine's own kernel: what it answered, and the lines naming `pid`. */
const theGatesLinesOn = (pid: number): { readonly status: number | null; readonly naming: readonly string[]; readonly all: readonly string[] } => {
  const run = spawnSync(process.execPath, [THE_GATE], { encoding: 'utf8' })
  const lines = run.stderr.split('\n')
  return {
    status: run.status,
    naming: lines.filter((line) => line.includes(`(pid ${pid})`) || line.includes(`whether ${pid} outlives`)),
    all: lines,
  }
}

test('a member a run left behind is named on this machine\'s own kernel, and the gate fails on it (martha#472)', () => {
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
    const theLine = `Probe started ${written.started_at ?? written.process_started_at} still runs (pid ${pid}) under a home no session of yours uses: ${home}`

    // The gate, not the reading: a live leftover is a non-zero answer, in the exact line, and never a quiet 0.
    const whileItRuns = theGatesLinesOn(pid)
    assert.equal(whileItRuns.status, 1, whileItRuns.all.join('\n'))
    assert.deepEqual(whileItRuns.naming, [theLine])

    // The same child, and the records place another user may write into: it is read as a place this check cannot tell
    // about, which keeps the gate non-zero, and it is never passed off as the leftover it would otherwise be.
    chmodSync(records, STATE_DIRECTORY_MODE | 0o070)
    const notOurs = theGatesLinesOn(pid)
    assert.equal(notOurs.status, 1, notOurs.all.join('\n'))
    assert.deepEqual(notOurs.naming, [`cannot tell whether ${pid} outlives its run: ${records} ${NOT_OURS}`])

    // Vouched for again, the very same record names the very same child: the place's mode is the whole difference.
    chmodSync(records, STATE_DIRECTORY_MODE)
    assert.deepEqual(theGatesLinesOn(pid).naming, [theLine])

    child.kill('SIGKILL')
    child = undefined
    assert.deepEqual(theGatesLinesOn(pid).naming, [], 'a member that has stopped is named by nothing')
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    removeTheTree(scratch)
  }
})
