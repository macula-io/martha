// Waking an idle member (martha#959, porting crew-code's `wakeWhenIdle`, #957 gap 1).
//
// This exists so a free member is woken with its next step instead of sitting until someone types to it. Every host asks
// the launcher on its own clock, only while its session is idle, and the launcher decides from the crew's own record:
// the member's row, its park marker, the issues nobody in the crew holds, and a clock kept per member in the crew's
// store. What comes back is either the one text below, which the host submits as a turn of its own, or nothing.
//
// Three rules shape it:
//
//   - IDLE IS TWO FACTS. The crew's word is the row: it says `idle` and it is live. The host's word is that the session
//     is not in a main turn, and only the host knows that, so the question is asked by the host and answered here. A row
//     that has gone quiet is an offline member, never an idle one.
//   - ONE CLOCK, IN THE CREW'S STORE. The wait doubles per wake up to the declared cap, and it starts when the member was
//     first seen idle — so a member that has just finished a turn is not woken at once. A refresh replaces the session
//     and must not reset the wait, so the clock is a file the crew keeps (../nudge_an_idle_crew keeps its own beside it),
//     and it is dropped the moment the member is no longer idle, which is the member having done something.
//   - A PARK STANDS. A parked member is never woken, and neither is the member who routes the crew's work, nor one at or
//     over its refresh limit: the refresh flow hands that one over at its turn end, and a wake would only spend a turn
//     nobody asked for.
//
// Core: no disk and no clock of its own. The row, the parks, the count and the time are handed in.

