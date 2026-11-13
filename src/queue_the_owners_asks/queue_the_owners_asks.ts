// The owner's ask queue (martha#313, the queue half).
//
// This exists so a routine yes/no ask from a member reaches the owner as one batch instead of one interruption each:
// `queue_ask` puts a question in the queue, `list_asks` only looks, `take_asks` claims every waiting ask as one batch
// for a single multi-select menu, and `settle_asks` takes that batch off once the owner has answered it.
//
// Nothing is moved on disk. The queue is an append-only stream in the crew's row streams (martha#254 R1): an ask is one
// row, a take another, a settle a third, and what waits is the fold of the three. An ask's id, and a batch's, is the
// position the row was written at, so an id names one row for as long as the stream holds it. A crash at any point
// loses no ask, which is the bug crew-code once had: it deleted the ask files at take time.
//
// A batch not settled within ASK_CLAIM_MS puts its asks back in the queue, and a settle that arrives after that window
// still removes the asks the owner ticked, because the owner often answers hours later.
//
// Who may take and settle is the declaration's table, answered as the owner's list answers it (martha#316) and never
// from ../who_may_act's node ids: a solo crew has none. The act is OFFER_OWNER_ASKS, and both tools are gated alike.
//
// A settle is refused unless a menu closed in the session that took the batch after it took it. The launcher sees that,
// because its relay answers every tool call the host made, the menu tool included; the model's own word that it showed
// the owner a menu never counts. Which tool that is is the dialogs half's to name, once, in
// ../say_what_the_host_is_asking, and this slice reads it from there. The launcher keeps those closings in memory
// (menusTheLauncherKeeps), so a refresh forgets them and the next settle is refused rather than trusted.
//
// Every ask is stamped with the member the launcher started, never with a name the ask's text chose, and its text is
// capped and stripped of the characters that repaint a row: it reaches the session that offers it as a menu, which is a
// new way text reaches a session, so ../inbound_paths holds a row for it and this slice's gate stands on that row.

