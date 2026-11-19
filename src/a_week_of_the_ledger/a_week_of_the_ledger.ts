// A week of the crew's ledger (martha#308): the owner's view of one ISO week — what it cost in work, how long each
// package took, how long it waited on the owner, and how much of it was reworked — read from the rows Martha keeps and
// from nothing else.
//
// Every figure is read, never guessed. A package's cycle time is its own first row to its landing row; a review round, a
// fix after a release and a landing are the milestones the ledger writes; an attempt is a recovery that chose to send
// the act again; and an ask is answered at the first settle whose ticked ids list it — the ask queue's own rule, never
// "the settle of its batch". A package carried in from before the week says so instead of being given a guessed start.
//
// Money is not in these rows, and the view says so rather than printing a zero (DECIDED 2026-11-19 "Work now, money
// later (Recommended)"; the row that would carry spend is martha#860). An ask carries no package, so owner wait is the
// crew's, and a package line says so. The reading is pure — no clock, no I/O — so one week answers the same everywhere.

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { StoredRow } from '../host_contract/host_contract.ts'
import {
  ACT_ANNOUNCED,
  ACT_CONCLUDED,
  FIX_SHIPPED_AFTER_RELEASE,
  OUTWARD_ACTS,
  PACKAGE_LANDED,
  RECOVERY_DECIDED,
  REFRESH_FORCED,
  RETRIED_ONCE,
  REVIEW_ROUND_CLOSED,
  type LedgerRow,
  type OutwardActKind,
} from '../log_ledger/log_ledger.ts'
import { ASKS_SETTLED, ASK_QUEUED, theQuestion } from '../queue_the_owners_asks/queue_the_owners_asks.ts'

const AN_HOUR_MS = 60 * MINUTE_MS
const A_DAY_MS = 24 * AN_HOUR_MS
const THE_WEEK = /^([0-9]{4})-W([0-9]{2})$/
const THE_LAST_WEEK_A_YEAR_MAY_HAVE = 53
const THE_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const THE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** The bounds one week stands between: Monday 00:00 UTC to the Monday after, and the words it prints them with. */
export interface TheWeeksBounds {
  readonly from: number
  readonly to: number
  readonly printed: string
}

const theDayOf = (at: number): string => {
  const date = new Date(at)
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  return `${THE_DAYS[date.getUTCDay()]!} ${String(date.getUTCDate())} ${THE_MONTHS[date.getUTCMonth()]!} ${hour}:${minute} UTC`
}

/** The Monday of an ISO week: week 1 is the one holding January the fourth, whatever day that is (ISO 8601). */
const theMondayOf = (year: number, week: number): number => {
  const januaryTheFourth = Date.UTC(year, 0, 4)
  const itsDay = new Date(januaryTheFourth).getUTCDay() || 7
  return januaryTheFourth - (itsDay - 1) * A_DAY_MS + (week - 1) * 7 * A_DAY_MS
}

/** The bounds of `YYYY-Www`, or why the word is no week: a shape it does not hold, or a week that year does not have. */
export function theBoundsOfTheWeek(week: string): TheWeeksBounds | { readonly refused: string } {
  const matched = THE_WEEK.exec(week)
  if (matched === null) return { refused: `${week} is not an ISO week: name it YYYY-Www, as in 2026-W47.` }
  const year = Number(matched[1])
  const numbered = Number(matched[2])
  if (numbered < 1 || numbered > THE_LAST_WEEK_A_YEAR_MAY_HAVE) {
    return { refused: `${week} names week ${String(numbered)}: a year has 1 to ${String(THE_LAST_WEEK_A_YEAR_MAY_HAVE)}.` }
  }
  const from = theMondayOf(year, numbered)
  // A week belongs to the year its Thursday is in (ISO 8601), which is what refuses 2026-W53 in a 52-week year.
  if (new Date(from + 3 * A_DAY_MS).getUTCFullYear() !== year) {
    return { refused: `${week} is not a week of ${String(year)}: that year's weeks do not reach it.` }
  }
  const to = from + 7 * A_DAY_MS
  return { from, to, printed: `${week} (${theDayOf(from)} – ${theDayOf(to)})` }
}

