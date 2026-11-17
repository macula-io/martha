// Idle members beside work nobody holds, told to whoever routes the crew's work (martha#319, package B).
//
// This exists so open work does not sit for days beside members who are free to take it. A member counts as idle beside
// unheld work while its row says idle, it is live, nobody has parked it, it is not one of the members who read nudges,
// and the crew's backlog read holds at least one issue nobody in the crew holds. When a member has stayed like that for
// the declared idle_minutes, it is named in the crew's nudges (../nudge_the_supervisor) as kind `unheld`, beside the
// count of issues nobody holds.
//
// Two rules shape it:
//
//   - THE CLOCK SURVIVES A REFRESH. The moment each member became idle beside unheld work is kept in the crew's own
//     store (UNHELD_IDLE_FILE), so a refreshed Supervisor sees the same nudge, with the same start time, as the one
//     before it. The time is kept when the condition begins and dropped when it ends, so the clock starts again only
//     after the condition has really ended. A member between two packages for a minute never reaches the window.
//   - NO STRANGER'S TEXT. The nudge carries a declared name, a count and a time. Issue titles and Purpose lines stay in
//     the `unheld_work` answer, which the seam takes in as any tool result.
//
// Core: no disk and no clock of its own. The rows, the parks, the kept times and the read are handed in.

import { sameMemberName, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, Refused } from '../host_contract/host_contract.ts'
import type { Nudge } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { IDLE, OFFLINE_AFTER_MS, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theSplitOf } from '../find_the_unheld_work/find_the_unheld_work.ts'
import { theBacklogNow, type TheBacklogReader } from '../find_the_unheld_work/keep_the_backlog_read.ts'

/** The file the idle clock is kept in, in the crew's backlog place. */
export const UNHELD_IDLE_FILE = 'idle.json'

/** When each member became idle beside unheld work, in milliseconds since the epoch, keyed by the member's name. */
export type TheIdleClock = Readonly<Record<string, number>>

/** What decides who is idle beside unheld work: the rows, the parks, who reads nudges, the unheld count and the time. */
export interface IdleInput {
  readonly rows: readonly DashboardRow[]
  /** The members whose park marker says they are parked. */
  readonly parked: readonly string[]
  /** The members nudges are told to: never the subject of one. */
  readonly receivers: readonly string[]
  /** How many issues the kept backlog read holds that nobody in the crew holds. */
  readonly unheld: number
  readonly now: number
}

const same = sameMemberName

/** Whether a row is a member idle beside the work: idle, live, not parked, not a receiver. */
const idleBeside = (row: DashboardRow, input: IdleInput): boolean =>
  row.state === IDLE &&
  input.now - row.at <= OFFLINE_AFTER_MS &&
  !input.parked.some((name) => same(name, row.member)) &&
  !input.receivers.some((name) => same(name, row.member))

/**
 * The idle clock after this look: a member idle beside unheld work keeps the time it began, or begins now; every other
 * member is dropped, so its clock starts again only when the condition does. With nothing unheld, nobody is idle beside it.
 */
export function theIdleClockAfter(kept: TheIdleClock, input: IdleInput): TheIdleClock {
  if (input.unheld === 0) return {}
  const idle = input.rows.filter((row) => idleBeside(row, input)).map((row) => row.member)
  return Object.fromEntries(idle.map((member) => [member, kept[member] ?? input.now]))
}

/** The nudges the clock makes: one per member idle beside unheld work for the window or longer. A window of 0 is off. */
export function unheldNudges(clock: TheIdleClock, idle_minutes: number, unheld: number, now: number): readonly Nudge[] {
  if (idle_minutes <= 0) return []
  return Object.entries(clock)
    .filter(([, since]) => now - since >= idle_minutes * MINUTE_MS)
    .map(([member, since]) => ({ kind: 'unheld' as const, member, package: '', since, unheld }))
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The clock the place keeps: none when it keeps no file or one this cannot read, or why the place will not answer. */
export function theIdleClockIn(place: CrewPlace | Refused): TheIdleClock | Refused {
  if ('refusal' in place) return place
  const held = place.read(UNHELD_IDLE_FILE)
  if (held === undefined) return {}
  if ('refusal' in held) return held
  let value: unknown
  try {
    value = JSON.parse(held.text)
  } catch {
    return {}
  }
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
}

/** Keeps the clock, or says why it could not. */
export const keepTheIdleClock = (place: CrewPlace, clock: TheIdleClock): Refused | undefined =>
  place.keep(UNHELD_IDLE_FILE, `${JSON.stringify(clock)}\n`)

/** What the crew's nudges need to add this kind: the declared backlog, how it is read, the rows, the parks and the receivers. */
export interface UnheldNudgesAsked {
  readonly backlog: { readonly places: readonly string[]; readonly idle_minutes: number } | null
  readonly members: readonly string[]
  readonly reader: TheBacklogReader
  readonly rows: readonly DashboardRow[]
  readonly parked: readonly string[]
  readonly receivers: readonly string[]
}

/**
 * The `unheld` nudges for this look, with the clock kept for the next one. A crew that declares no backlog, or turns the
 * nudge off with 0, gets none and keeps no clock. A store that will not answer gives none: a clock that cannot be kept
 * would start again on every look and never reach the window, so nothing is said rather than something wrong.
 */
export async function theUnheldNudgesFor(asked: UnheldNudgesAsked): Promise<readonly Nudge[]> {
  if (asked.backlog === null || asked.backlog.idle_minutes <= 0 || 'refusal' in asked.reader.place) return []
  const read = await theBacklogNow(asked.reader, asked.backlog.places)
  const kept = theIdleClockIn(asked.reader.place)
  if ((read !== undefined && 'refusal' in read) || 'refusal' in kept) return []
  const unheld = read === undefined ? 0 : theSplitOf(read.issues, asked.members).unheld.length
  const input = { rows: asked.rows, parked: asked.parked, receivers: asked.receivers, unheld, now: asked.reader.now }
  const clock = theIdleClockAfter(kept, input)
  if (keepTheIdleClock(asked.reader.place, clock) !== undefined) return []
  return unheldNudges(clock, asked.backlog.idle_minutes, unheld, asked.reader.now)
}
