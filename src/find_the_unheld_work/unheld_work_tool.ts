// The `unheld_work` tool's answer (martha#319, package B): who may ask, and what the Supervisor is told.
//
// The tools slice (../a_crews_tools) hands over the declaration, the crew's backlog place and how `gh` runs; every
// decision is here. Who may ask is the rule `who_is_free` follows (../see_who_is_free/who_is_free_tool): choosing what
// to hand out is assigning work, so only a role the table grants `assign_work` may ask.
//
// The answer carries issue titles and Purpose lines, which are text other people wrote. It reaches the model as this
// tool's MCP result, which the seam takes in on B2 like every other result; ../inbound_paths names the path as
// UNHELD_WORK_PATH so the table says where that text comes from.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { mayKeepTheOwnersList } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { clockOf } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { BACKLOG_PAGES_MOST, theSplitInWords, theSplitOf } from './find_the_unheld_work.ts'
import { theBacklogNow, type TheBacklogReader, type TheKeptRead } from './keep_the_backlog_read.ts'

/** The name the tool is registered under. */
export const UNHELD_WORK = 'unheld_work'

/** The inbound path the answer's issue text arrives on, in ../inbound_paths. */
export const UNHELD_WORK_PATH = 'B10'

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
  readonly settings: Pick<CrewSettings, 'members' | 'mode' | 'backlog'>
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
  return { answer: theAnswerOf(kept, backlog.places, asked.settings.members.map((member) => member.name), asked.reader.now) }
}

/** The answer's words: where it looked and when, what failed, then the split. */
export function theAnswerOf(kept: TheKeptRead, places: readonly string[], members: readonly string[], now: number): string {
  const when = kept.read_at === null ? 'never read' : `read at ${clockOf(kept.read_at)}`
  const head = [`Backlog of ${places.join(', ')}, ${when}.`]
  if (kept.cut) head.push(`The search was cut at ${String(BACKLOG_PAGES_MOST)} pages: issues newer than the last one read are not in this list.`)
  if (kept.error !== null) head.push(`The newest read failed at ${clockOf(kept.tried_at)}: ${kept.error}. This is the last good list.`)
  return [...head, theSplitInWords(theSplitOf(kept.issues, members), now)].join('\n')
}
