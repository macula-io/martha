// What one launch answers a host's reports from (martha#541, packages 2-4, 1a).
//
// This exists so every gate the crew keeps is asked in one place that names no host, instead of in the Claude Code
// adapter (#257's finding 1). It is that place: the entry one host's adapter reaches, and every host's after it.
//
// What it holds in 1a is what every answer is made from, and nothing that decides anything yet: the sessions this launch
// has taken a start of, the record kept for each and the reason one can no longer be vouched for, one order its events
// are answered in, and the checkout's tree as it was when the owner approved the launch (what a read is exempt
// against, martha#127). The handlers that still answer in the adapter ask for those here, so the state has one owner
// from the moment the adapter stops holding it.
//
// The members that answer a report — a session's start, a turn, a tool call, a tool result, a review the host saw fail
// — are added by the pull requests that move them (1b, 2, 3). Each of those removes a member this file exposes today
// for the handlers that have not moved yet; the door closes to the answering members alone when the last one does.
//
// It names no host: the types it takes are the slices' own, and a host's facts arrive already translated by the
// adapter (packages 2-4's design, comment 6941097792). The contract's words are added here by the pull requests that
// first answer a report in them.

import type { ApprovedLaunch } from '../answer_a_tool_call/answer_a_tool_call.ts'
import type { LaunchHost } from '../judge_a_checkouts_tree/checkout_tree.ts'
import { fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import type { SessionRecords } from '../session_records_in_rows/session_records_in_rows.ts'
import { type HostSession, rememberSession } from '../take_in_a_turn/take_in_a_turn.ts'

/**
 * What the entry is given for one launch: the record it keeps, the launch the owner approved, and the machine the
 * launch gate reads the checkout through. The adapter builds it from the same values it answers with, so the entry
 * reads nothing the adapter does not.
 */
export interface ThePlacesAHostReportsOver {
  readonly records: SessionRecords
  /** The member's launch, as `prepareLaunch` was given it. */
  readonly launch: ApprovedLaunch
  /**
   * The machine parts the launch gate reads the checkout with: the contract's own `stores.files`, `stores.scratch` and
   * `processes.runNow` (martha#16). The launcher passes the value it runs with; a slice never holds the machine.
   */
  readonly machine: LaunchHost
}

/**
 * One launch's answers, as the adapter reaches them while its handlers have not all moved: the record, the sessions,
 * the order, and the tree the owner approved. Nothing here decides anything, and no member is added for a caller that
 * has not moved: the door narrows as the handlers do.
 */
export interface TheAnswersOfOneLaunch {
  /** The record this launch keeps, as the entry holds it: the adapter reads it here and nowhere else. */
  readonly records: SessionRecords
  /** Runs `work` after every piece of work already asked for, so it reads the record the one before it wrote. */
  inOrder<T>(work: () => Promise<T>): Promise<T>
  /** Whether this launch holds a start of this session. */
  holds(session_id: string): boolean
  /** Why nothing this session takes in may be answered for again, or undefined while it may. */
  brokenBecause(session_id: string): string | undefined
  /** The session an event names, or why the launcher cannot vouch for it. */
  named(session_id: unknown): HostSession | string
  /** Keeps the session's record, or marks it broken and says why. */
  keep(session: HostSession): Promise<string | undefined>
  /** The session as the gate now reads it, or why its record can no longer be vouched for (martha#321). */
  vouchFor(session: HostSession): Promise<HostSession | string>
  /**
   * The checkout's tree as it is now, before the host starts, when the owner approved this start state; `null`
   * otherwise. A checkout with no config is launched whatever it holds and approves nothing, so it gets `null`, and
   * every read in it counts (decided 2026-11-07, martha#127).
   */
  readonly approved_start: string | null
}

/** The answers one launch gives, over the sessions it has taken a start of. */
export function answersOver(
  places: ThePlacesAHostReportsOver,
  sessions: Map<string, HostSession> = new Map<string, HostSession>(),
): TheAnswersOfOneLaunch {
  /** Why this session may be answered for no more, for the rest of this process. */
  const broken = new Map<string, string>()
  let queue: Promise<unknown> = Promise.resolve()

  const approved_start = approvedStartTree(places)

  const breakSession = (session: HostSession, why: string): string => {
    sessions.delete(session.id)
    broken.set(session.id, why)
    return why
  }

  /** Keeps the session's record, or marks the session broken and says why. */
  const keep = async (session: HostSession): Promise<string | undefined> => {
    rememberSession(places.records.store, session)
    try {
      await places.records.flush(session.id)
      sessions.set(session.id, session)
      return undefined
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const why = `the record of session ${session.id} could not be kept (${typeof code === 'string' ? code : String(error)}), so nothing in it is answered for again`
      return breakSession(session, why)
    }
  }

  /**
   * Checks the session's stored record is still the one kept, or marks it broken and says why; and answers with the
   * session as the gate now reads it, because the owner may have released it since the last call (martha#321).
   */
  const vouchFor = async (session: HostSession): Promise<HostSession | string> => {
    try {
      await places.records.check(session.id)
      const record = places.records.store.read(session.id)
      return record === undefined ? session : { ...session, gate: record }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const why = `the record of session ${session.id} can no longer be vouched for (${typeof code === 'string' ? code : error instanceof Error ? error.message : String(error)}), so nothing in it is answered for again`
      return breakSession(session, why)
    }
  }

  return {
    records: places.records,
    inOrder: <T>(work: () => Promise<T>): Promise<T> => {
      const next = queue.then(work)
      queue = next.catch(() => undefined)
      return next
    },
    holds: (session_id) => sessions.has(session_id),
    brokenBecause: (session_id) => broken.get(session_id),
    named: (session_id) => sessionNamed(session_id, sessions, broken),
    keep,
    vouchFor,
    approved_start,
  }
}

/** The session an event names, or why the launcher cannot vouch for it. */
function sessionNamed(
  session_id: unknown,
  sessions: ReadonlyMap<string, HostSession>,
  broken: ReadonlyMap<string, string>,
): HostSession | string {
  if (typeof session_id !== 'string' || session_id === '') return 'the event names no session'
  const lost = broken.get(session_id)
  if (lost !== undefined) return lost
  return sessions.get(session_id) ?? `no start of session ${session_id} was taken, so nothing it takes in can be recorded`
}

/**
 * The checkout's tree as it is now, before the host starts, when the owner approved this start state; `null`
 * otherwise. A checkout with no config is launched whatever it holds and approves nothing, so it gets `null`, and every
 * read in it counts (decided 2026-11-07, martha#127).
 */
function approvedStartTree(places: ThePlacesAHostReportsOver): string | null {
  const state = readLaunchState(places.launch, places.machine, places.launch.approved_tree)
  return places.launch.approved_fingerprints.includes(fingerprintOf(state)) ? state.tree : null
}
