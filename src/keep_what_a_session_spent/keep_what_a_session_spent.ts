// What a session spent, kept as readings of what its host reports (martha#860).
//
// This exists so the owner can read what a package spent — money as its host estimates it, and the wall-clock it held
// the package — from rows Martha keeps, without Martha inventing a figure. Both hosts report a session's cost as a
// running total, so a row is a READING of that total, not an amount: what was spent is the reader's subtraction
// (./the_spend_between.ts), and a second reading of the same session folds into the first instead of adding to it.
//
// Where the rows live. `usage/<owner/repo#n>` for a session that holds a package, and `usage/crew` for one that holds
// none (the Supervisor, a member reading its brief, a member between packages), so a week's total is whole. Neither is
// the budget's `spend/<package>`: that stream holds what Martha counts and its reader refuses any other row, and an
// estimated dollar must never be what a budget is held to without a decision that says so.
//
// A hold. A session holds one stream at a time: the package its member's row names, or the crew's. The first reading
// under a hold OPENS it, and its cost is the baseline the hold is measured from. When the member's row names another
// package, the reading that sees it is kept twice: once closing the old hold, once opening the new one, so the turn in
// which the package was named is counted once and nothing falls between the two. A hold whose opening cost is null has
// no baseline and is unknown, never measured from 0 — except a hold opened on the session's own first question, before
// any response was priced, whose null is 0 (Venus's ruling on the design, martha#860).
//
// Who writes. The launcher, from the question the mod asks at a session's start and every turn's end
// (../refresh_a_member/the_refresh_flow.ts). A beat taken while a turn runs writes nothing, and a reading that changed
// nothing writes nothing. What the writer last kept is one small file per member in the crew's own store, read once a
// question as the refresh flow reads its own; no stream is read to decide a write.
//
// The model. A reading closes the turn that just ended, so its model is the one that ran it: the launch's, then the one a
// switch was CONFIRMED on (martha#315), never one just ordered, and the reading is taken before the flow orders anything.

import type { CrewPlace, Refused, Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_NOT_DURABLE } from '../host_contract/host_contract.ts'
import { WORK_PACKAGE, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { BILLINGS, type AHostsReading, type Billing } from './the_hosts_usage.ts'

/** The kind every row of a usage stream carries. */
export const USAGE_READ = 'usage_read'

/** The hosts whose usage is kept, by the name a row carries. */
export const USAGE_HOSTS = [CLAUDE_CODE, 'martha-engine'] as const
export type AUsageHost = (typeof USAGE_HOSTS)[number]

/** The word that names the crew's own stream: the readings of sessions that hold no package. */
export const THE_CREWS_USAGE = 'crew'

/** One reading of a session's cost while it held one stream, as its host reported it. */
export interface AUsageRead {
  readonly kind: typeof USAGE_READ
  /** The package held, or null for the crew's stream. */
  readonly package: string | null
  readonly member: string
  readonly host: AUsageHost
  /** The model that ran the turn this reading closes. */
  readonly model: string
  readonly session: string
  /** The host's start of the session these figures count from; null when the host gives none. */
  readonly started_at: number | null
  /** 1 on the reading that opens a hold: its cost is the hold's baseline. */
  readonly opens: 0 | 1
  /** 1 when this reading is the session's own first question. */
  readonly at_start: 0 | 1
  readonly usd: number | null
  readonly unknown_price: 0 | 1
  readonly billing: Billing
  /** The launcher's clock. */
  readonly at: number
}

/** The word every usage stream is stored under, and the crew's place each member's last reading is kept in, `<crew>/usage`. */
export const USAGE_PLACE = 'usage'

/** The stream a package's readings live in, or the crew's: the one place a usage stream is named. */
export function usageStreamOf(work_package: string | null): string {
  if (work_package === null) return `${USAGE_PLACE}/${THE_CREWS_USAGE}`
  if (!WORK_PACKAGE.test(work_package)) throw new Error(`${JSON.stringify(work_package)} is not a work package (owner/repo#n)`)
  return `${USAGE_PLACE}/${work_package}`
}

const isText = (value: unknown): value is string => typeof value === 'string'
const isAFlag = (value: unknown): boolean => value === 0 || value === 1
const isANumberOrNull = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value))

/** Each field a usage row is read by, checked on its own: a row missing one is refused by name, never skipped. */
const ROW_FIELDS: readonly ((row: Row) => boolean)[] = [
  (row) => row['kind'] === USAGE_READ,
  (row) => row['package'] === null || (isText(row['package']) && WORK_PACKAGE.test(row['package'])),
  (row) => isText(row['member']) && isText(row['model']) && isText(row['session']),
  (row) => (USAGE_HOSTS as readonly unknown[]).includes(row['host']) && (BILLINGS as readonly unknown[]).includes(row['billing']),
  (row) => isANumberOrNull(row['started_at']) && isANumberOrNull(row['usd']),
  (row) => isAFlag(row['opens']) && isAFlag(row['at_start']) && isAFlag(row['unknown_price']),
  (row) => Number.isInteger(row['at']),
]

