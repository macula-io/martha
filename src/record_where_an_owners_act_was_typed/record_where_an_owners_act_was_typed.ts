// Where each of the owner's own acts was typed, kept so a record no act wrote can be seen (martha#619, design r=3).
//
// The records the owner's acts write stay exactly as they were: approvals.jsonl and owner_keys.jsonl are read by
// parsers that refuse a whole file over one field they do not know, so nothing is added to them. Beside them, one
// append-only log, owner_acts.jsonl, names each line an act wrote: the act, the file, the line's 0-based position, the
// sha256 of the line's bytes as written (without its newline), when, and where it was typed (the terminal on the act's
// input and its session). A record line is read three ways: an act, when a log entry names that file, that position
// and that hash, all three; history, when it was in the file before the log began; or written without the martha
// command, when nothing names it.
//
// The record is written first and its log entry after it. A crash between the two leaves the record reading "written
// without the martha command": the log never claims an act it did not see finish.
//
// THE CUTOVER. When the log is first made, it keeps, for each record file, how many lines it held and the sha256 of
// those lines. Lines below that count read as history before the cutover, and only while the hash still matches: an
// edited history reads as changed. Time cannot draw this line, because a forged line can carry any time; position can.
// Lines written before the cutover is taken count as history, whoever wrote them: that is the same-user limit below.
// A cutover taken after the first approval it would cover is named as late, so removing the log to take a new one,
// which would launder a forged line into history, is shown rather than hidden.
//
// What this is, said plainly (Raf, 2026-11-18, "Speed bumps, said plainly"): a member runs as the owner's own OS user
// and can append to this log, or remove it, as it can write the records themselves. This makes a forged record
// visible in the plain case; it is a speed bump, not a wall.

import { createHash } from 'node:crypto'

/** Where an act was typed: the terminal on its standard input, and its session; either null when it cannot be told. */
export interface SeenFrom {
  readonly tty: string | null
  readonly session: number | null
}

/** One entry of the log: the line an act wrote, exactly, and where the act was typed. */
export interface AnOwnersActLogged {
  readonly act: string
  readonly file: string
  readonly position: number
  readonly sha256: string
  readonly at: string
  readonly seen_from: SeenFrom
}

/** What the log kept of each record file when it began: its line count and the sha256 of those lines. */
export interface TheCutover {
  readonly taken_at: string
  readonly files: Readonly<Record<string, { readonly lines: number; readonly sha256: string }>>
}

/** How one record line reads. */
export type HowALineReads =
  | { readonly kind: 'act'; readonly act: AnOwnersActLogged }
  | { readonly kind: 'history'; readonly before: string }
  | { readonly kind: 'history_changed'; readonly before: string }
  | { readonly kind: 'without_the_martha_command' }

/** The log as read: its entries, and the 1-based numbers of the lines that are not entries. */
export interface TheLogRead {
  readonly entries: readonly AnOwnersActLogged[]
  readonly unreadable: readonly number[]
}

export const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** The sha256 of a file's first `count` lines, as the cutover keeps it. */
const prefixHashOf = (lines: readonly string[], count: number): string => sha256Of(lines.slice(0, count).join('\n'))

/** The cutover over these record files as they are now, taken at `taken_at`. */
export function theCutoverOver(files: Readonly<Record<string, readonly string[]>>, taken_at: string): TheCutover {
  return { taken_at, files: Object.fromEntries(Object.entries(files).map(([file, lines]) => [file, { lines: lines.length, sha256: prefixHashOf(lines, lines.length) }])) }
}

/** The entries for the lines an act added to a file: every line from `before` on, each by its own position and bytes. */
export function theEntriesFor(act: string, file: string, lines: readonly string[], before: number, at: string, seen_from: SeenFrom): AnOwnersActLogged[] {
  return lines.slice(before).map((line, index) => ({ act, file, position: before + index, sha256: sha256Of(line), at, seen_from }))
}

/** The log's lines read: an unreadable line is named by number and vouches for nothing. */
export function theLogIn(text: string): TheLogRead {
  const entries: AnOwnersActLogged[] = []
  const unreadable: number[] = []
  text.split('\n').forEach((line, index) => {
    if (line === '') return
    const entry = anEntryIn(line)
    if (entry === undefined) unreadable.push(index + 1)
    else entries.push(entry)
  })
  return { entries, unreadable }
}

function anEntryIn(line: string): AnOwnersActLogged | undefined {
  const held = parsedOrUndefined(line)
  if (typeof held !== 'object' || held === null) return undefined
  const { act, file, position, sha256, at, seen_from } = held as Record<string, unknown>
  if (![act, file, sha256, at].every((field) => typeof field === 'string') || !isAPosition(position)) return undefined
  const seen = aSeenFromIn(seen_from)
  return seen === undefined ? undefined : { act: act as string, file: file as string, position: position as number, sha256: sha256 as string, at: at as string, seen_from: seen }
}

function parsedOrUndefined(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return undefined
  }
}

const isAPosition = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** Where an entry says its act was typed, or undefined when it does not say it in the log's own shape. */
function aSeenFromIn(value: unknown): SeenFrom | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { tty, session } = value as Record<string, unknown>
  const ttyHolds = tty === null || typeof tty === 'string'
  const sessionHolds = session === null || (typeof session === 'number' && Number.isInteger(session))
  return ttyHolds && sessionHolds ? { tty, session } : undefined
}

/**
 * How each line of a record file reads against the log and its cutover. It only reads: it never refuses a record, and
 * a line its own parser refuses stays refused whatever this says of it.
 */
export function howTheLinesRead(file: string, lines: readonly string[], log: TheLogRead, cutover: TheCutover | undefined): HowALineReads[] {
  const kept = cutover?.files[file]
  const historyHolds = kept === undefined || (lines.length >= kept.lines && prefixHashOf(lines, kept.lines) === kept.sha256)
  return lines.map((line, position): HowALineReads => {
    // The log first: a line an act wrote is that act's, even at a position the cutover counted, as a whole record
    // rewritten by its act (the kept shapes) is. Only a line no entry names falls back to history.
    const sha256 = sha256Of(line)
    const act = log.entries.find((entry) => entry.file === file && entry.position === position && entry.sha256 === sha256)
    if (act !== undefined) return { kind: 'act', act }
    if (cutover !== undefined && kept !== undefined && position < kept.lines) {
      return historyHolds ? { kind: 'history', before: cutover.taken_at } : { kind: 'history_changed', before: cutover.taken_at }
    }
    return { kind: 'without_the_martha_command' }
  })
}

/** The line the owner reads for one record line. */
export function theLineFor(how: HowALineReads): string {
  if (how.kind === 'act') return `typed at ${how.act.seen_from.tty ?? 'no terminal'} (session ${how.act.seen_from.session ?? 'unknown'}), ${how.act.at}`
  if (how.kind === 'history') return `history before ${how.before}`
  if (how.kind === 'history_changed') return `history before ${how.before}, CHANGED since: these lines are not what they were when Martha began recording`
  return 'WRITTEN WITHOUT THE MARTHA COMMAND: no act of yours recorded writing this line'
}

/** The line that names a late cutover: one taken after the first approval it covers, as a removed log would be. */
export function aLateCutover(cutover: TheCutover, first_approved_at: string | undefined): string | undefined {
  if (first_approved_at === undefined || cutover.taken_at <= first_approved_at) return undefined
  return `Martha began recording where your acts were typed at ${cutover.taken_at}, after your first approval (${first_approved_at}): if you have run approve since an earlier ${cutover.taken_at.slice(0, 10)}, the record of where it was typed was removed and begun again.`
}
