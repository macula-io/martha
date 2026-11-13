// What a record looks like after the owner released it (martha#321).
//
// This exists so an owner whose gate is holding a member can let that member work again without throwing its session
// away — and so the release survives the crew's own refresh instead of being undone by it.
//
// WHY A SEPARATE STREAM. Each session's row stream (`session-record:<id>`) has exactly one writer: the member's
// launcher. It checks that stream before every tool call and refuses the session for good once the stream holds more
// rows than the launcher kept, and a row with any key besides `ingested` reads as LOST. So the owner's terminal — a
// different process — cannot append there without breaking the member it exists to free. `martha release` therefore
// writes `release-of:<session>`, and the launcher stays the only writer of the session stream (Mercurius's ruling,
// 2026-11-13, on this issue).
//
// THREE RULES, and each one is a test.
//
//   1. THE SESSION STREAM KEEPS THE RAW RECORD, and nothing here writes a cleared record into it. A release is an
//      overlay applied when the record is read — for a decision (the gate) and for an inheritance (the carry). The
//      carry's handover check is why: a stamp records the length and digest of the record it saw, and a shorter record
//      fails that check, so a cleared record written back would make the successor read as lost and the release would
//      be undone by the very next refresh.
//
//   2. A MARK CLEARS A FIXED PREFIX, NEVER EVERYTHING. It holds `through`, the length of the raw record it cleared,
//      and a digest of that prefix. The record after release is `raw.slice(through)`, and only when the digest matches
//      the raw prefix; a mark that does not match is ignored and the member stays held. A fixed prefix matters in
//      time: a member may take in a stranger's text after the owner typed the release but before the launcher reads
//      the stream, and "clear it all" would clear an arrival the owner never saw. It also makes applying a mark twice
//      give the same answer, so the launcher and the carry can both apply it without coordinating.
//
//   3. ONE PURE FUNCTION DECIDES, AND BOTH READERS CALL IT. If the release stream cannot be read, no release is
//      applied and the member stays held exactly as before — never lost, never released.
//
// The residual is the one the design already names: same-user code can append to `release-of:` directly, as it could
// to any stream (A13). Nothing here pretends to close that.

import { createHash } from 'node:crypto'

import type { Ingestion, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'

/** What prefixes a session's release stream; the rest is the session id, as the session record's stream does. */
export const RELEASE_STREAM = 'release-of:'

/** The stream one session's releases are kept in. */
export const releaseStreamOf = (session_id: string): string => `${RELEASE_STREAM}${session_id}`

/**
 * One release the owner made: how much of the record it cleared, that prefix's digest, who released, when, and how
 * many arrivals it cleared. The count is the most the mark may hold about what it cleared — never the text, because
 * the arrivals are what must not be readable to a model.
 */
export interface ReleaseMark {
  /** The length of the raw record this mark cleared: the record after release begins after it. */
  readonly through: number
  /** The digest of that prefix, computed by recordDigestOf, exactly as a handover stamp computes it. */
  readonly digest: string
  /** Who released it: the owner's mark, the one identity the gate admits without the policy. */
  readonly by: string
  /** When, as an ISO moment, so a reader can tell a release from one made after it. */
  readonly at: string
  /** How many arrivals it cleared, for the owner to read. */
  readonly cleared: number
}

/** A digest of a record's prefix, in the shape a handover stamp keeps, so a mark and a stamp can be compared. */
export function recordDigestOf(ingested: readonly Ingestion[]): string {
  return createHash('sha256')
    .update(JSON.stringify(ingested.map((ingest) => [ingest.path, ingest.from_node_id])))
    .digest('hex')
}

/** True when this mark's prefix is still exactly the beginning of this raw record. A longer record still matches. */
export function markHolds(mark: ReleaseMark, raw: readonly Ingestion[]): boolean {
  if (!Number.isInteger(mark.through) || mark.through < 0 || mark.through > raw.length) return false
  return recordDigestOf(raw.slice(0, mark.through)) === mark.digest
}

/**
 * What the gate and the carry read for this session: the raw record with the owner's newest matching release applied.
 *
 * Pure, so both readers get the same answer, and applying it twice changes nothing. A mark that no longer matches the
 * record — because the record was replaced, or because it names a prefix this record does not begin with — is ignored
 * rather than trusted.
 */
export function releasedRecordOf(raw: readonly Ingestion[], marks: readonly ReleaseMark[]): Session {
  for (let newest = marks.length - 1; newest >= 0; newest -= 1) {
    const mark = marks[newest]
    if (mark !== undefined && markHolds(mark, raw)) return { ingested: raw.slice(mark.through) }
  }
  return { ingested: raw }
}

/**
 * The mark an owner's release writes for a record it is clearing whole: the length and digest of what it saw.
 *
 * The whole record is what the owner's answer clears (the gate's question 1: not a chosen subset, because choosing is
 * the model's job and the model is what was reached), and the mark still clears a prefix — the one that was the whole
 * record when it was made.
 */
export function releaseMarkFor(
  raw: readonly Ingestion[],
  by: string,
  now: () => number = Date.now,
): ReleaseMark {
  return {
    through: raw.length,
    digest: recordDigestOf(raw),
    by,
    at: new Date(now()).toISOString(),
    cleared: raw.length,
  }
}

/** A stored mark, or undefined when this is not one: a stream that holds something else releases nothing. */
export function markOf(row: unknown): ReleaseMark | undefined {
  if (typeof row !== 'object' || row === null) return undefined
  const entry = row as Record<string, unknown>
  const through = entry['through']
  const digest = entry['digest']
  const by = entry['by']
  const at = entry['at']
  const cleared = entry['cleared']
  if (typeof through !== 'number' || !Number.isInteger(through) || through < 0) return undefined
  if (typeof digest !== 'string' || digest === '') return undefined
  if (typeof by !== 'string' || by === '') return undefined
  if (typeof at !== 'string' || at === '') return undefined
  if (typeof cleared !== 'number' || !Number.isInteger(cleared) || cleared < 0) return undefined
  return { through, digest, by, at, cleared }
}
