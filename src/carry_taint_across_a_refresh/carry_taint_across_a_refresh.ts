// What a host calls when a session starts, and when a handover is written or read.
//
// This exists so a stranger's text cannot reach a member's shell by waiting for a
// refresh: the successor of a tainted session is tainted too.
//
// Why a session id is not enough. The record of what a session took in is kept
// per session id (../take_in_a_turn). On the Claude Code host a crew refresh is
// a handover file, then `/clear`, then the successor reading the handover — and
// `/clear` starts a new session id. Keyed by id alone, the successor starts with
// an empty record and reads a summary its tainted predecessor wrote: the taint is
// laundered through the crew's normal rhythm, with no forgery at all.
//
// Four rules are load-bearing here.
//
//   1. A HOST DECLARES ITS SESSION EVENTS. Every event that starts a session
//      says whether the id stays (`same_id`), a new id inherits a predecessor's
//      record (`inherits`), or a new id starts with no context (`fresh`). An
//      event the declaration does not list fails closed: the session is held as
//      having lost its record, never as fresh. The events the host EMITS are a
//      second list, which the host's adapter derives from the host's own schema
//      (../claude_code_host for Claude Code), and ../check_every_path_is_gated
//      fails CI on any emitted event the declaration does not cover.
//
//   2. A REFRESH IS AN INHERITANCE, MADE BY THE HOST. The host's mod knows both
//      ids — it ran the refresh — so it hands the predecessor's id to the seam.
//      The model never does. A predecessor whose record cannot be read leaves a
//      successor that has lost its record.
//
//   3. A HANDOVER IS STAMPED BY THE HOST, NOT WRITTEN THROUGH `Write`. A tainted
//      session cannot run `Write`, so a handover written that way is lost exactly
//      when it matters. The host writes the file for the member and stamps it:
//      the member, the predecessor's session id, a digest of the content, and
//      the predecessor's record AS IT WAS when stamped (its length and a digest
//      of it). Reading the handover takes the predecessor's record from the
//      session store and checks it still begins with what was stamped, so a
//      record reset after the stamp — a reused id, a same-user rewrite — reads
//      as lost, never as clean. The record itself is never copied into the
//      stamp.
//
//   4. READING A HANDOVER IS AN INHERITANCE WHEN THE STAMP HOLDS, AND A TAINT
//      WHEN IT DOES NOT. No stamp, a digest that does not match the content, or
//      a predecessor whose record cannot be read: the reader has lost its record.
//      A handover of another member's: unattributed text from a checkout file
//      (B4), which taints. So an owner's bare `/clear` is fresh only until the
//      session reads a handover.
//
// There is no release here. Once tainted, a member stays tainted through every
// refresh until a `fresh` start that reads no handover. An owner release would be
// the owner's own signed act (martha#2, item 7's objects), never a model's; it is
// not built, and nothing here stands in for it.
//
// The residual, named: same-user code that rewrites the stamp store or the
// session store directly (A13) is the anchor weakness item 7 addresses, and an
// OS boundary beyond it. This module stops every path that goes through a model.

import { createHash } from 'node:crypto'

import {
  beginSession,
  rememberSession,
  resumeSession,
  sessionFromRecord,
  sessionWithLostRecord,
  takeInTurn,
  type HostSession,
  type SessionRecordStore,
} from '../take_in_a_turn/take_in_a_turn.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { recordIngestion, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'

/** What an event that starts a session does to the record. */
export type SessionStartOutcome = 'same_id' | 'inherits' | 'fresh'

export const SESSION_START_OUTCOMES: readonly SessionStartOutcome[] = ['same_id', 'inherits', 'fresh']

/** The refresh the crew's mod runs itself: a start no host sends, with the predecessor's id. */
export const CREW_REFRESH = 'crew_refresh'

/** Every event a host can start a session with, and what each does to the record. */
export interface HostSessionEvents {
  readonly host: string
  readonly events: Readonly<Record<string, SessionStartOutcome>>
}

/**
 * The Claude Code host's session events.
 *
 * `compact` and `resume` keep the session id, so the store already carries the
 * record; a `resume` under a new id has no record there, and so has lost it:
 * fail closed. `fork` carries the parent's context under a new id, so it is
 * declared `same_id`, finds no record under that id, and has lost it. It is never
 * `fresh`. `crew_refresh` is the `/clear` the crew's mod ran itself, after the
 * member's handover: the mod reports it as a refresh, with the predecessor's id,
 * because it is one. Only `startup` and a `/clear` the mod did not run start with
 * no context. The events the host emits are derived from its schema by its
 * adapter (../claude_code_host).
 */
