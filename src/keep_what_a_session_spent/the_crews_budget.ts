// The crew's budget gauges (martha#990, gap 6 of martha#957): the weekly window, when it would run out at the pace so
// far, and the reviewer model's gauge the owner sets by hand.
//
// This exists so the owner and the Supervisor see what the crew has left of its week. It is a port of crew-code's
// gauges (macula-sponsors 6f353d51, crew-code/hooks/register.tsx:2598-2690, :5377-5390, :6666-6674) and adds no rule
// of its own. Nothing here parks a member or changes the crew's pace: the budget is a measurement for the owner, never
// an order to the crew (crew-code's own words, reg:5484-5490); pacing by it is the owner's call.
//
//   - The weekly window is the host's own `seven_day` reading (./the_hosts_usage.ts). Every member's session reads it at
//     every turn's end, and the crew keeps the newest one, so every pane shows one reading.
//   - The run-out is projected at the window's average pace so far, and said only when it falls before the reset.
//   - The reviewer model's window has no reading a host gives, so the owner sets it: `/crew-budget <model> <percent>`,
//     and `/crew-budget <model> off`. A crew that holds reviews to no model has no such gauge.
//
// Core: no disk and no clock of its own. The crew's place and the time are handed in.

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, CrewStore, Refused } from '../host_contract/host_contract.ts'
import type { TheWeekly } from './the_hosts_usage.ts'

/** Where the crew keeps its gauges, under the one crew store. */
export const BUDGET_GAUGES_PLACE = 'budget_gauges'

/** The newest weekly reading any member's session made. */
export const THE_WEEKLY_FILE = 'weekly.json'

/** The reviewer gauge the owner set, with when. */
export const THE_REVIEWER_FILE = 'reviewer.json'

const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** How long the weekly window runs. */
export const WEEK_MS = 7 * DAY_MS

/** The ask the mod makes when the owner types `/crew-budget` (martha#990): never a model's tool. */
export const THE_BUDGET_ASK = 'the_crews_budget'

/** The highest and lowest percent a gauge holds: what the owner types is held between them, as crew-code holds it. */
const FULL = 100
const EMPTY = 0

/** What the budget line starts with, wherever it is shown. */
export const BUDGET_LINE_LABEL = 'Budget:'

/** The word that clears the reviewer gauge. */
export const GAUGE_OFF = 'off'

/** The reviewer gauge as the owner set it: a percent, and when it was set. `off` keeps null, read back as none set. */
export interface TheReviewerGauge {
  readonly percent: number
  readonly at: number
}

/** A duration as the owner reads it: minutes under an hour, hours under a day, then days (crew-code's `span`). */
export const theSpanOf = (ms: number): string =>
  ms < HOUR_MS ? `${String(Math.max(1, Math.round(ms / MINUTE_MS)))}m` : ms < DAY_MS ? `${String(Math.round(ms / HOUR_MS))}h` : `${String(Math.round(ms / DAY_MS))}d`

/**
 * When the window runs out at its average pace so far, or null when that cannot be said: nothing spent yet, or a
 * window that has not begun by this clock.
 */
export function theRunOutOf(weekly: TheWeekly, now: number): number | null {
  const started_at = weekly.resets_at - WEEK_MS
  return weekly.percent > 0 && now > started_at ? started_at + ((now - started_at) * FULL) / weekly.percent : null
}

/** The reviewer gauge's label: the reviewer model, as the owner would say it. */
export const theGaugesName = (review_model: string): string => review_model.charAt(0).toUpperCase() + review_model.slice(1)

/**
 * The budget line: the weekly window and its reset, the run-out when it falls before the reset, and the reviewer gauge
 * with how long ago it was set. Empty when there is nothing to show.
 */
export function theBudgetLine(weekly: TheWeekly | null, gauge: TheReviewerGauge | null, review_model: string | null, now: number): string {
  const run_out = weekly === null ? null : theRunOutOf(weekly, now)
  const parts = [
    ...(weekly === null ? [] : [`weekly ${String(weekly.percent)}% · resets in ${theSpanOf(weekly.resets_at - now)}`]),
    ...(weekly !== null && run_out !== null && run_out < weekly.resets_at ? [`runs out in ${theSpanOf(Math.max(0, run_out - now))}, before the reset`] : []),
    ...(gauge === null || review_model === null ? [] : [`${theGaugesName(review_model)} ${String(gauge.percent)}% (set ${theSpanOf(now - gauge.at)} ago)`]),
  ]
  return parts.join(' · ')
}

const isAnObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The JSON a kept file holds, or undefined when it is not JSON. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** A kept file read as the shape `is` allows: undefined when none is kept, a refusal naming the file when it is not one. */
function keptIn<T>(place: CrewPlace | Refused, file: string, is: (value: unknown) => value is T): T | undefined | Refused {
  if ('refusal' in place) return place
  const held = place.read(file)
  if (held === undefined || 'refusal' in held) return held
  const value = parsed(held.text)
  // A cleared gauge is kept as null: the place removes nothing, so "none set" is a value it holds.
  if (value === null) return undefined
  return is(value) ? value : { refusal: `${file} in the crew's ${BUDGET_GAUGES_PLACE} place is not a gauge` }
}

