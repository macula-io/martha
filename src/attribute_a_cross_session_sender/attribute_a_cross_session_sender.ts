// Who sent a cross-session message, as the host attests it (martha#14).
//
// This exists so a crew member's message keeps the receiving session's shell
// because the host, not the text or a socket, says which node id sent it.
//
// The chain has three links, and only the first is not a file:
//
//   1. the HOST attests the process that sent the delivery (on a Unix socket the
//      kernel knows the connecting pid), out of band, never in the turn's text;
//   2. the LAUNCHER's record pairs that pid, and the time the kernel says that
//      process started, with the member it launched; it is the only party that
//      knows the pid-to-member pairing first-hand rather than from a claim;
//   3. the record names the member's node id, which is what the shell gate reads.
//
// Rules this module keeps, from the threat model on martha#14:
//
//   - BIND NOTHING UNTIL A HOST ATTESTS THE SENDER. A host that cannot say which
//     process sent a delivery binds nothing, and the delivery stays
//     unattributed. On the Claude Code host today that is every delivery: the
//     plugin is handed the turn's text and nothing else. Fail closed.
//   - NEVER FROM TEXT. Nothing here takes text: not an envelope's `from` or
//     `from-name`, not a socket path, not a name. A whole envelope pasted into a
//     session names whatever its writer typed.
//   - A RECORD IS VALID FOR ONE PROCESS. A record whose process is gone, or whose
//     pid now belongs to a process that started at another time, is dead. A reused
//     pid or a socket bound at a dead member's path inherits nothing.
//   - NEVER SILENTLY WIDEN. No record, two records for one pid, or a record the
//     store cannot vouch for: unattributed.
//
//   - ONLY A SIGNED PAIR BINDS. The launcher's file is writable by every member's
//     user, so a record binds only when its (member_name, node_id) pair is in the
//     members list the owner signed (../trust_only_signed_lists, kind 'members').
//     A planted record naming an unsigned node id, or pairing a signed node id
//     with another member's name, binds nothing.
//
// The residual, accepted for now (owner's ruling on martha#1, A13 is martha#24):
// every member runs as the same OS user, so a member that already holds a shell
// can rewrite the launcher's file and point a SIGNED member's record at its own
// pid. The pid is dynamic and no owner can sign it; that binding stays martha#24.

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import type { AttestedSender, KeyedRowStore, KeyedRows, Processes } from '../host_contract/host_contract.ts'

/** One member the owner signed for: the name and node id a launch record must pair. */
export interface SignedMember {
  readonly member_name: string
  /** Lowercased, as the signed list is opened. */
  readonly node_id: string
}

/** What the launcher records when it starts a member. */
export type MemberLaunch = {
  readonly member_name: string
  /** The member's node id, lowercased. */
  readonly node_id: string
  /** The process the launcher started for the member. */
  readonly pid: number
  /**
   * When the kernel says that process started, as the launcher read it at launch:
   * which boot, and when in that boot. A pid and its start ticks repeat across a
   * reboot; the boot does not.
   */
  readonly process_started_at: string
}

/**
 * Where the launcher's records live: the launcher's seam (#42), one row per
 * member, keyed by the member's name. Only the launcher writes them: every other
 * slice reads them through the contract's `stores.launches`, which cannot write. One row
 * per member, so two launches at once never write over each other's record: there
 * is no shared list to read, change and write back. The host keeps the file-level
 * promises (no links, checked where it is read, nothing it did not write); this
 * slice decides what a row must say.
 */
export type MemberLaunchStore = KeyedRowStore

/** The launcher's records as the binder reads them. */
export type MemberLaunchRecords = KeyedRows

/** The host's view of which process holds a pid, boot included. */
export type ProcessTable = Pick<Processes, 'identityOf'>

/** The node id a delivery's attested sender is bound to, or null for nobody. */
export type Binder = (sender: AttestedSender | undefined) => string | null

/** The binder of a host that attests no sender: it binds nothing. */
export const bindNothing: Binder = () => null

/** What the launcher is about to record, before the kernel is asked when it started. */
export interface Launched {
  readonly member_name: string
  readonly node_id: string
  readonly pid: number
}

