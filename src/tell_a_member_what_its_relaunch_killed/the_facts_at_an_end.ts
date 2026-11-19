// What a launch end found, read into the record it keeps (#693).
//
// A launch end kills the member's process group; before it does, it reads what that group still holds and what the
// member's trees hold, and keeps both as the record the next start is told from and the two refusals judge. The kernel
// and git are read through the narrow ports below, so this is decided and tested without a launch.
//
// Two things are deliberately not facts this slice reads for itself. When a command started is the machine's own
// answer (start ticks since the boot, and the boot's moment), passed in as `theStartMs`; a start the machine will not
// say is not a start of "now", so a list it could not date is told as unreadable rather than judged (rule 1). And a
// command the launch itself started -- the relay, the mesh server, a tool server -- is not the member's, so the launch
// says which of them are its own by the identity it already binds, and they are dropped before the record is made.

import {
  theDigestOf,
  theRecordAfter,
  type IDirtyFile,
  type IMtimeOfAFile,
  type IRunningCommand,
  type WhatAKilledRunLeft,
} from './tell_a_member_what_its_relaunch_killed.ts'

/** One command a group held, as the kernel named it: its pid, the line, and its start in ticks since the boot. */
export interface ACommandTheKernelHeld {
  readonly pid: number
  readonly command_line: string
  readonly start_ticks: string
}

/** The member's trees, as an end reads them: what git says differs, and the bytes and the write time of each path. */
export interface TheTreesAnEndReads {
  /** The paths git says differ from HEAD in `tree`, or why it could not be asked. */
  readonly dirtyIn: (tree: string) => { readonly paths: readonly string[] } | { readonly unreadable: string }
  /** A path's bytes in `tree`, or undefined when the tree does not hold them (deleted, or gone with the tree). */
  readonly bytesIn: (tree: string, path: string) => Uint8Array | undefined
  /** When `tree`'s path was last written, in milliseconds, or null when the tree will not say. */
  readonly modifiedIn: (tree: string, path: string) => number | null
}

/** The member's process group, as an end reads it, and which of its commands the launch itself started. */
export interface TheProcessesAnEndReads {
  readonly commandsIn: (group: number) => { readonly commands: readonly ACommandTheKernelHeld[] } | { readonly unreadable: string }
  /** Whether a command is one the launch started for itself (its relay, its mesh server, its tool servers). */
  readonly isTheLaunchesOwn: (one: { readonly pid: number; readonly start_ticks: string }) => boolean
}

/** A start in ticks since the boot as a moment on the machine's clock, or null when the machine will not say. */
export type TheStartMs = (start_ticks: string) => number | null

/** What an end is given: the member, the group, its trees, and the three readers above. */
export interface AnEnd {
  readonly member: string
  readonly at_ms: number
  readonly group: number
  readonly trees: readonly string[]
  readonly processes: TheProcessesAnEndReads
  readonly tree_reads: TheTreesAnEndReads
  readonly theStartMs: TheStartMs
  /** The record this end replaces, whose unreleased leftovers it carries over (rule 5). */
  readonly replaced?: WhatAKilledRunLeft
}

/** The commands the end found still running, and why none could be dated, when none could. */
const theRunningAtTheEnd = (the: AnEnd): { running: readonly IRunningCommand[]; unreadable?: string } => {
  const read = the.processes.commandsIn(the.group)
  if ('unreadable' in read) return { running: [], unreadable: read.unreadable }
  const theirs = read.commands.filter((one) => !the.processes.isTheLaunchesOwn(one))
  const dated = theirs.flatMap((one) => {
    const started_at_ms = the.theStartMs(one.start_ticks)
    return started_at_ms === null ? [] : [{ command_line: one.command_line, started_at_ms }]
  })
  if (dated.length < theirs.length) {
    return { running: dated, unreadable: `the machine could not say when ${String(theirs.length - dated.length)} of its commands started` }
  }
  return { running: dated }
}

/** The differing paths of one tree: their digests, and their write times where the tree gives one. */
const theDirtyOfATree = (one: {
  readonly tree: string
  readonly read: { readonly paths: readonly string[] }
  readonly reads: TheTreesAnEndReads
  readonly worktree?: string
}): { dirty: readonly IDirtyFile[]; mtimes: readonly IMtimeOfAFile[] } => {
  const dirty: IDirtyFile[] = []
  const mtimes: IMtimeOfAFile[] = []
  for (const path of one.read.paths) {
    const bytes = one.reads.bytesIn(one.tree, path)
    if (bytes === undefined) continue
    const place = one.worktree === undefined ? { path } : { path, worktree: one.worktree }
    dirty.push({ ...place, digest: theDigestOf(bytes) })
    const mtime_ms = one.reads.modifiedIn(one.tree, path)
    if (mtime_ms !== null) mtimes.push({ ...place, mtime_ms })
  }
  return { dirty, mtimes }
}

/** Every differing path of every tree the end read, and why any tree it could not read was not read. */
const theTreesAtTheEnd = (the: AnEnd): {
  dirty: readonly IDirtyFile[]
  mtimes: readonly IMtimeOfAFile[]
  unreadable?: string
} => {
  const dirty: IDirtyFile[] = []
  const mtimes: IMtimeOfAFile[] = []
  let unreadable: string | undefined
  for (const tree of the.trees) {
    const read = the.tree_reads.dirtyIn(tree)
    if ('unreadable' in read) {
      unreadable ??= read.unreadable
      continue
    }
    // Every tree is tagged with its own place, one tree as much as many (martha#719): a refusal reads a leftover at the
    // tree the record names, and the member's one worktree is not the crew's checkout. Two trees holding one path are
    // still told apart by it.
    const read_one = theDirtyOfATree({ tree, read, reads: the.tree_reads, worktree: tree })
    dirty.push(...read_one.dirty)
    mtimes.push(...read_one.mtimes)
  }
  return { dirty, mtimes, ...(unreadable === undefined ? {} : { unreadable }) }
}

/** The record an end makes of what it found, carrying over what the record it replaces kept (rule 5). */
export const theRecordAtTheEnd = (the: AnEnd): WhatAKilledRunLeft => {
  const running = theRunningAtTheEnd(the)
  const trees = theTreesAtTheEnd(the)
  return theRecordAfter({
    member: the.member,
    at_ms: the.at_ms,
    running: running.running,
    dirty: trees.dirty,
    mtimes: trees.mtimes,
    ...(running.unreadable === undefined ? {} : { running_unreadable: running.unreadable }),
    ...(trees.unreadable === undefined ? {} : { dirty_unreadable: trees.unreadable }),
    ...(the.replaced === undefined ? {} : { replaced: the.replaced }),
  })
}
