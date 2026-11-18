// What the pinned Claude Code host recorded about the tools a launch served a session (martha#658), parsed into the
// core's `AToolDelta` and folded by ../hold_a_session_to_its_served_tools into the host-neutral fact `ServedToolsHeld`.
// This file holds only Claude Code's own parts: its record type, its field names, its causes and its transcript folder.
//
// The host writes one transcript line each time the tools it defers change: the names it added, the names it
// withdrew, and why. A session that lost its crew tools works on and cannot say so itself; this line is written by
// the host, so it can be read from outside the session that lost them.
//
// T3 (claude_code_host.ts) is narrowed for this one record type only. The transcript is a file the member's own shell
// can append to, so nothing here is read for identity, authority, taint, origin or any gate. Only typed values leave
// this file, and the fold's own comment says which:
//   - the names stay as written, for the fold to keep only by equality with a served name;
//   - why, through the closed set `ServedToolsCause`, by the causes taken from the recording (`not_configured` in
//     every retraction it holds);
//   - the failed servers as a count; cause neutral only when the host wrote exactly true.
//
// The record type, its field names and the cause set are the recording's (recorded_claude_code_tool_deltas.json),
// never typed by hand: a host that renames them fails the test that reads the recording.

import { readFileSync } from 'node:fs'

import type { ServedToolsHeld } from '../host_contract/host_contract.ts'
import { servedToolsHeldAfter, theCausesOf, type AToolDelta } from '../hold_a_session_to_its_served_tools/hold_a_session_to_its_served_tools.ts'
import { openTheTranscript, type AHeldTranscript, type Refused, type WhereTheTranscriptIs } from '../read_one_file_held_by_its_descriptor/read_one_file_held_by_its_descriptor.ts'
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

/** The fields of a record as a list: the field itself when it is one, nothing otherwise. */
const listIn = (field: unknown): readonly unknown[] => (Array.isArray(field) ? field : [])

/** The tool delta one transcript line is, parsed into the core's terms, or undefined when it is any other line. */
export function toolDeltaIn(line: string): AToolDelta | undefined {
  let entry: unknown
  try {
    entry = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(entry) || entry['type'] !== TOOL_DELTA_LINE || !isRecord(entry['attachment'])) return undefined
  const fields = entry['attachment']
  if (fields['type'] !== TOOL_DELTA_TYPE) return undefined
  return {
    removed: listIn(fields[TOOL_DELTA_FIELDS.removed]),
    added: [...listIn(fields[TOOL_DELTA_FIELDS.added]), ...listIn(fields[TOOL_DELTA_FIELDS.readded])],
    cause_neutral: fields[TOOL_DELTA_FIELDS.cause_neutral] === true,
    causes: theCausesOf(causesIn(fields[TOOL_DELTA_FIELDS.retracted]), RECORDED_LEFT_THE_CONFIGURATION),
    failed_servers: listIn(fields[TOOL_DELTA_FIELDS.failed_servers]).length,
    stamp: entry['timestamp'],
  }
}

/** The state after one more transcript line, folded by the core. */
export function servedToolsHeldAfterTheLine(before: ServedToolsHeld, line: string, served: ReadonlySet<string>, now: number): ServedToolsHeld {
  return servedToolsHeldAfter(before, toolDeltaIn(line), served, now)
}

/**
 * The folder under the host config folder that holds every project's session transcripts: the same folder
 * ../refuse_a_member_writing_owner_memory denies a member's writes in. Not exported: the tree's tests spell the host's
 * layout out as they build it.
 */
const PROJECTS_FOLDER = 'projects'

/** Opens a session's Claude Code transcript under every bound the core reader holds it to, or refuses it by name. */
export function openTheClaudeCodeTranscript(where: WhereTheTranscriptIs): AHeldTranscript | Refused {
  return openTheTranscript(where, PROJECTS_FOLDER)
}