const isAWeekly = (value: unknown): value is TheWeekly =>
  isAnObject(value) && Number.isFinite(value['percent']) && Number.isFinite(value['resets_at'])

const isAGauge = (value: unknown): value is TheReviewerGauge =>
  isAnObject(value) && Number.isFinite(value['percent']) && Number.isFinite(value['at'])

/** The newest weekly reading the crew keeps, undefined when none was kept, or why it cannot be read. */
export const theWeeklyKept = (crew: CrewStore): TheWeekly | undefined | Refused => keptIn(crew.place(BUDGET_GAUGES_PLACE), THE_WEEKLY_FILE, isAWeekly)

/** The reviewer gauge the owner set, undefined when none is set, or why it cannot be read. */
export const theReviewerGaugeKept = (crew: CrewStore): TheReviewerGauge | undefined | Refused => keptIn(crew.place(BUDGET_GAUGES_PLACE), THE_REVIEWER_FILE, isAGauge)

/** Keeps a session's weekly reading as the crew's newest: the one every pane then shows. */
export function keepTheWeekly(crew: CrewStore, weekly: TheWeekly): Refused | undefined {
  const place = crew.place(BUDGET_GAUGES_PLACE)
  if ('refusal' in place) return place
  return place.keep(THE_WEEKLY_FILE, `${JSON.stringify({ percent: weekly.percent, resets_at: weekly.resets_at })}\n`)
}

/** The budget line over what the crew keeps, empty when a kept gauge cannot be read or nothing is kept. */
export function theBudgetLineOf(crew: CrewStore, review_model: string | null, now: number): string {
  const weekly = theWeeklyKept(crew)
  const gauge = review_model === null ? undefined : theReviewerGaugeKept(crew)
  const read = <T>(value: T | undefined | Refused): T | null => (value === undefined || (isAnObject(value) && 'refusal' in value) ? null : (value as T))
  return theBudgetLine(read(weekly), read(gauge), review_model, now)
}

/** What `/crew-budget` says it does, with the reviewer model when the crew holds reviews to one. */
export const theBudgetUsage = (review_model: string | null): string =>
  review_model === null
    ? 'Usage: /crew-budget shows the budget.'
    : `Usage: /crew-budget shows the budget. /crew-budget ${review_model} <percent> sets the ${theGaugesName(review_model)} gauge, /crew-budget ${review_model} ${GAUGE_OFF} clears it.`

/** What the owner typed after `/crew-budget`: the gauge's name and its value, either of them empty. */
export interface TheBudgetCommand {
  readonly gauge: string
  readonly value: string
}

/**
 * Sets the gauge a `/crew-budget` names: true when it names none (only the line is shown), or the reviewer gauge with
 * a value it takes; false for any other gauge or value, which shows the usage. A percent is held between 0 and 100.
 */
function theGaugeSet(crew: CrewStore, command: TheBudgetCommand, review_model: string | null, now: number): boolean | Refused {
  if (command.gauge === '') return true
  if (review_model === null || command.gauge !== review_model) return false
  const place = crew.place(BUDGET_GAUGES_PLACE)
  if ('refusal' in place) return place
  if (command.value === GAUGE_OFF) return place.keep(THE_REVIEWER_FILE, `${JSON.stringify(null)}\n`) ?? true
  return thePercentSet(place, command.value, now)
}

/** Keeps the reviewer gauge's percent, held between 0 and 100: false when the value is not a number. */
function thePercentSet(place: CrewPlace, value: string, now: number): boolean | Refused {
  const percent = Number(value)
  if (value === '' || !Number.isFinite(percent)) return false
  return place.keep(THE_REVIEWER_FILE, `${JSON.stringify({ percent: Math.min(FULL, Math.max(EMPTY, percent)), at: now })}\n`) ?? true
}

/**
 * `/crew-budget`: sets the reviewer gauge when it is named with a value it takes, then shows the budget line and the
 * usage, as crew-code answers it. A gauge or value it does not take shows the usage alone.
 */
export function theBudgetCommandAnswer(crew: CrewStore, command: TheBudgetCommand, review_model: string | null, now: number): string {
  const set = theGaugeSet(crew, command, review_model, now)
  if (typeof set !== 'boolean') return `The budget cannot be kept: ${set.refusal}`
  if (!set) return theBudgetUsage(review_model)
  const line = theBudgetLineOf(crew, review_model, now)
  return `${line === '' ? 'No budget reading yet.' : `${BUDGET_LINE_LABEL} ${line}.`} ${theBudgetUsage(review_model)}`
}

/** The `/crew-budget` ask's arguments, as the mod sends what the owner typed: the gauge and the value, as words. */
export function theBudgetCommandIn(args: Readonly<Record<string, unknown>>): TheBudgetCommand | string {
  const typed = args['typed']
  if (typeof typed !== 'string') return 'the /crew-budget ask carries no text the owner typed'
  const [gauge = '', value = ''] = typed.trim().split(/\s+/)
  return { gauge, value }
}
