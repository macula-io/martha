// Whether a session still holds the tools its launch served, folded from the tool deltas its host recorded
// (martha#658), as the host-neutral fact `ServedToolsHeld`. A core slice: the host adapter parses its own record into
// `AToolDelta`, and nothing here knows a host's record type or field names.
//
// The record comes from a file the member's own shell can append to, so nothing here is read for identity, authority,
// taint, origin or any gate. It is read as a liveness fact that can only raise a notice or hold a state at unknown, and
// only typed values leave this file:
//   - a tool name counts only when it equals a name the launch served, and no name is carried out at all;
//   - why, through the closed set `ServedToolsCause`: a cause the host adapter names as leaving the configuration is
//     `left_the_configuration`; anything else is `other`, never the string;
//   - the failed servers as a count;
//   - the time, parsed as a date, or the caller's clock when it does not parse.
// A forged line can raise one notice, or make the member's own loss read as held. It grants nothing.

import type { ServedToolsCause, ServedToolsHeld } from '../host_contract/host_contract.ts'

/** One tool delta as the host adapter parsed it from its own record, with nothing judged yet. */
export interface AToolDelta {
  /** The names the host withdrew, as written: any value, kept only by equality with a served name. */
  readonly removed: readonly unknown[]
  /** The names the host added or added back, as written. */
  readonly added: readonly unknown[]
  /** Whether the host said the withdrawal is cause neutral; true only when it wrote exactly true. */
  readonly cause_neutral: boolean
  /** Why the host withdrew them, already through the closed set (theCausesOf). */
  readonly causes: readonly ServedToolsCause[]
  /** How many servers the host said failed. */
  readonly failed_servers: number
  /** The time the record carries, as written. */
  readonly stamp: unknown
}

/** The state a session starts in: nothing recorded yet, so nothing is claimed. */
export const NOTHING_RECORDED: ServedToolsHeld = { state: 'unknown' }

/** The served names among a field's entries, matched by equality, so no other string is kept. */
function servedIn(field: readonly unknown[], served: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(field.filter((name): name is string => typeof name === 'string' && served.has(name)))
}

/** The one form of time the host writes on a line; Date.parse alone reads a date out of a sentence. */
const A_HOSTS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/

/** The time a line records, as a number; the caller's clock when the line's own is not the host's form. */
function timeOf(stamp: unknown, now: number): number {
  const at = typeof stamp === 'string' && A_HOSTS_TIME.test(stamp) ? Date.parse(stamp) : Number.NaN
  return Number.isFinite(at) ? at : now
}

/**
 * Why the host withdrew them, through the closed set: one entry per distinct cause it gave. `leaving` holds the causes
 * the host adapter knows as leaving the configuration.
 */
export function theCausesOf(causes: readonly string[], leaving: ReadonlySet<string>): readonly ServedToolsCause[] {
  const seen = new Set<ServedToolsCause>(causes.map((cause) => (leaving.has(cause) ? 'left_the_configuration' : 'other')))
  return [...seen].sort()
}

function withdrawnBy(delta: AToolDelta, now: number): ServedToolsHeld {
  return {
    state: 'withdrawn',
    at: timeOf(delta.stamp, now),
    cause_neutral: delta.cause_neutral,
    causes: delta.causes,
    failed_servers: delta.failed_servers,
  }
}

/** Whether the delta adds back every served tool: only then is a session held. */
function addsEveryServed(delta: AToolDelta, served: ReadonlySet<string>): boolean {
  return served.size > 0 && servedIn(delta.added, served).size === served.size
}

/**
 * The state after one more tool delta, or after a record that is none (undefined). A withdrawal of any served tool
 * makes it `withdrawn`; a delta that adds every served tool makes it `held`; everything else, a partial add among it,
 * leaves it as it was.
 */
export function servedToolsHeldAfter(before: ServedToolsHeld, delta: AToolDelta | undefined, served: ReadonlySet<string>, now: number): ServedToolsHeld {
  if (delta === undefined) return before
  if (servedIn(delta.removed, served).size > 0) return withdrawnBy(delta, now)
  if (addsEveryServed(delta, served)) return { state: 'held', at: timeOf(delta.stamp, now) }
  return before
}
