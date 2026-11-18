// What a launch end reads on this machine, kept as the record the member's next start is told from (#693).
//
// These run against a real git and a planted /proc, never against this checkout or a running launcher: the promise is
// that the record names the member's own trees, the commands a kill would cut, and nothing the launch started itself.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLONES, WORKTREES } from '../declare_crew/declare_crew.ts'
import type { CrewStore } from '../host_contract/host_contract.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { filesOnThisMachine, runNowOnThisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { bootTimeMsUnder, processesInGroupUnder, startedAtMs } from '../a_launch_end_on_this_machine/what_a_launch_end_reads.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  keepWhatTheEndLeft,
  theDifferingPathsOf,
  theMembersTrees,
  theWorktreesListedIn,
  ticksPerSecondOnTheMachine,
  type ALaunchEndOnThisMachine,
  type TheMachineAtAnEnd,
} from './the_end_on_this_machine.ts'
import { LEFTOVER_RECORDS_PLACE, theRecordFileNameOf } from './the_telling_on_every_start.ts'
import { theDigestOf } from './tell_a_member_what_its_relaunch_killed.ts'

/** The crew this reads for, and the member whose launch ended: names of a crew that never existed. */
const THE_MEMBER = 'Proteus'
const ANOTHER_MEMBER = 'Triton'
const ITS_BRANCH = `${THE_MEMBER}/1`
const ANOTHERS_BRANCH = `${ANOTHER_MEMBER}/2`
const THE_DEFAULT_BRANCH = 'main'

const A_FILE = 'src/a_file.ts'
const ANOTHER_FILE = 'src/another_file.ts'
const THE_WRITTEN_BYTES = 'what the killed command wrote\n'

/** A /proc of our own: one boot, and the processes a test says were in the group. */
const BOOT_SECONDS = 1_794_000_000
const START_TICKS = '900100'
const THE_GROUP = 600
const A_MEMBERS_PID = 601
const A_SERVERS_PID = 602

const NO_CHECKOUT = join(tmpdir(), 'no-checkout-of-ours-at-all')

// The machine's own path to the fixture, resolved: git answers `worktree list` with the place it resolved, so a
// TMPDIR reached through a link (the CI job that runs the suite under one) would otherwise disagree with itself.
const scratch = (t: TestContext): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'martha-an-end-')))
  t.after(() => removeTheTree(dir))
  return dir
}

/** What a launch end reads of this machine, over `proc_root` and this machine's own git, getconf and stat. */
const aMachine = (proc_root: string): TheMachineAtAnEnd => ({
  processes: { runNow: runNowOnThisMachine },
  files: filesOnThisMachine,
  modifiedAt: (path) => {
    try {
      return statSync(path).mtimeMs
    } catch {
      return null
    }
  },
  commandsIn: (group) => processesInGroupUnder(proc_root, group),
  wordsOf: (pid) => {
    try {
      return readFileSync(join(proc_root, String(pid), 'cmdline'), 'utf8').split('\u0000').filter((word) => word !== '')
    } catch {
      return []
    }
  },
  theStartMs: (start_ticks) => {
    const boot_ms = bootTimeMsUnder(proc_root)
    const ticks = ticksPerSecondOnTheMachine({ processes: { runNow: runNowOnThisMachine } }, tmpdir())
    return boot_ms === null || ticks === null ? null : startedAtMs(start_ticks, boot_ms, ticks)
  },
})

/** A /proc holding `processes` in `THE_GROUP`, and the boot's own moment; a test names the words of each command. */
function aProcOf(t: TestContext, processes: readonly { readonly pid: number; readonly line: string }[]): string {
  const root = scratch(t)
  for (const one of processes) {
    const fields_after_command = Array.from({ length: 20 }, () => '1')
    fields_after_command[2] = String(THE_GROUP)
    fields_after_command[19] = START_TICKS
    mkdirSync(join(root, String(one.pid)))
    writeFileSync(join(root, String(one.pid), 'stat'), `${one.pid} (a shell) ${fields_after_command.join(' ')}\n`)
    writeFileSync(join(root, String(one.pid), 'cmdline'), `${one.line.split(' ').join('\u0000')}\u0000`)
  }
  writeFileSync(join(root, 'stat'), `cpu 1 2 3\nbtime ${String(BOOT_SECONDS)}\n`)
  return root
}

