// The budget as the crew holds it for a member's session (martha#513, slice 3).
//
// This exists so the count is read once and the per-call cost is one append and one small file. The session's first
// question for a package reads that package's newest contract and its spend stream; every question after that about the
// same package is answered from what was read, and every call the relay lets run appends one row and moves the tally by
// one. What the member's own row names is read on every call, because the package is usually named part-way into a
// session — the brief and the handover come first, and `report_where_the_work_stands` names the package — and the cache
// is keyed by session and package so neither that report nor a move to another package is missed (r=1 R1). A refresh is
// a new session, so the read happens again and the successor starts from the stream — which is how the count outlives
// the session without any session having to remember it.
//
// Deliberately read differently from the contract's allowed actions (../refuse_calls_outside_the_package_contract),
// which reads the newest contract on every act: an act is rare, a tool call is not. The price is that a version which
// raises a limit reaches the member at its next start or refresh and not at the call it was spent at — and the four
// calls that end a package stay open (./refuse_a_call_past_the_budget), which is how it gets to that refresh.
//
// A package with no contract, an unbounded one, a member holding nothing, and a ledger this slice cannot read all count
// nothing and stop nothing: a budget is a bound on work, and none of those has one to bound.

import type { AUnitOnARow, DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theContractVersionsOf } from '../keep_the_package_contract/keep_the_package_contract.ts'
import type { ABudget, BudgetUnit } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { isACallThatEndsThePackage, type ASpendInForce, type AUnitSpent } from './refuse_a_call_past_the_budget.ts'
import { theClockStartedAt, theUncountableBudgetNote, theUnitsSpentNow } from './the_spend_in_force.ts'
import { noteTheCallCounted as noteTheRow, theSpendCounts } from './the_spend_stream.ts'

/** What this slice needs of the places it is handed: the member's own row, and the streams the crew keeps. */
export interface TheBudgetPlaces {
  readonly member: string
  readonly ledger: LedgerHost
  readonly beats: { readonly read: (member: string) => DashboardRow | null }
}

/** The budget, as the relay asks it: what a session may spend, and one more call counted. */
export interface TheBudgetAsACrewHoldsIt {
  theSpendInForce(session_id: string): Promise<ASpendInForce | undefined>
  noteTheCallCounted(session_id: string, own_name: string): Promise<string | undefined>
}

/** One session's budget, as it was read at its first call and as the calls since have moved it. */
interface AHeldBudget {
  readonly package: string
  readonly version: number
  readonly limits: ABudget
  readonly counted_at_start: Partial<Record<BudgetUnit, number>>
  readonly clock_started_at: number | undefined
  counted_since: number
  readonly why_unreadable?: string
}

/** What a session's spend is now: the units its contract names, with the calls and the minutes spent of each. */
const theSpendOf = (budget: AHeldBudget, now: number): ASpendInForce => {
  const counted = { ...budget.counted_at_start, 'tool calls': (budget.counted_at_start['tool calls'] ?? 0) + budget.counted_since }
  const units = theUnitsSpentNow({ limits: budget.limits, counted, clock_started_at: budget.clock_started_at, now })
  return { package: budget.package, version: budget.version, units, ...(budget.why_unreadable === undefined ? {} : { why_unreadable: budget.why_unreadable }) }
}

/** The spend stream's counts, or why they could not be read: a count nobody can read stops the calls it cannot judge. */
async function theCountsOrTheReason(host: LedgerHost, package_name: string): Promise<Pick<AHeldBudget, 'counted_at_start' | 'why_unreadable'>> {
  try {
    return { counted_at_start: await theSpendCounts(host, package_name) }
  } catch (why) {
    return { counted_at_start: {}, why_unreadable: why instanceof Error ? why.message : String(why) }
  }
}

/**
 * The budget a member's session is held to for `package_name`, read once: that package's newest contract (a bounded one
 * only), the moment a package's minutes started, and what it has spent. Null when no budget can bind.
 */
async function readTheBudget(places: TheBudgetPlaces, package_name: string): Promise<AHeldBudget | null> {
  try {
    const versions = await theContractVersionsOf(places.ledger, package_name)
    const newest = versions.at(-1)
    if (newest === undefined || newest.contract.kind !== 'bounded') return null
    const counted = await theCountsOrTheReason(places.ledger, package_name)
    return { package: package_name, version: newest.version, limits: newest.contract.budget, clock_started_at: theClockStartedAt(versions), counted_since: 0, ...counted }
  } catch {
    return null
  }
}

