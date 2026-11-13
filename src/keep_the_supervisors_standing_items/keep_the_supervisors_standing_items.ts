// The Supervisor's standing items (martha#317): what it holds back, who owes what, and what the owner said.
//
// This exists so those three survive a refresh as items the next Supervisor session is handed, instead of living in a
// handover's prose, where one lost line lands a pull request on the wrong day.
//
// Three kinds, as crew-code keeps them: a hold (an item, why, and until when: a YYYY-MM-DD day first, or a condition),
// a wait (a package, who owes it, and what they owe), and a ruling (a rule, its day, and the owner's own words). A
// member the table lets assign work records one and closes one; every member reads them, because knowing what is held
// is how a member avoids landing it.
//
// The items are an append-only stream in the crew's row streams, as the owner's list is (../keep_the_owners_todo_list):
// recording an item is one row, closing it is another that keeps the evidence it was closed on, and what stands is the
// fold of the two. Nothing is ever removed, so a close can never fail quietly and leave an item standing, and "when was
// this hold released, and on what" can be answered later.
//
// A ruling here is the Supervisor's record of the owner's words, never the owner's yes: no gate reads this stream as an
// approval, and every ruling is drawn with who recorded it.

import type { Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_NOT_DURABLE, ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import { AN_ID_IS_A_SLUG, CONTROL, SAFE_ID, type TodoAnswer, type TodoHost } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { WORK_PACKAGE } from '../log_ledger/log_ledger.ts'

/** The stream the standing items live in, in the crew's row streams. */
export const STANDING_STREAM = 'standing'

/** The three kinds of item, in the order they are listed. */
export const STANDING_KINDS = ['held', 'awaiting', 'decided'] as const
export type StandingKind = (typeof STANDING_KINDS)[number]

/** The row that records each kind, and the row that closes any of them. */
export const ITEM_HELD = 'item_held'
export const WAIT_OWED = 'wait_owed'
export const RULING_RECORDED = 'ruling_recorded'
export const ITEM_CLOSED = 'item_closed'

/** The row each kind is recorded by. */
const ROW_OF_KIND: Readonly<Record<StandingKind, string>> = { held: ITEM_HELD, awaiting: WAIT_OWED, decided: RULING_RECORDED }

/** The fields each kind carries, every one required. */
export const FIELDS_OF_KIND: Readonly<Record<StandingKind, readonly string[]>> = {
  held: ['item', 'reason', 'until'],
  awaiting: ['owes', 'what'],
  decided: ['rule', 'date', 'words'],
}

/**
 * The field a hold names the package it holds in, as a batch names it (owner/repo#n). It is optional: a hold on
 * something that is no package (a tag, a fleet roll) leaves it out. A batch that lands a held package is refused
 * (martha#364, ../hold_a_package_back_from_a_batch).
 */
const PACKAGE = 'package'

/** The package a hold holds, when it names one; undefined for a hold that names none and for the other kinds. */
export const theHeldPackageOf = (item: StandingItem): string | undefined => (item.kind === 'held' ? item.fields[PACKAGE] : undefined)

/** Whether two packages are the same one: GitHub reads owner/repo in any case, and the number has no case to differ in. */
export const theSamePackage = (one: string, other: string): boolean => one.toLowerCase() === other.toLowerCase()

/** The tools: record an item, close one, and list what stands. */
export const STANDING_ADD = 'standing_add'
export const STANDING_CLOSE = 'standing_close'
export const STANDING = 'standing'

/** The longest field an item holds, in characters: an item is drawn on one line. */
export const MAX_STANDING_FIELD = 300

/** How many items a starting session is handed at most; the rest it reads with `standing`. */
export const ITEMS_HANDED_AT_START = 20

/** What `standing_add` says it is for. */
export const STANDING_ADD_DESCRIPTION =
  `Record one of the Supervisor's standing items, so the next Supervisor session is handed it after a refresh: held (item, reason, until: a YYYY-MM-DD day first, or the condition that ends the hold; ${PACKAGE}: the package it holds, owner/repo#n, so a batch that lands it is refused), awaiting (owes: who owes it, what: what they owe; the id is a slug naming the package, such as martha-317) or decided (rule, date: YYYY-MM-DD, words: the owner's own). Recording the same kind and id again replaces it, which is how a hold's day moves; a hold's ${PACKAGE} must then be named again, the same. A ruling is your record of the owner's words, never the owner's yes.`

/** What `standing_close` says it is for. */
export const STANDING_CLOSE_DESCRIPTION =
  'Close a standing item. A held item closes only with one line of evidence that its condition was met (a merged sha, a day that has passed, the owner\'s yes). An id that stands as two kinds needs its kind named, so closing the wait never ends the hold. The close keeps its evidence in the stream.'

/** What `standing` says it is for. */
export const STANDING_DESCRIPTION = 'List what the Supervisor holds back, who owes what, and the owner\'s recorded rulings, one line each; a hold whose day has come reads DUE.'

/** What is said when nothing stands. */
export const NOTHING_STANDS = 'Nothing is held, awaited or recorded as decided.'

/** The heading the items are drawn under, in the pane and at a session's start. */
export const STANDING_HEADING = 'Standing items'

/** An item, as the fold of the stream holds it. `recorded_by` is the launch's member that wrote it. */
export interface StandingItem {
  readonly kind: StandingKind
  readonly id: string
  readonly fields: Readonly<Record<string, string>>
  readonly recorded_by: string
  readonly since: number
}

// --- the rules an item holds to -------------------------------------------------

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_FIRST = /^(\d{4}-\d{2}-\d{2})(?![0-9])/

/** Whether `text` is a day the calendar has: 2026-02-31 is not one. */
export function isADay(text: string): boolean {
  const parts = DAY.exec(text)
  if (parts === null) return false
  const day = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
  return day.toISOString().slice(0, 10) === text
}

/** Why a one-line field is refused, naming it, or undefined when it holds. */
function fieldRefusal(field: string, value: unknown): string | undefined {
  if (value === undefined || value === '') return `${field} is missing`
  if (typeof value !== 'string') return `${field} is not text`
  if (CONTROL.test(value)) return `${field} holds a line break, a control or a hidden character: an item is one line, read as its bytes`
  if (value.trim() !== value) return `${field} starts or ends with a space`
  return value.length > MAX_STANDING_FIELD ? `${field} is longer than ${MAX_STANDING_FIELD} characters` : undefined
}

/** Why an id is refused, or undefined when it names an item. */
const idRefusal = (id: unknown): string | undefined =>
  typeof id === 'string' && SAFE_ID.test(id) ? undefined : AN_ID_IS_A_SLUG

/** Why a hold's package is refused, or undefined when it names none or names one as a batch would. */
function packageRefusal(kind: StandingKind, value: unknown): string | undefined {
  if (kind !== 'held' || value === undefined || value === '') return undefined
  const refused = fieldRefusal(PACKAGE, value)
  if (refused !== undefined) return refused
  return WORK_PACKAGE.test(value as string) ? undefined : `${PACKAGE} is not owner/repo#n, as a batch names a package`
}

/** The package a hold names, as its one extra field, or nothing for a hold that names none and for the other kinds. */
const theHeldPackage = (kind: StandingKind, args: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> =>
  kind === 'held' && typeof args[PACKAGE] === 'string' && args[PACKAGE] !== '' ? { [PACKAGE]: args[PACKAGE] } : {}

/** The kind a call names, or undefined when it names none of the three. */
const kindIn = (raw: unknown): StandingKind | undefined => STANDING_KINDS.find((kind) => kind === raw)

/** The item a call records, as `recorded_by` at `since`, or why it is refused by name. */
export function theItemAsked(args: Readonly<Record<string, unknown>>, recorded_by: string, since: number): StandingItem | { readonly refused: string } {
  const kind = kindIn(args['kind'])
  if (kind === undefined) return { refused: `kind is one of ${STANDING_KINDS.join(', ')}` }
  const id = idRefusal(args['id'])
  if (id !== undefined) return { refused: id }
  const names = FIELDS_OF_KIND[kind]
  const refused = names.map((name) => fieldRefusal(name, args[name])).find((said) => said !== undefined) ?? packageRefusal(kind, args[PACKAGE])
  if (refused !== undefined) return { refused: `a ${kind} item: ${refused}` }
  if (kind === 'decided' && !isADay(args['date'] as string)) return { refused: 'a decided item: date is not a day: YYYY-MM-DD, one the calendar has' }
  const fields = Object.fromEntries(names.map((name) => [name, args[name] as string]))
  return { kind, id: args['id'] as string, fields: { ...fields, ...theHeldPackage(kind, args) }, recorded_by, since }
}

// --- the stream -----------------------------------------------------------------

/** The kind a recording row is of, or undefined when the row records none. */
const kindOfRow = (row: Row): StandingKind | undefined => STANDING_KINDS.find((kind) => ROW_OF_KIND[kind] === row['kind'])

/** An item as the stream holds it, read back under the same rules it was recorded by, or null when it is none. */
function recordedIn(row: Row): StandingItem | null {
  const kind = kindOfRow(row)
  if (kind === undefined || typeof row['since'] !== 'number' || fieldRefusal('recorded_by', row['recorded_by']) !== undefined) return null
  const item = theItemAsked({ ...row, kind }, row['recorded_by'] as string, row['since'])
  return 'refused' in item ? null : item
}

const keyOf = (kind: unknown, id: unknown): string => `${String(kind)}:${String(id)}`

/** Held first, then who owes what, then the rulings; oldest first within each. */
const inOrder = (a: StandingItem, b: StandingItem): number => STANDING_KINDS.indexOf(a.kind) - STANDING_KINDS.indexOf(b.kind) || a.since - b.since

/**
 * What stands: every item recorded and not closed, in order. Recording a kind and id again replaces the item; a row
 * the stream holds that is no item (a hand-written one, one that breaks a rule) is left off rather than drawn.
 */
export function theStandingItems(stored: readonly StoredRow[]): readonly StandingItem[] {
  const standing = new Map<string, StandingItem>()
  for (const { row } of stored) {
    if (row['kind'] === ITEM_CLOSED) standing.delete(keyOf(row['standing_kind'], row['id']))
    const item = recordedIn(row)
    if (item !== null) standing.set(keyOf(item.kind, item.id), item)
  }
  return [...standing.values()].sort(inOrder)
}

/** Appends `row` at the length the stream was read at, and says what became of it. */
async function appendAtLength(host: TodoHost, row: Row, length: number, told: string): Promise<TodoAnswer> {
  try {
    await host.stores.rows.append(STANDING_STREAM, row, length)
    return { told }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === ROW_STREAM_MOVED) return { refused: 'the standing items moved while this was written, so nothing was written: call again' }
    if (code === ROW_NOT_DURABLE) return { told: `${told}, though the host could not make it durable` }
    return { refused: `the standing items did not keep the row: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Records the item a call asks for, as `recorded_by`. */
export async function recordAStandingItem(host: TodoHost, args: Readonly<Record<string, unknown>>, recorded_by: string): Promise<TodoAnswer> {
  const item = theItemAsked(args, recorded_by, host.clock.now())
  if ('refused' in item) return item
  const stored = await host.stores.rows.read(STANDING_STREAM)
  const drops = aHeldRecordDropsItsPackage(theStandingItems(stored), item)
  if (drops !== undefined) return { refused: drops }
  const row = { kind: ROW_OF_KIND[item.kind], id: item.id, ...item.fields, recorded_by, since: item.since }
  return appendAtLength(host, row, stored.length, `${item.kind} ${item.id} is recorded`)
}

/**
 * Why recording `asked` would drop or change the package an open hold of the same id holds, or undefined when it keeps
 * it. Recording again replaces the hold, so a day moved without the package would leave a hold that still reads HELD
 * while a batch lands its package (martha#364). A hold that named none may be given one.
 */
export function aHeldRecordDropsItsPackage(open: readonly StandingItem[], asked: StandingItem): string | undefined {
  if (asked.kind !== 'held') return undefined
  const held = open.find((item) => item.kind === 'held' && item.id === asked.id)?.fields[PACKAGE]
  const named = asked.fields[PACKAGE]
  if (held === undefined || (named !== undefined && theSamePackage(held, named))) return undefined
  return `${asked.id} is held on ${held}: name the same package to move its day, or close it first (${STANDING_CLOSE}, with its evidence). Nothing was written`
}

/** The one item an id (and, when named, a kind) closes, or why there is not exactly one. */
function theItemToClose(items: readonly StandingItem[], id: string, named: unknown): StandingItem | string {
  const kind = named === undefined || named === '' ? undefined : kindIn(named)
  if (kind === undefined && named !== undefined && named !== '') return `kind is one of ${STANDING_KINDS.join(', ')}`
  const matches = items.filter((item) => item.id === id && (kind === undefined || item.kind === kind))
  if (matches.length === 0) return `${id} does not stand${kind === undefined ? '' : ` as ${kind}`}`
  if (matches.length > 1) return `${id} stands as ${matches.map((item) => item.kind).join(' and ')}: name the kind to close`
  return matches[0]!
}

/** Why a close's evidence is refused for `item`, or undefined when it holds. A hold needs it; the rest may carry it. */
function evidenceRefusal(item: StandingItem, evidence: unknown): string | undefined {
  if (item.kind === 'held' && (evidence === undefined || evidence === '')) {
    return `${item.id} is held until ${item.fields['until']}: say, in one line of evidence, how that was met (a merged sha, a day that has passed, the owner's yes)`
  }
  return evidence === undefined || evidence === '' ? undefined : fieldRefusal('evidence', evidence)
}

/** Closes the item a call names, as `closed_by`, keeping its evidence in the stream. */
export async function closeAStandingItem(host: TodoHost, args: Readonly<Record<string, unknown>>, closed_by: string): Promise<TodoAnswer> {
  const id = idRefusal(args['id'])
  if (id !== undefined) return { refused: id }
  const stored = await host.stores.rows.read(STANDING_STREAM)
  const item = theItemToClose(theStandingItems(stored), args['id'] as string, args['kind'])
  if (typeof item === 'string') return { refused: item }
  const evidence = evidenceRefusal(item, args['evidence'])
  if (evidence !== undefined) return { refused: evidence }
  const row = { kind: ITEM_CLOSED, id: item.id, standing_kind: item.kind, evidence: typeof args['evidence'] === 'string' ? args['evidence'] : '', closed_by, at: host.clock.now() }
  return appendAtLength(host, row, stored.length, `${item.kind} ${item.id} is closed`)
}

// --- what is shown ----------------------------------------------------------------

/** The day `now` falls on, as YYYY-MM-DD in UTC: what a hold's day is compared with. */
export const todayOf = (now: number): string => new Date(now).toISOString().slice(0, 10)

/** The day a hold ends, when its `until` starts with one the calendar has. */
function untilDay(item: StandingItem): string | undefined {
  const day = DAY_FIRST.exec(item.fields['until'] ?? '')?.[1]
  return day !== undefined && isADay(day) ? day : undefined
}

/** Whether a hold's day has come: on that day and after it, never for a hold whose end is a condition with no day. */
export function isDue(item: StandingItem, today: string): boolean {
  const day = item.kind === 'held' ? untilDay(item) : undefined
  return day !== undefined && day <= today
}

/** The line each kind is drawn as, besides the DUE mark a hold may carry. */
const LINE_OF_KIND: Readonly<Record<StandingKind, (item: StandingItem) => string>> = {
  held: (item) => `HELD ${item.id}${item.fields[PACKAGE] === undefined ? '' : ` (${item.fields[PACKAGE]})`}: ${item.fields['item']}. Why: ${item.fields['reason']}. Until: ${item.fields['until']}`,
  awaiting: (item) => `AWAITING ${item.id}: ${item.fields['owes']} owes ${item.fields['what']}, since ${todayOf(item.since)}`,
  decided: (item) => `DECIDED, recorded by ${item.recorded_by}: ${item.fields['date']} "${item.fields['words']}" (${item.id}): ${item.fields['rule']}`,
}

/** The DUE mark: what the reader does with a hold whose day has come. */
export const DUE = 'DUE: check the condition, then close it or move the day'

/** One item on one line. */
export const itemLine = (item: StandingItem, today: string): string => `- ${LINE_OF_KIND[item.kind](item)}${isDue(item, today) ? ` (${DUE})` : ''}.`

/** Every item, one line each, or the line saying nothing stands. */
export function theStandingList(items: readonly StandingItem[], today: string): readonly string[] {
  return items.length === 0 ? [NOTHING_STANDS] : items.map((item) => itemLine(item, today))
}

/**
 * The part of a starting session's line that hands it the standing items: at most ITEMS_HANDED_AT_START of them, then
 * how many more there are and to call `standing`. Null when nothing stands.
 */
export function theStandingPartOfTheStart(items: readonly StandingItem[], today: string): string | null {
  if (items.length === 0) return null
  const handed = items.slice(0, ITEMS_HANDED_AT_START).map((item) => itemLine(item, today))
  const more = items.length - handed.length
  const tail = more > 0 ? [`… and ${more} more: call ${STANDING} for the rest.`] : []
  return [`${STANDING_HEADING} (${items.length}), recorded by this crew's members; a ruling is a record of the owner's words, not the owner's yes:`, ...handed, ...tail].join('\n')
}
