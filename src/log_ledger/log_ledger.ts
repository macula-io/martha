// The ledger of a work package: what its members reached, and what they sent.
//
// Two kinds of row live here, in one append-only stream per package.
//
//   MILESTONES a member keeps as it works: a checkpoint reached, a review round
//   closed, a release shipped, a fix shipped after a release.
//
//   OUTWARD ACTS: a push, a handoff, a room message, a tag. Each act gets its row
//   BEFORE it runs (#15 finding 2, "commit before dispatch"). If the store does
//   not keep that row, the act does not run. Its outcome is a second row, written
//   after it. So when a member is refreshed or handed over mid-act, its successor
//   finds an act that was sent and has no outcome, and checks what happened
//   instead of sending it again. That is the mechanical half of revalidating on
//   resume (#3).
//
//   Where that holds: for every act sent through sendOutwardAct, which is the
//   only way this slice lets an act out. A slice that sends a kind of act (a
//   push, a room message) routes it through sendOutwardAct when it lands; until
//   then nothing sends one at all.
//
// A package is an issue, owner/repo#n, and its name is checked before it names
// a stream.
//
// Nothing here rewrites or removes a row. An outcome names the row of the act it
// concludes; the store's expected-length append makes sure that two successors
// concluding the same act cannot both be kept.
//
// The ledger reaches the coding tool only through the host contract's clock and
// rows, so it runs unchanged on every host.

import type { HostContract, Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_NOT_DURABLE, ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'

/** The milestones a member keeps on a package. */
export const MILESTONES = [
  'checkpoint_reached',
  'review_round_closed',
  'release_shipped',
  'fix_shipped_after_release',
] as const
export type Milestone = (typeof MILESTONES)[number]

/** The acts that leave the member's own session, and so are announced first. */
export const OUTWARD_ACTS = ['push', 'handoff', 'room_message', 'tag'] as const
export type OutwardActKind = (typeof OUTWARD_ACTS)[number]

const ACT_ANNOUNCED = 'act_announced'
const ACT_CONCLUDED = 'act_concluded'

/** Every kind of row the ledger writes. */
export const LEDGER_ROW_KINDS = [...MILESTONES, ACT_ANNOUNCED, ACT_CONCLUDED] as const

/** An outward act: its kind, and what it acts on, in the member's own words. */
export type OutwardAct = {
  readonly kind: OutwardActKind
  readonly what: string
}

/** How an act ended, as the member who saw it end says. */
export type Outcome = {
  readonly succeeded: boolean
  readonly detail: string
}

type RowCommon = {
  readonly package: string
  readonly member: string
  /** Milliseconds since the epoch, from the host's clock. */
  readonly at: number
}

export type MilestoneRow = RowCommon & {
  readonly kind: Milestone
  readonly note: string
}

export type ActAnnouncedRow = RowCommon & {
  readonly kind: typeof ACT_ANNOUNCED
  readonly act: OutwardAct
}

export type ActConcludedRow = RowCommon & {
  readonly kind: typeof ACT_CONCLUDED
  /** The position of the act's announced row in this package's ledger. */
  readonly announced_at: number
  readonly outcome: Outcome
}

export type LedgerRow = MilestoneRow | ActAnnouncedRow | ActConcludedRow

/** An act that was sent and whose outcome no member has recorded. */
export interface ActAwaitingOutcome {
  readonly announced_at: number
  readonly member: string
  readonly act: OutwardAct
  readonly at: number
}

/** What the ledger needs of a host: its clock and its rows. */
export type LedgerHost = Pick<HostContract, 'clock' | 'stores'>

interface Work {
  readonly package: string
  readonly member: string
}

// A work package is an issue: owner/repo#n, as GitHub names it. Nothing else is
// one, and refusing everything else here keeps a package name from steering
// where its stream lives.
const WORK_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.+#)[A-Za-z0-9._-]+#[1-9][0-9]*$/

/** The stream a package's ledger lives in; refuses a name that is not owner/repo#n. */
export const ledgerStreamOf = (work_package: string): string => {
  if (!WORK_PACKAGE.test(work_package)) throw new Error(`${JSON.stringify(work_package)} is not a work package (owner/repo#n)`)
  return `ledger/${work_package}`
}

// --- reading --------------------------------------------------------------------

const isText = (value: unknown): value is string => typeof value === 'string'
const isPosition = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

const hasCommon = (row: Row): boolean => isText(row['package']) && isText(row['member']) && isPosition(row['at'])

const isOutwardAct = (value: unknown): value is OutwardAct =>
  typeof value === 'object' &&
  value !== null &&
  (OUTWARD_ACTS as readonly unknown[]).includes((value as Row)['kind']) &&
  isText((value as Row)['what'])

const isOutcome = (value: unknown): value is Outcome =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Row)['succeeded'] === 'boolean' &&
  isText((value as Row)['detail'])

