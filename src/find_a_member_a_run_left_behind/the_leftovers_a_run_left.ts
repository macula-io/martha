// A member a run started and left running (martha#472): what `martha ls` shows after the crew's own lines and what
// `check:no-member-outlives-its-run` fails on.
//
// This exists because the lifeline (the other half of #472) cannot reach one case: a launcher killed with SIGKILL
// leaves nobody reading the lifeline, and its member runs on under the home the run gave it, for days, with the
// host's defaults on. Nothing of the owner's notices. This notices.
//
// It names, it never stops: a leftover member is the owner's to stop, in the crew that owns it, and a gate that killed
// processes on its own say would be a worse fault than the one it reports.
//
// Nothing is written to a home to make this possible. Every launch already leaves a record naming the member, its pid,
// its start time and the pid namespace it runs in, in the state root the MEMBER's OWN environment names
// (`$XDG_STATE_HOME/martha`, else `$HOME/.local/state/martha`), under the project the run was in. So a process in
// front of the kernel can be placed: read its `HOME` and `XDG_STATE_HOME`, read that state root's launch records
// through the reader the launcher's own records are read through, and a record naming this pid AND this start time is
// this member.
//
// What makes a home a run's: the owner has exactly one home, the one the password database names, and an owner's own
// `martha start` inherits it unchanged. A live member under any other home is one a run started.
//
// Nothing here reads the machine. Every reading it needs — the kernel's processes, a home's records, the path a
// spelling names — is handed to it, so the same rule is pinned by a test that has no processes and no home of its own.
//
// Silence is earned, never assumed. A records directory this reader cannot vouch for, an environment it cannot read and
// a kernel that will not name a process each say so in a line of their own and fail the gate: `unknown` is never clean,
// the rule the process lookups already keep.
//
// What this does not see, stated rather than left to be discovered:
//   - a process the launcher never recorded: a test that spawns a host itself, bypassing `martha start`;
//   - a by-hand check run under the owner's own home, which is out of this class by definition;
//   - a second launch of the same member in one project's state replaces the first one's record, so a first member
//     still running goes unnamed (records are keyed by member name);
//   - a time namespace shifts the start ticks the kernel shows. Nothing of ours makes one today;
//   - the namespace a record carries is the one read where the record was WRITTEN, which is the launcher's own; that is
//     the member's too, since the launcher starts the member as its child, and it is what a reader from another
//     namespace compares with.

