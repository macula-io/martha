// The repo's three drift numbers (martha#1010's addendum): open issues, open issues untouched, and pull requests closed
// without merging. Read once a day for each repo the week's packages name, spent through the crew's one GitHub budget,
// and kept as one row per repo per day in the crew's own store, so a week's trend needs no second read.
//
// DECIDED 2026-11-20 "Trend only (Recommended)": a number higher than the same number seven days earlier is the notice,
// and an owner who wants a fixed line sets one on the declaration. Nothing here refuses anything.
//
// The abandoned count is the search's own `is:pr is:closed is:unmerged`, with nothing taken off it. Terra's note on r=1
// asked that superseded batch pull requests be left out, on the lander's `land/<date>-<n>` heads. That note does not
// bite: the lander opens no pull request at all (it merges the passed heads onto a batch branch and pushes that branch,
// ../land_passed_work_as_one_batch), and no pull request this repository has ever had names a `land/` head. The search
// API takes `head:` only as a literal branch name, never a family, so an exclusion of `land/*` could not be asked for
// even if one were needed; were a batch pull request ever opened, this read would need a page of heads and Terra's note
// comes back with it.

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { A_PERCENT } from '../declare_crew/the_crews_trims.ts'
import type { CrewPlace, Refused } from '../host_contract/host_contract.ts'
import { spendTheGithubBudget, type Spent, type TheGithubSpender } from './spend_the_github_budget.ts'

/** Where a crew keeps the repo numbers, under the one crew store. */
export const GITHUB_DRIFT_PLACE = 'github_drift'

/** The one record it holds: every repo's rows, keyed by the day each was read. */
export const THE_DRIFT_FILE = 'drift.json'

/** How long a day is, in the unit the crew's clock keeps. */
export const A_DAY_MS = 24 * 60 * MINUTE_MS

/** How many days apart two rows must be for one to be the other's trend: a week. */
export const A_WEEK_DAYS = 7

/** How many days of rows a repo keeps: a week and today, which is all a trend reads. */
export const DAYS_KEPT = A_WEEK_DAYS + 1

/** A repository as GitHub names it, `owner/name`: the one shape a repo row and a nudge line are read against. */
export const A_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/

/** The three numbers a repo's row carries, in the words a notice and a nudge line print them (martha#1010). */
export const OPEN_ISSUES = 'open issues'
export const UNTOUCHED_ISSUES = 'untouched issues'
export const ABANDONED_PRS = 'abandoned PRs'
export const REPO_NUMBERS = [OPEN_ISSUES, UNTOUCHED_ISSUES, ABANDONED_PRS] as const
export type RepoNumber = (typeof REPO_NUMBERS)[number]

/** One of a day's numbers as it is compared: the abandoned pull requests are the share of all of them, in percent. */
export function aRepoNumberIn(numbers: AReposNumbers, number: RepoNumber): number {
  if (number === OPEN_ISSUES) return numbers.open_issues
  if (number === UNTOUCHED_ISSUES) return numbers.untouched_issues
  return numbers.all_prs === 0 ? 0 : Math.round((numbers.abandoned_prs * A_PERCENT) / numbers.all_prs)
}

/** One day's numbers for one repository, as four reads answered them. */
export interface AReposNumbers {
  readonly open_issues: number
  readonly untouched_issues: number
  readonly abandoned_prs: number
  /** Every pull request the repo has, open and closed: what the abandoned ones are a share of. */
  readonly all_prs: number
}

/** The numbers kept, by repo and then by the day they were read. */
export type TheDriftRecord = Readonly<Record<string, Readonly<Record<string, AReposNumbers>>>>

/** The day a moment falls on, in UTC, as GitHub's search and the record's keys spell it. */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** The record a crew's store holds, or none when it holds nothing this can read: a trend with no history is no trend. */
export function theDriftRecordIn(place: CrewPlace | Refused): TheDriftRecord {
  if ('refusal' in place) return {}
  const held = place.read(THE_DRIFT_FILE)
  if (held === undefined || 'refusal' in held) return {}
  return theRecordIn(held.text) ?? {}
}

/** Keeps the record, or says why the store would not. */
export const keepTheDriftRecord = (place: CrewPlace, record: TheDriftRecord): Refused | undefined =>
  place.keep(THE_DRIFT_FILE, `${JSON.stringify(record)}\n`)