/** The ISO week one instant falls in, UTC: the week the command answers when the owner names none, and its only clock. */
export function theWeekOf(at: number): string {
  const local = new Date(at)
  const itsDay = local.getUTCDay() || 7
  const thursday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (4 - itsDay) * A_DAY_MS
  const year = new Date(thursday).getUTCFullYear()
  const week = 1 + Math.floor((thursday - theMondayOf(year, 1)) / (7 * A_DAY_MS))
  return `${String(year)}-W${String(week).padStart(2, '0')}`
}

/** The acts one package announced, concluded, and needed a second attempt of, as the week reads them. */
export interface TheActsOfAPackage {
  readonly announced: number
  readonly concluded: number
  readonly attempts: number
  readonly by: Readonly<Record<OutwardActKind, number>>
}

/** One package's week: what it did inside the week's bounds, and how long it has run in all. */
export interface APackagesWeek {
  readonly package: string
  readonly carriedIn: boolean
  readonly firstAt: number
  readonly lastAt: number
  readonly landedAt: number | undefined
  readonly landedInTheWeek: boolean
  readonly cycleMs: number | undefined
  readonly reviewRounds: number
  readonly fixesAfterRelease: number
  readonly recoveries: number
  readonly retriedOnce: number
  readonly acts: TheActsOfAPackage
  readonly rowsWritten: number
}

/** What the owner took to answer the asks made in the week; an ask still waiting is never counted as answered. */
export interface TheOwnersWait {
  readonly asked: number
  readonly answered: number
  readonly stillWaiting: number
  readonly totalMs: number
  readonly longest: { readonly ms: number; readonly question: string } | undefined
}

/** The crew's own figures for the week, counted once each. */
export interface TheWeeksCrew {
  readonly touched: number
  readonly landed: number
  readonly carriedIn: number
  readonly stillOpen: number
  readonly ownersWait: TheOwnersWait
  readonly reviewRounds: number
  readonly fixesAfterRelease: number
  readonly recoveries: number
  readonly retriedOnce: number
  readonly forcedRefreshes: number
  readonly acts: TheActsOfAPackage
}

/** One week's answer: the bounds it was read between, the crew's figures, and each package's. */
export interface TheWeek {
  readonly bounds: TheWeeksBounds
  readonly crew: TheWeeksCrew
  readonly packages: readonly APackagesWeek[]
  readonly skipped: readonly string[]
}

/** What the week is asked with: the week's name, each package's rows, and the ask queue's rows, all already read. */
export interface AnAskedWeek {
  readonly week: string
  readonly ledgers: readonly { readonly package: string; readonly rows: readonly LedgerRow[] }[]
  readonly asks: readonly StoredRow[]
  readonly skipped?: readonly string[]
}

export type AWeek = { readonly week: TheWeek } | { readonly refused: string }

const inTheWeek = (at: number, bounds: TheWeeksBounds): boolean => at >= bounds.from && at < bounds.to

const theZeroOfTheKinds = (): Record<OutwardActKind, number> =>
  Object.fromEntries(OUTWARD_ACTS.map((kind) => [kind, 0])) as Record<OutwardActKind, number>

/** The acts of one package's week, its attempts being the recoveries that sent an act a second time. */
function theActsOf(rowsInTheWeek: readonly LedgerRow[]): TheActsOfAPackage {
  const by = theZeroOfTheKinds()
  const announced = rowsInTheWeek.filter((row): row is Extract<LedgerRow, { kind: typeof ACT_ANNOUNCED }> => row.kind === ACT_ANNOUNCED)
  for (const row of announced) by[row.act.kind] += 1
  const retried = rowsInTheWeek.filter((row) => row.kind === RECOVERY_DECIDED && row.decision === RETRIED_ONCE)
  return {
    announced: announced.length,
    concluded: rowsInTheWeek.filter((row) => row.kind === ACT_CONCLUDED).length,
    attempts: retried.length,
    by,
  }
}