/** The readings of one stream, oldest first, or why one of its rows is no reading of it. */
export function theReadingsIn(stream: string, rows: readonly StoredRow[]): readonly AUsageRead[] | Refused {
  const read: AUsageRead[] = []
  for (const stored of rows) {
    const holds = ROW_FIELDS.every((field) => field(stored.row))
    if (!holds || usageStreamOf(stored.row['package'] as string | null) !== stream) {
      return { refusal: `row ${String(stored.position)} of ${stream} is not a reading of what a session spent there` }
    }
    read.push(stored.row as unknown as AUsageRead)
  }
  return read
}

/**
 * What the writer last kept for a member: the reading itself, so the next one can be told apart from it. `opens_at` is
 * set when a hand-over's closing row was kept and its opening was not: the new hold is still to open, at that reading.
 */
type TheLastKept = Pick<AUsageRead, 'package' | 'session' | 'started_at' | 'usd' | 'model' | 'billing' | 'unknown_price'> & { readonly opens_at?: number }

/** The question a reading is taken from: the host's reading, and where in the session it was asked. */
export interface AReadingAsked extends Pick<AHostsReading, 'cost_usd' | 'started_at' | 'unknown_price' | 'billing'> {
  readonly session_id: string
  readonly at_start: boolean
  readonly turn_running: boolean
}

/** What the writer works over: the member, its row, the crew's store, and the streams. */
export interface TheUsagePlaces {
  readonly member: string
  readonly host: AUsageHost
  readonly beats: DashboardStore
  readonly ledger: LedgerHost
  /** The model that ran the turn just ended: the launch's, then the one a switch was CONFIRMED on (martha#315). */
  readonly row_model: string
  /** The crew's place the writer keeps its last reading in, or why there is none. */
  readonly kept: CrewPlace | Refused
}

/** The file one member's last reading is kept in. */
export const theUsageFile = (member: string): string => `${member}.usage.json`

/** The member's last kept reading, undefined when it has none or the file cannot be read as one: then the next opens. */
function theLastKeptOf(place: CrewPlace, member: string): TheLastKept | undefined {
  const read = place.read(theUsageFile(member))
  if (read === undefined || 'refusal' in read) return undefined
  try {
    return JSON.parse(read.text) as TheLastKept
  } catch {
    return undefined
  }
}

const theSameSession = (last: TheLastKept, now: TheLastKept): boolean => last.session === now.session && last.started_at === now.started_at

/** Whether a reading of the same hold says anything the last one did not. */
const sayingSomethingNew = (last: TheLastKept, now: TheLastKept): boolean =>
  last.usd !== now.usd || last.model !== now.model || last.billing !== now.billing || last.unknown_price !== now.unknown_price

/** One row to append, and what the writer has kept once it is: so a refusal between two rows loses neither. */
interface ARowToKeep {
  readonly row: AUsageRead
  readonly after: TheLastKept
}

/**
 * The rows this reading is kept as: none, one, or the closing and opening pair of a hold that changed. A hand-over
 * whose opening was refused opens first, at the reading that named the package, so the old hold is never closed twice.
 */
function theRowsFor(last: TheLastKept | undefined, now: TheLastKept, asked: AReadingAsked, at: number, places: TheUsagePlaces): readonly ARowToKeep[] {
  const row = (reading: TheLastKept, held: string | null, opens: 0 | 1, at_start: 0 | 1, when: number): AUsageRead => ({
    kind: USAGE_READ, package: held, session: reading.session, started_at: reading.started_at, usd: reading.usd, model: reading.model,
    billing: reading.billing, unknown_price: reading.unknown_price, member: places.member, host: places.host, opens, at_start, at: when,
  })
  const at_start = asked.at_start ? 1 : 0
  if (last === undefined || !theSameSession(last, now)) return [{ row: row(now, now.package, 1, at_start, at), after: now }]
  if (last.opens_at !== undefined) {
    const { opens_at, ...opened } = last
    return [{ row: row(opened, opened.package, 1, 0, opens_at), after: opened }, ...theRowsFor(opened, now, asked, at, places)]
  }
  if (last.package !== now.package) {
    return [{ row: row(now, last.package, 0, at_start, at), after: { ...now, opens_at: at } }, { row: row(now, now.package, 1, at_start, at), after: now }]
  }
  return sayingSomethingNew(last, now) ? [{ row: row(now, now.package, 0, at_start, at), after: now }] : []
}

