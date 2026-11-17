// What a package has spent against what its contract allows, read for the gate (martha#513, slice 3).
//
// Two of the three units a contract may name are counted on every host: tool calls, from the package's spend stream, and
// minutes, from the clock — the third is tokens, which a host counts only where it reports them. This host reports a
// share of the context and a cost in dollars and no token count at all, so a tokens budget cannot bite here; saying so
// at the start line is the difference between a member that knows and one that trusts a limit nothing enforces.
//
// The clock starts once, at the `at` of the first version that is bounded and names minutes, and never moves: a later
// version changes the limit, which is what makes raising it the remedy for a package that spent its minutes waiting.
// Counting from the earliest version instead would spend a package the moment it was first bounded.

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { AContractVersion } from '../keep_the_package_contract/keep_the_package_contract.ts'
import type { ABudget, APackageContract, BudgetUnit } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import type { AUnitSpent } from './refuse_a_call_past_the_budget.ts'

/** The units this build counts on a host: tool calls from the stream, and minutes from the clock. */
export const THE_UNITS_THIS_HOST_COUNTS: readonly BudgetUnit[] = ['tool calls', 'minutes']

/** The unit this host reports no count for, so a contract that names it is told rather than trusted. */
export const THE_UNIT_THIS_HOST_CANNOT_COUNT: BudgetUnit = 'tokens'

const isCountedHere = (unit: string): boolean => (THE_UNITS_THIS_HOST_COUNTS as readonly string[]).includes(unit)

/** What a bounded contract spends in the units this host cannot count; empty when it names none of them. */
const theUnitsNotCountedHere = (budget: ABudget): readonly BudgetUnit[] =>
  (Object.keys(budget) as BudgetUnit[]).filter((unit) => !isCountedHere(unit))

/**
 * What a member is told about a budget this host cannot count in full: which unit it does not report, and whether the
 * package therefore has nothing holding it at all. Undefined when every unit the contract names is counted.
 */
export function theUncountableBudgetNote(contract: APackageContract): string | undefined {
  if (contract.kind !== 'bounded') return undefined
  const uncounted = theUnitsNotCountedHere(contract.budget)
  if (uncounted.length === 0) return undefined
  const named = Object.keys(contract.budget).length
  const alone = uncounted.length === named
  return (
    `this host reports no token count, so ${uncounted.join(', ')} in this package's budget is not counted here` +
    (alone ? ', and a budget of tokens alone cannot bite on this machine: only tool calls and minutes can.' : '.')
  )
}

/** What one unit has spent, or undefined when this host cannot count it. */
const theSpentOf = (unit: BudgetUnit, counted: Partial<Record<BudgetUnit, number>>, clock_started_at: number | undefined, now: number): number | undefined => {
  if (unit === 'tool calls') return counted[unit] ?? 0
  if (unit === 'minutes' && clock_started_at !== undefined) return Math.floor((now - clock_started_at) / MINUTE_MS)
  return undefined
}

/** Each unit the contract names, with what the package has spent of it, in the contract's own order. */
export function theUnitsSpentNow(asked: {
  readonly limits: ABudget
  readonly counted: Partial<Record<BudgetUnit, number>>
  readonly clock_started_at: number | undefined
  readonly now: number
}): readonly AUnitSpent[] {
  const units: AUnitSpent[] = []
  for (const [unit, limit] of Object.entries(asked.limits) as [BudgetUnit, number][]) {
    const spent = theSpentOf(unit, asked.counted, asked.clock_started_at, asked.now)
    if (spent !== undefined) units.push({ unit, spent, limit })
  }
  return units
}

/**
 * The moment a package's minutes start counting: the `at` of the first version that is bounded and names minutes.
 * Undefined when no version has both, because a package that names no minutes has no clock to start.
 */
export function theClockStartedAt(versions: readonly AContractVersion[]): number | undefined {
  const bounded = versions.find((version) => version.contract.kind === 'bounded' && namesMinutes(version.contract))
  return bounded?.at
}

/** Whether this contract names minutes among the units it counts. */
const namesMinutes = (contract: APackageContract): boolean => contract.kind === 'bounded' && contract.budget.minutes !== undefined