/** One package's week, or undefined when the week holds no row of it: a package nobody touched is not in the week. */
export function thePackageWeek(
  package_name: string,
  rows: readonly LedgerRow[],
  bounds: TheWeeksBounds,
): APackagesWeek | undefined {
  const inTheRowList = rows.filter((row) => inTheWeek(row.at, bounds))
  const [first] = rows
  if (first === undefined || inTheRowList.length === 0) return undefined
  const landed = rows.find((row) => row.kind === PACKAGE_LANDED)
  const recoveries = inTheRowList.filter((row) => row.kind === RECOVERY_DECIDED)
  return {
    package: package_name,
    carriedIn: first.at < bounds.from,
    firstAt: first.at,
    lastAt: rows.at(-1)?.at ?? first.at,
    landedAt: landed?.at,
    landedInTheWeek: landed !== undefined && inTheWeek(landed.at, bounds),
    cycleMs: landed === undefined ? undefined : landed.at - first.at,
    reviewRounds: inTheRowList.filter((row) => row.kind === REVIEW_ROUND_CLOSED).length,
    fixesAfterRelease: inTheRowList.filter((row) => row.kind === FIX_SHIPPED_AFTER_RELEASE).length,
    recoveries: recoveries.length,
    retriedOnce: recoveries.filter((row) => row.decision === RETRIED_ONCE).length,
    acts: theActsOf(inTheRowList),
    rowsWritten: inTheRowList.length,
  }
}

const isAnAsk = (row: StoredRow): boolean => row.row['kind'] === ASK_QUEUED
const sinceOf = (row: StoredRow): number | undefined => (typeof row.row['since'] === 'number' ? row.row['since'] : undefined)

/** The asks made in the week, each with when the owner answered it, by the queue's own rule. */
function theWaitsOf(asks: readonly StoredRow[], bounds: TheWeeksBounds): readonly { readonly ms: number; readonly question: string }[] {
  const settles = asks.filter((row) => row.row['kind'] === ASKS_SETTLED)
  const answeredAt = (id: number): number | undefined => {
    const settled = settles.find((settle) => Array.isArray(settle.row['yes']) && (settle.row['yes'] as unknown[]).includes(id))
    const at = settled?.row['at']
    return typeof at === 'number' ? at : undefined
  }
  return asks.flatMap((row) => {
    const since = sinceOf(row)
    if (!isAnAsk(row) || since === undefined || !inTheWeek(since, bounds)) return []
    const at = answeredAt(row.position)
    return at === undefined ? [] : [{ ms: at - since, question: theQuestion(String(row.row['question'] ?? '')) }]
  })
}

/** What the owner took to answer the asks made in the week; an ask still waiting is never counted as answered. */
export function theOwnersWaitIn(asks: readonly StoredRow[], bounds: TheWeeksBounds): TheOwnersWait {
  const waits = theWaitsOf(asks, bounds)
  const asked = asks.filter((row) => {
    const since = sinceOf(row)
    return isAnAsk(row) && since !== undefined && inTheWeek(since, bounds)
  }).length
  return {
    asked,
    answered: waits.length,
    stillWaiting: asked - waits.length,
    totalMs: waits.reduce((sum, wait) => sum + wait.ms, 0),
    longest: waits.reduce<{ readonly ms: number; readonly question: string } | undefined>(
      (longest, wait) => (longest === undefined || wait.ms > longest.ms ? wait : longest),
      undefined,
    ),
  }
}

/** The crew's week: each package counted once, and the owner's wait from the ask queue. */
function theCrewOf(packages: readonly APackagesWeek[], ownersWait: TheOwnersWait, forcedRefreshes: number): TheWeeksCrew {
  const by = theZeroOfTheKinds()
  for (const one of packages) for (const kind of OUTWARD_ACTS) by[kind] += one.acts.by[kind]
  return {
    touched: packages.length,
    landed: packages.filter((one) => one.landedInTheWeek).length,
    carriedIn: packages.filter((one) => one.carriedIn).length,
    stillOpen: packages.filter((one) => one.landedAt === undefined).length,
    ownersWait,
    reviewRounds: packages.reduce((sum, one) => sum + one.reviewRounds, 0),
    fixesAfterRelease: packages.reduce((sum, one) => sum + one.fixesAfterRelease, 0),
    recoveries: packages.reduce((sum, one) => sum + one.recoveries, 0),
    retriedOnce: packages.reduce((sum, one) => sum + one.retriedOnce, 0),
    forcedRefreshes,
    acts: {
      announced: packages.reduce((sum, one) => sum + one.acts.announced, 0),
      concluded: packages.reduce((sum, one) => sum + one.acts.concluded, 0),
      attempts: packages.reduce((sum, one) => sum + one.acts.attempts, 0),
      by,
    },
  }
}