const isLedgerRow = (row: Row): row is LedgerRow => {
  if (!hasCommon(row)) return false
  if ((MILESTONES as readonly unknown[]).includes(row['kind'])) return isText(row['note'])
  if (row['kind'] === ACT_ANNOUNCED) return isOutwardAct(row['act'])
  if (row['kind'] === ACT_CONCLUDED) return isPosition(row['announced_at']) && isOutcome(row['outcome'])
  return false
}

interface PlacedRow {
  readonly position: number
  readonly row: LedgerRow
}

// A row the ledger cannot read is refused, never skipped: skipping it could hide
// an act that was sent, and a successor would send it again. So is a row filed
// under another package's stream: its positions would be read as this one's.
const placed = (work_package: string, stored: StoredRow): PlacedRow => {
  if (!isLedgerRow(stored.row)) throw new Error(`row ${stored.position} of ${work_package} is not a ledger row`)
  if (stored.row.package !== work_package) {
    throw new Error(`row ${stored.position} of ${work_package} belongs to ${stored.row.package}`)
  }
  return { position: stored.position, row: stored.row }
}

const placedRows = async (host: LedgerHost, work_package: string): Promise<readonly PlacedRow[]> =>
  (await host.stores.rows.read(ledgerStreamOf(work_package))).map((stored) => placed(work_package, stored))

/** Every row of a package's ledger, oldest first. */
export async function readLedger(host: LedgerHost, work_package: string): Promise<readonly LedgerRow[]> {
  return (await placedRows(host, work_package)).map(({ row }) => row)
}

const concludedPositions = (rows: readonly PlacedRow[]): ReadonlySet<number> =>
  new Set(rows.flatMap(({ row }) => (row.kind === ACT_CONCLUDED ? [row.announced_at] : [])))

/** Every act of a package that was sent and has no outcome yet, oldest first. */
export async function actsAwaitingOutcome(
  host: LedgerHost,
  work_package: string,
): Promise<readonly ActAwaitingOutcome[]> {
  const rows = await placedRows(host, work_package)
  const concluded = concludedPositions(rows)
  return rows.flatMap(({ position, row }) =>
    row.kind === ACT_ANNOUNCED && !concluded.has(position)
      ? [{ announced_at: position, member: row.member, act: row.act, at: row.at }]
      : [],
  )
}

// --- writing --------------------------------------------------------------------

// Async on purpose: a package name ledgerStreamOf refuses becomes a rejection
// of this promise, never a throw before the caller's handler is attached.
const keep = async (host: LedgerHost, row: LedgerRow, expected_length?: number): Promise<number> =>
  host.stores.rows.append(ledgerStreamOf(row.package), row, expected_length)

/** Keeps a milestone of a package. */
export async function noteMilestone(
  host: LedgerHost,
  input: Work & { readonly milestone: Milestone; readonly note: string },
): Promise<void> {
  await keep(host, {
    kind: input.milestone,
    package: input.package,
    member: input.member,
    at: host.clock.now(),
    note: input.note,
  })
}

const refusalToConclude = (rows: readonly PlacedRow[], announced_at: number): string | undefined => {
  const announced = rows.find(({ position }) => position === announced_at)
  if (announced?.row.kind !== ACT_ANNOUNCED) return `no act was announced at row ${announced_at}`
  if (concludedPositions(rows).has(announced_at)) return `the act at row ${announced_at} is already concluded`
  return undefined
}

const streamMoved = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === ROW_STREAM_MOVED

/**
 * How many times concluding reads the stream again after it moved. Each attempt
 * follows a row another writer kept; a stream that moves this often while one
 * outcome is being kept is reported, not chased.
 */
export const CONCLUDE_ATTEMPTS = 5

/**
 * Records the outcome of an act announced at `announced_at`. Used by the member
 * that sent it, and by a successor that checked an act left awaiting.
 *
 * The outcome is kept only if no row landed since the check that the act is
 * still awaiting; if one did, the check runs again on what is there now, at
 * most CONCLUDE_ATTEMPTS times.
 */
export async function concludeAct(
  host: LedgerHost,
  input: Work & { readonly announced_at: number; readonly outcome: Outcome },
): Promise<void> {
  for (let attempt = 1; attempt <= CONCLUDE_ATTEMPTS; attempt += 1) {
    const rows = await placedRows(host, input.package)
    const refusal = refusalToConclude(rows, input.announced_at)
    if (refusal !== undefined) throw new Error(refusal)
    const row: ActConcludedRow = {
      kind: ACT_CONCLUDED,
      package: input.package,
      member: input.member,
      at: host.clock.now(),
      announced_at: input.announced_at,
      outcome: input.outcome,
    }
    try {
      await keep(host, row, rows.length)
      return
    } catch (error) {
      if (!streamMoved(error)) throw error
    }
  }
  throw new Error(
    `the outcome of the act at row ${input.announced_at} was not kept: ${input.package} kept moving for ${CONCLUDE_ATTEMPTS} attempts`,
  )
}

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The code of a failure before the act ran: it was never sent, and sending it again is safe. */
export const ACT_NOT_SENT = 'ACT_NOT_SENT'

