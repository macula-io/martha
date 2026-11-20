// What a host says a session has used, read strictly (martha#860, from martha#255's first reading).
//
// This exists so the one reading of a host's usage is the one every caller takes: the refresh flow reads its context
// share from it, and the row of what a session spent reads its cost, its start and how it is billed from the same
// object. The mod hands the host's `usage()` over untouched, so a field this file does not know the shape of is refused
// by name rather than read as nothing: a cost read as "none" when it was malformed would make a session look silent.
//
// The figures, as the Claude Code mod API documents `$.session.usage()`:
//   - `cost.usd` is the session's cost so far, as `/cost` totals it: a client-side estimate at list price, not the bill,
//     and the whole session's, its background model and subagents included. `cost.hasUnknownPrice` marks an unpriced
//     model costed at another's rates.
//   - `startedAt` is when the session these figures count from began; `/clear` starts it over.
//   - `rateLimits` holds `five_hour` and `seven_day` windows only on a subscription, a gateway's `spend_limit` as its
//     own estimate, and nothing off a subscription — or before the first response has a reading.
//   - `context.percent` is the last response's input against the window, absent until a first response.

/** How a session's cost is billed, as far as its host says (martha#860 R3). */
export const BILLINGS = ['subscription', 'metered', 'unknown'] as const
export type Billing = (typeof BILLINGS)[number]
const [SUBSCRIPTION, METERED, UNKNOWN_BILLING] = BILLINGS

/** The rate-limit windows that appear only on a subscription. */
const SUBSCRIPTION_WINDOWS: readonly string[] = ['five_hour', 'seven_day']

/** The subscription's weekly window, which the crew's budget gauge reads (martha#990). */
const THE_WEEKLY_WINDOW = 'seven_day'

/** The share of the weekly window used, and when the window resets (martha#990). */
export interface TheWeekly {
  readonly percent: number
  /** When the window resets, in milliseconds since the epoch. */
  readonly resets_at: number
}

/** The rate-limit window a gateway keeps: its own estimate, which says nothing of a plan. */
const A_GATEWAYS_WINDOW = 'spend_limit'

/** What a host's usage says, as this launcher reads it. */
export interface AHostsReading {
  /** The share of the context limit, or 0 when the host reports none this launcher can trust (martha#255). */
  readonly percent: number
  /** What the session has cost so far, or null when the host reports nothing. */
  readonly cost_usd: number | null
  /** When the session these figures count from began, or null when the host says nothing. */
  readonly started_at: number | null
  /** 1 once the cost includes a model with no known price. */
  readonly unknown_price: 0 | 1
  readonly billing: Billing
  /** The weekly window, or null when the host gives none, or gives one with no reset (martha#990, as crew-code reads it). */
  readonly weekly: TheWeekly | null
}

/** What a host that says nothing at all is read as. */
export const NOTHING_REPORTED: AHostsReading = { percent: 0, cost_usd: null, started_at: null, unknown_price: 0, billing: UNKNOWN_BILLING, weekly: null }

type Fields = Readonly<Record<string, unknown>>

const isAnObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The object under `name`, or undefined when there is none. */
const anObjectAt = (usage: Fields, name: string): Fields | undefined => (isAnObject(usage[name]) ? usage[name] : undefined)

/** Each field a reading is built from, checked on its own: the first that is malformed is named, never read as none. */
const USAGE_FIELDS: readonly ((usage: Fields) => string | undefined)[] = [
  (usage) => (Number.isFinite(usage['startedAt']) ? undefined : 'the host\'s usage carries no start it can be counted from'),
  (usage) => {
    const limits = usage['rateLimits']
    return limits === undefined || (Array.isArray(limits) && limits.every((one) => isAnObject(one) && typeof one['kind'] === 'string'))
      ? undefined
      : 'the host\'s usage carries rate limits that are not a list of named windows'
  },
  (usage) => {
    // The weekly window (martha#990): a share that is no number, or a reset that is no time, is refused by name.
    const weekly = theWeeklyWindowIn(usage)
    if (weekly === undefined) return undefined
    if (!Number.isFinite(weekly['percentUsed'])) return `the host's ${THE_WEEKLY_WINDOW} window carries a share used that is not a number`
    const resets = weekly['resetsAt']
    return resets === undefined || (typeof resets === 'string' && Number.isFinite(Date.parse(resets))) ? undefined : `the host's ${THE_WEEKLY_WINDOW} window carries a reset that is not a time`
  },
  (usage) => {
    const usd = anObjectAt(usage, 'cost')?.['usd']
    return usd === undefined || usd === null || Number.isFinite(usd) ? undefined : 'the host\'s usage carries a cost that is neither a number nor null'
  },
  (usage) => {
    const cost = anObjectAt(usage, 'cost')
    return cost === undefined || cost['hasUnknownPrice'] === undefined || cost['hasUnknownPrice'] === true ? undefined : 'the host\'s usage marks an unknown price with something other than true'
  },
]

/** The host's weekly window, when its rate limits are a list that holds one. */
function theWeeklyWindowIn(usage: Fields): Fields | undefined {
  const limits = usage['rateLimits']
  if (!Array.isArray(limits)) return undefined
  return (limits as readonly unknown[]).find((one): one is Fields => isAnObject(one) && one['kind'] === THE_WEEKLY_WINDOW)
}

/** The weekly window as a reading, once the fields are held: null when there is none, or it names no reset. */
function theWeeklyOf(usage: Fields): TheWeekly | null {
  const weekly = theWeeklyWindowIn(usage)
  if (weekly === undefined || weekly['resetsAt'] === undefined) return null
  return { percent: weekly['percentUsed'] as number, resets_at: Date.parse(weekly['resetsAt'] as string) }
}

/**
 * How the session is billed: a subscription's windows say so, and a list holding none says "off one" only after a
 * response. A usage with no list at all says nothing of its billing, so it is unknown, never read as an empty list.
 */
function theBillingOf(usage: Fields, answered: boolean): Billing {
  if (!Array.isArray(usage['rateLimits'])) return UNKNOWN_BILLING
  const kinds = (usage['rateLimits'] as readonly Fields[]).map((one) => one['kind'])
  if (kinds.some((kind) => SUBSCRIPTION_WINDOWS.includes(kind as string))) return SUBSCRIPTION
  return answered && kinds.every((kind) => kind === A_GATEWAYS_WINDOW) ? METERED : UNKNOWN_BILLING
}

/** The cost half of a reading: the running total, null when the host priced nothing yet, and whether a price was unknown. */
const theCostIn = (cost: Fields | undefined): Pick<AHostsReading, 'cost_usd' | 'unknown_price'> => ({
  cost_usd: typeof cost?.['usd'] === 'number' ? cost['usd'] : null,
  unknown_price: cost?.['hasUnknownPrice'] === true ? 1 : 0,
})

/**
 * The host's usage as a reading, or why it is not one. A value that is no object at all is a host that said nothing, as
 * it always was; an object is held to every field above.
 */
export function theHostsReadingIn(usage: unknown): AHostsReading | string {
  if (!isAnObject(usage)) return NOTHING_REPORTED
  const refused = USAGE_FIELDS.map((holds) => holds(usage)).find((said) => said !== undefined)
  if (refused !== undefined) return refused
  const percent = anObjectAt(usage, 'context')?.['percent']
  const answered = typeof percent === 'number' && Number.isFinite(percent)
  return {
    percent: answered ? percent : 0,
    ...theCostIn(anObjectAt(usage, 'cost')),
    started_at: usage['startedAt'] as number,
    billing: theBillingOf(usage, answered),
    weekly: theWeeklyOf(usage),
  }
}
