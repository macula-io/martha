// The crew's state a turn of the member who assigns work is handed (martha#984, gap 5 of martha#957): the Supervisor's
// standing items and the crew's nudges, rebuilt for every render of that member's prompt rather than once at its start.
//
// This lives beside the start line (./the_start_line.ts) because it is the same text handed again, for the same member,
// under the same gate: only a member the table lets assign work is handed anything, and the nudge part only when the
// crew turned nudges on. The crew's mod (../claude_code_relay/hooks/crew.tsx) asks for it by THE_CREW_STATE_ASK and puts
// the answer in one `session` section of the system prompt; the mod decides nothing, and builds no text of its own.
//
// A turn reads only what is recorded (martha#984 design, point 2): the standing stream, the channel, the ledgers, the
// closes and the backlog read the crew already keeps. No GitHub call is made and nothing is written: the nudges come
// from ../see_the_crew's turn look, which is handed no processes and keeps no idle clock.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { TheCrewFilesStores, TurnSource } from '../host_contract/host_contract.ts'
import { theStandingItemsOf } from '../keep_the_supervisors_standing_items/the_standing_tools.ts'
import { theStandingPartOfTheStart, todayOf } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { mayKeepTheOwnersList } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { theNudgesPartLines } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { SEE_THE_CREW_TOOL, theNudgesOfATurn } from '../see_the_crew/the_see_the_crew_tool.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { TheStartLine } from './the_start_line.ts'

/** What the crew's mod asks the launcher for, on every render of a member's prompt (martha#984): the crew's state. */
export const THE_CREW_STATE_ASK = 'crew_state_asked'

/** The source the crew's state is taken in on, on a turn (martha#984): its own inbound path, beside the start's A20. */
export const CREW_STATE_SOURCE: TurnSource = 'crew_state'

/**
 * How many nudge lines one turn is handed, at most (martha#984 threat model): the rest are named by count, with the
 * tool that shows them all. The prompt is rendered for every request, so a long list would be paid for on every one.
 */
export const NUDGES_HANDED_ON_A_TURN = 10

/** What a turn's crew state is read over: the crew's streams and stores, this member, every row, and the time. */
export interface TheCrewStateAsked {
  readonly ledger: LedgerHost
  readonly stores: TheCrewFilesStores
  readonly root: string
  readonly member: string
  /** The declaration's settings, or why it could not be read: a crew the launcher cannot read hands nothing. */
  readonly settings: CrewSettings | { readonly refused: string }
  /** Every member's row, by name. */
  readonly rows: Readonly<Record<string, DashboardRow>>
  readonly now: number
}

/**
 * The crew's state for this turn, with the sources its record must take in before it is handed; null when nothing is
 * handed: a member the table does not let assign work, a declaration that cannot be read, or nothing standing and
 * nothing nudged.
 */
export async function theCrewStateOfATurn(asked: TheCrewStateAsked): Promise<TheStartLine | null> {
  const { settings } = asked
  if ('refused' in settings || !mayKeepTheOwnersList(settings, asked.member)) return null
  const standing = theStandingPartOfTheStart(await theStandingItemsOf(asked.ledger), todayOf(asked.now))
  const nudges = theNudgesHandedOnATurn(theNudgesPartLines(await theNudgesOfATurn({ ...asked, settings }), settings))
  const line = [standing, nudges].filter((part): part is string => part !== null).join('\n\n')
  return line === '' ? null : { line, taken_in: [CREW_STATE_SOURCE] }
}

/** The nudge part as theNudgesPart prints it, its lines capped at NUDGES_HANDED_ON_A_TURN; null when there is none. */
export function theNudgesHandedOnATurn(lines: readonly string[]): string | null {
  const [heading, ...nudges] = lines
  if (heading === undefined) return null
  const handed = nudges.slice(0, NUDGES_HANDED_ON_A_TURN)
  const more = nudges.length - handed.length
  const tail = more > 0 ? [`… and ${String(more)} more: call ${SEE_THE_CREW_TOOL.name} for the rest.`] : []
  return [heading, ...handed, ...tail].join('\n')
}
