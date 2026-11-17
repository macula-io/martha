// The ledger of a work package: what its members reached, and what they sent.
//
// Two kinds of row live here, in one append-only stream per package.
//
//   MILESTONES a member keeps as it works: a checkpoint reached, a review round
//   closed, a release shipped, a fix shipped after a release. And one the tool a
//   member logs with never keeps: the verdict a VERDICT line gives, which is what
//   the landing reads (martha#350).
//
//   OUTWARD ACTS: a push, a handoff, a room message, a tag. Each act gets its row
//   BEFORE it runs (#15 finding 2, "commit before dispatch"). If the store does
//   not keep that row, the act does not run. Its outcome is a second row, written
//   after it. So when a member is refreshed or handed over mid-act, its successor
//   finds an act that was sent and has no outcome, and checks what happened
//   instead of sending it again. That is the mechanical half of revalidating on
//   resume (#3).
//
//   Where that holds: for every act sent through sendOutwardAct, or announced
//   with announceAct for an act that lands several packages at once. Those are
//   the only two ways the ledger lets an act out, and ../recover_a_failed_act is
//   the one caller of each that recovers a failure (martha#512).
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

/**
 * The milestones a member keeps on a package, and the two only another act keeps.
 *
 * A VERDICT line keeps `verdict_given` (martha#350): the verdict that ended a review round. The tool a member logs with
 * cannot write it: it maps its own events onto the milestones above (../keep_the_ledger) and this name is not among
 * them, so a review round a member logs passes no head. A line does write it, and the member that sends the line is not
 * checked (../send_a_crew_message, martha#253), so a verdict row can still be claimed: what this kind shuts is the log
 * path, not the say path.
 *
 * A landing keeps `package_landed` (martha#320's ruling): a package reaching the default branch is a fact about the
 * package, and it is what ends a package's waits. A member never writes it either, so a member cannot close every wait
 * on a package with one call.
 *
 * A resume keeps `package_resumed` (martha#512): whoever the crew's nudges go to lifts a package's pause, and only the
 * tool that checks that grant writes it (../recover_a_failed_act), so a member cannot lift its own package's pause.
 */
export const MILESTONES = [
  'checkpoint_reached',
  'review_round_closed',
  'release_shipped',
  'fix_shipped_after_release',
  'verdict_given',
  'package_landed',
  'package_resumed',
] as const
export type Milestone = (typeof MILESTONES)[number]

/**
 * The acts that leave the member's own session, or are done to it, and so are announced first. `refresh_forced` is the
 * second kind (martha#311): the launcher ends the member's running turn so its handover can run, which throws away
 * whatever that turn was doing, so a successor must see it among the acts left open.
 */
export const REFRESH_FORCED = 'refresh_forced'
export const OUTWARD_ACTS = ['push', 'handoff', 'room_message', 'tag', REFRESH_FORCED] as const
export type OutwardActKind = (typeof OUTWARD_ACTS)[number]

const ACT_ANNOUNCED = 'act_announced'
const ACT_CONCLUDED = 'act_concluded'
const RECOVERY_DECIDED = 'recovery_decided'

/**
 * The row a package's contract is kept on (martha#513): the version the package is held to, and the contract it holds.
 *
 * It is a row of the package's own append-only stream so that "a change is a new version, never an edit" is the store's
 * rule and not a writer's promise: a second contract is a second row, and the one before it stands. A package reads its
 * newest, and every later session reads the same one.
 *
 * The contract's own words are not judged here. The slice that writes a contract (../keep_the_package_contract) owns
 * its vocabulary, and this file owning it too would be the same decision kept twice; so the ledger holds the version,
 * a digest of the block and that block's own lines, which the slice reads back by the rule it was written by.
 */
export const CONTRACT_KEPT = 'contract_kept'

/**
 * The kinds of row the ledger writes.
 *
 * `recovery_decided` is the fourth (martha#512): what a package did about an act that failed, kept beside the act's own
 * two rows because it is a fact about the package and outlives the session that decided it. A successor reads the
 * attempt it paid for from there, so a restart or a refresh cannot buy a second one.
 */
export const LEDGER_ROW_KINDS = [...MILESTONES, ACT_ANNOUNCED, ACT_CONCLUDED, RECOVERY_DECIDED, CONTRACT_KEPT] as const

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

/**
 * The four things a package may do about an act that failed (martha#512), one attempt at most.
 *
 * `retried_once` is the only decision that sends the act again, and only after the inspection found it did not happen.
 * `concluded_from_the_inspection` is the act recorded from what was really found, which is how a timeout stops a
 * second send. `replanned` says the member takes the failure back into its own work; `paused` stops the package and
 * goes to the Supervisor. The names are the ledger's, as the acts' are: a row is read by every session of the crew.
 */
export const RECOVERY_DECISIONS = ['retried_once', 'concluded_from_the_inspection', 'replanned', 'paused'] as const
export type RecoveryDecision = (typeof RECOVERY_DECISIONS)[number]

