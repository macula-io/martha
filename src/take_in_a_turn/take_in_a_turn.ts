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
//      On the binder's path the host hands over no identity at all, only the
//      sending process it attests, and the binder alone turns that into a node
//      id (../attribute_a_cross_session_sender). On the path the host's engine
//      attests, the owner typing at the member's own terminal, the identity is
//      the owner's mark and nothing the host offers (martha#51).
//
//   2. THE RECORD IS PERSISTED PER SESSION ID AND RELOADED ON START. Holding it
//      only in memory fails open on every process restart, because a resumed
//      transcript would come back to an empty record. A session that expects a
//      record and cannot read one is TAINTED, never fresh.
//
//   3. A SESSION ID IS NEVER STARTED TWICE. Only a session under a new id starts
//      with no record, and only when the host's declared event says it is
//      fresh (../carry_taint_across_a_refresh). A compaction and a resume keep
//      the id and so keep the record. A fresh start on an id that already holds
//      a record has lost its record and overwrites nothing: reusing an id must
//      never wipe what the old session took in.
//
//   4. COMPACTION AND A HANDOVER ARE NOT ARRIVALS. They inherit the predecessor's
//      record from the store; they are not new text to record. A handover is
//      written and stamped by the host and read through
//      ../carry_taint_across_a_refresh, so the record it inherits is the
//      predecessor's own, from the store, and never the file's word for it.
//
//   5. A LOST RECORD STAYS LOST. A session whose record could not be read is
//      remembered as lost, never as empty, so a second restart does not turn it
//      fresh.

import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { INBOUND_PATHS, attestationOf, senderIsAttested } from '../inbound_paths/inbound_paths.ts'
import {
  OWNER_AT_THE_TERMINAL,
  recordIngestion,
  startFreshSession,
  type Ingestion,
  type Session,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { framedDeliveryOf } from '../trust_only_framed_envelopes/trust_only_framed_envelopes.ts'
import type { Arrival, AttestedSender, TurnSource } from '../host_contract/host_contract.ts'

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
  owner_typed: 'A14',
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

/**
 * A session that is starting new: its empty record is written before anything
 * arrives. An id that already holds a record is not new, and has lost its record.
 */
export function beginSession(store: SessionRecordStore, session_id: string): HostSession {
  if (store.read(session_id) !== undefined) return sessionWithLostRecord(session_id)
  const gate = startFreshSession()
  store.write(session_id, gate)
  return { id: session_id, gate, record_missing: false }
}

/**
 * What the store keeps for a session whose record could not be read.
 *
 * Writing an empty record instead would fail open: the next start would read it
 * as a session that took in nothing. Its path is one the registry does not know,
 * so the gate refuses on it even where `record_missing` is not consulted.
 */
export const RECORD_LOST: Ingestion = { path: 'record-lost', from_node_id: null }

/** A session whose record cannot be read: tainted, never fresh. */
export function sessionWithLostRecord(session_id: string): HostSession {
  return { id: session_id, gate: startFreshSession(), record_missing: true }
}

/** The host's view of a record read from the store. */
export function sessionFromRecord(session_id: string, gate: Session | undefined): HostSession {
  if (gate === undefined || gate.ingested.some((ingest) => ingest.path === RECORD_LOST.path)) {
    return sessionWithLostRecord(session_id)
  }
  return { id: session_id, gate, record_missing: false }
}

/**
 * A session that is expected to have a record — a restart, a resume, a mod
 * reload. If the record cannot be read, the session is tainted: an empty record
 * is the one thing that must never be assumed.
 */
export function resumeSession(store: SessionRecordStore, session_id: string): HostSession {
  return sessionFromRecord(session_id, store.read(session_id))
}

/** Keep the record, so the next process can load it. A lost record stays lost. */
export function rememberSession(store: SessionRecordStore, session: HostSession): void {
  store.write(session.id, session.record_missing ? recordIngestion(session.gate, [RECORD_LOST]) : session.gate)
}

/**
 * The session after this turn, with the turn recorded.
 *
 * The identity is carried only where the registry says something attested the
 * sender. Everywhere else it is dropped, even when the host offers one, because a
 * path nobody attests cannot make a stranger a member. On the binder's path the
 * identity is the binder's answer for the sender the host attests, and nothing
 * else: a host whose binder binds nothing records the delivery unattributed.
 */
export function takeInTurn(session: HostSession, arrival: Arrival, binder: Binder): HostSession {
  const path = pathOf(arrival)
  const identity = identityOf(path, arrival, binder)

  return { ...session, gate: recordIngestion(session.gate, [{ path, from_node_id: identity }]) }
}

/** The registry rows that are not a turn source the host reports. */
export const REGISTRY_ROWS_THAT_ARE_NOT_TURN_SOURCES: readonly string[] = [
  'A8', // a handover is inherited through the record, not taken in (rule 4)
  'A9', // a forged envelope is not something a host reports
  'A12', // a compaction summary is inherited through the record, not taken in
  'B8', // no body text reaches the model
  // code the host starts by itself is not text taken in: the launch gate stands there
  ...INBOUND_PATHS.filter((path) => path.klass === 'launched').map((path) => path.id),
  // words refused before the host starts never become a turn: the argument gate stands there
  ...INBOUND_PATHS.filter((path) => path.control.kind === 'refused-before-launch').map((path) => path.id),
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

function identityOf(path: string, arrival: Arrival, binder: Binder): string | null {
  if (!senderIsAttested(path)) return null
  if (attestationOf(path) === 'host-engine') return OWNER_AT_THE_TERMINAL
  if (attestationOf(path) === 'host-binder') return binder(attestedSenderOf(arrival))
  return 'from_identity' in arrival ? (arrival.from_identity ?? null) : null
}

/**
 * The sender the host attests for a delivery, or undefined.
 *
 * A text-only turn names its sender only where the host also says the harness
 * delivered it: a whole envelope the owner pasted is otherwise indistinguishable
 * from a delivery, and must stay unattributed.
 */
function attestedSenderOf(arrival: Arrival): AttestedSender | undefined {
  if ('source' in arrival) return arrival.source === 'cross_session' ? arrival.sender : undefined
  return arrival.origin === 'harness_delivery' ? arrival.sender : undefined
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
