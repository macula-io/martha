// One member's row on the owner's dashboard, and the one writer that keeps it (martha#254).
//
// This exists so the owner can watch a crew work: who is working, on what, how far, what holds each one up, without
// asking anyone. The row is one per member of the declaration, never one per session, so a refresh takes the row
// over instead of adding a second one for the same member.
//
// A beat is a whole row, not a change: the writer writes every field every time, under a staging name and renamed
// into place, so a reader handed the file mid-write reads the row before it or the row after it and never half of
// either. Two beats cannot interleave into a row neither of them took, so a reader never merges fields.
//
// The newest `at` wins, and the WRITER settles it (r=1, O1): a beat taken earlier and landing later is dropped whole
// when it is offered, not blended into the row a newer beat already got there. A row is offered by the member's own
// launcher, the one process that hears every event of the session, and by nothing else.
//
// The row is never removed. A member that stops beating reads `offline` once OFFLINE_AFTER_MS has passed, which is
// the reader's word about a row that has gone quiet, not a state anyone writes.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { getuid } from 'node:process'

/** The states a row can be in, as the owner reads them. */
export const STATES = ['working', 'reviewing', 'waiting', 'needs-you', 'idle', 'parked'] as const
export type State = (typeof STATES)[number]

/** The state a member that never beat reads as. */
export const IDLE: State = 'idle'

/** What a row reads as once it has gone quiet, which no writer records: the reader's word about a stale beat. */
export const OFFLINE = 'offline' as const

/** Every state a reader can show: the six a writer records, and `offline`. */
export type ShownState = State | typeof OFFLINE

/** How often a member's launcher offers its beat, so a pane can tell a working member from a session that has died. */
export const BEAT_INTERVAL_MS = 5_000

/** How quiet a row must be to read `offline`: six beats missed, so a slow turn is never mistaken for a dead session. */
export const OFFLINE_AFTER_MS = BEAT_INTERVAL_MS * 6

/** A wait a member names: who holds it up, what for, and since when. */
export interface Waits {
  /** A person: the owner, the supervisor, or a member's name. */
  readonly on: string
  /** What it waits for, in a few words: a HANDOFF, a verdict, a menu, a yes. */
  readonly for: string
  /** Milliseconds since the epoch, when the wait began. */
  readonly since: number
}

/** What only the member's session knows, posted by the host's mod and written into the row by the launcher. */
export interface HostFacts {
  readonly model: string
  readonly provider: string
  readonly contextPercent: number | null
  readonly costUsd: number | null
}

/** One member's row, whole. */
export interface DashboardRow {
  readonly member: string
  readonly session: string
  /** Milliseconds since the epoch, when this beat was taken. */
  readonly at: number
  readonly state: State
  /** The package it holds, owner/repo#n, or '' when it holds none. */
  readonly holds: string
  readonly task: string
  readonly progress: { readonly step: number; readonly of: number }
  readonly waits: Waits | null
  /** What needs the owner, in the member's own words; '' when nothing does. */
  readonly needs: string
  readonly host: HostFacts
}

/** What one row is called in a refusal. */
const ONE_ROW = 'dashboard row'

/** The file one member's row is kept in: never a path, and never a dot a person or git could steer with. */
export function rowFileNameOf(member: string): string {
  return `${encodeURIComponent(member).replaceAll('.', '%2E')}.json`
}

/** The member a row file name keeps, or undefined when it is not one this slice writes. */
export function memberOfRowFileName(name: string): string | undefined {
  if (!name.endsWith('.json')) return undefined
  try {
    const member = decodeURIComponent(name.slice(0, -'.json'.length))
    return rowFileNameOf(member) === name ? member : undefined
  } catch {
    return undefined
  }
}

/** Only the owner may read or write a row. */
const ROW_FILE_MODE = 0o600

/** What starts a row's file while it is still being written, as the state files do. */
const STAGING_PREFIX = '.staging-'

/**
 * Keeps `row` as the member's row, whole: under a staging name beside it, every byte counted, then renamed into
 * place. A beat older than the one the row already holds is dropped whole, and nothing is written (r=1, O1).
 *
 * `why` is set when the beat was not kept, in words the member's launcher can show the owner; a beat the writer
 * dropped as older is not a failure, and says so.
 */
export function keepBeat(directory: string, row: DashboardRow): { readonly kept: boolean; readonly why?: string } {
  const path = join(directory, rowFileNameOf(row.member))
  const held = readBeat(path)
  if (held !== null && held.at >= row.at) return { kept: false, why: `a beat taken at ${held.at} is already here, and this one was taken at ${row.at}` }
  return keepWhole(path, `${JSON.stringify(row, null, 2)}\n`)
}

/** The member's row as it is, or null when it holds none; throws when the file is not a row only this user may read. */
export function beatOf(directory: string, member: string): DashboardRow | null {
  return readBeat(join(directory, rowFileNameOf(member)))
}

