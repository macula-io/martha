// The line a session is handed when it starts (martha#254 design line 53, #317, #443 part 5): the Supervisor's standing
// items, then every act of the package this member holds that was sent with no outcome recorded.
//
// This lives here because handing a member its crew text is what this slice does, and the tools slice (../a_crews_tools)
// keeps only the method that calls it. A member the table does not let assign work is handed no standing item.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { TurnSource } from '../host_contract/host_contract.ts'
import { theStandingItemsOf } from '../keep_the_supervisors_standing_items/the_standing_tools.ts'
import { theStandingPartOfTheStart, todayOf } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { mayKeepTheOwnersList } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { theLineAStartingSessionIsHanded, whatWasSent } from '../keep_the_ledger/keep_the_ledger.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The source the standing items are taken in on, at a session's start (martha#317): its own inbound path. */
export const STANDING_ITEMS_SOURCE: TurnSource = 'standing_items'

/** What a session is handed at its start, and the sources its record takes in for it (martha#317). */
export interface TheStartLine {
  readonly line: string
  readonly taken_in: readonly TurnSource[]
}

/** What a starting session is handed over: the crew's streams, this member, its row, and the declaration's table. */
export interface TheStartLineAsked {
  readonly ledger: LedgerHost
  readonly member: string
  /** The declaration's settings, or why it could not be read: a crew the launcher cannot read is handed no standing item. */
  readonly settings: CrewSettings | { readonly refused: string }
  /** The row this session last had, read by the launcher; null when it has none yet. */
  readonly held: DashboardRow | null
  readonly now: number
}

/**
 * The line this member's session starts on: what the member's own row says it holds, and every act of that package that
 * was sent with no outcome recorded (martha#254 design line 53, test 10). The row is the member's, so a session that
 * resumes a package reads its predecessor's package and checks what became of what it sent, instead of hoping it asks.
 * Null when the member holds no package, or when nothing of it was left waiting.
 */
export async function theLineToHandAtStart(asked: TheStartLineAsked): Promise<TheStartLine | null> {
  const standing = await theStandingPartHanded(asked)
  const acts = await theOpenActsHanded(asked)
  const line = [standing, acts].filter((part) => part !== null).join('\n\n')
  if (line === '') return null
  return { line, taken_in: standing === null ? [] : [STANDING_ITEMS_SOURCE] }
}

/** The open acts of the package this member holds, or null when it holds none or nothing of it waits. */
async function theOpenActsHanded(asked: TheStartLineAsked): Promise<string | null> {
  const package_name = asked.held?.holds ?? ''
  if (package_name === '') return null
  const sent = await whatWasSent(asked.ledger, package_name)
  return theLineAStartingSessionIsHanded(package_name, sent.acts)
}

/**
 * The standing items a starting session is handed (martha#317): only to a member the table lets assign work, and nothing
 * when nothing stands.
 */
async function theStandingPartHanded(asked: TheStartLineAsked): Promise<string | null> {
  if ('refused' in asked.settings) return null
  if (!mayKeepTheOwnersList(asked.settings, asked.member)) return null
  return theStandingPartOfTheStart(await theStandingItemsOf(asked.ledger), todayOf(asked.now))
}
