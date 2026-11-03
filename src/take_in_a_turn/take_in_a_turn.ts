// What a host calls it when a session has taken something in.
//
// This is the seam the shell gate is wired through. A host does not hand over a
// path id — it hands over what happened: a room poll turned a message into a
// turn, a ring arrived, the owner pasted something, the context was compacted.
// This module turns that into the record the gate reads, so the gate never has
// to know which host it is running under.
//
// Two rules are load-bearing here:
//
//   * The IDENTITY a sender is judged by is the one the host holds for it, and
//     only that. It is never read out of the text: an envelope in a pasted turn
//     carries whatever its writer typed, and taking an identity from it would let
//     the writer name themselves the supervisor.
//   * A session is only cleared by a real replacement — a new session, a restart,
//     a /clear. Compaction and a resumed handover are not replacements: they
//     carry the old text forward, so they add to the record rather than reset it.

import { INBOUND_PATHS } from '../inbound_paths/inbound_paths.ts'
import { recordIngestion, startFreshSession, type Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
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
  | 'handover'
  | 'owner_paste'
  | 'server_instructions'
  | 'compaction'
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
  handover: 'A8',
  owner_paste: 'A10',
  server_instructions: 'A11',
  compaction: 'A12',
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
export type Replacement = 'clear' | 'restart' | 'new_session' | 'compaction' | 'handover' | 'resume'

const REPLACES_THE_SESSION: readonly Replacement[] = ['clear', 'restart', 'new_session']

/**
 * The session after this turn, with the turn recorded.
 *
 * The identity is the host's, never the text's. A host that holds none records an
 * unattributed ingestion, and the session is tainted: text arrived and nobody can
 * say who sent it.
 */
export function takeInTurn(session: Session, arrival: Arrival): Session {
  const identity = arrival.from_identity ?? null
  return recordIngestion(session, [{ path: pathOf(arrival), from_node_id: identity }])
}

/**
 * The session after a replacement.
 *
 * Only a real replacement clears what the session took in. A compaction or a
 * resumed handover keeps it — those carry the old text into the new context, and
 * that is exactly the text a session must not act on.
 */
export function replaceSession(session: Session, replacement: Replacement): Session {
  return REPLACES_THE_SESSION.includes(replacement) ? startFreshSession() : session
}

function pathOf(arrival: Arrival): string {
  if ('source' in arrival) return PATH_OF_SOURCE[arrival.source]

  // The host has only text: the derivation rule from ../trust_only_framed_envelopes
  // decides whether this turn is a delivery at all. Either way the identity above
  // came from the host, not from what the text says.
  const delivery = framedDeliveryOf({ text: arrival.text, ...(arrival.origin === undefined ? {} : { origin: arrival.origin }) })
  return delivery === undefined ? PATH_OF_SOURCE.owner_paste : PATH_OF_SOURCE.cross_session
}

/** The registry ids this seam can produce, for the coverage check. */
export const PATHS_THIS_SEAM_RECORDS: readonly string[] = Object.values(PATH_OF_SOURCE)

/** Every registry row the seam reaches; a row outside this set is not a turn source. */
export function sourcesWithoutARegistryRow(): readonly string[] {
  const known = new Set(INBOUND_PATHS.map((path) => path.id))
  return PATHS_THIS_SEAM_RECORDS.filter((path) => !known.has(path))
}
