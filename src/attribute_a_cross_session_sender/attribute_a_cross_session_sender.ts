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
// The residual, accepted for now (owner's ruling on martha#1, A13 is martha#24):
// every member runs as the same OS user, so a member that already holds a shell
// can rewrite the launcher's file. The signed roster (martha#2 item 7) closes it.

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'

/** What the launcher records when it starts a member. */
export interface MemberLaunch {
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
 * What a host attests about who sent one delivery: the sending process, as the
 * host learned it out of band (the kernel's peer credentials on a Unix socket).
 * A host that knows only the turn's text has nothing to put here.
 */
export interface AttestedSender {
  readonly sending_pid: number
}

/**
 * Where the launcher's records live, one per member. Only the launcher writes
 * them. One record per member, so two launches at once never write over each
 * other's record: there is no shared list to read, change and write back.
 */
export interface MemberLaunchStore {
  /** Every record, or none when the store cannot vouch for what it holds. */
  launches(): readonly MemberLaunch[]
  /** Keep this member's record, in place of any it had. */
  keep(launch: MemberLaunch): void
  /** Drop this member's record. */
  drop(member_name: string): void
}

/** The kernel's view of a process. */
export interface ProcessTable {
  /**
   * When the process with this pid started, boot included, or null when no
   * process has it or the boot cannot be told.
   */
  startTimeOf(pid: number): string | null
}

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

  const process_started_at = processes.startTimeOf(launched.pid)
  if (process_started_at === null) {
    return {
      recorded: false,
      refusal: `A launch of ${launched.member_name} is not recorded: no process ${launched.pid} is running.`,
    }
  }

  const node_id = launched.node_id.toLowerCase()
  for (const stale of store.launches()) {
    if (stale.member_name !== launched.member_name && (stale.pid === launched.pid || stale.node_id === node_id)) {
      store.drop(stale.member_name)
    }
  }

  store.keep({ member_name: launched.member_name, node_id, pid: launched.pid, process_started_at })
  return { recorded: true }
}

/** Record that the launcher stopped a member: its record goes. */
export function recordMemberStopped(store: MemberLaunchStore, member_name: string): void {
  store.drop(member_name)
}

/**
 * The binder over the launcher's records.
 *
 * It reads the records and the kernel on every delivery, so a member that exited
 * since the last delivery is already dead here.
 */
export function binderOverLaunches(store: MemberLaunchStore, processes: ProcessTable): Binder {
  return (sender) => {
    if (sender === undefined || !isPid(sender.sending_pid)) return null

    const matching = store.launches().filter((launch) => launch.pid === sender.sending_pid)
    if (matching.length !== 1) return null

    const [launch] = matching
    if (launch === undefined) return null
    if (processes.startTimeOf(launch.pid) !== launch.process_started_at) return null

    return launch.node_id
  }
}

function isPid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0
}