/**
 * The decision a package made about an act that failed, with what it was read from: the class the failure was given
 * and the evidence for it, and what the inspection read and found. The class is a diagnosis, so its words belong to the
 * slice that makes it (../recover_a_failed_act); the ledger keeps the row and the decisions it must count.
 */
export type RecoveryRow = RowCommon & {
  readonly kind: typeof RECOVERY_DECIDED
  readonly act: OutwardAct
  readonly failure: { readonly class: string; readonly evidence: string }
  readonly inspection: { readonly read: string; readonly found: string }
  readonly decision: RecoveryDecision
}

/**
 * One version of a package's contract (martha#513): which version, a digest of the block it was read from, and the
 * block's own lines, so a later session reads the contract by the rule it was read by. A version is 1 for the first, and
 * one more than the version before it; a package whose newest row carries the digest a caller holds is already at it.
 */
export type ContractKeptRow = RowCommon & {
  readonly kind: typeof CONTRACT_KEPT
  readonly version: number
  readonly digest: string
  readonly block: readonly string[]
}

export type LedgerRow = MilestoneRow | ActAnnouncedRow | ActConcludedRow | RecoveryRow | ContractKeptRow

/** Whether a row of a package's ledger is a recovery it decided. */
export const isRecoveryRow = (row: LedgerRow): row is RecoveryRow => row.kind === RECOVERY_DECIDED

/** Whether a row of a package's ledger is a version of its contract. */
export const isContractKeptRow = (row: LedgerRow): row is ContractKeptRow => row.kind === CONTRACT_KEPT

/**
 * The attempts a package already paid for on one act: the recoveries that sent it again, counted over the package's
 * whole life (martha#512). The act is read as the member described it, its kind and its what, because the row of an act
 * that was never sent is not there to be named by; a successor counting from these rows cannot buy a second attempt with
 * a restart or a refresh.
 */
export const theAttemptsOn = (rows: readonly LedgerRow[], act: OutwardAct): number =>
  rows.filter(isRecoveryRow).filter((row) => row.act.kind === act.kind && row.act.what === act.what && row.decision === 'retried_once').length

/** The milestone a lifted pause is kept as (martha#512). */
export const PACKAGE_RESUMED: Milestone = 'package_resumed'

/**
 * The pause a package stands under, or undefined when it stands under none (martha#512): the latest recovery that
 * decided `paused`, when no resume was kept after it. Read from rows that outlive the session that paused, so a restart
 * or a refresh does not lift a pause; only a `package_resumed` row does.
 */
export function thePauseOn(rows: readonly LedgerRow[]): RecoveryRow | undefined {
  let pause: RecoveryRow | undefined
  for (const row of rows) {
    if (isRecoveryRow(row) && row.decision === 'paused') pause = row
    else if (row.kind === PACKAGE_RESUMED) pause = undefined
  }
  return pause
}

/** An act that was sent and whose outcome no member has recorded. */
export interface ActAwaitingOutcome {
  readonly announced_at: number
  readonly member: string
  readonly act: OutwardAct
  readonly at: number
}

/** What the ledger needs of a host: its clock, and the rows a package's stream is kept in. */
export type LedgerHost = Pick<HostContract, 'clock'> & { readonly stores: { readonly rows: HostContract['stores']['rows'] } }

interface Work {
  readonly package: string
  readonly member: string
}

// A work package is an issue: owner/repo#n, as GitHub names it. Nothing else is
// one, and refusing everything else here keeps a package name from steering
// where its stream lives.
export const WORK_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.+#)[A-Za-z0-9._-]+#[1-9][0-9]*$/

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

/** A failure as a recovery row keeps it: the class it was given and the evidence for it, each read as text. */
const isAFailureNote = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && isText((value as Row)['class']) && isText((value as Row)['evidence'])

/** What an inspection read and found, each read as text. */
const isAnInspection = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && isText((value as Row)['read']) && isText((value as Row)['found'])

const isARecovery = (row: Row): boolean =>
  isOutwardAct(row['act']) &&
  isAFailureNote(row['failure']) &&
  isAnInspection(row['inspection']) &&
  (RECOVERY_DECISIONS as readonly unknown[]).includes(row['decision'])

/** A version at or above one, as a contract's first version is. */
const isAVersion = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1

/** A contract's own block: lines, and not a record standing in for one. The slice that wrote it reads it back. */
const isAContractBlock = (value: unknown): boolean => Array.isArray(value) && value.every(isText)

const isAContractKept = (row: Row): boolean => isAVersion(row['version']) && isText(row['digest']) && isAContractBlock(row['block'])