/** One week answered from the rows it is handed: refused by name when the week is not one, else the figures. */
export function aWeekOfTheLedger(asked: AnAskedWeek): AWeek {
  const bounds = theBoundsOfTheWeek(asked.week)
  if ('refused' in bounds) return bounds
  const packages = asked.ledgers.flatMap((ledger) => {
    const one = thePackageWeek(ledger.package, ledger.rows, bounds)
    return one === undefined ? [] : [one]
  })
  const forcedRefreshes = asked.ledgers.flatMap((ledger) => ledger.rows).filter(
    (row) => row.kind === ACT_ANNOUNCED && row.act.kind === REFRESH_FORCED && inTheWeek(row.at, bounds),
  ).length
  const crew = theCrewOf(packages, theOwnersWaitIn(asked.asks, bounds), forcedRefreshes)
  return { week: { bounds, crew, packages: [...packages].sort((a, b) => a.package.localeCompare(b.package)), skipped: asked.skipped ?? [] } }
}

/** How long, as the owner reads it: whole days and hours, hours and minutes, minutes, or under a minute. */
export function theDurationOf(ms: number): string {
  const days = Math.floor(ms / A_DAY_MS)
  const hours = Math.floor((ms - days * A_DAY_MS) / AN_HOUR_MS)
  const minutes = Math.floor((ms - days * A_DAY_MS - hours * AN_HOUR_MS) / MINUTE_MS)
  if (days > 0) return `${String(days)} d ${String(hours)} h`
  if (hours > 0) return `${String(hours)} h ${String(minutes)} min`
  if (minutes > 0) return `${String(minutes)} min`
  return 'under a minute'
}

const theCount = (n: number, one: string, many: string = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`

/** One package's line: its cycle, its rework, its acts, and the owner wait it cannot carry. */
export function theLineOfAPackage(one: APackagesWeek): string {
  const cycle = one.cycleMs === undefined
    ? `still open, last row ${theDayOf(one.lastAt)}`
    : `cycle ${theDurationOf(one.cycleMs)}${one.carriedIn ? ' (carried in)' : ''}, landed ${theDayOf(one.landedAt ?? one.firstAt)}`
  const acts = `${theCount(one.acts.announced, 'act')} announced, ${String(one.acts.concluded)} concluded, ${String(one.acts.attempts)} retried`
  return `${one.package} — ${cycle} | owner wait not in the rows | ${theCount(one.reviewRounds, 'review round')}, ${theCount(one.fixesAfterRelease, 'fix')} after a release, ${String(one.retriedOnce)} retried | acts ${acts} | ${theCount(one.rowsWritten, 'row')}`
}

/** The week as the owner reads it: the bounds first, then the crew, then each package. */
export function theLinesOf(week: TheWeek): readonly string[] {
  const { bounds, crew } = week
  const longest = crew.ownersWait.longest
  const waits = `owner wait: ${theCount(crew.ownersWait.asked, 'ask')}, ${String(crew.ownersWait.answered)} answered, ${String(crew.ownersWait.stillWaiting)} still waiting; ${theDurationOf(crew.ownersWait.totalMs)} in all${longest === undefined ? '' : `; the longest ${theDurationOf(longest.ms)} — "${longest.question}"`}`
  const kinds = OUTWARD_ACTS.map((kind) => `${kind.replace(/_/g, ' ')} ${String(crew.acts.by[kind])}`).join(', ')
  return [
    bounds.printed,
    `packages: ${String(crew.touched)} touched, ${String(crew.landed)} landed, ${String(crew.carriedIn)} carried in, ${String(crew.stillOpen)} still open`,
    waits,
    `work: ${theCount(crew.reviewRounds, 'review round')}, ${theCount(crew.fixesAfterRelease, 'fix')} after a release, ${theCount(crew.recoveries, 'recovery', 'recoveries')} (${String(crew.retriedOnce)} retried), ${theCount(crew.forcedRefreshes, 'forced refresh', 'forced refreshes')}`,
    `acts: ${theCount(crew.acts.announced, 'act')} announced, ${String(crew.acts.concluded)} concluded (${kinds}); ${theCount(crew.acts.attempts, 'attempt')} after a failure`,
    'money: not in the rows (martha#860 carries the row that would hold it)',
    ...week.skipped.map((one) => `skipped: ${one}`),
    ...week.packages.map((one) => theLineOfAPackage(one)),
  ]
}
