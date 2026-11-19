// What was spent between two instants, from the readings alone (martha#860).
//
// This exists so a week, or any other window, answers its spend from the rows ./keep_what_a_session_spent.ts keeps and
// nothing else, the way macula-io/martha#308 answers its work from the ledger: it is handed rows already read and reads
// no store, so #308 takes it as one call beside its own.
//
// A reading is a running total, so what a hold spent in a window is its highest reading before the window's end less
// its reference: its highest reading before the window, or its baseline when the window holds its start. A reading lower
// than one before it is not subtracted: the session is named as having gone back and its highest reading counts. The
// cost between two readings belongs to the later one's model and billing, because a reading closes the turn that ran on
// them; so a figure is exact per turn and nothing is pro-rated.
//
// What is never invented. A hold that reported no cost at all is silent; a hold whose reference is null and that then
// reports a cost is unknown — both are named, neither is counted as 0. The one null that is 0 is a hold opened on its
// session's own first question, before any response was priced (Venus's ruling, martha#860).
//
// Every dollar here is the host's list-price estimate: on a subscription the plan bills none of it. The billings are kept
// apart in every figure, so no sum ever adds a subscription's estimate to a metered one.

import type { StoredRow } from '../host_contract/host_contract.ts'
import { type Billing } from './the_hosts_usage.ts'
import { theReadingsIn, usageStreamOf, type AUsageRead } from './keep_what_a_session_spent.ts'

/** What a window's spend is read from: its bounds, and every usage stream already read. */
export interface TheSpendAsked {
  readonly from: number
  readonly to: number
  /** Each package's `usage/` stream, by package. */
  readonly usage: ReadonlyMap<string, readonly StoredRow[]>
  /** The crew's own `usage/crew` stream: sessions that held no package. */
  readonly crew: readonly StoredRow[]
}

/** Dollars by how they are billed, never added across billings. */
export type Dollars = Readonly<Record<Billing, number>>

/** What one session spent in the window while it held one package, or the crew's stream. */
export interface ASessionsSpend {
  readonly package: string | null
  readonly member: string
  readonly host: string
  /** The model of its last reading in the window. */
  readonly model: string
  readonly session: string
  /** What it spent, by billing; null when it is silent or unknown. */
  readonly usd: Dollars | null
  readonly unknownPrice: boolean
  readonly wentBack: boolean
  /** From the later of the hold's opening and the window's start to its last reading in the window. */
  readonly wallMs: number
}

/** One window's spend. */
export interface TheSpend {
  readonly sessions: readonly ASessionsSpend[]
  readonly byPackage: readonly { readonly package: string; readonly usd: Dollars; readonly sessions: number; readonly silent: readonly string[] }[]
  readonly outsideAnyPackage: Dollars
  readonly byMember: readonly { readonly member: string; readonly usd: Dollars }[]
  /** By the model the session ran on: its background model and subagents ran inside these figures. */
  readonly bySessionModel: readonly { readonly model: string; readonly usd: Dollars }[]
  /** Holds that reported no cost: named, never counted as 0. */
  readonly silent: readonly ASessionsSpend[]
  /** Holds with no reference to measure from, that then reported a cost: named, never measured from 0. */
  readonly unknownBaseline: readonly ASessionsSpend[]
  readonly wentBack: readonly ASessionsSpend[]
}

const NO_DOLLARS: Dollars = { subscription: 0, metered: 0, unknown: 0 }

const plus = (dollars: Dollars, billing: Billing, usd: number): Dollars => ({ ...dollars, [billing]: dollars[billing] + usd })
const added = (one: Dollars, other: Dollars): Dollars => ({ subscription: one.subscription + other.subscription, metered: one.metered + other.metered, unknown: one.unknown + other.unknown })

/** A hold: the readings of one session under one stream, from the reading that opened it. */
interface AHold {
  readonly opening: AUsageRead
  readonly readings: AUsageRead[]
}

/** The holds of one stream's readings, each split at the reading that opens it. */
function theHoldsIn(readings: readonly AUsageRead[]): readonly AHold[] {
  const open = new Map<string, AHold>()
  const holds: AHold[] = []
  for (const reading of readings) {
    const key = `${reading.session}\u0000${String(reading.started_at)}`
    const held = open.get(key)
    if (reading.opens === 1 || held === undefined) {
      const hold: AHold = { opening: reading, readings: [reading] }
      open.set(key, hold)
      holds.push(hold)
    } else {
      held.readings.push(reading)
    }
  }
  return holds
}

/** The cost a hold is measured from at its opening: its own, or 0 for a null on the session's own first question. */
const theBaselineOf = (opening: AUsageRead): number | null => (opening.usd === null && opening.at_start === 1 ? 0 : opening.usd)

/** The highest known cost among these, or null when none is known. */
const theHighest = (costs: readonly (number | null)[]): number | null =>
  costs.reduce<number | null>((high, cost) => (cost === null ? high : high === null ? cost : Math.max(high, cost)), null)

