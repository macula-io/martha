// What the pinned Claude Code host recorded about the tools a launch served a session (martha#658), as the
// host-neutral fact `ServedToolsHeld`.
//
// The host writes one transcript line each time the tools it defers change: the names it added, the names it
// withdrew, and why. A session that lost its crew tools works on and cannot say so itself; this line is written by
// the host, so it can be read from outside the session that lost them.
//
// T3 (claude_code_host.ts) is narrowed for this one record type only. The transcript is a file the member's own shell
// can append to, so nothing here is read for identity, authority, taint, origin or any gate. It is read as a liveness
// fact that can only raise a notice or hold a state at unknown, and only typed values leave this file:
//   - a tool name counts only when it equals a name the launch served, and no name is carried out at all;
//   - why, through the closed set `ServedToolsCause`, taken from the recording (`not_configured` in every retraction
//     it holds); anything else is `other`, never the string;
//   - the failed servers as a count;
//   - the time, parsed as a date, or the caller's clock when it does not parse.
// A forged line can raise one notice, or make the member's own loss read as held. It grants nothing.
//
// The record type, its field names and the cause set are the recording's (recorded_claude_code_tool_deltas.json),
// never typed by hand: a host that renames them fails the test that reads the recording.

import { readFileSync } from 'node:fs'

import type { ServedToolsCause, ServedToolsHeld } from '../host_contract/host_contract.ts'
import { isRecord } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** One transcript line as the recording keeps it. */
export interface RecordedToolDeltaLine {
  readonly type: string
  readonly timestamp: string
  readonly version: string
  readonly attachment: Readonly<Record<string, unknown>>
}

/** The host's tool deltas, as recorded: an add at a session's start and a withdrawal while it worked. */
export interface RecordedToolDeltas {
  readonly host_version: string
  readonly records: readonly RecordedToolDeltaLine[]
}

export const RECORDED_TOOL_DELTAS: RecordedToolDeltas = JSON.parse(
  readFileSync(new URL('./recorded_claude_code_tool_deltas.json', import.meta.url), 'utf8'),
) as RecordedToolDeltas

/** The fields this reader takes, by the host's own names; the test holds each to a key the recording carries. */
export const TOOL_DELTA_FIELDS = {
  added: 'addedNames',
  readded: 'readdedNames',
  removed: 'removedNames',
  cause_neutral: 'causeNeutral',
  failed_servers: 'failedMcpServers',
  retracted: 'retractedTools',
  retracted_cause: 'cause',
} as const

/** The line kind and the attachment type a tool delta is written as, read from the recording. */
const THE_RECORD = RECORDED_TOOL_DELTAS.records[0]
export const TOOL_DELTA_LINE = THE_RECORD?.type ?? ''
export const TOOL_DELTA_TYPE = String(THE_RECORD?.attachment['type'] ?? '')

/** Every cause the recording saw the host give for a withdrawal: the one the contract calls leaving the configuration. */
export const RECORDED_LEFT_THE_CONFIGURATION: ReadonlySet<string> = new Set(
  RECORDED_TOOL_DELTAS.records.flatMap((line) => causesIn(line.attachment[TOOL_DELTA_FIELDS.retracted])),
)

function causesIn(retracted: unknown): readonly string[] {
  if (!Array.isArray(retracted)) return []
  return retracted.flatMap((one) => (isRecord(one) && typeof one[TOOL_DELTA_FIELDS.retracted_cause] === 'string' ? [one[TOOL_DELTA_FIELDS.retracted_cause] as string] : []))
}

/** The state a session starts in: nothing recorded yet, so nothing is claimed. */
export const NOTHING_RECORDED: ServedToolsHeld = { state: 'unknown' }

/** The tool delta one transcript line is, or undefined when it is any other line. */
function toolDeltaIn(line: string): ADelta | undefined {
  let entry: unknown
  try {
    entry = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(entry) || entry['type'] !== TOOL_DELTA_LINE || !isRecord(entry['attachment'])) return undefined
  const attachment = entry['attachment']
  if (attachment['type'] !== TOOL_DELTA_TYPE) return undefined
  return { fields: attachment, stamp: entry['timestamp'] }
}

/** A tool delta's fields, and the time its line carries. */
interface ADelta {
  readonly fields: Readonly<Record<string, unknown>>
  readonly stamp: unknown
}

/** The served names among a field's entries, matched by equality, so no other string is kept. */
function servedIn(field: unknown, served: ReadonlySet<string>): ReadonlySet<string> {
  if (!Array.isArray(field)) return new Set()
  return new Set(field.filter((name): name is string => typeof name === 'string' && served.has(name)))
}

/** The one form of time the host writes on a line; Date.parse alone reads a date out of a sentence. */
const A_HOSTS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/

/** The time a line records, as a number; the caller's clock when the line's own is not the host's form. */
function timeOf(stamp: unknown, now: number): number {
  const at = typeof stamp === 'string' && A_HOSTS_TIME.test(stamp) ? Date.parse(stamp) : Number.NaN
  return Number.isFinite(at) ? at : now
}

/** Why the host withdrew them, through the closed set: one entry per distinct cause it gave. */
function causesOf(retracted: unknown): readonly ServedToolsCause[] {
  const seen = new Set<ServedToolsCause>(causesIn(retracted).map((cause) => (RECORDED_LEFT_THE_CONFIGURATION.has(cause) ? 'left_the_configuration' : 'other')))
  return [...seen].sort()
}

function withdrawnBy({ fields, stamp }: ADelta, now: number): ServedToolsHeld {
  const failed = fields[TOOL_DELTA_FIELDS.failed_servers]
  return {
    state: 'withdrawn',
    at: timeOf(stamp, now),
    cause_neutral: fields[TOOL_DELTA_FIELDS.cause_neutral] === true,
    causes: causesOf(fields[TOOL_DELTA_FIELDS.retracted]),
    failed_servers: Array.isArray(failed) ? failed.length : 0,
  }
}

/** Whether the line adds back every served tool: only then is a session held. */
function addsEveryServed(fields: Readonly<Record<string, unknown>>, served: ReadonlySet<string>): boolean {
  const added = new Set([...servedIn(fields[TOOL_DELTA_FIELDS.added], served), ...servedIn(fields[TOOL_DELTA_FIELDS.readded], served)])
  return served.size > 0 && added.size === served.size
}

/**
 * The state after one more transcript line. A withdrawal of any served tool makes it `withdrawn`; a line that adds
 * every served tool makes it `held`; every other line, a partial add among them, leaves it as it was.
 */
export function servedToolsHeldAfter(before: ServedToolsHeld, line: string, served: ReadonlySet<string>, now: number): ServedToolsHeld {
  const delta = toolDeltaIn(line)
  if (delta === undefined) return before
  if (servedIn(delta.fields[TOOL_DELTA_FIELDS.removed], served).size > 0) return withdrawnBy(delta, now)
  if (addsEveryServed(delta.fields, served)) return { state: 'held', at: timeOf(delta.stamp, now) }
  return before
}
