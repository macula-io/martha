// The owner's ask queue (martha#313, the queue half).
//
// This exists so a routine yes/no ask from a member reaches the owner as one batch instead of one interruption each:
// `ask_the_owner` puts a question in the queue, `see_the_owners_asks` only looks, `take_the_owners_asks` claims every waiting ask as one batch
// for a single multi-select menu, and `settle_the_owners_asks` takes that batch off once the owner has answered it.
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
// A settle is refused unless a menu closed in the session that took the batch after it took it, and every id it names is
// an option the owner picked in that menu, as the host's own answer reports it (martha#608, thePicksIn). The launcher
// sees both, because its relay answers every tool call the host made, the menu tool included, and hands the crew the
// call's posted input with the host's answer; the model's own word about what it showed or what was ticked never
// counts. Which tool that is is the dialogs half's to name, once, in ../say_what_the_host_is_asking, and this slice reads
// it from there. The launcher keeps those menus in memory (menusTheLauncherKeeps), so a refresh forgets them and the
// next settle is refused rather than trusted.
//
// This closes a settle through the tool with ids the owner did not tick. It does not close a write that bypasses the
// tool: members run as the owner's own OS user (the owner's ruling of 2026-11-18, #258 closed), so a process of theirs
// can append to the stream, or speak to the relay's socket, itself. A speed bump that makes a faked yes awkward and
// visible, not a boundary.
//
// Every ask is stamped with the member the launcher started, never with a name the ask's text chose, and its text is
// capped and stripped of the characters that repaint a row: it reaches the session that offers it as a menu, which is a
// new way text reaches a session, so ../inbound_paths holds a row for it and this slice's gate stands on that row. An
// ask that gate refuses is never handed over, and never stops the take: it is skipped and named in the answer, because
// the ordinary way to get one is a member who asked and was then renamed or removed from the declaration.
//
// An ask that would delete a branch carries the tips the yes covers (martha#391, ../read_the_tips_a_removal_covers):
// the launcher reads both copies, the row keeps them, and the line `take_the_owners_asks` and `see_the_owners_asks` show names them, so the
// one menu the ask reaches offers every tip the deletion removes. The branch is held to the question's own rule on its
// way in and on its way out, because it reaches the same menu.