import { OFFER_OWNER_ASKS, OWNER } from '../declare_crew/declare_crew.ts'
import type { Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_NOT_DURABLE, ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import { CONTROL } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'

/** The stream the owner's asks live in, in the crew's row streams. */
export const OWNER_ASKS_STREAM = 'owner_asks'

/** The row that puts an ask in the queue. */
export const ASK_QUEUED = 'ask_queued'

/** The row that claims every waiting ask as one batch. */
export const ASKS_TAKEN = 'asks_taken'

/** The row that takes a batch off, saying which of its asks the owner ticked. */
export const ASKS_SETTLED = 'asks_settled'

/** The tool a member queues a routine ask with. */
export const QUEUE_ASK = 'queue_ask'

/** The tool that shows what waits, and takes nothing. */
export const LIST_ASKS = 'list_asks'

/** The tool that claims every waiting ask for one menu. */
export const TAKE_ASKS = 'take_asks'

/** The tool that takes a claimed batch off, once the owner answered it. */
export const SETTLE_ASKS = 'settle_asks'

const MINUTE_MS = 60_000

/**
 * How long a taken batch holds its asks before they wait again: half an hour, named here and nowhere else, and quoted
 * by every description and answer that names it.
 */
export const ASK_CLAIM_MS = 30 * MINUTE_MS

/** How long an ask may be, in characters: what the owner reads in a menu option, and what the queue keeps. */
export const MAX_ASK = 300

/** The claim window as the words that quote it. */
export const THE_WINDOW = `${String(ASK_CLAIM_MS / MINUTE_MS)} minutes`

/** What `queue_ask` says it is for: one routine ask, queued, and never a menu of its own. */
export const QUEUE_ASK_DESCRIPTION =
  'Queue a routine yes/no ask for the owner instead of opening a menu for it. The session that offers asks hands them over ' +
  "in one menu. Never queue part of a change: a change's asks go in one menu. The answer is queued, how many wait, and to " +
  'carry on.'

/** What `list_asks` says it is for: it only looks. */
export const LIST_ASKS_DESCRIPTION = 'List the asks waiting for the owner, oldest first. It only looks: nothing is taken and nothing is offered.'

/** What `take_asks` says it is for: one batch, one menu, and the window that puts it back. */
export const TAKE_ASKS_DESCRIPTION =
  "Take every ask waiting for the owner, oldest first, as one batch to offer in a single multi-select menu. Each ask's id " +
  `goes into its menu option. A batch not settled within ${THE_WINDOW} puts its asks back in the queue.`

/** What `settle_asks` says it is for: the batch off, with what the owner ticked. */
export const SETTLE_ASKS_DESCRIPTION =
  "Take a batch off the owner's ask queue once the owner has answered it, with the ids they ticked. Refused unless a menu " +
  `closed in this session since the batch was taken, and a settle after ${THE_WINDOW} still removes them.`

/** One ask waiting for the owner. `id` is the position its row was written at, in the queue and in a menu. */
export interface AnAsk {
  readonly id: number
  readonly question: string
  readonly asked_by: string
  readonly since: number
}

/** One batch: the asks it claimed, and who took it in which session. */
export interface ABatch {
  readonly id: number
  readonly asks: readonly number[]
  readonly at: number
  readonly by: string
  readonly session: string
}

/** What waits, and the batch nobody settled: the fold of every row the stream holds. */
export interface TheQueue {
  /** Every ask waiting for the owner, oldest first: not in a live batch, and not ticked by any settle. */
  readonly waiting: readonly AnAsk[]
  /** The newest batch no settle names: live within the window, and a late settle's to remove after it. */
  readonly claim: ABatch | null
}

/** A slice's answer: what it tells the caller, or why it would not. */
export type AskAnswer = { readonly told: string } | { readonly refused: string }

// --- a row read back ------------------------------------------------------------

/** Whether `value` is a whole number at or above zero, as a stream position is. */
const isPosition = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

/** The ask a stored row holds, or null when it is no row of this queue. */
function askIn({ position, row }: StoredRow): AnAsk | null {
  if (row['kind'] !== ASK_QUEUED || typeof row['question'] !== 'string' || typeof row['asked_by'] !== 'string') return null
  if (typeof row['since'] !== 'number') return null
  return { id: position, question: row['question'], asked_by: row['asked_by'], since: row['since'] }
}

/** The batch a stored row holds, or null when it is no take of this queue. */
function batchIn({ position, row }: StoredRow): ABatch | null {
  const asks = row['asks']
  if (row['kind'] !== ASKS_TAKEN || !Array.isArray(asks) || !asks.every(isPosition)) return null
  if (typeof row['at'] !== 'number' || typeof row['by'] !== 'string' || typeof row['session'] !== 'string') return null
  return { id: position, asks: asks as number[], at: row['at'], by: row['by'], session: row['session'] }
}

/** What a settle names: the batch, and the asks the owner ticked. Null when the row is no settle of this queue. */
function settleIn({ row }: StoredRow): { readonly batch: number; readonly yes: readonly number[] } | null {
  const yes = row['yes']
  if (row['kind'] !== ASKS_SETTLED || !isPosition(row['batch']) || !Array.isArray(yes) || !yes.every(isPosition)) return null
  return { batch: row['batch'], yes: yes as number[] }
}

/** The batches and asks a stream holds, each row read once. */
interface TheRows {
  readonly asks: readonly AnAsk[]
  readonly batches: readonly ABatch[]
  readonly settled: readonly { readonly batch: number; readonly yes: readonly number[] }[]
}

function theRowsIn(stored: readonly StoredRow[]): TheRows {
  return {
    asks: stored.flatMap((held) => askIn(held) ?? []),
    batches: stored.flatMap((held) => batchIn(held) ?? []),
    settled: stored.flatMap((held) => settleIn(held) ?? []),
  }
}

/** The newest batch no settle names, or null when every batch was settled. */
function newestUnsettled({ batches, settled }: TheRows): ABatch | null {
  const done = new Set(settled.map((one) => one.batch))
  return batches.filter((batch) => !done.has(batch.id)).sort((one, other) => other.id - one.id)[0] ?? null
}

/** Whether `batch` is still inside its window at `now`: its asks are offered, not waiting. */
export function withinItsWindow(batch: ABatch, now: number): boolean {
  return now < batch.at + ASK_CLAIM_MS
}

/**
 * The queue as the stream holds it: what waits, and the newest batch nobody settled. An ask inside a live batch is not
 * waiting; an ask of a batch whose window has passed waits again; and an ask any settle ticked is gone, whatever batch
 * claims it.
 */
export function theQueueIn(stored: readonly StoredRow[], now: number): TheQueue {
  const rows = theRowsIn(stored)
  const claim = newestUnsettled(rows)
  const offered = new Set(claim !== null && withinItsWindow(claim, now) ? claim.asks : [])
  const ticked = new Set(rows.settled.flatMap((one) => one.yes))
  return { waiting: rows.asks.filter((ask) => !ticked.has(ask.id) && !offered.has(ask.id)), claim }
}

// --- who may offer the asks -------------------------------------------------------

/** The declaration, as much of it as the queue is decided by: the members, and the table of who may do what. */
export interface TheDeclaration {
  readonly members: readonly { readonly name: string; readonly role: string }[]
  readonly mode: { readonly may: Readonly<Partial<Record<string, readonly string[]>>> }
}

/** Who this crew's table lets offer the owner's asks. */
const theGrantOf = (declaration: TheDeclaration): readonly string[] => declaration.mode.may[OFFER_OWNER_ASKS] ?? []

/**
 * Whether `member` may take the asks or settle a batch: its role is granted OFFER_OWNER_ASKS, or the table grants that
 * act to the owner and nobody else, in which case the members act as the owner's own sessions. That last reading is
 * the one martha#316's ruling on the owner's list settled, and a solo crew needs it here too: its declaration names the
 * owner and two roles, so without it there would be no session a solo crew's asks could ever reach.
 */
export function mayOfferTheOwnersAsks(declaration: TheDeclaration, member: string): boolean {
  const granted = theGrantOf(declaration)
  const role = declaration.members.find((one) => one.name === member)?.role
  if (role === undefined) return false
  if (granted.includes(role)) return true
  return granted.includes(OWNER) && granted.every((one) => one === OWNER)
}

/** Why a member may not take or settle, naming the act that would have allowed it and the table that grants it. */
export function whoMayOfferTheAsks(declaration: TheDeclaration, member: string): string {
  return `${member} may not take or settle the owner's asks: this crew's table grants ${OFFER_OWNER_ASKS} to ${theGrantOf(declaration).join(', ') || 'nobody'}. Nothing was taken.`
}

// --- the text an ask carries -------------------------------------------------------

/** The rule an ask's text holds to, over every character it carries: the owner's list's own rule (../keep_the_owners_todo_list), read as a sweep. */
const A_HIDDEN_CHARACTER = new RegExp(CONTROL.source, 'gu')

/** The question as the queue keeps it: the owner's characters only, no control or hidden one, and capped. */
export const theQuestion = (text: string): string => text.replace(A_HIDDEN_CHARACTER, '').trim().slice(0, MAX_ASK)

/** Why `raw` is not a question this queue keeps, or undefined when it is: a call says what it asks, in text. */
function questionRefusal(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return 'ask is missing: say the question, answerable yes or no, naming exactly what would be done'
  return theQuestion(raw) === '' ? 'ask is empty: say the question, answerable yes or no, naming exactly what would be done' : undefined
}

// --- the four tools -----------------------------------------------------------------

/** What a write of a row says: what to tell the caller, and the position the row was kept at. */
type Kept = { readonly told: string; readonly position: number }

/** Appends `row` at the length the stream was read at, and says what became of it, with its position either way. */
async function appendAtLength(host: LedgerHost, row: Row, length: number, told: string): Promise<Kept | { readonly refused: string }> {
  try {
    return { told, position: await host.stores.rows.append(OWNER_ASKS_STREAM, row, length) }
  } catch (error) {
    const held = error as { code?: unknown; position?: unknown }
    if (held.code === ROW_STREAM_MOVED) return { refused: 'the ask queue moved while this was written, so nothing was written: call again' }
    if (held.code !== ROW_NOT_DURABLE || !isPosition(held.position)) {
      return { refused: `the ask queue did not keep the row: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { told: `${told}, though the host could not make it durable`, position: held.position }
  }
}

/** The line one ask reads as, wherever it is shown: its id, who asked, and the question itself. */
const theLineOf = (ask: AnAsk): string => `- ${String(ask.id)} (from ${ask.asked_by}): ${ask.question}`

/**
 * `queue_ask`: the ask kept against the member the launcher started, never a name the call chose. The answer says how
 * many wait and tells the member to carry on, because opening a menu for it is what the queue exists to avoid.
 */
export async function queueAnAsk(host: LedgerHost, args: Readonly<Record<string, unknown>>, asked_by: string): Promise<AskAnswer> {
  const refused = questionRefusal(args['ask'])
  if (refused !== undefined) return { refused }
  const stored = await host.stores.rows.read(OWNER_ASKS_STREAM)
  const row = { kind: ASK_QUEUED, question: theQuestion(args['ask'] as string), asked_by, since: host.clock.now() }
  const kept = await appendAtLength(host, row, stored.length, '')
  if ('refused' in kept) return kept
  const waiting = theQueueIn(await host.stores.rows.read(OWNER_ASKS_STREAM), host.clock.now()).waiting.length
  return { told: `Queued for the owner; ${String(waiting)} ${waiting === 1 ? 'ask' : 'asks'} waiting. Do not open a menu for it; carry on.` }
}

/** `list_asks`: every ask waiting, oldest first, and nothing taken. */
export async function listTheAsks(host: LedgerHost): Promise<AskAnswer> {
  const now = host.clock.now()
  const { waiting, claim } = theQueueIn(await host.stores.rows.read(OWNER_ASKS_STREAM), now)
  if (waiting.length === 0 && claim === null) return { told: 'No asks are waiting for the owner.' }
  const offered = claim === null || !withinItsWindow(claim, now) ? [] : [withTheOwner(claim)]
  const listed = waiting.length === 0 ? ['Nothing else is waiting.'] : [`${String(waiting.length)} waiting, oldest first:`, ...waiting.map(theLineOf)]
  return { told: [...offered, ...listed].join('\n') }
}

/** The line `list_asks` says of a batch the owner is looking at: it is taken, and how many asks it holds. */
const withTheOwner = (claim: ABatch): string =>
  `Batch ${String(claim.id)} is taken and not settled: ${String(claim.asks.length)} ask(s) are with the owner.`

/**
 * `take_asks`: every waiting ask claimed as one batch, or why nothing was. A batch already taken inside its window is
 * refused — the owner is still looking at it — and every ask is admitted by the queue's own gate before any of it is
 * handed over, so a row nobody wrote through `queue_ask` takes nothing.
 */
export async function takeTheAsks(
  host: LedgerHost,
  taken: { readonly member: string; readonly session: string; readonly declaration: TheDeclaration },
): Promise<AskAnswer> {
  const allowed = mayOfferTheOwnersAsks(taken.declaration, taken.member)
  if (!allowed) return { refused: whoMayOfferTheAsks(taken.declaration, taken.member) }
  const stored = await host.stores.rows.read(OWNER_ASKS_STREAM)
  const queue = theQueueIn(stored, host.clock.now())
  const held = theHeldBatch(queue, host.clock.now())
  if (held !== undefined) return { refused: held }
  if (queue.waiting.length === 0) return { told: 'No asks are waiting for the owner.' }
  const members = taken.declaration.members.map((member) => member.name)
  const unadmitted = queue.waiting.find((ask) => whyNotAdmitted(ask, members) !== undefined)
  if (unadmitted !== undefined) return { refused: `ask ${String(unadmitted.id)} is not one this queue can hand over: ${whyNotAdmitted(unadmitted, members)}. Nothing was taken.` }
  const row = { kind: ASKS_TAKEN, asks: queue.waiting.map((ask) => ask.id), at: host.clock.now(), by: taken.member, session: taken.session }
  const kept = await appendAtLength(host, row, stored.length, '')
  if ('refused' in kept) return kept
  return { told: theBatchOffered(queue.waiting, kept.position) }
}

/** Why a batch already taken holds the queue, or undefined when the waiting asks may be taken. */
function theHeldBatch(queue: TheQueue, now: number): string | undefined {
  if (queue.claim === null || !withinItsWindow(queue.claim, now)) return undefined
  const minutes = Math.floor((now - queue.claim.at) / MINUTE_MS)
  return (
    `batch ${String(queue.claim.id)} was taken ${String(minutes)} minute(s) ago and is not settled, so the owner is still ` +
    `looking at it. Settle it with the ids they ticked, or take again once ${THE_WINDOW} have passed.`
  )
}

/** What `take_asks` answers: one batch, each ask with its id for a menu option, and how to settle it. */
function theBatchOffered(waiting: readonly AnAsk[], batch: number): string {
  const one = waiting.length === 1
  return [
    `${String(waiting.length)} queued ${one ? 'ask' : 'asks'}, oldest first. Offer them to the owner as ONE multi-select menu, ` +
      `at most 4 options a question and more questions in the same menu when there are more, with each ask's id in its option. ` +
      `Then settle batch ${String(batch)} with the ids the owner ticked.`,
    ...waiting.map(theLineOf),
  ].join('\n')
}

/** The batch a call names, or why it is not one this queue took. */
function theBatchACallNames(args: Readonly<Record<string, unknown>>, stored: readonly StoredRow[]): { readonly batch: ABatch } | { readonly refused: string } {
  const batch = args['batch']
  if (!isPosition(batch)) return { refused: 'batch is the id take_asks answered, as a whole number' }
  const held = theRowsIn(stored).batches.find((one) => one.id === batch)
  return held === undefined ? { refused: `batch ${String(batch)} is not a batch this queue took` } : { batch: held }
}

/** The ids a call names as the owner's yes, or why they are not ids of `claim`. */
function theTickedIn(args: Readonly<Record<string, unknown>>, claim: ABatch): readonly number[] | string {
  const yes = args['yes']
  if (!Array.isArray(yes) || !yes.every(isPosition)) return 'yes is the ids the owner ticked, as whole numbers'
  const unknown = (yes as number[]).find((id) => !claim.asks.includes(id))
  return unknown === undefined ? (yes as number[]) : `${String(unknown)} is not an ask of batch ${String(claim.id)}`
}

/**
 * `settle_asks`: the batch off, with what the owner ticked, and the rest waiting again. Refused unless a menu closed in
 * the session that took the batch since it took it, and refused for a session the table does not let settle.
 */
export async function settleTheAsks(
  host: LedgerHost,
  settled: { readonly member: string; readonly declaration: TheDeclaration; readonly menus: TheOwnersMenus | undefined },
  args: Readonly<Record<string, unknown>>,
): Promise<AskAnswer> {
  const allowed = mayOfferTheOwnersAsks(settled.declaration, settled.member)
  if (!allowed) return { refused: whoMayOfferTheAsks(settled.declaration, settled.member) }
  const stored = await host.stores.rows.read(OWNER_ASKS_STREAM)
  const claim = theBatchACallNames(args, stored)
  if ('refused' in claim) return claim
  const closed = noMenuClosed(settled.menus, claim.batch)
  if (closed !== undefined) return { refused: closed }
  const yes = theTickedIn(args, claim.batch)
  if (typeof yes === 'string') return { refused: yes }
  const row = { kind: ASKS_SETTLED, batch: claim.batch.id, yes, at: host.clock.now(), by: settled.member }
  const kept = await appendAtLength(host, row, stored.length, '')
  if ('refused' in kept) return kept
  const back = claim.batch.asks.filter((id) => !yes.includes(id)).length
  return { told: `Batch ${String(claim.batch.id)} settled: ${String(yes.length)} the owner ticked, ${String(back)} back in the queue.` }
}

/** Why no menu closed since the batch was taken, or undefined when one did: the one thing a settle stands on. */
function noMenuClosed(menus: TheOwnersMenus | undefined, batch: ABatch): string | undefined {
  if (menus === undefined) {
    return `settle_asks is refused: this launch keeps no record of menus, so nothing shows batch ${String(batch.id)} was ever offered.`
  }
  const closed = menus.closedAt(batch.session)
  if (closed !== null && closed > batch.at) return undefined
  return (
    `settle_asks is refused: no menu has closed in the session that took batch ${String(batch.id)} since it was taken, so ` +
    'nobody has offered it to the owner. Offer the batch as one menu, then settle it.'
  )
}

// --- what a menu's closing is ------------------------------------------------------

/**
 * What the launcher keeps of the menus its host closed: the last time one closed in each session, by the host's own
 * answer to the menu tool. Kept in memory on purpose: a closing is about a session that is running now, and a refresh
 * loses it, so the settle after a refresh is refused rather than trusted.
 */
export interface TheOwnersMenus {
  /** When a menu last closed in `session`, in ms since the epoch; null when none has. */
  closedAt(session: string): number | null
  /** The launcher saw the host answer one of its calls: the menu tool's answer is the one this keeps. */
  noteTheCallsAnswer(call: { readonly tool: string }, session: string): void
}

/** The record a launcher keeps, over the clock the launcher reads. */
export function menusTheLauncherKeeps(clock: { now(): number }): TheOwnersMenus {
  const closed = new Map<string, number>()
  return {
    closedAt: (session) => closed.get(session) ?? null,
    noteTheCallsAnswer: (call, session) => {
      if (call.tool === MENU_TOOL) closed.set(session, clock.now())
    },
  }
}

// --- the gate that stands on the row ----------------------------------------------

/**
 * Whether an ask may be handed to the session that offers it: the asker is a member the launcher started — never a name
 * the ask's text chose — and the text is one the queue writes, capped and carrying no character that repaints a row.
 */
export function admitsAnAskToTheOwner({ ask, members }: { readonly ask: AnAsk; readonly members: readonly string[] }): boolean {
  return whyNotAdmitted(ask, members) === undefined
}

/** Why an ask may not be handed over, in the gate's own words: undefined when it may. */
export function whyNotAdmitted(ask: AnAsk, members: readonly string[]): string | undefined {
  if (!members.includes(ask.asked_by)) return `its asker ${JSON.stringify(ask.asked_by)} is not a member this crew's launcher started`
  if (ask.question.length > MAX_ASK) return `its text is longer than ${String(MAX_ASK)} characters`
  if (CONTROL.test(ask.question)) return 'its text carries a control or hidden character'
  return ask.question === '' ? 'its text is empty' : undefined
}