/** Every repo's today row, read where the record has none and kept: the one place these numbers are fetched. */
export async function theDriftReadToday(
  spender: TheGithubSpender,
  repos: readonly string[],
  now: number,
  issue_untouched_days: number,
): Promise<TheDriftRecord> {
  const place = spender.place
  if ('refusal' in place) return {}
  let record = theDriftRecordIn(place)
  const day = dayOf(now)
  for (const repo of new Set(repos)) {
    if (!A_REPO.test(repo) || record[repo]?.[day] !== undefined) continue
    const numbers = await theNumbersOf(spender, repo, now, issue_untouched_days)
    if ('refusal' in numbers) continue
    record = withTheDaysRow(record, repo, day, numbers)
    keepTheDriftRecord(place, record)
  }
  return record
}

/** The record with one repo's day kept, and the rows older than the ones a trend reads dropped. */
function withTheDaysRow(record: TheDriftRecord, repo: string, day: string, numbers: AReposNumbers): TheDriftRecord {
  const held: Record<string, AReposNumbers> = { ...(record[repo] ?? {}), [day]: numbers }
  const kept = Object.keys(held)
    .sort()
    .slice(-DAYS_KEPT)
  const rows: Record<string, AReposNumbers> = {}
  for (const one of kept) rows[one] = held[one] as AReposNumbers
  return { ...record, [repo]: rows }
}

/** One repo's four numbers, each a search the crew's budget spends; the first read GitHub does not answer ends it. */
async function theNumbersOf(spender: TheGithubSpender, repo: string, now: number, issue_untouched_days: number): Promise<AReposNumbers | Refused> {
  const untouched_before = dayOf(now - issue_untouched_days * A_DAY_MS)
  const queries = {
    open_issues: `repo:${repo} is:issue is:open`,
    untouched_issues: `repo:${repo} is:issue is:open updated:<${untouched_before}`,
    all_prs: `repo:${repo} is:pr`,
    abandoned_prs: `repo:${repo} is:pr is:closed is:unmerged`,
  }
  const read: Partial<AReposNumbers> = {}
  for (const [number, query] of Object.entries(queries)) {
    const count = await theCountOf(spender, query, `search:${repo}:${number}`)
    if ('refusal' in count) return count
    Object.assign(read, { [number]: count.count })
  }
  return read as AReposNumbers
}

/** One search's total, as the budget spent it, or why GitHub could not be asked. */
async function theCountOf(spender: TheGithubSpender, query: string, of: string): Promise<{ readonly count: number } | Refused> {
  const spent: Spent = await spendTheGithubBudget(spender, ['api', `search/issues?q=${encodeURIComponent(query)}`], of)
  if ('refusal' in spent) return spent
  if (spent.said.exit_code !== 0) return { refusal: `GitHub could not count ${query}: ${spent.said.stderr.trim() || 'it answered nothing.'}` }
  const counted = aCountIn(spent.said.stdout)
  return counted === undefined ? { refusal: `GitHub answered for ${query} with something this cannot read.` } : { count: counted }
}

/** A search answer's `total_count`, or undefined when the text is not one this reads. */
function aCountIn(text: string): number | undefined {
  try {
    const answer: unknown = JSON.parse(text)
    const total = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>)['total_count'] : undefined
    return typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : undefined
  } catch {
    return undefined
  }
}

/** A record read back from the store, or undefined when it is not one: every row four whole numbers, one per repo and day. */
function theRecordIn(text: string): TheDriftRecord | undefined {
  try {
    const held: unknown = JSON.parse(text)
    if (typeof held !== 'object' || held === null || Array.isArray(held)) return undefined
    const record = held as Record<string, unknown>
    for (const rows of Object.values(record)) {
      if (!isAReposRows(rows)) return undefined
    }
    return record as TheDriftRecord
  } catch {
    return undefined
  }
}

/** Whether the rows a repo holds are days of four whole numbers. */
function isAReposRows(rows: unknown): boolean {
  if (typeof rows !== 'object' || rows === null || Array.isArray(rows)) return false
  return Object.entries(rows as Record<string, unknown>).every(([day, numbers]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && isANumbers(numbers))
}

/** Whether a day's row is the four numbers, each a whole number, zero or more. */
function isANumbers(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const numbers = value as Record<string, unknown>
  return ['open_issues', 'untouched_issues', 'abandoned_prs', 'all_prs'].every((name) => {
    const one = numbers[name]
    return typeof one === 'number' && Number.isInteger(one) && one >= 0
  })
}
