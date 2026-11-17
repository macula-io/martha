// Why a call does not run because its package has spent its budget (martha#513, slice 3).
//
// This exists so a budget narrows what a member may do and never widens it: like the contract's allowed actions
// (../refuse_calls_outside_the_package_contract), the check only turns a yes into a no, and it says yes to everything
// when the package has no budget, is unbounded, or has spent none of it.
//
// At the wall the refusal keeps four calls open, and they are the four that end a package cleanly rather than the four
// that are convenient: a member that cannot write its handover is trapped at the wall with no way to save its context,
// which is the one thing this rule promises never to do. The names are the tools' own constants compared after
// `ownNameOf`, because a host that installs them under a server calls them `mcp__martha__write_my_handover`, and a
// table matched on the called name would refuse the handover exactly when it is needed (martha#513 slice 2, r=1).

import { PARK_A_MEMBER } from '../park_and_wake_a_member/the_park_tools.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import type { BudgetUnit } from '../keep_the_package_contract/the_contract_in_a_brief.ts'

/** The calls a spent package may still make: each one ends it, or reports on it, and none of them does the work. */
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
  /** Why the count could not be read: the units it cannot judge are refused, and nothing else is. */
  readonly why_unreadable?: string
}

/** The units this package has spent whole, the ones whose count has reached its limit. */
export const theUnitsSpentWhole = (spend: ASpendInForce): readonly AUnitSpent[] => spend.units.filter((one) => one.spent >= one.limit)

/** How one unit reads in a refusal: what it allows and what was spent of it. */
const theUnitSaid = (one: AUnitSpent): string => `${String(one.spent)} of ${String(one.limit)} ${one.unit}`

/** The sentence that says what a member may still do at the wall, in the order it should do it. */
export const WHAT_A_SPENT_PACKAGE_MAY_STILL_DO =
  `Write your handover (${WRITE_MY_HANDOVER_TOOL}), say so to the crew (${SAY_TO_THE_CREW}), ` +
  `report where the work stands (${REPORT_WHERE_THE_WORK_STANDS}) or be parked (${PARK_A_MEMBER}); those four still run.`

/** Why this call does not run at the wall, saying what was spent and what may still be done. */
const theRefusalSaid = (spend: ASpendInForce, spent: readonly AUnitSpent[]): string =>
  `this call does not run: package ${spend.package}'s budget (contract version ${String(spend.version)}) is spent — ` +
  `${spent.map(theUnitSaid).join(', ')}. ${WHAT_A_SPENT_PACKAGE_MAY_STILL_DO} Everything else waits for a new version of the contract.`

/** Why this call does not run because the count itself could not be read. */
const theUnreadableSaid = (spend: ASpendInForce): string =>
  `this call does not run: what package ${spend.package} has spent could not be read (${spend.why_unreadable ?? 'no reason given'}), ` +
  `and a call nobody can count is not run. ${WHAT_A_SPENT_PACKAGE_MAY_STILL_DO}`

/** Whether this own name is one of the calls that end a package. */
export const isACallThatEndsThePackage = (own_name: string): boolean => (THE_CALLS_THAT_END_A_PACKAGE as readonly string[]).includes(own_name)

/**
 * Why this call does not run, or undefined when it does: a package with no budget, an unbounded one, or one with count
 * left refuses nothing, and the four calls that end a package run whatever it has spent.
 */
export function refuseACallPastTheBudget(call: AReadableCall, spend: ASpendInForce | undefined, ownNameOf: TheOwnNameOf): string | undefined {
  if (spend === undefined) return undefined
  if (isACallThatEndsThePackage(ownNameOf(call.tool))) return undefined
  if (spend.why_unreadable !== undefined) return theUnreadableSaid(spend)
  const spent = theUnitsSpentWhole(spend)
  return spent.length === 0 ? undefined : theRefusalSaid(spend, spent)
}