/** The code of a failure after the act ran: it was sent, and its outcome is not in the ledger. */
export const OUTCOME_NOT_KEPT = 'OUTCOME_NOT_KEPT'

/** The position of a row the store left in the stream without making it durable, if that is why. */
const positionLeftBy = (cause: unknown): number | undefined => {
  const failure = cause as { code?: unknown; position?: unknown } | null
  return typeof failure === 'object' && failure !== null && failure.code === ROW_NOT_DURABLE && typeof failure.position === 'number'
    ? failure.position
    : undefined
}

/**
 * The act was never sent, because its row was not kept. The cause says why.
 *
 * `row_may_stand_at` is set when the store linked the row and could not make it
 * durable (ROW_NOT_DURABLE): the row may be read, as an act left awaiting, and
 * the store takes no more rows on that stream in this process. Do not send the
 * act again; whoever checks awaiting acts finds it was not sent and concludes it.
 */
export class ActNotSent extends Error {
  readonly code = ACT_NOT_SENT
  readonly row_may_stand_at: number | undefined

  constructor(act: OutwardAct, cause: unknown) {
    super(`the ${act.kind} was not sent: its row was not kept (${detailOf(cause)})`, { cause })
    this.name = 'ActNotSent'
    this.row_may_stand_at = positionLeftBy(cause)
  }
}

/**
 * The act was sent, and its outcome could not be kept. Never send it again:
 * check what happened, then record it with concludeAct.
 *
 * When the act itself failed, that failure is the cause, so it is not lost; the
 * reason the outcome was not kept is `keeping_error` either way. Read
 * `sent.succeeded` to know which `cause` holds: false, the act's own failure;
 * true, the same error as `keeping_error`.
 */
export class OutcomeNotKept extends Error {
  readonly code = OUTCOME_NOT_KEPT
  readonly announced_at: number
  readonly sent: { readonly succeeded: true; readonly result: string } | { readonly succeeded: false }
  readonly keeping_error: unknown

  constructor(input: {
    readonly act: OutwardAct
    readonly announced_at: number
    readonly sent: OutcomeNotKept['sent']
    readonly send_error?: unknown
    readonly keeping_error: unknown
  }) {
    super(
      `the ${input.act.kind} at row ${input.announced_at} was sent, and its outcome was not kept (${detailOf(input.keeping_error)})`,
      { cause: input.sent.succeeded ? input.keeping_error : input.send_error },
    )
    this.name = 'OutcomeNotKept'
    this.announced_at = input.announced_at
    this.sent = input.sent
    this.keeping_error = input.keeping_error
  }
}

/**
 * Sends an outward act: its row first, then the act, then its outcome.
 *
 * A caller can tell three failures apart, and each says what a retry may do:
 * - ActNotSent (ACT_NOT_SENT): the row was not kept, so `send` never ran.
 *   Sending again is safe, unless `row_may_stand_at` is set: then the row may
 *   stand as an act left awaiting, and the act is not sent again.
 * - the act's own error, unchanged: `send` failed, and that failure is the
 *   act's kept outcome.
 * - OutcomeNotKept (OUTCOME_NOT_KEPT): `send` ran and its outcome could not be
 *   kept, by a store failure or because a successor concluded the act first.
 *   The act stays awaiting until someone checks it. Never send it again.
 *
 * This is the only way the ledger lets an act out, so an act sent through it
 * always has its row first. An act that does not go through it has no row: the
 * slice that sends each kind of act (a push, a room message) routes it here
 * when that slice lands.
 */
export async function sendOutwardAct(
  host: LedgerHost,
  input: Work & { readonly act: OutwardAct },
  send: () => Promise<string>,
): Promise<string> {
  const announced_at = await keep(host, {
    kind: ACT_ANNOUNCED,
    package: input.package,
    member: input.member,
    at: host.clock.now(),
    act: input.act,
  }).catch((cause: unknown) => {
    throw new ActNotSent(input.act, cause)
  })

  const keepOutcome = async (outcome: Outcome, sent: OutcomeNotKept['sent'], send_error?: unknown) => {
    try {
      await concludeAct(host, { package: input.package, member: input.member, announced_at, outcome })
    } catch (keeping_error) {
      throw new OutcomeNotKept({ act: input.act, announced_at, sent, send_error, keeping_error })
    }
  }

  let result: string
  try {
    result = await send()
  } catch (send_error) {
    await keepOutcome({ succeeded: false, detail: detailOf(send_error) }, { succeeded: false }, send_error)
    throw send_error
  }
  await keepOutcome({ succeeded: true, detail: result }, { succeeded: true, result })
  return result
}