/**
 * Keeps the reading this question carries, or says why it could not. A beat writes nothing. What the writer last kept
 * follows each row appended and never runs ahead of one, so a reading the store refused is taken again next time, and
 * a hand-over's closing row already kept is not appended twice.
 */
export async function keepWhatTheSessionSpent(places: TheUsagePlaces, asked: AReadingAsked): Promise<string | undefined> {
  if (asked.turn_running) return undefined
  if ('refusal' in places.kept) return places.kept.refusal
  const row = places.beats.read(places.member)
  const now: TheLastKept = {
    package: row !== null && row.holds !== '' ? row.holds : null,
    session: asked.session_id,
    started_at: asked.started_at,
    usd: asked.cost_usd,
    model: places.row_model,
    billing: asked.billing,
    unknown_price: asked.unknown_price,
  }
  for (const one of theRowsFor(theLastKeptOf(places.kept, places.member), now, asked, places.ledger.clock.now(), places)) {
    const refused = (await appendTheReading(places.ledger, one.row)) ?? places.kept.keep(theUsageFile(places.member), `${JSON.stringify(one.after)}\n`)?.refusal
    if (refused !== undefined) return refused
  }
  return undefined
}

/** One reading appended to its stream; a row kept but not made durable is kept, and is never appended twice. */
async function appendTheReading(ledger: LedgerHost, reading: AUsageRead): Promise<string | undefined> {
  try {
    await ledger.stores.rows.append(usageStreamOf(reading.package), { ...reading })
    return undefined
  } catch (why) {
    if (typeof why === 'object' && why !== null && (why as Row)['code'] === ROW_NOT_DURABLE) return undefined
    return `the store could not keep what ${reading.member}'s session spent (${why instanceof Error ? why.message : String(why)})`
  }
}

/** The row phase that says what the session spent could not be kept (martha#860 R4): the owner's words, never an order. */
export const SPEND_NOT_KEPT = 'spend_not_kept'

/** A row's phase as the refresh flow writes it: what is happening, and why, in the owner's words. */
interface ARowPhase {
  readonly phase: string
  readonly reason: string
}

/** How the row says a reading was not kept, after the flow's own reason when it has one. */
const NOT_KEPT_SAYS = 'what the session spent was not kept: '
const AFTER_THE_FLOWS_REASON = '; '

/** A row phase with what it said of a reading not kept taken off: the flow's own reason, as the flow wrote it. */
const withoutWhatWasNotKept = (phase: ARowPhase): ARowPhase => ({ ...phase, reason: phase.reason.split(`${AFTER_THE_FLOWS_REASON}${NOT_KEPT_SAYS}`)[0] ?? phase.reason })

/** `phase` saying the reading was not kept: beside the flow's own reason, said once however often it was refused. */
const sayingWhatWasNotKept = (phase: ARowPhase, why: string): ARowPhase => ({ ...phase, reason: `${withoutWhatWasNotKept(phase).reason}${AFTER_THE_FLOWS_REASON}${why}` })

/**
 * The flow's act, with a reading the store refused said on the row: beside the flow's own phase, never in its place,
 * whether the flow writes that phase on this turn or left it on the row from an earlier one; and taken off at the next
 * turn's end that keeps a reading, never by a beat that kept nothing, leaving the flow's own phase as it wrote it. Only
 * the row phase changes: the order the mod is sent stays the flow's alone, so a refused reading never holds the flow up.
 */
export function withWhatWasNotKept<A extends { readonly refresh?: ARowPhase | null }>(act: A, unkept: string | undefined, said: ARowPhase | null | undefined, turn_running: boolean): A {
  if (unkept !== undefined) return { ...act, refresh: theRefusalSaid(act.refresh === undefined ? said : act.refresh, `${NOT_KEPT_SAYS}${unkept}`) }
  if (act.refresh !== undefined || turn_running || said === undefined || said === null) return act
  return theRefusalTakenOff(act, said)
}

/** The row phase saying `why`: beside the flow's phase when there is one, on its own when the row holds none of the flow's. */
const theRefusalSaid = (flows: ARowPhase | null | undefined, why: string): ARowPhase =>
  flows === undefined || flows === null || flows.phase === SPEND_NOT_KEPT ? { phase: SPEND_NOT_KEPT, reason: why } : sayingWhatWasNotKept(flows, why)

/** The act once a reading was kept: a bare refusal cleared, the flow's phase given back its own words, else untouched. */
function theRefusalTakenOff<A extends { readonly refresh?: ARowPhase | null }>(act: A, said: ARowPhase): A {
  if (said.phase === SPEND_NOT_KEPT) return { ...act, refresh: null }
  const left = withoutWhatWasNotKept(said)
  return left.reason === said.reason ? act : { ...act, refresh: left }
}