import { OFFER_OWNER_ASKS, OWNER, whoTheTableGrants, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_NOT_DURABLE, ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import { CONTROL } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { A_COMMIT_ID, type ABranchItRemoves, theTipsItRemoves } from '../read_the_tips_a_removal_covers/read_the_tips_a_removal_covers.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'

/**
 * What names an ask the owner said yes to, wherever a yes is stood on: an unbounded contract's line and a criterion's
 * evidence (martha#513), and the fast-forward's argument (martha#605).
 */
export const OWNER_YES = 'owner_yes'

/** The stream the owner's asks live in, in the crew's row streams. */
export const OWNER_ASKS_STREAM = 'owner_asks'

/** The row that puts an ask in the queue. */
export const ASK_QUEUED = 'ask_queued'

/** The row that claims every waiting ask as one batch. */
export const ASKS_TAKEN = 'asks_taken'

/** The row that takes a batch off, saying which of its asks the owner ticked. */
export const ASKS_SETTLED = 'asks_settled'

/** The tool a member queues a routine ask with. */
export const QUEUE_ASK = 'ask_the_owner'

/** The tool that shows what waits, and takes nothing. */
export const LIST_ASKS = 'see_the_owners_asks'

/** The tool that claims every waiting ask for one menu. */
export const TAKE_ASKS = 'take_the_owners_asks'

/** The tool that takes a claimed batch off, once the owner answered it. */
export const SETTLE_ASKS = 'settle_the_owners_asks'

/**
 * How long a taken batch holds its asks before they wait again: half an hour, named here and nowhere else, and quoted
 * by every description and answer that names it.
 */
export const ASK_CLAIM_MS = 30 * MINUTE_MS

/** How long an ask may be, in characters: what the owner reads in a menu option, and what the queue keeps. */
export const MAX_ASK = 300

/** The claim window as the words that quote it. */
export const THE_WINDOW = `${String(ASK_CLAIM_MS / MINUTE_MS)} minutes`

/** What `ask_the_owner` says it is for: one routine ask, queued, and never a menu of its own. */
export const QUEUE_ASK_DESCRIPTION =
  'Queue a routine yes/no ask for the owner instead of opening a menu for it. The session that offers asks hands them over ' +
  "in one menu. Never queue part of a change: a change's asks go in one menu. An ask that would delete a branch names " +
  'repo and branch too, so the ask records every tip the yes removes and the owner is not asked twice. The answer is ' +
  'queued, how many wait, and to carry on.'

/** What `see_the_owners_asks` says it is for: it only looks. */
export const LIST_ASKS_DESCRIPTION = 'List the asks waiting for the owner, oldest first. It only looks: nothing is taken and nothing is offered.'

/** What `take_the_owners_asks` says it is for: one batch, one menu, and the window that puts it back. */
export const TAKE_ASKS_DESCRIPTION =
  "Take every ask waiting for the owner, oldest first, as one batch to offer in a single multi-select menu. Each ask is " +
  `one menu option, posted exactly as the answer gives it. A batch not settled within ${THE_WINDOW} puts its asks back in the queue.`

/** What `settle_the_owners_asks` says it is for: the batch off, with what the owner ticked. */
export const SETTLE_ASKS_DESCRIPTION =
  "Take a batch off the owner's ask queue once the owner has answered it, with the ids they ticked. Checked against the " +
  "host's own answer to the last menu that closed in this session since the batch was taken: an id the owner did not pick " +
  `there is refused. A settle after ${THE_WINDOW} still removes them. A speed bump, not a wall: a process running as the ` +
  "owner's OS user can still write the queue's stream itself."

/** One ask waiting for the owner. `id` is the position its row was written at, in the queue and in a menu. */
export interface AnAsk {
  readonly id: number
  readonly question: string
  readonly asked_by: string
  readonly since: number
  /** The branch the ask would remove and the tips the yes covers, when it would remove one (martha#391). */
  readonly removes?: ABranchItRemoves
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

/** Whether `value` is a tip this launcher read: a commit id, or nothing, which says that copy is not there. */
const isATipOrNothing = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && A_COMMIT_ID.test(value))

/**
 * The removal a stored row says its ask covers, read back: absent when the row names none, and `malformed` when it names
 * one this queue never wrote. The shape is the reader's business, as the question's own type is; the branch's text is
 * the gate's business below, because it is delivered to another session and a shape is not what repaints a row.
 */
function theRemovalIn(held: unknown): ABranchItRemoves | undefined | 'malformed' {
  if (held === undefined) return undefined
  const { branch, local_tip, origin_tip } = (held ?? {}) as Readonly<Record<string, unknown>>
  if (typeof branch !== 'string' || !isATipOrNothing(local_tip) || !isATipOrNothing(origin_tip)) return 'malformed'
  if (local_tip === null && origin_tip === null) return 'malformed'
  return { branch, local_tip, origin_tip }
}

/** The ask a stored row holds, or null when it is no row of this queue. */
function askIn({ position, row }: StoredRow): AnAsk | null {
  if (row['kind'] !== ASK_QUEUED || typeof row['question'] !== 'string' || typeof row['asked_by'] !== 'string') return null
  if (typeof row['since'] !== 'number') return null
  const removes = theRemovalIn(row['removes'])
  if (removes === 'malformed') return null
  return {
    id: position,
    question: row['question'],
    asked_by: row['asked_by'],
    since: row['since'],
    ...(removes === undefined ? {} : { removes }),
  }
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

/** Who this crew's table lets offer the owner's asks: read as ../declare_crew reads any act a table does not name. */
const theGrantOf = (declaration: TheDeclaration): readonly string[] => whoTheTableGrants(declaration.mode.may[OFFER_OWNER_ASKS])

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

/**
 * The branch a removal names, as the queue keeps it: the question's own rule, read once and used twice, because the
 * branch reaches the same menu the question does (martha#391).
 */
export const theBranch = (text: string): string => theQuestion(text)

/** Why a branch named for removal is not one this queue keeps, or undefined when it is: a removal names a branch. */
function branchRefusal(named: string): string | undefined {
  return named === '' ? 'the branch this ask removes is empty once its hidden characters are taken out: name the branch, as git names it' : undefined
}

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

/** The line one ask reads as, wherever it is shown: its id, who asked, the question itself, and the tips a removal covers. */
const theLineOf = (ask: AnAsk): string =>
  `- ${String(ask.id)} (from ${ask.asked_by}): ${ask.question}${ask.removes === undefined ? '' : ` ${theTipsItRemoves(ask.removes)}`}`

/**
 * `ask_the_owner`: the ask kept against the member the launcher started, never a name the call chose. The answer says how
 * many wait and tells the member to carry on, because opening a menu for it is what the queue exists to avoid.
 *
 * `removes` is the branch an ask would delete and the tip each copy of it stands at, read by the launcher
 * (../read_the_tips_a_removal_covers); the row keeps both, because a yes to a branch deletion that named one copy
 * deleted that one and left the other (martha#391, the owner's second ask on 2026-11-13). The clone's tip and
 * origin's are often the same, and when they are not, both are on the row and both are named in the answer, so the one
 * menu the ask reaches offers every tip the deletion removes.
 */
export async function queueAnAsk(
  host: LedgerHost,
  args: Readonly<Record<string, unknown>>,
  asked_by: string,
  removes?: ABranchItRemoves,
): Promise<AskAnswer> {
  const refused = questionRefusal(args['ask'])
  if (refused !== undefined) return { refused }
  const kept = removes === undefined ? undefined : { ...removes, branch: theBranch(removes.branch) }
  const branchRefused = kept === undefined ? undefined : branchRefusal(kept.branch)
  if (branchRefused !== undefined) return { refused: branchRefused }
  const stored = await host.stores.rows.read(OWNER_ASKS_STREAM)
  const row = {
    kind: ASK_QUEUED,
    question: theQuestion(args['ask'] as string),
    asked_by,
    since: host.clock.now(),
    ...(kept === undefined ? {} : { removes: kept }),
  }
  const wrote = await appendAtLength(host, row, stored.length, '')
  if ('refused' in wrote) return wrote
  const waiting = theQueueIn(await host.stores.rows.read(OWNER_ASKS_STREAM), host.clock.now()).waiting.length
  const both = kept === undefined ? '' : ` ${theTipsItRemoves(kept)}`
  return { told: `Queued for the owner; ${String(waiting)} ${waiting === 1 ? 'ask' : 'asks'} waiting.${both} Do not open a menu for it; carry on.` }
}

/** `see_the_owners_asks`: every ask waiting, oldest first, and nothing taken. */
export async function listTheAsks(host: LedgerHost): Promise<AskAnswer> {
  const now = host.clock.now()
  const { waiting, claim } = theQueueIn(await host.stores.rows.read(OWNER_ASKS_STREAM), now)
  if (waiting.length === 0 && claim === null) return { told: 'No asks are waiting for the owner.' }
  const offered = claim === null || !withinItsWindow(claim, now) ? [] : [withTheOwner(claim)]
  const listed = waiting.length === 0 ? ['Nothing else is waiting.'] : [`${String(waiting.length)} waiting, oldest first:`, ...waiting.map(theLineOf)]
  return { told: [...offered, ...listed].join('\n') }
}

/** The line `see_the_owners_asks` says of a batch the owner is looking at: it is taken, and how many asks it holds. */
const withTheOwner = (claim: ABatch): string =>
  `Batch ${String(claim.id)} is taken and not settled: ${String(claim.asks.length)} ask(s) are with the owner.`

/**
 * Every ask the owner has answered yes to, by id: the settles the stream holds, whatever batch they name, across the
 * queue's whole life (martha#513). It is what a package's unbounded mark and an acceptance criterion are checked
 * against: a yes the owner gave is a fact of the crew's, and a reader of one does not need a batch or a window.
 */
export async function theAsksTheOwnerSaidYesTo(host: LedgerHost): Promise<readonly number[]> {
  return theRowsIn(await host.stores.rows.read(OWNER_ASKS_STREAM)).settled.flatMap((settle) => settle.yes)
}

/**
 * The asks the owner said yes to, each with the question it was asked in: an answer is evidence of what it was asked
 * about, so a caller that stands on one reads whether it was asked about its own matter (martha#513's unbounded
 * contract, which is the owner's word about that package and not a yes to whatever else they were asked that day).
 */
export async function theAsksSaidYesToWithTheirWords(host: LedgerHost): Promise<readonly AnAsk[]> {
  const rows = theRowsIn(await host.stores.rows.read(OWNER_ASKS_STREAM))
  const said_yes = new Set(rows.settled.flatMap((settle) => settle.yes))
  return rows.asks.filter((ask) => said_yes.has(ask.id))
}

/**
 * `take_the_owners_asks`: every waiting ask this crew still declares claimed as one batch, or why nothing was. A batch already
 * taken inside its window is refused — the owner is still looking at it — and every ask is admitted by the queue's own
 * gate before any of it is handed over, so a row nobody wrote through `ask_the_owner` is never in a menu. An ask the gate
 * refuses is skipped and named in the answer rather than stopping the take: the ordinary way to get one is a member who
 * asked and was then renamed or removed from the declaration, and one such ask must not hold up everyone else's.
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
  const admitted = queue.waiting.filter((ask) => admitsAnAskToTheOwner({ ask, members }))
  const skipped = queue.waiting.filter((ask) => !admitsAnAskToTheOwner({ ask, members }))
  if (admitted.length === 0) return { refused: `${theSkipsSaid(skipped, members).join('. ')}. Nothing was taken.` }
  const row = { kind: ASKS_TAKEN, asks: admitted.map((ask) => ask.id), at: host.clock.now(), by: taken.member, session: taken.session }
  const kept = await appendAtLength(host, row, stored.length, '')
  if ('refused' in kept) return kept
  return { told: theBatchOffered(admitted, kept.position, skipped, members) }
}

/** Why each of `skipped` may not be handed over, in the gate's own words: one sentence an ask. */
const theSkipsSaid = (skipped: readonly AnAsk[], members: readonly string[]): string[] =>
  skipped.map((ask) => `ask ${String(ask.id)} is not one this queue can hand over: ${whyNotAdmitted(ask, members) ?? ''}`)

/** Why a batch already taken holds the queue, or undefined when the waiting asks may be taken. */
function theHeldBatch(queue: TheQueue, now: number): string | undefined {
  if (queue.claim === null || !withinItsWindow(queue.claim, now)) return undefined
  const minutes = Math.floor((now - queue.claim.at) / MINUTE_MS)
  return (
    `batch ${String(queue.claim.id)} was taken ${String(minutes)} minute(s) ago and is not settled, so the owner is still ` +
    `looking at it. Settle it with the ids they ticked, or take again once ${THE_WINDOW} have passed.`
  )
}

/** What `take_the_owners_asks` answers: one batch, each ask with its id for a menu option, and how to settle it. */
function theBatchOffered(waiting: readonly AnAsk[], batch: number, skipped: readonly AnAsk[], members: readonly string[]): string {
  const one = waiting.length === 1
  return [
    `${String(waiting.length)} queued ${one ? 'ask' : 'asks'}, oldest first. Offer them to the owner as ONE multi-select menu, ` +
      `at most ${String(MENU_OPTIONS_MAX)} options a question and more questions in the same menu when there are more, each question's text its own. ` +
      'Each ask is one option, posted exactly as given below: its label, and its description. ' +
      `Then settle batch ${String(batch)} with the ids the owner ticked: a settle is checked against the host's own answer to that menu.`,
    ...waiting.map((ask) => `${theLineOf(ask)}\n  label: ${JSON.stringify(theOptionOf(ask).label)}\n  description: ${JSON.stringify(theOptionOf(ask).description)}`),
    ...theSkipsOffered(skipped, members),
  ].join('\n')
}

/** The lines a take says of the asks it will not hand over: each named, with the gate's own reason, and kept out of the menu. */
function theSkipsOffered(skipped: readonly AnAsk[], members: readonly string[]): string[] {
  if (skipped.length === 0) return []
  const them = skipped.length === 1 ? 'it' : 'them'
  return [
    `${String(skipped.length)} ${skipped.length === 1 ? 'ask' : 'asks'} this queue will not hand over, and no menu should offer ${them}:`,
    ...skipped.map((ask) => `${theLineOf(ask)} — ${whyNotAdmitted(ask, members) ?? ''}`),
  ]
}

/** The batch a call names, or why it is not one this queue may settle: an id it never took, or one a settle already names. */
function theBatchACallNames(args: Readonly<Record<string, unknown>>, stored: readonly StoredRow[]): { readonly batch: ABatch } | { readonly refused: string } {
  const batch = args['batch']
  if (!isPosition(batch)) return { refused: 'batch is the id take_the_owners_asks answered, as a whole number' }
  const rows = theRowsIn(stored)
  const held = rows.batches.find((one) => one.id === batch)
  if (held === undefined) return { refused: `batch ${String(batch)} is not a batch this queue took` }
  if (rows.settled.some((one) => one.batch === held.id)) {
    return { refused: `batch ${String(batch)} was already settled, so it stands once: take the asks again for a new batch. Nothing was settled.` }
  }
  return { batch: held }
}

/** The ids a call names as the owner's yes, or why they are not ids of `claim`. */
function theTickedIn(args: Readonly<Record<string, unknown>>, claim: ABatch): readonly number[] | string {
  const yes = args['yes']
  if (!Array.isArray(yes) || !yes.every(isPosition)) return 'yes is the ids the owner ticked, as whole numbers'
  const unknown = (yes as number[]).find((id) => !claim.asks.includes(id))
  return unknown === undefined ? (yes as number[]) : `${String(unknown)} is not an ask of batch ${String(claim.id)}`
}

/**
 * `settle_the_owners_asks`: the batch off, with what the owner ticked, and the rest waiting again. Refused unless a menu closed in
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
  const menu = theMenuTheSettleStandsOn(settled.menus, claim.batch)
  if (typeof menu === 'string') return { refused: menu }
  const yes = theTickedIn(args, claim.batch)
  if (typeof yes === 'string') return { refused: yes }
  const unticked = theTicksTheMenuDoesNotHold(yes, menu, theRowsIn(stored).asks)
  if (unticked !== undefined) return { refused: unticked }
  const row = { kind: ASKS_SETTLED, batch: claim.batch.id, yes, at: host.clock.now(), by: settled.member }
  const kept = await appendAtLength(host, row, stored.length, '')
  if ('refused' in kept) return kept
  const back = claim.batch.asks.filter((id) => !yes.includes(id)).length
  return { told: `Batch ${String(claim.batch.id)} settled: ${String(yes.length)} the owner ticked, ${String(back)} back in the queue.` }
}

/**
 * The options the owner picked in the menu a settle stands on, or why there is none to stand on: no menu closed in the
 * session that took the batch since it took it, or the host's answer to it was not kept. Not kept refuses every settle,
 * an empty yes included, because nothing then says what the owner answered (martha#608).
 */
function theMenuTheSettleStandsOn(menus: TheOwnersMenus | undefined, batch: ABatch): readonly APostedOption[] | string {
  if (menus === undefined) {
    return `settle_the_owners_asks is refused: this launch keeps no record of menus, so nothing shows batch ${String(batch.id)} was ever offered.`
  }
  const closed = menus.lastClosed(batch.session)
  if (closed === null || closed.at <= batch.at) {
    return (
      `settle_the_owners_asks is refused: no menu has closed in the session that took batch ${String(batch.id)} since it was taken, so ` +
      'nobody has offered it to the owner. Offer the batch as one menu, then settle it.'
    )
  }
  if (closed.picked !== undefined) return closed.picked
  return (
    `settle_the_owners_asks is refused: the host's answer to the last menu in the session that took batch ${String(batch.id)} was not kept, ` +
    'so nothing says what the owner ticked. Offer the batch again as one menu, then settle it.'
  )
}

/**
 * Why the ids a settle names are not what the owner picked, or undefined when every one is (martha#608). Each id must be
 * an option the owner picked whose label opens with that id and whose description is that ask's own line, exactly as
 * the take printed it; and no picked option may stand for two asks.
 */
function theTicksTheMenuDoesNotHold(yes: readonly number[], picked: readonly APostedOption[], asks: readonly AnAsk[]): string | undefined {
  const two = picked.find((option) => aLabelForTwoAsks(option.label))
  if (two !== undefined) return `the owner picked ${JSON.stringify(two.label)}, which stands for more than one ask, so it settles none. Nothing was settled.`
  for (const id of yes) {
    const option = picked.find((one) => one.label.startsWith(theIdOpening(id)))
    if (option === undefined) return `${String(id)} is not an option the owner picked in the menu. Nothing was settled.`
    const ask = asks.find((one) => one.id === id)
    if (ask === undefined || option.description !== theLineOf(ask)) {
      return `the option the owner picked for ${String(id)} does not carry ask ${String(id)}'s own line as its description, so it is not that ask. Nothing was settled.`
    }
  }
  return undefined
}

/** How a label opens for the ask with this id: what a take tells the member to post, and what a settle reads. */
const theIdOpening = (id: number): string => `${String(id)}. `

/** Another id's opening anywhere in a text: digits, then the opening's own dot and space. */
const ANOTHER_ID = /\d+\. /u

/** Whether a label that opens with an ask's id carries another id, or the joiner, after it: it would stand for two asks. */
function aLabelForTwoAsks(label: string): boolean {
  const opening = new RegExp(`^${ANOTHER_ID.source}`, 'u').exec(label)
  if (opening === null) return false
  const rest = label.slice(opening[0].length)
  return ANOTHER_ID.test(rest) || rest.includes(PICK_JOINER)
}

/** The option a take tells the member to post for one ask: its id and question as the label, its line as the description. */
export const theOptionOf = (ask: AnAsk): APostedOption => ({ label: `${theIdOpening(ask.id)}${ask.question}`, description: theLineOf(ask) })

// --- what a menu's closing is, and what the owner picked in it ---------------------

/** One option of a menu, as the member posted it: what the owner reads, and what the host reports back when ticked. */
export interface APostedOption {
  readonly label: string
  readonly description: string
}

/** A menu the host closed: when, and the options the owner picked, or no `picked` when the answer could not be kept. */
export interface AMenuClosed {
  readonly at: number
  /** Every posted option the owner picked, over all of the menu's questions. Absent: the answer was not kept. */
  readonly picked?: readonly APostedOption[]
}

/** A call's answer as the relay hands it to the crew: the tool, the input the host posted, and the host's own answer. */
export interface ACallAnswered {
  readonly tool: string
  readonly input?: unknown
  readonly answer?: unknown
}

/**
 * What the launcher keeps of the menus its host closed: the last one in each session, with what the host's own answer
 * says the owner picked (martha#608). Kept in memory on purpose: a closing is about a session that is running now, and a
 * refresh loses it, so the settle after a refresh is refused rather than trusted. One slot a session: a later menu
 * replaces the earlier one.
 */
export interface TheOwnersMenus {
  /** The menu that last closed in `session`; null when none has. */
  lastClosed(session: string): AMenuClosed | null
  /** The launcher saw the host answer one of its calls: the menu tool's answer is the one this keeps. */
  noteTheCallsAnswer(call: ACallAnswered, session: string): void
}

/** The record a launcher keeps, over the clock the launcher reads. */
export function menusTheLauncherKeeps(clock: { now(): number }): TheOwnersMenus {
  const closed = new Map<string, AMenuClosed>()
  return {
    lastClosed: (session) => closed.get(session) ?? null,
    noteTheCallsAnswer: (call, session) => {
      if (call.tool !== MENU_TOOL) return
      const picked = thePicksIn(call.input, call.answer)
      closed.set(session, picked === undefined ? { at: clock.now() } : { at: clock.now(), picked })
    },
  }
}

/**
 * What the host puts between the labels of a multi-select answer, as recorded on Claude Code 2.1.327
 * (./recorded_menu_answers.json): the picks in the order the owner ticked them, not the order they were posted.
 */
export const PICK_JOINER = ', '

/** The most options the host takes in one question of its menu: what a take tells the member, and what the reader tries. */
export const MENU_OPTIONS_MAX = 4

/**
 * The options the owner picked, read from the host's own answer to the menu, never from the member's word (martha#608);
 * undefined when the answer cannot be kept.
 *
 * What the recording (./recorded_menu_answers.json, Claude Code 2.1.327, driven at its terminal) shows, and why this
 * reads it the way it does:
 * 1. The answer the relay hands over carries `result.answers`: one string per question, keyed by the question's text.
 * 2. A multi-select question's string is its picked labels joined by PICK_JOINER, in the order the owner ticked them.
 *    So nothing is split: every ordering of every subset of the posted options is joined and compared whole, and a
 *    label that itself holds the joiner can only match the option it is.
 * 3. An "Other" answer is the owner's typed words, bare, with nothing in `annotations` to say so. A string no subset
 *    matches is therefore read as the owner's words: that question picks nothing, and an id never comes from a box
 *    the owner typed in.
 * 4. A menu the owner cancels answers with an error text and no `answers`, so it is not kept.
 * Not kept, too: two posted questions with the same text (the answers are keyed by text), a posted question the
 * answer has no string for, and a string more than one ordering of the options matches.
 */
export function thePicksIn(input: unknown, answer: unknown): readonly APostedOption[] | undefined {
  const questions = thePostedQuestions(input)
  const answers = isARecord(answer) && isARecord(answer['result']) ? answer['result']['answers'] : undefined
  if (questions === undefined || !isARecord(answers)) return undefined
  if (new Set(questions.map((one) => one.question)).size !== questions.length) return undefined
  const picked: APostedOption[] = []
  for (const one of questions) {
    const of_one = thePicksOfOne(one, answers[one.question])
    if (of_one === undefined) return undefined
    picked.push(...of_one)
  }
  return picked
}

/** One question's picks: the one ordering of its options its answer joins to, none for the owner's words, undefined when unreadable. */
function thePicksOfOne(question: APostedQuestion, said: unknown): readonly APostedOption[] | undefined {
  if (typeof said !== 'string') return undefined
  const matching = everyOrderingOf(question.options).filter((ordering) => ordering.map((option) => option.label).join(PICK_JOINER) === said)
  return matching.length > 1 ? undefined : (matching[0] ?? [])
}

/** One posted question: its text and its options, as the member posted them. */
interface APostedQuestion {
  readonly question: string
  readonly options: readonly APostedOption[]
}

const isARecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isAnOption = (value: unknown): value is APostedOption =>
  isARecord(value) && typeof value['label'] === 'string' && typeof value['description'] === 'string'

/** The menu's questions as the member posted them, or undefined when the input is not a menu this reader can hold. */
function thePostedQuestions(input: unknown): readonly APostedQuestion[] | undefined {
  const questions = isARecord(input) ? input['questions'] : undefined
  if (!Array.isArray(questions)) return undefined
  const held = questions.filter(
    (one): one is APostedQuestion =>
      isARecord(one) && typeof one['question'] === 'string' && Array.isArray(one['options']) && one['options'].length <= MENU_OPTIONS_MAX && one['options'].every(isAnOption),
  )
  return held.length === questions.length ? held : undefined
}

/** Every ordering of every non-empty subset of `options`: at most 64 for the host's most options a question. */
function everyOrderingOf(options: readonly APostedOption[]): (readonly APostedOption[])[] {
  return options.flatMap((first, at) => {
    const rest = options.filter((_, other) => other !== at)
    return [[first], ...everyOrderingOf(rest).map((tail) => [first, ...tail])]
  })
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
  if (ask.question === '') return 'its text is empty'
  const { label } = theOptionOf(ask)
  if (aLabelForTwoAsks(label)) return `its menu option ${JSON.stringify(label)} would read as more than one ask, because its text holds another id or ${JSON.stringify(PICK_JOINER)}: ask it again without either`
  return ask.removes === undefined ? undefined : whyTheBranchIsRefused(ask.removes.branch)
}

/**
 * Why the branch a removal names may not be handed over, in the gate's own words: the question's own rule, applied to
 * the branch, which reaches the same menu (martha#391). A row a shell wrote straight into the stream is refused here.
 */
function whyTheBranchIsRefused(branch: string): string | undefined {
  if (branch.length > MAX_ASK) return `its branch is longer than ${String(MAX_ASK)} characters`
  if (CONTROL.test(branch)) return 'its branch carries a control or hidden character'
  return branch === '' ? 'its branch is empty' : undefined
}
