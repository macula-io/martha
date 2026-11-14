// Run the leftover-member check (martha#472), over this machine's kernel:
//
//   node src/check_no_member_outlives_its_run/main.ts [--self-test] [--proc <dir>]
//
// Exit 0 looked, and found no member under a run's home; 1 one or more found, or a place this reader could not tell
// about; 2 the check could not be made. It never passes because it could not look: a process whose environment the
// kernel will not give this reader is said and counted, and does not fail the check, since an unreadable environment is
// evidence of nothing (setuid tools and sandboxes of the owner's own run that way).
//
// `--self-test` proves it bites on a runner that holds no members: it starts a real child under a scratch home, writes
// that child's record with the launcher's own writer, reads the real kernel — once for the member it names, once for a
// records directory it can no longer vouch for — then kills the child and shows the silence. It cleans up on every path.

import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { launchesIn, recordMemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { STATE_DIRECTORY_MODE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { itFails, theLinesOf, whatARunLeft, type WhatARunLeft } from './the_leftovers_a_run_left.ts'
import { LAUNCH_RECORDS_PLACE } from '../start_a_member/start_a_member.ts'
import { theKernelThisMachineShows, theOwnersHome } from './the_kernel_this_machine_shows.ts'

const NAME = 'check_no_member_outlives_its_run'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Every finding as its line, and the status: a leftover or a place it could not tell about fails it. */
function reportFindings(found: readonly WhatARunLeft[]): number {
  for (const line of theLinesOf(found)) console.error(line)
  const failing = found.filter(itFails)
  const unread = found.length - failing.length
  const said =
    failing.length === 0
      ? 'no member outlives a run'
      : `${failing.length} line(s) above: a member a run left behind, or a place this check could not tell about`
  console.error(`${NAME}: ${said}${unread === 0 ? '' : `, and ${unread} process(es) of yours it could not read`}`)
  return failing.length === 0 ? 0 : 1
}

/** The gate over a kernel: every line, and whether anything was said that fails it. */
function theGate(proc_root: string, owners_home: string): number {
  try {
    statSync(join(proc_root, 'self', 'status'))
  } catch {
    console.error(`${NAME}: could not be made: ${proc_root} is not a /proc this reader can read`)
    return 2
  }
  return reportFindings(whatARunLeft(theKernelThisMachineShows(proc_root, owners_home)))
}

/** The self-test: a real child, the launcher's own writer, the real kernel, and each of the three answers. */
function theSelfTest(): number {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-472-'))
  const home = join(scratch, 'run-home')
  const records = join(home, '.local', 'state', STATE_ROOT_NAME, LAUNCH_RECORDS_PLACE)
  const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore', env: aRunsEnvironment(home) })
  try {
    if (child.pid === undefined) return failed('the child the self-test starts has no pid')
    mkdirSync(records, { recursive: true, mode: STATE_DIRECTORY_MODE })
    chmodSync(records, STATE_DIRECTORY_MODE)
    const written = theRecordFor(records, child.pid)
    if ('failed' in written) return failed(written.failed)
    const answer = theThreeAnswers(child.pid, home, records, written.started_at)
    if (answer !== undefined) return failed(answer)
    console.error(`${NAME}: the check bites (a member named, a home it cannot vouch for, and silence once the member is gone)`)
    return 0
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    openUpForRemoval(scratch)
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The child's record, written by the launcher's own writer, and when the kernel says it started. */
function theRecordFor(records: string, pid: number): { readonly started_at: string } | { readonly failed: string } {
  const written = recordMemberLaunch(launchRecordsDirectory(records), linuxProcessIdentities, { member_name: 'Probe', node_id: 'a'.repeat(64), pid })
  if (!written.recorded) return { failed: `the record the self-test writes was refused: ${written.refusal}` }
  const [launch] = launchesIn(launchRecordsDirectory(records))
  return { started_at: launch?.started_at ?? launch?.process_started_at ?? '' }
}

/** A run's environment for the self-test's child: its own home, and no XDG_STATE_HOME, so the state root is derived
 * from HOME as a run's home without one is read. */
function aRunsEnvironment(home: string): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home }
  delete env['XDG_STATE_HOME']
  return env
}

/** The three answers, each on the real kernel: the member named, a home it cannot vouch for, and the silence after. */
function theThreeAnswers(pid: number, home: string, records: string, started_at: string): string | undefined {
  const expected = `Probe started ${started_at} still runs (pid ${pid}) under a home no session of yours uses: ${home}`
  const named = theLinesOf(whatARunLeft(theKernelThisMachineShows('/proc', theOwnersHome())))
  if (!named.includes(expected)) return `the member the self-test started was not named as expected\nexpected: ${expected}\nsaid: ${named.join(' | ') || '(nothing)'}`
  if (reportFindings(whatARunLeft(theKernelThisMachineShows('/proc', theOwnersHome()))) !== 1) return 'the gate did not fail on a member a run left behind'
  chmodSync(records, 0o770)
  const blind = theLinesOf(whatARunLeft(theKernelThisMachineShows('/proc', theOwnersHome())))
  if (!blind.some((line) => line.includes(`cannot tell whether ${pid} outlives its run: ${home}`))) return `a records directory this reader cannot vouch for was read as clean\nsaid: ${blind.join(' | ') || '(nothing)'}`
  if (reportFindings(whatARunLeft(theKernelThisMachineShows('/proc', theOwnersHome()))) !== 1) return 'the gate did not fail on a place it could not tell about'
  chmodSync(records, STATE_DIRECTORY_MODE)
  process.kill(pid, 'SIGKILL')
  if (reportFindings(whatARunLeft(theKernelThisMachineShows('/proc', theOwnersHome()))) !== 0) return 'the gate said something that fails it after the child was killed'
  return undefined
}

const failed = (why: string): number => {
  console.error(`${NAME}: self-test failed: ${why}`)
  return 1
}

/** The scratch tree is taken away whole: every directory in it is opened up first, since the state's are 0700. */
function openUpForRemoval(path: string): void {
  try {
    chmodSync(path, 0o700)
  } catch {
    return
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) openUpForRemoval(join(path, entry.name))
}

const main = (): number => (process.argv.includes('--self-test') ? theSelfTest() : theGate(option('--proc') ?? '/proc', theOwnersHome()))

process.exitCode = main()
