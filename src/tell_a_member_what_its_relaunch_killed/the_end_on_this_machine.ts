// What a launch end finds on this machine, kept as the record the next start is told from (#693).
//
// ../the_facts_at_an_end decides what an end's findings mean; this reads them for real: the member's process group from
// /proc, its trees from git, the bytes and write times of the paths git says differ, and the machine's own answers for
// how long a second of its clock is (`getconf CLK_TCK`) and when it booted (/proc/stat). Everything here is synchronous,
// because the launcher takes the record before it kills the group: a killed process has nothing left to read, and the
// host's background children are still alive when its own exit fires.
//
// Three things this refuses to invent:
//
//   - A start the machine will not date is not a start of "now". A process list or a boot time the kernel will not give
//     leaves that half of the record unreadable, and the core judges nothing on it (rule 1).
//   - The launch's own servers are dropped by an identity the launch holds, not by a command line: a program started
//     from the launcher's own mesh-server place is the launch's, and anything else the group holds is the member's. A
//     member can type any command line; it cannot write into that place.
//   - A tree whose worktrees git will not list is not read at all, and no record is kept, so a record already kept
//     stands for the refusals rather than being replaced by one that says nothing was found.

import { join, resolve, sep } from 'node:path'

import type { CrewStore, FileTree, Processes } from '../host_contract/host_contract.ts'
import { isTheMembersBranch, type AListedWorktree, type TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { type ACommandTheKernelHeld, type AnEnd, type TheTreesAnEndReads, theRecordAtTheEnd } from './the_facts_at_an_end.ts'
import { keepTheLeftoverRecordOf, theLeftoverRecordOf } from './the_telling_on_every_start.ts'
import type { WhatAKilledRunLeft } from './tell_a_member_what_its_relaunch_killed.ts'

/**
 * The machine, as an end reads it: processes that are waited for and files, the trees' write times, and the three things
 * only the launcher can read — the group the kernel held, the words a process was started with, and when in the boot a
 * start happened. What is read for real is the launcher's (../end_a_launch/end_a_launch.ts); this slice decides.
 */
export interface TheMachineAtAnEnd {
  readonly processes: Pick<Processes, 'runNow'>
  readonly files: Pick<FileTree, 'bytesOf'>
  /** When a path was last written, in milliseconds, or null when it will not say. */
  readonly modifiedAt: (path: string) => number | null
  /** The commands the member's group held, as the kernel named them: read before the kill, never after. */
  readonly commandsIn: (group: number) => { readonly commands: readonly ACommandTheKernelHeld[] } | { readonly unreadable: string }
  /** The words a process was started with, from the kernel's own cmdline: none when it holds none any more. */
  readonly wordsOf: (pid: number) => readonly string[]
  /** A start in ticks since the boot as a moment on the machine's clock, or null when the machine will not say. */
  readonly theStartMs: (start_ticks: string) => number | null
}

/** One launch's end: the member, the group about to be killed, its crew, and the places its trees and servers are in. */
export interface ALaunchEndOnThisMachine {
  readonly member: string
  readonly at_ms: number
  /** The member's process group, read before the kill. */
  readonly group: number
  /** The crew's own store, where the record is kept beside the telling that reads it. */
  readonly crew: CrewStore
  /** The layout the crew declared, or undefined when it declared none: then no tree is the member's. */
  readonly workspace: TheWorkspace | undefined
  /** Where the member starts: the checkout whose worktrees are listed for the member's own. */
  readonly checkout: string
  /** The launcher's own mesh-server place: a program started from it is the launch's, never the member's. */
  readonly mesh_servers: string
  readonly machine: TheMachineAtAnEnd
}

/** What was kept, or why nothing was: a refused or unreadable earlier record is never replaced by an empty one. */
export type AnEndKept = { readonly kept: WhatAKilledRunLeft } | { readonly not_kept: string }

/** What git says differs in one tree, or why it could not be asked. */
export type TheDifferingOfATree = { readonly paths: readonly string[] } | { readonly unreadable: string }

const NOTHING = '\u0000'

/** What a run of a program needs of the machine: processes that are waited for. */
type WithProcesses = Pick<TheMachineAtAnEnd, 'processes'>

/** One run of a program in `where`, waited for, and its answer as text; a run that could not start answers as a failure. */
const ran = (machine: WithProcesses, where: string, command: string, args: readonly string[]): { readonly said: string } | { readonly unreadable: string } => {
  const run = machine.processes.runNow({ command, args, cwd: where })
  return run.exit_code === 0 ? { said: run.stdout } : { unreadable: `${command} ${args.join(' ')} could not answer (${run.stderr.trim() || `it exited ${String(run.exit_code)}`})` }
}

/**
 * How many ticks one second of this machine's clock holds (`getconf CLK_TCK`), or null when it will not say. Read from
 * the machine, never typed: a start in ticks is only a moment on the clock once it is divided by this.
 */
export function ticksPerSecondOnTheMachine(machine: WithProcesses, where: string): number | null {
  const answer = ran(machine, where, 'getconf', ['CLK_TCK'])
  if ('unreadable' in answer) return null
  const ticks = Number(answer.said.trim())
  return Number.isInteger(ticks) && ticks > 0 ? ticks : null
}

/** The paths git says differ from HEAD in `tree`, with the deletions left out (there are no bytes to digest); or why. */
export function theDifferingPathsOf(tree: string, machine: TheMachineAtAnEnd): TheDifferingOfATree {
  const answer = ran(machine, tree, 'git', ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all'])
  if ('unreadable' in answer) return { unreadable: `${tree} could not be asked what differs: ${answer.unreadable}` }
  const entries = answer.said.split(NOTHING).filter((one) => one.length > 3)
  const paths = entries.flatMap((one) => {
    const status = one.slice(0, 2)
    return status.includes('D') ? [] : [one.slice(3)]
  })
  return { paths }
}

/** A worktree git lists: its place, the branch it is on, and whether only its record is left. */
export function theWorktreesListedIn(checkout: string, machine: TheMachineAtAnEnd): readonly AListedWorktree[] | { readonly unreadable: string } {
  const answer = ran(machine, checkout, 'git', ['worktree', 'list', '--porcelain'])
  if ('unreadable' in answer) return { unreadable: answer.unreadable }
  const blocked = answer.said.split('\n\n')
  return blocked.flatMap((block) => {
    const lines = block.split('\n').filter((line) => line !== '')
    const where = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (where === undefined) return []
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length) ?? null
    return [{ path: where, branch, prunable: lines.some((line) => line === 'prunable') }]
  })
}

/** The trees an end reads for `member`: the worktrees whose branch is its own, by the crew's own ownership rule. */
export function theMembersTrees(the: Pick<ALaunchEndOnThisMachine, 'workspace' | 'checkout' | 'member' | 'machine'>): readonly string[] | { readonly unreadable: string } {
  if (the.workspace === undefined) return []
  const listed = theWorktreesListedIn(the.checkout, the.machine)
  if ('unreadable' in listed) return listed
  return listed
    .filter((one) => !one.prunable && one.branch !== null && isTheMembersBranch(one.branch, the.workspace!, the.member))
    .map((one) => one.path)
}

/** Whether a word names a program under `place`: the place itself, or a path past the separator that ends it. */
const standsUnder = (word: string, place: string): boolean => {
  const at = resolve(word)
  return at === place || at.startsWith(`${place}${sep}`)
}

/**
 * Whether a command in the group is one the launch started for itself: its words name a program under the launcher's
 * own mesh-server place. The test is the place the launch holds, never the line a member could type.
 */
const startedByTheLaunch = (the: ALaunchEndOnThisMachine) => (one: { readonly pid: number }): boolean =>
  the.machine.wordsOf(one.pid).some((word) => standsUnder(word, resolve(the.mesh_servers)))

/** The bytes a tree's path holds, or undefined when it does not hold them (deleted, or gone with the tree). */
const bytesInTheTree = (machine: TheMachineAtAnEnd) => (tree: string, path: string): Uint8Array | undefined => {
  try {
    return machine.files.bytesOf(join(tree, path))
  } catch {
    return undefined
  }
}

/** The readers an end is given, over this machine, with the group already listed by the launcher before the kill. */
function theReadersOf(
  the: ALaunchEndOnThisMachine,
  group: ReturnType<TheMachineAtAnEnd['commandsIn']>,
): { readonly processes: AnEnd['processes']; readonly tree_reads: TheTreesAnEndReads; readonly theStartMs: AnEnd['theStartMs'] } {
  return {
    processes: {
      commandsIn: () => group,
      isTheLaunchesOwn: startedByTheLaunch(the),
    },
    tree_reads: {
      dirtyIn: (tree) => theDifferingPathsOf(tree, the.machine),
      bytesIn: bytesInTheTree(the.machine),
      modifiedIn: (tree, path) => the.machine.modifiedAt(join(tree, path)),
    },
    theStartMs: (start_ticks) => the.machine.theStartMs(start_ticks),
  }
}

/**
 * What the record this end found replaces: the one kept for the member, when it is one this could read. An earlier
 * record that cannot be read is never replaced by a new one, so the refusals keep saying it cannot be read (rule 3);
 * and a place that cannot be asked keeps nothing at all.
 */
function theRecordItReplaces(the: ALaunchEndOnThisMachine): { readonly replaced?: WhatAKilledRunLeft } | { readonly not_kept: string } {
  const earlier = theLeftoverRecordOf(the.crew, the.member)
  if (earlier === undefined) return {}
  if ('refusal' in earlier) return { not_kept: `what this member's last launch left could not be asked for: ${earlier.refusal}` }
  if ('unreadable' in earlier) return { not_kept: `what this member's last launch left cannot be read: ${earlier.unreadable}` }
  return { replaced: earlier.record }
}

/**
 * What this launch ended with, as the record the next start is told from: the member's trees read, the group listed
 * before the group is killed, and the record kept in the crew's own place. Nothing is kept when the trees cannot be
 * listed or the earlier record cannot be read: a record already kept then stands for the refusals.
 */
export function keepWhatTheEndLeft(the: ALaunchEndOnThisMachine): AnEndKept {
  // The group is listed before anything else, and before the caller kills it: git and the crew's place can take a
  // moment, and a killed process has nothing left to read.
  const group = the.machine.commandsIn(the.group)
  const trees = theMembersTrees(the)
  if ('unreadable' in trees) return { not_kept: `this member's trees could not be listed: ${trees.unreadable}` }
  const replaces = theRecordItReplaces(the)
  if ('not_kept' in replaces) return replaces
  const readers = theReadersOf(the, group)
  const record = theRecordAtTheEnd({
    member: the.member,
    at_ms: the.at_ms,
    group: the.group,
    trees,
    processes: readers.processes,
    tree_reads: readers.tree_reads,
    theStartMs: readers.theStartMs,
    ...(replaces.replaced === undefined ? {} : { replaced: replaces.replaced }),
  })
  const refused = keepTheLeftoverRecordOf(the.crew, record)
  return refused === undefined ? { kept: record } : { not_kept: `what this launch left could not be kept: ${refused}` }
}