/**
 * The budget over the places a launch gave: one read for each session and package the member's row names, then the
 * tally in memory.
 *
 * The row is read on every call, and what it names is part of the cache's key, because the package is usually named
 * part-way into a session: a member reads its brief and its handover first, and `report_where_the_work_stands` is the
 * call that names the package. Keyed by the session alone, the "nothing binds yet" read from before that report would
 * hold for the whole session, and neither the calls after it nor the successor session would be held to anything
 * (r=1 R1). The same key holds when a member is handed another package without a refresh: the new package's budget is
 * the one in force, not the one it left. Reading the row costs one small file a call, never a stream — the contract and
 * the spend stream are still read once for each session and package.
 */
export function theBudgetOver(places: TheBudgetPlaces): TheBudgetAsACrewHoldsIt {
  const held = new Map<string, AHeldBudget | null>()
  const theHeldFor = async (session_id: string): Promise<AHeldBudget | null> => {
    const package_name = places.beats.read(places.member)?.holds ?? ''
    if (package_name === '') return null
    const key = `${session_id}\u0000${package_name}`
    if (!held.has(key)) held.set(key, await readTheBudget(places, package_name))
    return held.get(key) ?? null
  }
  return {
    async theSpendInForce(session_id) {
      const budget = await theHeldFor(session_id)
      return budget === null ? undefined : theSpendOf(budget, places.ledger.clock.now())
    },
    async noteTheCallCounted(session_id, own_name) {
      const budget = await theHeldFor(session_id)
      if (budget === null) return undefined
      const refusal = await noteTheRow(places.ledger, { package: budget.package, member: places.member, unit: 'tool calls', count: 1 })
      if (refusal === undefined) budget.counted_since += 1
      // An uncounted call does not run — except one that ends the package: refusing the handover at the wall would
      // trap a member that the wall itself is telling to write one.
      return isACallThatEndsThePackage(own_name) ? undefined : refusal
    },
  }
}

/** The budget a crew holds for this session, read through the crew so the relay reads no store itself. */
export async function theSpendACrewHolds(
  crew: Pick<TheBudgetAsACrewHoldsIt, 'theSpendInForce'> | undefined,
  session_id: string,
): Promise<ASpendInForce | undefined> {
  return crew === undefined ? undefined : crew.theSpendInForce(session_id)
}

/** One more call counted, or why it could not be. */
export async function noteTheCallCounted(
  crew: Pick<TheBudgetAsACrewHoldsIt, 'noteTheCallCounted'> | undefined,
  session_id: string,
  own_name: string,
): Promise<string | undefined> {
  return crew === undefined ? undefined : crew.noteTheCallCounted(session_id, own_name)
}

/** Each unit's count as a start line says it: what was spent of what the contract allows. */
const theSpendSaid = (units: readonly AUnitSpent[]): string => units.map((one) => `${String(one.spent)} of ${String(one.limit)} ${one.unit}`).join(', ')

/**
 * What the member's dashboard row carries of its budget (martha#513, slice 3): the units it has spent of each, in the
 * row's own spelling, or undefined when there is no count to show — a member holding nothing, an unbounded package, or
 * a count that could not be read. No gauge is drawn here (#309); the number is put where a gauge can read it.
 */
export const theSpendOnARow = (spend: ASpendInForce | undefined): readonly AUnitOnARow[] | undefined => spend?.units

/**
 * What a member is handed about its budget at a start or after a refresh: what it has spent of each unit, and the units
 * this host cannot count. Read fresh, because a start is where the count is meant to be re-read — the relay's own read
 * is the one that happens once for each session and package (./the_budget_tools' theBudgetOver). Null when there is no
 * budget to report.
 */
export async function theSpendPartOfTheStart(host: LedgerHost, package_name: string, now: number): Promise<string | null> {
  if (package_name === '') return null
  try {
    const versions = await theContractVersionsOf(host, package_name)
    const newest = versions.at(-1)
    if (newest === undefined || newest.contract.kind !== 'bounded') return null
    const counted = await theSpendCounts(host, package_name)
    const units = theUnitsSpentNow({ limits: newest.contract.budget, counted, clock_started_at: theClockStartedAt(versions), now })
    const note = theUncountableBudgetNote(newest.contract)
    const said = `Your budget for ${package_name} (contract version ${String(newest.version)}): ${theSpendSaid(units)} spent.`
    return note === undefined ? said : `${said} And ${note}`
  } catch {
    return null
  }
}