import { MINUTE_MS, sameMemberName, type CrewSettings, type HouseRules } from '../declare_crew/declare_crew.ts'
import { WAKE } from '../declare_crew/the_crews_wake.ts'
import { offlineAfterMsOf } from '../declare_crew/the_crews_thresholds.ts'
import { theSplitOf } from '../find_the_unheld_work/find_the_unheld_work.ts'
import { theBacklogNow, type TheBacklogReader } from '../find_the_unheld_work/keep_the_backlog_read.ts'
import type { CrewPlace, Refused } from '../host_contract/host_contract.ts'
import { theNudgesGoTo } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { IDLE, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** Where the wake's clock is kept, under the one crew store: a place named after the declaration's own key, as the
 * backlog's read is kept (../find_the_unheld_work/keep_the_backlog_read), and the file every member's clock is in. */
export const WAKE_PLACE = WAKE
export const THE_CLOCKS_FILE = 'clocks.json'

/** What a host asks the launcher, on its own clock and only while idle (martha#959): the text to submit, or ''. */
export const THE_WAKE_ASK = 'wake_this_idle_session'

/**
 * What the wake says. It names Martha's own tools, and the stop line is crew-code's own: the owner's stop must outlive a
 * wake, and the park marker is where the crew keeps it.
 */
export const THE_WAKE_TEXT =
  'The crew mod woke this session: it is idle with nothing in hand.\n' +
  "Read any messages that came in for you and act on them, then look at the crew's work: `see_the_crew` for the rows, `unheld_work` for what nobody holds.\n" +
  'If an earlier instruction told you to stop, that stop stands over this wake-up: call `park_a_member` with your reason, say so in one line, and end your turn.'

/** The windows a crew declared, in milliseconds: how long a member must be idle, the cap the doubling stops at, and how
 * quiet a row must be to read offline. A first window of zero is a crew that turned wakes off. */
export interface TheWakeWindows {
  readonly after_ms: number
  readonly cap_ms: number
  readonly offline_ms: number
}

/** One member's clock: when this idle stretch began (or when it was last woken), and how many wakes it has taken. */
export interface AWAKE_CLOCK {
  readonly since: number
  readonly wakes: number
}

/** Every member's clock, by name. */
export type TheWakeClocks = Readonly<Record<string, AWAKE_CLOCK>>

/** What a look is decided from: the member, its row, its park, the unheld count, the windows, its context and the time. */
export interface TheWakeLook {
  readonly member: string
  /** The member's own row, or null when the crew holds none for it. */
  readonly row: DashboardRow | null
  /** Whether the member's park marker says it is parked. */
  readonly parked: boolean
  /** Whether this member is one the crew's work is routed to. Never woken: that one works when it decides to. */
  readonly routes: boolean
  /** How many issues the crew's kept backlog holds that nobody in the crew holds. */
  readonly unheld: number
  readonly now: number
  readonly windows: TheWakeWindows
  /** The crew's refresh limit, and where the session stands: at or over it the refresh flow hands over, and no wake is made. */
  readonly limit_percent: number
  readonly context_percent: number
  /** The clock this member's last look left, or null when it held none. */
  readonly clock: AWAKE_CLOCK | null
  /** Whether this look is the one a wake was made on. Only then does the clock count a wake. */
  readonly wake?: boolean
}

/** Whether the member is idle by the crew's own record: its row says idle, and the row is live. */
const idleIn = (look: TheWakeLook): boolean =>
  look.row !== null && look.row.state === IDLE && look.now - look.row.at <= look.windows.offline_ms

/**
 * The clock after this look: begun now when the member has just become idle, kept while it stays idle, counted when this
 * look woke it, and dropped when it is no longer idle — which is the member having done something since.
 */
export function theClockAfter(look: TheWakeLook): AWAKE_CLOCK | null {
  if (!idleIn(look)) return null
  if (look.wake !== true) return look.clock ?? { since: look.now, wakes: 0 }
  return { since: look.now, wakes: (look.clock?.wakes ?? 0) + 1 }
}

/** Whether the wait since the clock's start has reached `min(cap, after * 2 ** wakes)`: the doubling, and its cap. */
export function theWakeDue(look: TheWakeLook): boolean {
  if (look.clock === null || !idleIn(look)) return false
  const wait = Math.min(look.windows.cap_ms, look.windows.after_ms * 2 ** look.clock.wakes)
  return look.now - look.clock.since >= wait
}

/**
 * The text that wakes this member now, or null when no wake is due. The order of the refusals is the design's: work to
 * wake for, the member the crew leaves alone, the parked member, the limit, and only then the clock.
 */
export function theWakeOf(look: TheWakeLook): string | null {
  if (look.unheld === 0) return null
  if (look.routes || look.parked) return null
  if (look.windows.after_ms <= 0) return null
  if (look.context_percent >= look.limit_percent) return null
  return theWakeDue(look) ? THE_WAKE_TEXT : null
}

/** A clock as it is kept, or null when it is not one this slice wrote. */
const aClockIn = (value: unknown): AWAKE_CLOCK | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const held = value as Record<string, unknown>
  const since = held['since']
  const wakes = held['wakes']
  if (typeof since !== 'number' || typeof wakes !== 'number' || !Number.isInteger(wakes) || wakes < 0) return null
  return { since, wakes }
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The clocks the place keeps: none when it keeps no file or one this cannot read, or why the place will not answer. */
export function theClocksIn(place: CrewPlace | Refused): TheWakeClocks | Refused {
  if ('refusal' in place) return place
  const held = place.read(THE_CLOCKS_FILE)
  if (held === undefined) return {}
  if ('refusal' in held) return held
  let value: unknown
  try {
    value = JSON.parse(held.text)
  } catch {
    return {}
  }
  if (!isObject(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([member, clock]) => {
    const one = aClockIn(clock)
    return one === null ? [] : [[member, one] as const]
  }))
}

/** Keeps the clocks, or says why it could not. */
export const keepTheClocks = (place: CrewPlace, clocks: TheWakeClocks): Refused | undefined =>
  place.keep(THE_CLOCKS_FILE, `${JSON.stringify(clocks)}\n`)

/** One member's clock out of the crew's, by name as the declaration compares member names. */
export function theMembersClock(clocks: TheWakeClocks, member: string): AWAKE_CLOCK | null {
  const named = Object.keys(clocks).find((one) => sameMemberName(one, member))
  return named === undefined ? null : (clocks[named] ?? null)
}

/** Every clock with this member's replaced by `clock`, or dropped when it holds none. */
export function theClocksWith(clocks: TheWakeClocks, member: string, clock: AWAKE_CLOCK | null): TheWakeClocks {
  const kept = Object.entries(clocks).filter(([name]) => !sameMemberName(name, member))
  return clock === null ? Object.fromEntries(kept) : Object.fromEntries([...kept, [member, clock]])
}

/** The house rules a crew reads its wakes by: the switch, and the two windows it names when it is on. */
export type TheWakeRules = Pick<HouseRules, 'wake' | 'wake_after_minutes' | 'wake_cap_minutes'>

/** The windows the crew declared, or null when it declared no wake or turned it off with a first window of zero. */
export function theWakeWindowsOf(rules: TheWakeRules, offline_ms: number): TheWakeWindows | null {
  if (!rules.wake) return null
  const after_minutes = rules.wake_after_minutes
  const cap_minutes = rules.wake_cap_minutes
  if (after_minutes === null || cap_minutes === null || after_minutes <= 0) return null
  return { after_ms: after_minutes * MINUTE_MS, cap_ms: cap_minutes * MINUTE_MS, offline_ms }
}

/** What the launcher is handed to answer a host's wake ask: the crew's record, and where the session stands. */
export interface WakeAsked {
  readonly settings: CrewSettings
  readonly member: string
  /** Every member's row, by name, as the launcher laid them out. */
  readonly rows: Readonly<Record<string, DashboardRow>>
  /** Where this crew keeps its clocks, or why it keeps none. */
  readonly place: CrewPlace | Refused
  /** The members whose park marker says they are parked, as `see_the_crew` reads them. */
  readonly parked: readonly string[]
  /** The crew's kept backlog read, as `see_the_crew` reads it. */
  readonly reader: TheBacklogReader
  readonly now: number
  /** The session's own context, as its host reports it: at or over the crew's limit, the refresh flow hands it over. */
  readonly context_percent: number
}

/**
 * The wake this member is due right now, or null, with the clock kept for the next look. A crew that declared no wake, a
 * crew store that will not keep a clock, and a backlog read that could not be made each answer null: a clock that cannot
 * be kept would begin again on every look and never reach its window, and a read that failed is not "nothing unheld"
 * said — but it is not work to wake for either, so nothing is woken on it.
 */
export async function theWakeFor(asked: WakeAsked): Promise<string | null> {
  const windows = theWakeWindowsOf(asked.settings.house_rules, offlineAfterMsOf(asked.settings.thresholds))
  if (windows === null) return null
  const clocks = theClocksIn(asked.place)
  if ('refusal' in clocks || 'refusal' in asked.place) return null
  const read = asked.settings.backlog === null ? undefined : await theBacklogNow(asked.reader, asked.settings.backlog.places)
  const unheld = read === undefined || 'refusal' in read ? 0 : theSplitOf(read.issues, asked.settings.members.map((member) => member.name)).unheld.length
  const look: TheWakeLook = {
    member: asked.member,
    row: Object.entries(asked.rows).find(([name]) => sameMemberName(name, asked.member))?.[1] ?? null,
    parked: asked.parked.some((name) => sameMemberName(name, asked.member)),
    routes: theNudgesGoTo(asked.settings).some((name) => sameMemberName(name, asked.member)),
    unheld,
    now: asked.now,
    windows,
    limit_percent: asked.settings.thresholds.handover_percent,
    context_percent: asked.context_percent,
    clock: theMembersClock(clocks, asked.member),
  }
  const text = theWakeOf(look)
  const after = theClockAfter({ ...look, wake: text !== null })
  // A clock the store would not keep is a wake that would be repeated on every look; the wake itself is still the right
  // one to make, and it is made.
  keepTheClocks(asked.place, theClocksWith(clocks, asked.member, after))
  return text
}