/** Every member's row the place holds, by member, in no particular order; a row it cannot read is skipped with its reason. */
export function beatsIn(directory: string): { readonly rows: Readonly<Record<string, DashboardRow>>; readonly unread: readonly string[] } {
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' ? { rows: {}, unread: [] } : { rows: {}, unread: [`${directory} could not be read (${String(code ?? error)}).`] }
  }
  const rows: Record<string, DashboardRow> = {}
  const unread: string[] = []
  for (const name of names.sort()) {
    const read = oneBeatIn(directory, name)
    if (read === undefined || read === null) continue
    if (typeof read === 'string') unread.push(read)
    else rows[read.member] = read
  }
  return { rows, unread }
}

/** One entry of a rows place: its member's row, null for an entry that is no member's, or why it cannot be read. */
function oneBeatIn(directory: string, name: string): DashboardRow | null | string | undefined {
  const member = memberOfRowFileName(name)
  if (member === undefined) return undefined
  try {
    return readBeat(join(directory, name))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** The row at `path`, or null when the file is not there; throws when what is there is not a row of this user's. */
function readBeat(path: string): DashboardRow | null {
  let descriptor: number
  try {
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw new Error(`${path} could not be read (${String(code ?? error)}).`)
  }
  try {
    const found = fs.fstatSync(descriptor)
    if (!found.isFile() || found.uid !== getuid?.() || (found.mode & 0o077) !== 0) {
      throw new Error(`${path} is not a file only this user may read and write, so Martha does not trust it.`)
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    if (!isDashboardRow(parsed)) throw new Error(`${path} does not hold a ${ONE_ROW}.`)
    return parsed
  } finally {
    fs.closeSync(descriptor)
  }
}

/** True when `value` is a row this slice wrote, every field of it. */
export function isDashboardRow(value: unknown): value is DashboardRow {
  return (
    isRecord(value) &&
    KEPT_FIELDS.every((field) => field(value)) &&
    (STATES as readonly unknown[]).includes(value['state']) &&
    isProgress(value['progress']) &&
    isHostFacts(value['host']) &&
    isWaits(value['waits'])
  )
}

/** The row's fields that are plain text or a position, each checked by itself. */
const KEPT_FIELDS: readonly ((row: Record<string, unknown>) => boolean)[] = [
  (row) => isText(row['member']),
  (row) => isText(row['session']),
  (row) => isPosition(row['at']),
  (row) => isText(row['holds']),
  (row) => isText(row['task']),
  (row) => isText(row['needs']),
]

/** Whether a progress is one this slice writes: a step at or above zero, of a total of at least one. */
const isProgress = (value: unknown): boolean =>
  isRecord(value) && isPosition(value['step']) && isPosition(value['of']) && value['of'] >= 1

/** Whether host facts are the shape this slice writes. */
const isHostFacts = (value: unknown): boolean =>
  isRecord(value) &&
  isText(value['model']) &&
  isText(value['provider']) &&
  isANumberOrNull(value['contextPercent']) &&
  isANumberOrNull(value['costUsd'])

const isANumberOrNull = (value: unknown): boolean => value === null || typeof value === 'number'

/** Whether a wait is one this slice writes: null, or somebody, something, and since when. */
const isWaits = (value: unknown): boolean =>
  value === null || (isRecord(value) && isText(value['on']) && isText(value['for']) && isPosition(value['since']))

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'
const isPosition = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

/** Writes `text` at `path` whole: under a staging name beside it, every byte counted, then renamed into place. */
function keepWhole(path: string, text: string): { readonly kept: boolean; readonly why?: string } {
  const staged = join(dirname(path), `${STAGING_PREFIX}${randomUUID()}`)
  const refused = writeStaged(staged, text, path)
  if (refused !== undefined) {
    fs.rmSync(staged, { force: true })
    return { kept: false, why: refused }
  }
  fs.renameSync(staged, path)
  return { kept: true }
}

/** `text` written whole to the staging file `staged`, counting every byte; or why it was not. */
function writeStaged(staged: string, text: string, path: string): string | undefined {
  let descriptor: number
  try {
    descriptor = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, ROW_FILE_MODE)
  } catch (error) {
    return `${path} could not be written (${String((error as NodeJS.ErrnoException).code ?? error)}, so Martha keeps no ${ONE_ROW} in it.`
  }
  try {
    const bytes = Buffer.byteLength(text)
    const written = fs.writeSync(descriptor, text)
    if (written !== bytes) return `${path} kept only ${written} of the ${bytes} bytes of a ${ONE_ROW}, so Martha keeps none of it.`
    fs.fsyncSync(descriptor)
    return undefined
  } finally {
    fs.closeSync(descriptor)
  }
}
