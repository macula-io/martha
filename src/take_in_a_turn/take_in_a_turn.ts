// What a host calls it when a session has taken something in.
//
// This is the seam the shell gate is wired through. A host does not hand over a
// path id — it hands over what happened: a room poll turned a message into a
// turn, a ring arrived, the owner pasted something. This module turns that into
// the record the gate reads, so the gate never has to know which host it is
// running under.
//
// Four rules are load-bearing here.
//
//   1. AN IDENTITY IS ONLY CARRIED WHERE SOMETHING ATTESTED THE SENDER. The
//      registry says, per path, who attests a sender — a crew roster, the mesh
//      station, or the host's binder (martha#14). Every other path carries none,
//      whatever the text claims: a git commit author, a `gh` login, an envelope's
//      `from` attribute and a name in a message are written by whoever wrote the
//      text. A commit authored under the supervisor's node id gets no shell.
//
//   2. THE RECORD IS PERSISTED PER SESSION ID AND RELOADED ON START. Holding it
//      only in memory fails open on every process restart, because a resumed
//      transcript would come back to an empty record. A session that expects a
//      record and cannot read one is TAINTED, never fresh.
//
//   3. ONLY A REAL REPLACEMENT CLEARS THE RECORD. `clear` and `new_session` start
//      afresh. `compaction`, `handover` and `resume` keep it — they carry the old
//      text forward, and a restart that resumes a transcript is `resume`, not
//      `new_session`.
//
//   4. COMPACTION AND A HANDOVER ARE NOT ARRIVALS. They inherit the predecessor's
//      record from the store; they are not new text to record. A handover is
//      written from the predecessor's own context, so the record it inherits is
//      the honest summary of what that context held.

import { INBOUND_PATHS, senderIsAttested } from '../inbound_paths/inbound_paths.ts'
import {
  recordIngestion,
  startFreshSession,
  type Session,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { framedDeliveryOf, type TurnOrigin } from '../trust_only_framed_envelopes/trust_only_framed_envelopes.ts'

/** Every way text reaches a session, in the words a host would use for it. */
export type TurnSource =
  | 'crew_room'
  | 'shared_room'
  | 'backlog_digest'
  | 'ring'
  | 'ring_answer'
  | 'cross_session'
  | 'checkout_hook'
  | 'owner_paste'
  | 'server_instructions'
  | 'checkout_run'
  | 'mesh_read'
  | 'mcp_result'
  | 'gh'
  | 'checkout_file'
  | 'git_history'
  | 'web'
  | 'subagent'

/** The inbound path each source is recorded on, so the registry and the host agree. */
export const PATH_OF_SOURCE: Readonly<Record<TurnSource, string>> = {
  crew_room: 'A1',
  shared_room: 'A2',
  backlog_digest: 'A3',
  ring: 'A4',
  ring_answer: 'A5',
  cross_session: 'A6',
  checkout_hook: 'A7',
  owner_paste: 'A10',
  server_instructions: 'A11',
  checkout_run: 'A13',
  mesh_read: 'B1',
  mcp_result: 'B2',
  gh: 'B3',
  checkout_file: 'B4',
  git_history: 'B5',
  web: 'B6',
  subagent: 'B7',
}

/** Something a session took in, as the host describes it. */
export type Arrival =
  | {
      /** The host knows what it was. */
      readonly source: TurnSource
      /** The identity the host holds for the sender; omitted or null means it holds none. */
      readonly from_identity?: string | null
    }
  | {
      /** The host has only the turn's text, as the Claude Code host does. */
      readonly text: string
      readonly origin?: TurnOrigin
      readonly from_identity?: string | null
    }

/** A replacement of the session, in the words a host would use for it. */
export type Replacement = 'clear' | 'new_session' | 'compaction' | 'handover' | 'resume'

const REPLACES_THE_SESSION: readonly Replacement[] = ['clear', 'new_session']

/** A session, with the record the gate reads and whether that record could be read. */
export interface HostSession {
  readonly id: string
  readonly gate: Session
  /** True when a session that should have had a record could not read one. */
  readonly record_missing: boolean
}

/** Where a session's record lives between turns, and across process restarts. */
export interface SessionRecordStore {
  read(session_id: string): Session | undefined
  write(session_id: string, session: Session): void
}

/** A session that is starting new: its empty record is written before anything arrives. */
export function beginSession(store: SessionRecordStore, session_id: string): HostSession {
  const gate = startFreshSession()
  store.write(session_id, gate)
  return { id: session_id, gate, record_missing: false }
}

/**
 * A session that is expected to have a record — a restart, a resume, a mod
 * reload. If the record cannot be read, the session is tainted: an empty record
 * is the one thing that must never be assumed.
 */
export function resumeSession(store: SessionRecordStore, session_id: string): HostSession {
  const gate = store.read(session_id)
  return gate === undefined
    ? { id: session_id, gate: startFreshSession(), record_missing: true }
    : { id: session_id, gate, record_missing: false }
}

/** Keep the record, so the next process can load it. */
export function rememberSession(store: SessionRecordStore, session: HostSession): void {
  store.write(session.id, session.gate)
}

/**
 * The session after this turn, with the turn recorded.
 *
 * The identity is carried only where the registry says something attested the
 * sender. Everywhere else it is dropped, even when the host offers one, because a
 * path nobody attests cannot make a stranger a member.
 */
export function takeInTurn(session: HostSession, arrival: Arrival): HostSession {
  const path = pathOf(arrival)
  const identity = senderIsAttested(path) ? (arrival.from_identity ?? null) : null

  return { ...session, gate: recordIngestion(session.gate, [{ path, from_node_id: identity }]) }
}

/**
 * The session after a replacement.
 *
 * Only a real replacement clears what the session took in. A compaction, a
 * handover or a resumed transcript keeps it.
 */
export function replaceSession(session: HostSession, replacement: Replacement): HostSession {
  if (!REPLACES_THE_SESSION.includes(replacement)) return session
  return { ...session, gate: startFreshSession(), record_missing: false }
}

/** The registry rows that are not a turn source the host reports. */
export const REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES: readonly string[] = [
  'A8', // a handover is inherited through the record, not taken in (rule 4)
  'A9', // a forged envelope is not something a host reports
  'A12', // a compaction summary is inherited through the record, not taken in
  'B8', // no body text reaches the model
  // code the host starts by itself is not text taken in: the launch gate stands there
  ...INBOUND_PATHS.filter((path) => path.klass === 'launched').map((path) => path.id),
]

/** Registry rows a source can record that the registry does not know. */
export function pathsWithoutARegistryRow(
  paths: readonly string[] = Object.values(PATH_OF_SOURCE),
): readonly string[] {
  const known = new Set(INBOUND_PATHS.map((path) => path.id))
  return paths.filter((path) => !known.has(path))
}

/** Turn sources whose registry row may carry an identity at all. */
export function sourcesThatMayCarryAnIdentity(): readonly string[] {
  return Object.entries(PATH_OF_SOURCE)
    .filter(([, path]) => senderIsAttested(path))
    .map(([source]) => source)
}

function pathOf(arrival: Arrival): string {
  if ('source' in arrival) return PATH_OF_SOURCE[arrival.source]

  // The host has only text: the derivation rule from ../trust_only_framed_envelopes
  // decides whether this turn is a delivery at all. Either way the identity above
  // came from the host, not from what the text says.
  const delivery = framedDeliveryOf({
    text: arrival.text,
    ...(arrival.origin === undefined ? {} : { origin: arrival.origin }),
  })
  return delivery === undefined ? PATH_OF_SOURCE.owner_paste : PATH_OF_SOURCE.cross_session
}
