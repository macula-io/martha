// Where a package's spend is counted, and what counting it costs (martha#513, slice 3).
//
// This exists so the count of what a package has spent outlives the session that spent it without costing every other
// reader anything. The rows live in a stream of their own, `spend/<owner/repo#n>`, beside the package's ledger rather
// than inside it: the ledger's readers read the package's acts and its contract and never see a spend row, and the
// budget reads this stream once a session and keeps the rest of the count in memory (../hold_a_package_to_its_budget).
//
// The other half of that promise is in the caller: nothing here reads the stream per call. A caller that read it on
// every call would make call n cost n rows, which is the cost this stream exists to avoid.
//
// A row this file cannot read is refused by name rather than skipped, as the ledger refuses its own: a count that
// quietly dropped a row would let a package spend past its budget.

import { ROW_NOT_DURABLE, type Row } from '../host_contract/host_contract.ts'
import { WORK_PACKAGE, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { BUDGET_UNITS, type BudgetUnit } from '../keep_the_package_contract/the_contract_in_a_brief.ts'

/** The row a counted call is kept as, in the package's spend stream. */
export const SPEND_COUNTED = 'spend_counted'

/** One counted call, in the units the contract counts. */
export interface ACallCountedRow {
  readonly kind: typeof SPEND_COUNTED
  readonly package: string
  readonly member: string
  readonly at: number
  readonly unit: BudgetUnit
  readonly count: number
}

/** The stream a package's spend lives in: its own, so the package's act ledger never holds a spend row. */
export const spendStreamOf = (work_package: string): string => {
  if (!WORK_PACKAGE.test(work_package)) throw new Error(`${JSON.stringify(work_package)} is not a work package (owner/repo#n)`)
  return `spend/${work_package}`
}

const isText = (value: unknown): value is string => typeof value === 'string'
const isACount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1

/** Whether a stored row is a counted call this file can read whole. */
const isACallCounted = (row: Row): boolean =>
  row['kind'] === SPEND_COUNTED &&
  isText(row['package']) &&
  isText(row['member']) &&
  Number.isInteger(row['at']) &&
  (BUDGET_UNITS as readonly unknown[]).includes(row['unit']) &&
  isACount(row['count'])

/** What a package has spent in each unit its stream counts; a unit it never paid into is absent. */
export async function theSpendCounts(host: LedgerHost, work_package: string): Promise<Partial<Record<BudgetUnit, number>>> {
  const rows = await host.stores.rows.read(spendStreamOf(work_package))
  let counts: Partial<Record<BudgetUnit, number>> = {}
  for (const stored of rows) {
    const unit = theCountedUnitOf(stored.row, work_package, stored.position)
    counts = { ...counts, [unit]: (counts[unit] ?? 0) + (stored.row['count'] as number) }
  }
  return counts
}

/** The unit a stored row counts, or why it is no row of this package's spend: the one place a row is judged. */
function theCountedUnitOf(row: Row, work_package: string, position: number): BudgetUnit {
  if (!isACallCounted(row)) throw new Error(`row ${String(position)} of ${work_package}'s spend is not a counted call`)
  if (row['package'] !== work_package) {
    throw new Error(`${work_package}'s spend holds a row of ${String(row['package'])}, which is another package's`)
  }
  return row['unit'] as BudgetUnit
}

/** What a counted call is appended with. */
export interface ACallToCount {
  readonly package: string
  readonly member: string
  readonly unit: BudgetUnit
  readonly count: number
}

/** The code a rejection carries, or undefined when it carries none. */
const theCodeOf = (why: unknown): unknown => (typeof why === 'object' && why !== null ? (why as Row)['code'] : undefined)

/**
 * Keeps one more call against a package's spend, before the call runs. Undefined when it was kept — or kept but not
 * made durable, which the store answers with ROW_NOT_DURABLE and which must not be appended twice — and the reason
 * when it was not, because a call nobody counted is a budget a member can walk around.
 */
export async function noteTheCallCounted(host: LedgerHost, counted: ACallToCount): Promise<string | undefined> {
  try {
    await host.stores.rows.append(spendStreamOf(counted.package), {
      kind: SPEND_COUNTED,
      package: counted.package,
      member: counted.member,
      at: host.clock.now(),
      unit: counted.unit,
      count: counted.count,
    })
    return undefined
  } catch (why) {
    if (theCodeOf(why) === ROW_NOT_DURABLE) return undefined
    const said = why instanceof Error ? why.message : String(why)
    return `the store could not keep the row counting this call against ${counted.package}'s budget (${said}), so the call does not run.`
  }
}
