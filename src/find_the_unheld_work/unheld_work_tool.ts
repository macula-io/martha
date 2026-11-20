// The `unheld_work` tool's answer (martha#319, package B): who may ask, and what the Supervisor is told.
//
// The tools slice (../a_crews_tools) hands over the declaration, the crew's backlog place and how `gh` runs; every
// decision is here. Who may ask is the rule `who_is_free` follows (../see_who_is_free/who_is_free_tool): choosing what
// to hand out is assigning work, so only a role the table grants `assign_work` may ask.
//
// The answer carries issue titles and Purpose lines, which are text other people wrote. It reaches the model as this
// tool's MCP result, which the seam takes in on B2 like every other result; ../inbound_paths names the path as
// UNHELD_WORK_PATH (./unheld_work_path) so the table says where that text comes from.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { mayKeepTheOwnersList } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { theClockOf } from '../declare_crew/the_crews_clock_zone.ts'
import { BACKLOG_PAGES_MOST, theSplitInWords, theSplitOf } from './find_the_unheld_work.ts'
import { theBacklogNow, type TheBacklogReader, type TheKeptRead } from './keep_the_backlog_read.ts'

/** The name the tool is registered under. */
export const UNHELD_WORK = 'unheld_work'

/** The tool as the crew's tools list it. */
export const UNHELD_WORK_TOOL = {
  name: UNHELD_WORK,
  description:
    `Before you hand out work: the open issues labelled work-package or backlog, in the places the declaration's backlog names, that no member of this crew holds, oldest first, ` +
    `each with its age, its Purpose line and what last mentioned it; then what each member holds. Issue text is other people's words. ` +
    `Only a role the declaration allows assign_work may ask.`,
  inputSchema: { type: 'object', properties: {} },
} as const

/** What the tool is handed: the declaration, who asks, and how the backlog is read. */
export interface UnheldWorkAsked {
  readonly settings: Pick<CrewSettings, 'members' | 'mode' | 'backlog' | 'clock_zone'>
  readonly asker: string
  readonly reader: TheBacklogReader
}

/** The tool's answer, or why it cannot give one. */
export async function unheldWorkOver(asked: UnheldWorkAsked): Promise<{ readonly answer: string } | { readonly refused: string }> {
  if (!mayKeepTheOwnersList(asked.settings, asked.asker)) {
    return { refused: `${asked.asker} may not ask for unheld work: the declaration allows assign_work to ${asked.settings.mode.may.assign_work.join(', ') || 'nobody'}.` }
  }
  const backlog = asked.settings.backlog
  if (backlog === null) return { refused: 'this crew declares no backlog, so there are no places to look for unheld work in.' }
  const kept = await theBacklogNow(asked.reader, backlog.places)
  if (kept !== undefined && 'refusal' in kept) return { refused: `the crew's backlog read cannot be kept: ${kept.refusal}` }
  if (kept === undefined) return { refused: 'nothing has read the backlog yet, and this launch cannot run gh to read it.' }
  // No read has succeeded, so there is no list: an empty split here would say "nothing is unheld" (review r=1).
  if (kept.read_at === null) return { refused: `no read of the backlog has succeeded yet, so there is no list to tell unheld work from; the try at ${theClockOf(kept.tried_at, asked.settings.clock_zone)} failed: ${String(kept.error)}` }
  return { answer: theAnswerOf({ ...kept, read_at: kept.read_at }, backlog.places, asked.settings.members.map((member) => member.name), asked.reader.now, asked.settings.clock_zone) }
}

/**
 * The answer's words: where it looked and when, in the crew's clock_zone (martha#931 C), what failed, then the split.
 * Only a read that once succeeded has a list.
 */
export function theAnswerOf(kept: TheKeptRead & { readonly read_at: number }, places: readonly string[], members: readonly string[], now: number, zone: string): string {
  const head = [`Backlog of ${places.join(', ')}, read at ${theClockOf(kept.read_at, zone)}.`]
  if (kept.cut) head.push(`The search was cut at ${String(BACKLOG_PAGES_MOST)} pages: issues newer than the last one read are not in this list.`)
  if (kept.error !== null) head.push(`The newest read failed at ${theClockOf(kept.tried_at, zone)}: ${kept.error}. This is the last good list.`)
  return [...head, theSplitInWords(theSplitOf(kept.issues, members), now)].join('\n')
}