/** One git run in `where`, its answer, refused verbosely when the test's own setup failed. */
const git = (where: string, args: readonly string[]): string => {
  const run = spawnSync('git', [...args], { cwd: where, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')} failed: ${run.stderr}`)
  return run.stdout
}

/** A clone of one commit, its worktree place, and one worktree on each member's branch, in the crew's declared layout. */
const aCrewsTrees = (t: TestContext) => {
  const root = scratch(t)
  const checkout = join(root, 'a-clone')
  const worktrees = join(root, WORKTREES)
  mkdirSync(join(checkout, 'src'), { recursive: true })
  mkdirSync(worktrees)
  git(checkout, ['init', '-q', '-b', THE_DEFAULT_BRANCH])
  writeFileSync(join(checkout, A_FILE), 'the committed bytes\n')
  writeFileSync(join(checkout, ANOTHER_FILE), 'the other committed bytes\n')
  git(checkout, ['add', A_FILE, ANOTHER_FILE])
  git(checkout, ['-c', 'user.email=a@example.invalid', '-c', 'user.name=a-test', 'commit', '-q', '-m', 'a start'])
  const its_tree = join(worktrees, 'a-repo-1')
  const anothers_tree = join(worktrees, 'a-repo-2')
  git(checkout, ['worktree', 'add', '-q', '-b', ITS_BRANCH, its_tree])
  git(checkout, ['worktree', 'add', '-q', '-b', ANOTHERS_BRANCH, anothers_tree])
  return { checkout, worktrees, its_tree, anothers_tree, members: [THE_MEMBER, ANOTHER_MEMBER] }
}

test('#693: the trees an end reads are the worktrees on this member\'s branch, and no other member\'s', (t) => {
  const trees = aCrewsTrees(t)
  const workspace = { clones: join(scratch(t), CLONES), worktrees: trees.worktrees, members: trees.members }
  const read = theMembersTrees({ workspace, checkout: trees.checkout, member: THE_MEMBER, machine: aMachine(scratch(t)) })
  assert.ok(!('unreadable' in read))
  assert.deepEqual(read, [trees.its_tree])
})

test('#693: a crew that declared no layout has no trees, and a checkout git will not list reads none', (t) => {
  const machine = aMachine(scratch(t))
  assert.deepEqual(theMembersTrees({ workspace: undefined, checkout: NO_CHECKOUT, member: THE_MEMBER, machine }), [])
  assert.ok('unreadable' in theWorktreesListedIn(NO_CHECKOUT, machine))
})

test('#693: a path that was deleted is not a differing path, because there are no bytes to digest', (t) => {
  const trees = aCrewsTrees(t)
  writeFileSync(join(trees.its_tree, A_FILE), THE_WRITTEN_BYTES)
  rmSync(join(trees.its_tree, ANOTHER_FILE))
  const read = theDifferingPathsOf(trees.its_tree, aMachine(scratch(t)))
  assert.ok(!('unreadable' in read))
  assert.deepEqual(read.paths, [A_FILE])
  rmSync(join(trees.its_tree, A_FILE))
  const after = theDifferingPathsOf(trees.its_tree, aMachine(scratch(t)))
  assert.ok(!('unreadable' in after))
  assert.deepEqual(after.paths, [])
})

test('#693: the ticks in a second are the machine\'s own answer, and an unanswerable one dates nothing', (t) => {
  const machine = aMachine(scratch(t))
  const ticks = ticksPerSecondOnTheMachine(machine, tmpdir())
  assert.ok(ticks !== null && Number.isInteger(ticks) && ticks > 0)
  const silent = { ...machine, processes: { runNow: () => ({ exit_code: 1, stdout: '', stderr: 'no such tool' }) } }
  assert.equal(ticksPerSecondOnTheMachine(silent, tmpdir()), null)
})

/** A launch end over a real crew store, the planted /proc, and the launcher's own mesh-server place. */
const anEndOf = (the: {
  readonly proc: string
  readonly crew: CrewStore
  readonly checkout: string
  readonly its_tree: string
  readonly mesh_servers: string
}): ALaunchEndOnThisMachine => ({
  member: THE_MEMBER,
  at_ms: Date.now(),
  group: THE_GROUP,
  crew: the.crew,
  workspace: { clones: null, worktrees: the.its_tree, members: [THE_MEMBER, ANOTHER_MEMBER] },
  checkout: the.checkout,
  mesh_servers: the.mesh_servers,
  machine: aMachine(the.proc),
})

test('#693: a command the launch started itself is not the member\'s, and one it did not is told with its start', (t) => {
  const trees = aCrewsTrees(t)
  writeFileSync(join(trees.its_tree, A_FILE), THE_WRITTEN_BYTES)
  const mesh_servers = join(scratch(t), 'mesh-servers')
  const proc = aProcOf(t, [
    { pid: A_MEMBERS_PID, line: 'node --test a_runner.mjs' },
    { pid: A_SERVERS_PID, line: `${join(mesh_servers, 'v1', 'bin', 'server.js')} --serve` },
  ])
  const kept = keepWhatTheEndLeft(anEndOf({ proc, crew: keepTheCrewsFilesAsDirectories(scratch(t)), checkout: trees.checkout, its_tree: trees.its_tree, mesh_servers }))
  assert.ok('kept' in kept)
  const ticks = ticksPerSecondOnTheMachine(aMachine(proc), trees.checkout)
  assert.ok(ticks !== null)
  assert.deepEqual(kept.kept.running.map((one) => one.command_line), ['node --test a_runner.mjs'])
  assert.equal(kept.kept.running[0]?.started_at_ms, (BOOT_SECONDS + Number(START_TICKS) / ticks) * 1000)
  assert.equal(kept.kept.leftovers.length, 1)
  assert.equal(kept.kept.leftovers[0]?.command_line, 'node --test a_runner.mjs')
  assert.equal(kept.kept.leftovers[0]?.digest, theDigestOf(new TextEncoder().encode(THE_WRITTEN_BYTES)))
})

test('#693: an end with nothing running carries the earlier leftover over, so a second stop does not lose it', (t) => {
  const trees = aCrewsTrees(t)
  writeFileSync(join(trees.its_tree, A_FILE), THE_WRITTEN_BYTES)
  const crew = keepTheCrewsFilesAsDirectories(scratch(t))
  const mesh_servers = join(scratch(t), 'mesh-servers')
  const first = keepWhatTheEndLeft(anEndOf({ proc: aProcOf(t, [{ pid: A_MEMBERS_PID, line: 'node --test a_runner.mjs' }]), crew, checkout: trees.checkout, its_tree: trees.its_tree, mesh_servers }))
  assert.ok('kept' in first)
  assert.equal(first.kept.leftovers.length, 1)
  const later = keepWhatTheEndLeft(anEndOf({ proc: aProcOf(t, []), crew, checkout: trees.checkout, its_tree: trees.its_tree, mesh_servers }))
  assert.ok('kept' in later)
  assert.equal(later.kept.running.length, 0)
  assert.equal(later.kept.leftovers.length, 1)
  assert.equal(later.kept.leftovers[0]?.command_line, 'node --test a_runner.mjs')
})

test('#693: a record that cannot be read is never replaced by an empty one, and a tree git will not list keeps none', (t) => {
  const trees = aCrewsTrees(t)
  const crew = keepTheCrewsFilesAsDirectories(scratch(t))
  const place = crew.place(LEFTOVER_RECORDS_PLACE)
  assert.ok(!('refusal' in place))
  const junk = 'not a record at all'
  assert.equal(place.keep(theRecordFileNameOf(THE_MEMBER), junk), undefined)
  const mesh_servers = join(scratch(t), 'mesh-servers')
  const unreadable = keepWhatTheEndLeft(anEndOf({ proc: aProcOf(t, []), crew, checkout: trees.checkout, its_tree: trees.its_tree, mesh_servers }))
  assert.ok('not_kept' in unreadable)
  assert.deepEqual(place.read(theRecordFileNameOf(THE_MEMBER)), { text: junk })
  const unlisted = keepWhatTheEndLeft(anEndOf({ proc: aProcOf(t, []), crew, checkout: NO_CHECKOUT, its_tree: trees.its_tree, mesh_servers }))
  assert.ok('not_kept' in unlisted)
})