const isLedgerRow = (row: Row): row is LedgerRow => {
  if (!hasCommon(row)) return false
  if ((MILESTONES as readonly unknown[]).includes(row['kind'])) return isText(row['note'])
  if (row['kind'] === ACT_ANNOUNCED) return isOutwardAct(row['act'])
  if (row['kind'] === ACT_CONCLUDED) return isPosition(row['announced_at']) && isOutcome(row['outcome'])
  if (row['kind'] === RECOVERY_DECIDED) return isARecovery(row)
  if (row['kind'] === CONTRACT_KEPT) return isAContractKept(row)
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

/**
 * Keeps what a package decided about an act that failed: the class the failure was given and its evidence, what the
 * inspection read and found, and the decision. A decision is a fact about the package, so it is a row of the package's
 * stream: the successor that picks the package up reads the attempt its predecessor already paid for, and a restart or
 * a refresh buys no second one (martha#512).
 */
export async function noteRecovery(
  host: LedgerHost,
  input: Work & {
    readonly act: OutwardAct
    readonly failure: { readonly class: string; readonly evidence: string }
    readonly inspection: { readonly read: string; readonly found: string }
    readonly decision: RecoveryDecision
  },
): Promise<void> {
  await keep(host, {
    kind: RECOVERY_DECIDED,
    package: input.package,
    member: input.member,
    at: host.clock.now(),
    act: input.act,
    failure: input.failure,
    inspection: input.inspection,
    decision: input.decision,
  })
}

/**
 * Keeps one version of a package's contract (martha#513): the version, a digest of the block the brief carries, and the
 * block's own lines. The row is the version — the store only appends, so a contract changed after this one is kept is a
 * second row and this one stands.
 */
export async function noteTheContract(
  host: LedgerHost,
  input: Work & { readonly version: number; readonly digest: string; readonly block: readonly string[] },
): Promise<void> {
  await keep(host, {
    kind: CONTRACT_KEPT,
    package: input.package,
    member: input.member,
    at: host.clock.now(),
    version: input.version,
    digest: input.digest,
    block: input.block,
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
    if (await keptUnlessMoved(host, row, rows.length)) return
  }
  throw new Error(
    `the outcome of the act at row ${input.announced_at} was not kept: ${input.package} kept moving for ${CONCLUDE_ATTEMPTS} attempts`,
  )
}

/** Keeps the outcome row at `length`: true when kept, false when a row landed first; any other failure throws. */
async function keptUnlessMoved(host: LedgerHost, row: ActConcludedRow, length: number): Promise<boolean> {
  try {
    await keep(host, row, length)
    return true
  } catch (error) {
    if (!streamMoved(error)) throw error
    return false
  }
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
 * `row_may_stand_at` is set when the store refused with ROW_NOT_DURABLE: a row
 * on this stream was linked and could not be made durable, and the store takes
 * no more rows on it in this process. The row at that position may be this
 * act's, or another act's whose append failed earlier: every later append to
 * the stream, of any act, is refused naming that same position. It may be read,
 * as an act left awaiting. Do not send this act again on this stream in this
 * process; whoever checks awaiting acts finds that one was not sent and
 * concludes it.
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
 * Announces an outward act: its row first, and only then may it run. Answers the row the act was kept at, or throws
 * ActNotSent when the store would not keep it, so a caller that could not announce knows the act did not run.
 *
 * It is apart from sendOutwardAct for an act that lands several packages at once (martha#256's batch landing and its
 * fast-forward): the act runs once, and every package it lands holds the announcement before it runs, so no package's
 * ledger is told afterwards that the act was sent. An act that is one package's alone goes through sendOutwardAct.
 */
export async function announceAct(host: LedgerHost, input: Work & { readonly act: OutwardAct }): Promise<number> {
  return keep(host, {
    kind: ACT_ANNOUNCED,
    package: input.package,
    member: input.member,
    at: host.clock.now(),
    act: input.act,
  }).catch((cause: unknown) => {
    throw new ActNotSent(input.act, cause)
  })
}

/**
 * Sends an outward act: its row first, then the act, then its outcome.
 *
 * A caller can tell three failures apart, and each says what a retry may do:
 * - ActNotSent (ACT_NOT_SENT): the row was not kept, so `send` never ran.
 *   Sending again is safe, unless `row_may_stand_at` is set: then a row, this
 *   act's or another act's on the same stream, may stand as an act left
 *   awaiting, and the store refuses the stream for the rest of the process.
 * - the act's own error, unchanged: `send` failed, and that failure is the
 *   act's kept outcome.
 * - OutcomeNotKept (OUTCOME_NOT_KEPT): `send` ran and its outcome could not be
 *   kept, by a store failure or because a successor concluded the act first.
 *   The act stays awaiting until someone checks it. Never send it again.
 *
 * With announceAct, this is the only way the ledger lets an act out, so an act
 * sent through it always has its row first. An act that does not go through
 * either has no row. ../recover_a_failed_act sends every announced act through
 * one of them (martha#512 slice 2).
 */
export async function sendOutwardAct(
  host: LedgerHost,
  input: Work & { readonly act: OutwardAct },
  send: () => Promise<string>,
): Promise<string> {
  const announced_at = await announceAct(host, input)

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