/** What one hold spent in the window, or undefined when the window holds none of its readings. */
interface AHoldsWindow {
  readonly spend: ASessionsSpend
  readonly byModel: ReadonlyMap<string, Dollars>
  readonly silent: boolean
  readonly unknown: boolean
}

/** What the readings inside the window add above the reference, by billing and by model, and whether one went back. */
interface TheSpentInside {
  readonly usd: Dollars
  readonly byModel: ReadonlyMap<string, Dollars>
  readonly wentBack: boolean
}

/** Each reading above the highest before it adds the difference, to its own model and billing; a lower one adds nothing. */
function theSpentInside(inside: readonly AUsageRead[], reference: number | null): TheSpentInside {
  let running = reference
  let usd = NO_DOLLARS
  let wentBack = false
  const byModel = new Map<string, Dollars>()
  for (const reading of inside) {
    if (reading.usd === null || running === null) continue
    if (reading.usd < running) wentBack = true
    if (reading.usd <= running) continue
    usd = plus(usd, reading.billing, reading.usd - running)
    byModel.set(reading.model, plus(byModel.get(reading.model) ?? NO_DOLLARS, reading.billing, reading.usd - running))
    running = reading.usd
  }
  return { usd, byModel, wentBack }
}

function theWindowOf(hold: AHold, from: number, to: number): AHoldsWindow | undefined {
  const before = hold.readings.filter((reading) => reading.at < from)
  const inside = hold.readings.filter((reading) => reading.at >= from && reading.at < to)
  const last = inside.at(-1)
  if (last === undefined) return undefined
  const reference = theHighest([theBaselineOf(hold.opening), ...before.map((reading) => reading.usd)])
  const { usd, byModel, wentBack } = theSpentInside(inside, reference)
  const reported = inside.some((reading) => reading.usd !== null)
  const silent = reference === null && !reported
  const unknown = reference === null && reported
  const spend: ASessionsSpend = {
    package: hold.opening.package,
    member: hold.opening.member,
    host: hold.opening.host,
    model: last.model,
    session: hold.opening.session,
    usd: reference === null ? null : usd,
    unknownPrice: inside.some((reading) => reading.unknown_price === 1),
    wentBack,
    wallMs: last.at - Math.max(hold.opening.at, from),
  }
  return { spend, byModel: reference === null ? new Map() : byModel, silent, unknown }
}

/** Dollars summed by a key, in the order each key was first met. */
function summedBy(windows: readonly AHoldsWindow[], keyOf: (window: AHoldsWindow) => string): Map<string, Dollars> {
  const sums = new Map<string, Dollars>()
  for (const window of windows) sums.set(keyOf(window), added(sums.get(keyOf(window)) ?? NO_DOLLARS, window.spend.usd ?? NO_DOLLARS))
  return sums
}

/** The windows of one stream's holds that hold a reading in it, or why one of its rows is no reading. */
function theWindowsIn(stream: string, rows: readonly StoredRow[], from: number, to: number): readonly AHoldsWindow[] | { readonly refused: string } {
  const readings = theReadingsIn(stream, rows)
  if ('refusal' in readings) return { refused: readings.refusal }
  return theHoldsIn(readings).map((hold) => theWindowOf(hold, from, to)).filter((window): window is AHoldsWindow => window !== undefined)
}

/** The window's spend, or why one of the rows it was handed is no reading. */
export function theSpendBetween(asked: TheSpendAsked): TheSpend | { readonly refused: string } {
  const streams: [string, readonly StoredRow[]][] = [...[...asked.usage].map(([work_package, rows]): [string, readonly StoredRow[]] => [usageStreamOf(work_package), rows]), [usageStreamOf(null), asked.crew]]
  const windows: AHoldsWindow[] = []
  for (const [stream, rows] of streams) {
    const read = theWindowsIn(stream, rows, asked.from, asked.to)
    if ('refused' in read) return read
    windows.push(...read)
  }
  const held = windows.filter((window) => window.spend.package !== null)
  const byModel = new Map<string, Dollars>()
  for (const window of windows) for (const [model, usd] of window.byModel) byModel.set(model, added(byModel.get(model) ?? NO_DOLLARS, usd))
  return {
    sessions: windows.map((window) => window.spend),
    byPackage: [...summedBy(held, (window) => window.spend.package as string)].map(([work_package, usd]) => {
      const its = held.filter((window) => window.spend.package === work_package)
      return { package: work_package, usd, sessions: its.length, silent: its.filter((window) => window.silent || window.unknown).map((window) => window.spend.session) }
    }),
    outsideAnyPackage: windows.filter((window) => window.spend.package === null).reduce((sum, window) => added(sum, window.spend.usd ?? NO_DOLLARS), NO_DOLLARS),
    byMember: [...summedBy(windows, (window) => window.spend.member)].map(([member, usd]) => ({ member, usd })),
    bySessionModel: [...byModel].map(([model, usd]) => ({ model, usd })),
    silent: windows.filter((window) => window.silent).map((window) => window.spend),
    unknownBaseline: windows.filter((window) => window.unknown).map((window) => window.spend),
    wentBack: windows.filter((window) => window.spend.wentBack).map((window) => window.spend),
  }
}
