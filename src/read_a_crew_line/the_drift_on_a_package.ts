// What one package's ledger shows of the crew's drift (martha#1010): the highest review round its HANDOFF and VERDICT
// lines named, and the longest of those lines as its row kept it.
//
// This exists so the owner is told when a crew slides into ever more rounds and ever longer hand-offs, without a member
// being asked to report a number about itself. Both numbers are read from rows the crew already writes: a HANDOFF or a
// VERDICT line keeps its row with the line as its note (`keepTheLinesRow`), and that row carries how many lines the
// message had, when the release that wrote it kept one. Nothing here judges a FAIL or counts mutants: those two trims
// live in the role cards, and leave no mechanical trace to count.
//
// The notices are words about what is about to be sent, never a refusal. A notice rides on the answer the sender reads,
// the way an over-long message does (../send_a_crew_message), and the message goes either way.

import { aMostIsSet, CREW_LINE_LINES_MOST, REVIEW_ROUNDS_MOST, type TheCrewsTrims } from '../declare_crew/the_crews_trims.ts'
import { isActAnnouncedRow, readLedger, VERDICT_GIVEN, type LedgerHost, type LedgerRow, type MilestoneRow } from '../log_ledger/log_ledger.ts'
import { REPO_NUMBERS } from '../spend_the_github_budget/the_repos_numbers.ts'
import { readACrewLine } from './read_a_crew_line.ts'
import type { CrewLineRead } from './read_a_crew_line.ts'

/** The two numbers a package's drift is read as, and the repo's three, in the words a notice prints them (martha#1010). */
export const ROUNDS = 'rounds'
export const LINES = 'lines'
export const DRIFT_NUMBERS = [ROUNDS, LINES, ...REPO_NUMBERS] as const
export type DriftNumber = (typeof DRIFT_NUMBERS)[number]
export type PackageNumber = typeof ROUNDS | typeof LINES

/** One package's drift, as its ledger shows it: the highest round a line named, and the longest line, each with who wrote it. */
export interface APackagesDrift {
  readonly package: string
  /** The round the line names, and the one nowhere when no line named one. */
  readonly rounds: number
  readonly rounds_member: string
  /** Milliseconds since the epoch, when the line that reached the highest round was kept. */
  readonly rounds_at: number
  /** The longest line any row kept, and 0 when no row kept one. */
  readonly longest: number
  readonly longest_member: string
  readonly longest_at: number
}

/** A package's drift from the rows its ledger holds: no round and no line counted when the rows carry none. */
export function driftOnAPackage(rows: readonly LedgerRow[], package_name: string): APackagesDrift {
  const drift = { package: package_name, rounds: 0, rounds_member: '', rounds_at: 0, longest: 0, longest_member: '', longest_at: 0 }
  for (const row of rows) {
    const kept = theLineARowKeeps(row)
    if (kept === null) continue
    const round = theRoundOf(kept.line)
    if (round !== null && round > drift.rounds) Object.assign(drift, { rounds: round, rounds_member: kept.member, rounds_at: kept.at })
    if (kept.lines > drift.longest) Object.assign(drift, { longest: kept.lines, longest_member: kept.member, longest_at: kept.at })
  }
  return { ...drift }
}

/** One package's drift, read from its ledger. */
export async function theDriftOf(host: LedgerHost, package_name: string): Promise<APackagesDrift> {
  return driftOnAPackage(await readLedger(host, package_name), package_name)
}

/** A line a row kept, and how many lines its message had: what the drift is read from. */
interface AKeptLine {
  readonly line: CrewLineRead
  readonly member: string
  readonly at: number
  readonly lines: number
}

/**
 * The crew line a row keeps, or null for a row that is not one: a VERDICT's milestone row, or the row a HANDOFF
 * announced. A row an earlier release wrote keeps no line count, and reads as no line at all, since 0 must stay
 * distinguishable from a one-line message.
 */
function theLineARowKeeps(row: LedgerRow): AKeptLine | null {
  const kept = theKeptTextOf(row)
  if (kept === null) return null
  const read = readACrewLine(kept.text).line
  if (read === null) return null
  return { line: read, member: row.member, at: row.at, lines: kept.lines }
}

/** The text a row keeps its line as, and how many lines its message had; null for a row that keeps no line. */
function theKeptTextOf(row: LedgerRow): { readonly text: string; readonly lines: number } | null {
  if (isAVerdictRow(row)) return { text: row.note, lines: row.lines ?? 0 }
  if (isActAnnouncedRow(row) && row.act.kind === 'handoff') return { text: row.act.what, lines: row.lines ?? 0 }
  return null
}

/** Whether a row is the milestone a VERDICT line keeps. */
const isAVerdictRow = (row: LedgerRow): row is MilestoneRow => row.kind === VERDICT_GIVEN

/** The round a line names, or null when it names none. */
export function theRoundOf(line: CrewLineRead): number | null {
  const named = line.keys['r']
  return named === undefined ? null : Number(named)
}

/** A line about to be sent, as the notices are read from it: its verb, the round it names, and how many lines it has. */
export interface ALineAboutToBeSent {
  readonly verb: string
  readonly round: number | null
  readonly lines: number
}

/**
 * What a send says about the crew's mosts, before the line goes out: one line for a round past `review_rounds_most`,
 * one for a message past `crew_line_lines_most`, and nothing for a number the declaration set to 0 or turned off with
 * false. The message is sent anyway.
 */
export function theDriftNotices(about: ALineAboutToBeSent, drift: APackagesDrift, trims: TheCrewsTrims): readonly string[] {
  const most = trims[REVIEW_ROUNDS_MOST]
  const rounds = [about.round ?? 0, drift.rounds]
  const lines_most = trims[CREW_LINE_LINES_MOST]
  return [
    ...(aMostIsSet(most) && Math.max(...rounds) > most ? [`this is round ${String(Math.max(...rounds))}; the crew's most is ${String(most)}.`] : []),
    ...(aMostIsSet(lines_most) && about.lines > lines_most
      ? [`this ${about.verb} is ${lineCountOfWords(about.lines)}; the crew's most is ${String(lines_most)}.`]
      : []),
  ]
}

/** How many lines a text has: what a message's row keeps, and what a notice counts. */
export const lineCountOf = (text: string): number => text.split('\n').length

/** A count of lines in the words a notice says it: one line is not one lines. */
const lineCountOfWords = (count: number): string => `${String(count)} ${count === 1 ? 'line' : LINES}`