import { launchesIn, type MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { FileTree, KeyedRow } from '../host_contract/host_contract.ts'

/** A member that runs under a home no session of the owner's uses: the line the gate fails on and `martha ls` shows. */
export interface AMemberLeftBehind {
  readonly kind: 'left_behind'
  readonly member: string
  readonly started_at: string
  readonly pid: number
  readonly home: string
}

/** Something this reader could not place. Never silent: a reader that cannot tell says so. */
export interface ItCannotTell {
  readonly kind: 'cannot_tell'
  readonly pid: number
  /** What could not be vouched for, and why, as the line says it. */
  readonly why: string
}

/** A process of the owner's whose environment the kernel will not give this reader: setuid tools and sandboxes run
 * that way, and an unreadable environment is evidence of nothing (measured: five of them on the crew host). It is
 * counted and said, so silence still means the check looked, and it does not fail the gate. */
export interface AProcessNotRead {
  readonly kind: 'could_not_read'
  readonly pid: number
  readonly why: string
}

export type WhatARunLeft = AMemberLeftBehind | ItCannotTell | AProcessNotRead

/** The reason a records directory holding a row that is not a launch is said as. */
export const NOT_A_LAUNCH = 'holds a record that is not a launch this reader can vouch for'

/** One project's launch records, and the directory they were read from. */
export interface RecordsOfAProject {
  readonly where: string
  readonly rows: readonly KeyedRow[]
}

/** What the scan reads: the kernel's view of every process of this user, and the homes' records, each as a reader. */
export interface WhatTheScanReads {
  /** Every process of this user, as the kernel lists them. */
  readonly pids: readonly number[]
  /** A process's environment, or why it cannot be read. */
  readonly environmentOf: (pid: number) => { readonly env: Readonly<Record<string, string>> } | { readonly cannot_tell: string }
  /** The pid namespace a process runs in, as `readlink /proc/<pid>/ns/pid` gives it. */
  readonly namespaceOf: (pid: number) => string | undefined
  /** A process's pid in its own namespace: the last entry the kernel's `NSpid` line holds. */
  readonly ownPidOf: (pid: number) => number | undefined
  /** The identity a launch record compares, or null when the kernel will not say. */
  readonly identityOf: (pid: number) => string | null
  /** Every project's launch records under a home's state root, or why this reader will not vouch for one of its places. */
  readonly recordsUnder: (home: string, xdg_state_home: string | undefined) => { readonly projects: readonly RecordsOfAProject[] } | { readonly cannot_tell: string }
  /** The owner's home, from the password database: the one home that is never a run's. */
  readonly owners_home: string
  /** The pid namespace this reader is in, to compare a record's with. */
  readonly readers_namespace: string | undefined
  /** A path as the filesystem resolves it, or null when it cannot: so two spellings of one home are one home. */
  readonly realPathOf: FileTree['realPathOf']
}

/** The line a member that a run left behind is shown as. */
export const leftBehindLine = (left: AMemberLeftBehind): string =>
  `${left.member} started ${left.started_at} still runs (pid ${left.pid}) under a home no session of yours uses: ${left.home}`

/** The line a reader that could not tell is shown as. */
export const cannotTellLine = (blind: ItCannotTell): string => `cannot tell whether ${blind.pid} outlives its run: ${blind.why}`

/** One line per finding, each as the gate prints it and `martha ls` shows it. */
export const theLinesOf = (found: readonly WhatARunLeft[]): readonly string[] =>
  found.map((one) => {
    if (one.kind === 'left_behind') return leftBehindLine(one)
    if (one.kind === 'cannot_tell') return cannotTellLine(one)
    return `process ${one.pid} could not be read (${one.why}), so a member of yours cannot be ruled out among it`
  })

/** The lines of the members a run started and left running, and only those: what `martha ls` shows after the crew's
 * own. A place the scan could not tell about is the gate's to report, and `ls` says nothing of it. */
export const theLeftoversShown = (reads: WhatTheScanReads): readonly string[] =>
  theLinesOf(whatARunLeft(reads).filter((one) => one.kind === 'left_behind'))

/** Whether a finding is one the gate fails on: a leftover, or a place it could not tell about. Counted unreadable
 * processes are said and do not fail it. */
export const itFails = (one: WhatARunLeft): boolean => one.kind !== 'could_not_read'

/** Whether a record names this process, as the kernel shows it now. */
export const theRecordNamesThisProcess = (
  record: MemberLaunch,
  seen: { readonly pid: number; readonly namespace: string | undefined; readonly own_pid: number | undefined; readonly identity: string | null; readonly readers_namespace: string | undefined },
): boolean => {
  if (seen.identity === null || seen.identity !== record.process_started_at) return false
  // A record written before the namespace was kept names a bare pid, which means the same thing on both sides only
  // inside one namespace: the reader's own.
  if (record.pid_namespace === undefined) return seen.namespace !== undefined && seen.namespace === seen.readers_namespace && record.pid === seen.pid
  // From the outside, a member in another namespace answers to the pid it has there: the NSpid entry's last, not the
  // pid /proc shows the reader.
  return record.pid_namespace === seen.namespace && record.pid === seen.own_pid
}

/** Every member a run left behind, and every place this scan could not read. */
export const whatARunLeft = (reads: WhatTheScanReads): readonly WhatARunLeft[] =>
  reads.pids.flatMap((pid) => theFindingsFor(pid, reads))

/** What one process of this user gives: a member it is, a place this scan could not read, or nothing at all. */
function theFindingsFor(pid: number, reads: WhatTheScanReads): readonly WhatARunLeft[] {
  const environment = reads.environmentOf(pid)
  if ('cannot_tell' in environment) return [{ kind: 'could_not_read', pid, why: environment.cannot_tell }]
  const home = environment.env['HOME']
  // No home to place it by is no evidence of a run's home: nothing is said of it.
  if (home === undefined || samePlace(reads, home, reads.owners_home)) return []
  const records = reads.recordsUnder(home, environment.env['XDG_STATE_HOME'])
  if ('cannot_tell' in records) return [{ kind: 'cannot_tell', pid, why: records.cannot_tell }]
  return records.projects.flatMap((project) => theFindingsIn(project, pid, home, asTheKernelShowsIt(pid, reads)))
}

/** A process as the kernel shows it now, which is what a record is compared with. */
const asTheKernelShowsIt = (pid: number, reads: WhatTheScanReads) => ({
  pid,
  namespace: reads.namespaceOf(pid),
  own_pid: reads.ownPidOf(pid),
  identity: reads.identityOf(pid),
  readers_namespace: reads.readers_namespace,
})

/** What one project's records say of a process: the member one of them names, and a place they cannot be vouched for. */
function theFindingsIn(
  project: RecordsOfAProject,
  pid: number,
  home: string,
  seen: Parameters<typeof theRecordNamesThisProcess>[1],
): readonly WhatARunLeft[] {
  const launches = launchesIn({ all: () => project.rows })
  // A records directory that holds rows none of which is a launch is a place someone other than the launcher wrote in,
  // and it is never read as clean.
  const blind: readonly WhatARunLeft[] = project.rows.length > 0 && launches.length === 0 ? [{ kind: 'cannot_tell', pid, why: `${project.where} ${NOT_A_LAUNCH}` }] : []
  const record = launches.find((one) => theRecordNamesThisProcess(one, seen))
  return record === undefined ? blind : [...blind, { kind: 'left_behind', member: record.member_name, started_at: record.started_at ?? record.process_started_at, pid, home }]
}

/** Whether two paths name one place: compared as the filesystem resolves them, so a link is its own target. */
export function samePlace(reads: Pick<WhatTheScanReads, 'realPathOf'>, one: string, another: string): boolean {
  return resolved(reads, one) === resolved(reads, another)
}

/** A path as the filesystem resolves it: through its links, without a trailing slash. One this machine cannot resolve
 * (a home that is gone) is compared as it was written, without the slash. */
const resolved = (reads: Pick<WhatTheScanReads, 'realPathOf'>, path: string): string => reads.realPathOf(path) ?? path.replace(/\/+$/, '')