export type LaunchRecorded = { readonly recorded: true } | { readonly recorded: false; readonly refusal: string }

/** A member's name, as a record may carry it: it also names the member's record. */
export const MEMBER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * Record that the launcher started a member.
 *
 * The start time is read from the kernel here, not taken from the caller, so the
 * record pairs the member with the process that is running now. A new launch of a
 * member replaces its old record, and any record that held the same pid or node id
 * goes with it: one member, one process, one record.
 */
export function recordMemberLaunch(store: MemberLaunchStore, processes: ProcessTable, launched: Launched): LaunchRecorded {
  if (!MEMBER_NAME.test(launched.member_name)) {
    return { recorded: false, refusal: 'A member launch is not recorded: the member name is not a name a record can carry.' }
  }
  if (!NODE_ID.test(launched.node_id)) {
    return { recorded: false, refusal: `A launch of ${launched.member_name} is not recorded: its node id is not a node id.` }
  }
  if (!isPid(launched.pid)) {
    return { recorded: false, refusal: `A launch of ${launched.member_name} is not recorded: ${launched.pid} is not a process id.` }
  }

  const process_started_at = processes.identityOf(launched.pid)
  if (process_started_at === null) {
    return {
      recorded: false,
      refusal: `A launch of ${launched.member_name} is not recorded: no process ${launched.pid} is running.`,
    }
  }

  const node_id = launched.node_id.toLowerCase()
  for (const stale of launchesIn(store)) {
    if (stale.member_name !== launched.member_name && (stale.pid === launched.pid || stale.node_id === node_id)) {
      store.drop(stale.member_name)
    }
  }

  const launch: MemberLaunch = { member_name: launched.member_name, node_id, pid: launched.pid, process_started_at }
  store.keep(launched.member_name, launch)
  return { recorded: true }
}

/** Record that the launcher stopped a member: its record goes. */
export function recordMemberStopped(store: MemberLaunchStore, member_name: string): void {
  store.drop(member_name)
}

/**
 * The binder over the launcher's records.
 *
 * It reads the records, the signed members list and the kernel on every delivery,
 * so a member that exited, or that the owner dropped from the list, since the last
 * delivery is already dead here. `signedMembers` returns the opened list
 * (trustedMembers of openTrustList); a refused list is nobody, and binds nothing.
 */
export function binderOverLaunches(
  store: MemberLaunchRecords,
  processes: ProcessTable,
  signedMembers: () => readonly SignedMember[],
): Binder {
  return (sender) => {
    if (sender === undefined || !isPid(sender.sending_pid)) return null

    const matching = launchesIn(store).filter((launch) => launch.pid === sender.sending_pid)
    if (matching.length !== 1) return null

    const [launch] = matching
    if (launch === undefined) return null
    if (processes.identityOf(launch.pid) !== launch.process_started_at) return null
    const signed = signedMembers().some(
      (member) => member.member_name === launch.member_name && member.node_id === launch.node_id,
    )
    if (!signed) return null

    return launch.node_id
  }
}

/**
 * Every launch the store holds, or none when it cannot vouch for them all: a row
 * that is not a launch, or one kept under another member's name than its own,
 * means someone other than the launcher wrote there.
 */
export function launchesIn(store: MemberLaunchRecords): readonly MemberLaunch[] {
  const launches: MemberLaunch[] = []
  for (const { key, row } of store.all()) {
    if (!isMemberLaunch(row) || row.member_name !== key) return []
    launches.push(row)
  }
  return launches
}

function isMemberLaunch(value: unknown): value is MemberLaunch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { member_name, node_id, pid, process_started_at } = value as Record<string, unknown>
  return (
    typeof member_name === 'string' &&
    MEMBER_NAME.test(member_name) &&
    typeof node_id === 'string' &&
    NODE_ID.test(node_id) &&
    node_id === node_id.toLowerCase() &&
    typeof pid === 'number' &&
    isPid(pid) &&
    typeof process_started_at === 'string' &&
    process_started_at !== ''
  )
}

function isPid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0
}