export const CLAUDE_CODE_SESSION_EVENTS: HostSessionEvents = {
  host: 'claude-code',
  events: {
    startup: 'fresh',
    clear: 'fresh',
    compact: 'same_id',
    resume: 'same_id',
    fork: 'same_id',
    [CREW_REFRESH]: 'inherits',
  },
}

/** A session starting, as the host reports it. */
export interface SessionStart {
  readonly event: string
  readonly session_id: string
  /** The session this one carries on from; the host's to give, never the model's. */
  readonly predecessor_id?: string
}

/** The session a start event produces, with the record its declaration says it has. */
export function startSession(
  store: SessionRecordStore,
  declared: HostSessionEvents,
  start: SessionStart,
): HostSession {
  const outcome = Object.hasOwn(declared.events, start.event) ? declared.events[start.event] : undefined
  if (outcome === 'fresh') return beginSession(store, start.session_id)
  if (outcome === 'same_id') return resumeSession(store, start.session_id)
  if (outcome === 'inherits') return inherit(store, start)
  return sessionWithLostRecord(start.session_id)
}

function inherit(store: SessionRecordStore, start: SessionStart): HostSession {
  const predecessor = start.predecessor_id === undefined ? undefined : store.read(start.predecessor_id)
  const successor = sessionFromRecord(start.session_id, predecessor)
  rememberSession(store, successor)
  return successor
}

/** Events a host produced that its declaration does not list: each one is a gap. */
export function undeclaredSessionEvents(declared: HostSessionEvents, produced: readonly string[]): readonly string[] {
  return produced.filter((event) => !Object.hasOwn(declared.events, event))
}

/** What the host keeps next to a handover file it wrote for a member. */
export interface HandoverStamp {
  readonly member: string
  readonly predecessor_id: string
  /**
   * When the host stamped it, on the machine's clock. It is what the newest handover of a member is read by
   * (martha#255): the file's own name carries a day, and a day cannot tell two handovers apart.
   */
  readonly written_at: string
  readonly digest: string
  /** How many ingestions the predecessor's record held when stamped. */
  readonly record_length: number
  /** A digest of those ingestions, in order. */
  readonly record_digest: string
}

/** Where stamps live: the host's, keyed by handover file. A model writes none of it. */
export interface HandoverStampStore {
  read(file: string): HandoverStamp | undefined
  write(file: string, stamp: HandoverStamp): void
}

/** A handover file, as the host wrote it or the reader sees it. */
export interface Handover {
  readonly file: string
  readonly content: string
}

function digestOf(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function digestOfRecord(ingested: readonly Ingestion[]): string {
  return digestOf(JSON.stringify(ingested.map((ingest) => [ingest.path, ingest.from_node_id])))
}

/** True when the record still begins with exactly what the stamp saw; a shorter one cannot. */
function recordStillHolds(stamp: HandoverStamp, ingested: readonly Ingestion[]): boolean {
  return digestOfRecord(ingested.slice(0, stamp.record_length)) === stamp.record_digest
}

/** Stamp a handover the host wrote for the member whose session is handing over. */
export function stampHandover(
  stamps: HandoverStampStore,
  writer: { readonly member: string; readonly session: HostSession },
  handover: Handover,
  now: () => number = Date.now,
): void {
  stamps.write(handover.file, {
    member: writer.member,
    predecessor_id: writer.session.id,
    written_at: new Date(now()).toISOString(),
    digest: digestOf(handover.content),
    record_length: writer.session.gate.ingested.length,
    record_digest: digestOfRecord(writer.session.gate.ingested),
  })
}

/**
 * The session after it read a handover.
 *
 * The reader inherits what the predecessor took in, from the session store, when
 * the stamp holds. Every other case taints.
 */
export function readHandover(
  store: SessionRecordStore,
  stamps: HandoverStampStore,
  reader: { readonly member: string; readonly session: HostSession },
  handover: Handover,
): HostSession {
  const stamp = stamps.read(handover.file)
  if (stamp === undefined || stamp.digest !== digestOf(handover.content)) return lose(reader.session)
  if (stamp.member !== reader.member) return takeInTurn(reader.session, { source: 'checkout_file' }, bindNothing)

  const predecessor = sessionFromRecord(stamp.predecessor_id, store.read(stamp.predecessor_id))
  if (predecessor.record_missing || !recordStillHolds(stamp, predecessor.gate.ingested)) return lose(reader.session)
  return { ...reader.session, gate: recordIngestion(reader.session.gate, predecessor.gate.ingested) }
}

function lose(session: HostSession): HostSession {
  return { ...session, record_missing: true }
}
