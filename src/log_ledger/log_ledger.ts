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
// Nothing here rewrites or removes a row. An outcome names the row of the act it
// concludes; the store's expected-length append makes sure that two successors
// concluding the same act cannot both be kept.
//
// The ledger reaches the coding tool only through the host contract's clock and
// rows, so it runs unchanged on every host.

import type { HostContract, Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'

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

/** The stream a package's ledger lives in. */
export const ledgerStreamOf = (work_package: string): string => `ledger/${work_package}`

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
// an act that was sent, and a successor would send it again.
const placed = (work_package: string, stored: StoredRow): PlacedRow => {
  if (!isLedgerRow(stored.row)) throw new Error(`row ${stored.position} of ${work_package} is not a ledger row`)
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

const keep = (host: LedgerHost, row: LedgerRow, expected_length?: number): Promise<number> =>
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
 * Records the outcome of an act announced at `announced_at`. Used by the member
 * that sent it, and by a successor that checked an act left awaiting.
 *
 * The outcome is kept only if no row landed since the check that the act is
 * still awaiting; if one did, the check runs again on what is there now.
 */
export async function concludeAct(
  host: LedgerHost,
  input: Work & { readonly announced_at: number; readonly outcome: Outcome },
): Promise<void> {
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
  } catch (error) {
    if (!streamMoved(error)) throw error
    await concludeAct(host, input)
  }
}

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Sends an outward act: its row first, then the act, then its outcome.
 *
 * If the store does not keep the first row, `send` never runs and the refusal
 * reaches the caller. If `send` fails, the failure is kept as the outcome and
 * still reaches the caller. If the outcome cannot be kept, the act stays
 * awaiting, which is the truth: it was sent and its outcome is not recorded.
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
  })
  const conclude = (outcome: Outcome) => concludeAct(host, { ...input, announced_at, outcome })
  const sent = await send().catch(async (error: unknown) => {
    await conclude({ succeeded: false, detail: detailOf(error) })
    throw error
  })
  await conclude({ succeeded: true, detail: sent })
  return sent
}
