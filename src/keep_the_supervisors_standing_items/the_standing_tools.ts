// The Supervisor's standing items as tools answer them (martha#317, #443 part 5): the two tools that record and close
// them, the one that lists them, and the reader the owner's list and a starting session draw them with.
//
// The same table as the owner's list says who may (#316's answer), and every item is written as this launch's member,
// never as a name the call carries. The tools slice (../a_crews_tools) keeps only the table that calls this.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import type { StoredRow } from '../host_contract/host_contract.ts'
import { mayKeepTheOwnersList, type TodoAnswer } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import {
  STANDING,
  STANDING_ADD,
  STANDING_ADD_DESCRIPTION,
  STANDING_CLOSE,
  STANDING_CLOSE_DESCRIPTION,
  STANDING_DESCRIPTION,
  STANDING_KINDS,
  STANDING_STREAM,
  theStandingItems,
  theStandingList,
  todayOf,
  type StandingItem,
} from './keep_the_supervisors_standing_items.ts'

/** What `standing_add` takes: the kind, the item's id, and the fields that kind reads. */
export const STANDING_ADD_TOOL = {
  name: STANDING_ADD,
  description: STANDING_ADD_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...STANDING_KINDS], description: 'held, awaiting or decided' },
      id: { type: 'string', description: 'A slug naming the item, such as martha-317 (a package ref is refused): letters, digits, ".", "_" or "-"' },
      item: { type: 'string', description: 'held: what is held back, in one line' },
      reason: { type: 'string', description: 'held: why, in one line' },
      until: { type: 'string', description: 'held: a YYYY-MM-DD day first, or the condition that ends the hold' },
      package: { type: 'string', description: 'held, when the hold is on a package: owner/repo#n, as a batch names it; a batch that lands it is refused' },
      owes: { type: 'string', description: 'awaiting: who owes it' },
      what: { type: 'string', description: 'awaiting: what they owe' },
      rule: { type: 'string', description: 'decided: the rule, in one line' },
      date: { type: 'string', description: 'decided: the day the owner said it, YYYY-MM-DD' },
      words: { type: 'string', description: "decided: the owner's own words" },
    },
    required: ['kind', 'id'],
  },
}

/** What `standing_close` takes: the item, and the evidence a held one needs. */
export const STANDING_CLOSE_TOOL = {
  name: STANDING_CLOSE,
  description: STANDING_CLOSE_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: "The item's id, as it was recorded" },
      kind: { type: 'string', enum: [...STANDING_KINDS], description: 'The kind, when the id stands as more than one' },
      evidence: { type: 'string', description: 'One line: how the condition was met. Required to close a held item' },
    },
    required: ['id'],
  },
}

/** What `standing` takes: nothing. */
export const STANDING_TOOL = {
  name: STANDING,
  description: STANDING_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
}

/** What a standing tool is handed: the crew's rows, this member, and the declaration's table. */
export interface TheStandingAsked {
  readonly ledger: LedgerHost
  readonly member: string
  readonly settings: CrewSettings
  readonly now: number
}

/** What the tools answer: the items as lines, or why the table did not let this member write. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** What stands in the crew's standing items, read whole. */
export async function theStandingItemsOf(ledger: LedgerHost): Promise<readonly StandingItem[]> {
  const stored: readonly StoredRow[] = await ledger.stores.rows.read(STANDING_STREAM)
  return theStandingItems(stored)
}

/**
 * `standing_add` and `standing_close` (martha#317): the same table as the owner's list says who may (#316's answer),
 * and the item is written as this launch's member, never as a name the call carries.
 */
export async function keepTheStandingItems(asked: TheStandingAsked, act: () => Promise<TodoAnswer>): Promise<AToolAnswer> {
  if (mayKeepTheOwnersList(asked.settings, asked.member)) {
    const done = await act()
    return 'told' in done ? { answer: done.told } : { refused: done.refused }
  }
  const granted = asked.settings.mode.may.assign_work ?? []
  return { refused: `${asked.member} may not record or close standing items: this crew's table lets ${granted.join(', ') || 'nobody'} assign work, and only they may. Nothing was written; ${STANDING} reads them.` }
}

/** `standing`: the items that stand, one line each, as the member reads them. */
export async function theStandingToolOver(asked: TheStandingAsked): Promise<AToolAnswer> {
  return { answer: theStandingList(await theStandingItemsOf(asked.ledger), todayOf(asked.now)).join('\n') }
}
