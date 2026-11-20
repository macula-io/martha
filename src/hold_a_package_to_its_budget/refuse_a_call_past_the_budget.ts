// What a member is told when its package has spent its budget (martha#513 slice 3, martha#511).
//
// This was a refusal; under the owner's cut of 2026-11-20 (martha#601, row 112) it is a notice. Runaway spend on one
// package is none of the three harms a refusal is kept for (a leaked key or token, lost work, a push to main without the
// owner's yes), so the call runs and the member is told in one line what was spent, so it can stop and say so.
//
// The four calls that end a package are told nothing: they are what a member at its wall should be making. The names
// are the tools' own constants compared after `ownNameOf`, because a host that installs them under a server calls them
// `mcp__martha__write_my_handover` (martha#513 slice 2, r=1).

import { PARK_A_MEMBER } from '../park_and_wake_a_member/the_park_tools.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import type { BudgetUnit } from '../keep_the_package_contract/the_contract_in_a_brief.ts'

/** The calls that end a package, or report on it: none of them does the work, and none is told the budget is spent. */
export const THE_CALLS_THAT_END_A_PACKAGE = [WRITE_MY_HANDOVER_TOOL, SAY_TO_THE_CREW, PARK_A_MEMBER, REPORT_WHERE_THE_WORK_STANDS] as const

/** The name a tool's own server gave it; a caller with no split of its own says the called name is the own one. */
export type TheOwnNameOf = (called: string) => string

/** A call, as much of it as the budget reads: its tool. */
export interface AReadableCall {
  readonly tool: string
}

/** One unit of a budget: what it allows, and what the package has spent of it. */
export interface AUnitSpent {
  readonly unit: BudgetUnit
  readonly spent: number
  readonly limit: number
}

/** A package's spend, as the gate is handed it: the units it counts, and why they could not be read when they could not. */
export interface ASpendInForce {
  readonly package: string
  /** The contract version whose limit is in force. */
  readonly version: number
  readonly units: readonly AUnitSpent[]
  /** Why the count could not be read, said in the notice. */
  readonly why_unreadable?: string
}

/** The units this package has spent whole, the ones whose count has reached its limit. */
export const theUnitsSpentWhole = (spend: ASpendInForce): readonly AUnitSpent[] => spend.units.filter((one) => one.spent >= one.limit)

/** How one unit reads in a refusal: what it allows and what was spent of it. */
const theUnitSaid = (one: AUnitSpent): string => `${String(one.spent)} of ${String(one.limit)} ${one.unit}`

/** What a member at its wall is told to do, in the order it should do it. */
export const WHAT_A_SPENT_PACKAGE_SHOULD_DO =
  `write your handover (${WRITE_MY_HANDOVER_TOOL}), say so to the crew (${SAY_TO_THE_CREW}), ` +
  `report where the work stands (${REPORT_WHERE_THE_WORK_STANDS}) or be parked (${PARK_A_MEMBER}).`

/** The one line a member is told when its package's budget is spent: the call still runs. */
const theSpentSaid = (spend: ASpendInForce, spent: readonly AUnitSpent[]): string =>
  `Notice: package ${spend.package}'s budget (contract version ${String(spend.version)}) is spent — ` +
  `${spent.map(theUnitSaid).join(', ')}. The call runs; stop and ${WHAT_A_SPENT_PACKAGE_SHOULD_DO}`

/** The one line a member is told when what its package has spent could not be read: the call still runs. */
const theUnreadableSaid = (spend: ASpendInForce): string =>
  `Notice: what package ${spend.package} has spent could not be read (${spend.why_unreadable ?? 'no reason given'}). The call runs.`

/** Whether this own name is one of the calls that end a package. */
export const isACallThatEndsThePackage = (own_name: string): boolean => (THE_CALLS_THAT_END_A_PACKAGE as readonly string[]).includes(own_name)

/**
 * The notice this call gets from the package's budget, or undefined when there is none to give: no budget, an unbounded
 * one, one with count left, or one of the four calls that end a package.
 */
export function theNoticeOfACallPastTheBudget(call: AReadableCall, spend: ASpendInForce | undefined, ownNameOf: TheOwnNameOf): string | undefined {
  if (spend === undefined) return undefined
  if (isACallThatEndsThePackage(ownNameOf(call.tool))) return undefined
  if (spend.why_unreadable !== undefined) return theUnreadableSaid(spend)
  const spent = theUnitsSpentWhole(spend)
  return spent.length === 0 ? undefined : theSpentSaid(spend, spent)
}
