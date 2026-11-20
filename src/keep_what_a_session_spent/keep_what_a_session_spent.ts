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

/** The name a row carries for an engine member's usage (martha#999 package 5: its launch asks the refresh question too). */
export const THE_ENGINES_USAGE_HOST = 'martha-engine'

/** The hosts whose usage is kept, by the name a row carries. */
export const USAGE_HOSTS = [CLAUDE_CODE, THE_ENGINES_USAGE_HOST] as const
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
 * What the writer last kept for a member: the reading itself, so the next one can be told apart from it, and the rows of
 * it still owed to the streams, whole, so the next question appends them as they were and never takes them again.
 */
type TheLastKept = Pick<AUsageRead, 'package' | 'session' | 'started_at' | 'usd' | 'model' | 'billing' | 'unknown_price'> & { readonly owed?: readonly AUsageRead[] }

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

/** The rows this reading is kept as: none, one, or the closing and opening pair of a hold that changed. */
function theRowsFor(last: TheLastKept | undefined, now: TheLastKept, asked: AReadingAsked, at: number, places: TheUsagePlaces): readonly AUsageRead[] {
  const row = (held: string | null, opens: 0 | 1): AUsageRead => ({
    kind: USAGE_READ, package: held, session: now.session, started_at: now.started_at, usd: now.usd, model: now.model, billing: now.billing,
    unknown_price: now.unknown_price, member: places.member, host: places.host, opens, at_start: asked.at_start ? 1 : 0, at,
  })
  if (last === undefined || !theSameSession(last, now)) return [row(now.package, 1)]
  if (last.package !== now.package) return [row(last.package, 0), row(now.package, 1)]
  return sayingSomethingNew(last, now) ? [row(now.package, 0)] : []
}

/**
 * Keeps the reading this question carries, or says why it could not. A beat writes nothing.
 *
 * The memory runs AHEAD of the streams: before any row is appended it names the reading and every row still owed, and
 * after each row appended it names what is left. So a refusal at any step, of a row or of the memory, leaves the next
 * question with the rows owed as they were written, at the reading that named them; it never writes a hand-over's rows
 * again at its own later reading. A memory write refused right after a row was appended means that row is appended once
 * more, the same row at the same instant, and the reader takes a repeated row as the one it repeats
 * (./the_spend_between.ts). A memory refused before any row leaves this reading untaken, as a refused row always did.
 */
export async function keepWhatTheSessionSpent(places: TheUsagePlaces, asked: AReadingAsked): Promise<string | undefined> {
  if (asked.turn_running) return undefined
  if ('refusal' in places.kept) return places.kept.refusal
  const now = theReadingNow(places, asked)
  const last = theLastKeptOf(places.kept, places.member)
  const owed = [...(last?.owed ?? []), ...theRowsFor(last, now, asked, places.ledger.clock.now(), places)]
  return owed.length === 0 ? undefined : theRowsAppended(places.ledger, places.kept, places.member, now, owed)
}

/** The reading this question carries, under the package the member's row holds now. */
function theReadingNow(places: TheUsagePlaces, asked: AReadingAsked): TheLastKept {
  const row = places.beats.read(places.member)
  return {
    package: row !== null && row.holds !== '' ? row.holds : null,
    session: asked.session_id,
    started_at: asked.started_at,
    usd: asked.cost_usd,
    model: places.row_model,
    billing: asked.billing,
    unknown_price: asked.unknown_price,
  }
}

/** Every row owed appended in order, the memory naming what is left before the first and after each; or the first refusal. */
async function theRowsAppended(ledger: LedgerHost, kept: CrewPlace, member: string, now: TheLastKept, owed: readonly AUsageRead[]): Promise<string | undefined> {
  const remembered = (left: readonly AUsageRead[]): string | undefined =>
    kept.keep(theUsageFile(member), `${JSON.stringify(left.length === 0 ? now : { ...now, owed: left })}\n`)?.refusal
  let refused = remembered(owed)
  for (let next = 0; refused === undefined && next < owed.length; next += 1) {
    refused = (await appendTheReading(ledger, owed[next] as AUsageRead)) ?? remembered(owed.slice(next + 1))
  }
  return refused
}

/** One reading appended to its stream; a row kept but not made durable counts as kept, so it is not owed again. */
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
