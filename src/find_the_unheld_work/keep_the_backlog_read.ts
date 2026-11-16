// The backlog read the crew keeps (martha#319, package B).
//
// GitHub is asked at most once per BACKLOG_READ_INTERVAL_MS, from the Supervisor's launcher. What it answered is kept
// in the crew's own store, so every answer and every nudge between two reads is drawn from the same list. A read that
// fails keeps the last good list and says why the newer one failed: an empty list after a failure would read as "nothing
// is unheld", which is the one answer a failed read cannot give.

import { BACKLOG, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, CrewStore, ProcessOutcome, Refused } from '../host_contract/host_contract.ts'
import { readTheBacklog, type AnIssue } from './find_the_unheld_work.ts'

/** Where a crew keeps its backlog read and its idle clock, under the one crew store: named after the declaration's key. */
export const BACKLOG_PLACE = BACKLOG

/** The file the read is kept in. */
export const THE_READ_FILE = 'read.json'

/** How long a kept read serves before GitHub is asked again. */
export const BACKLOG_READ_INTERVAL_MS = 10 * MINUTE_MS

/** The read a crew keeps: the last good list, when it was read, and how the newest try went. */
export interface TheKeptRead {
  /** When GitHub was last asked, whatever it answered. */
  readonly tried_at: number
  /** When the list below was read; null until a read has succeeded. */
  readonly read_at: number | null
  readonly issues: readonly AnIssue[]
  readonly cut: boolean
  /** Why the newest try failed, or null when it did not. */
  readonly error: string | null
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isAList = (value: unknown, each: (one: unknown) => boolean): boolean => Array.isArray(value) && value.every(each)
const isText = (value: unknown): value is string => typeof value === 'string'

/** Whether a kept issue has every field an answer reads. */
const isAnIssue = (value: unknown): boolean =>
  isObject(value) &&
  isText(value['package']) &&
  isText(value['title']) &&
  typeof value['opened_at'] === 'number' &&
  isText(value['purpose']) &&
  isAList(value['holders'], isText) &&
  isText(value['mentioned'])

/** The kept read in `text`, or undefined when it is not one. */
function aKeptReadIn(text: string): TheKeptRead | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return isAKeptRead(value) ? value : undefined
}

/** Whether a parsed value has every field a kept read holds. */
const isAKeptRead = (value: unknown): value is TheKeptRead =>
  isObject(value) &&
  typeof value['tried_at'] === 'number' &&
  typeof value['cut'] === 'boolean' &&
  (value['read_at'] === null || typeof value['read_at'] === 'number') &&
  (value['error'] === null || isText(value['error'])) &&
  isAList(value['issues'], isAnIssue)

/** The read the place keeps, undefined when it keeps none, or why it cannot be read. */
export function theKeptReadIn(place: CrewPlace | Refused): TheKeptRead | undefined | Refused {
  if ('refusal' in place) return place
  const held = place.read(THE_READ_FILE)
  if (held === undefined || 'refusal' in held) return held
  return aKeptReadIn(held.text) ?? { refusal: `${THE_READ_FILE} in the crew's ${BACKLOG_PLACE} place is not a backlog read` }
}

/** Whether a new read is due: none was ever tried, or the last try is older than the interval. */
export const aReadIsDue = (kept: TheKeptRead | undefined, now: number): boolean =>
  kept === undefined || now - kept.tried_at >= BACKLOG_READ_INTERVAL_MS

/**
 * The read to keep after one try: the new list when it succeeded, and otherwise the last good list beside the error.
 */
export function theReadAfter(kept: TheKeptRead | undefined, tried: Awaited<ReturnType<typeof readTheBacklog>>, now: number): TheKeptRead {
  if ('error' in tried) {
    return { tried_at: now, read_at: kept?.read_at ?? null, issues: kept?.issues ?? [], cut: kept?.cut ?? false, error: tried.error }
  }
  return { tried_at: now, read_at: now, issues: tried.issues, cut: tried.cut, error: null }
}

/** What reading the backlog needs: the place to keep it in, how `gh` runs (none outside a launcher), and the time. */
export interface TheBacklogReader {
  readonly place: CrewPlace | Refused
  readonly run: ((args: readonly string[]) => Promise<ProcessOutcome>) | undefined
  readonly now: number
}

/** The reader over the crew's store: its backlog place, how `gh` runs (undefined outside a launcher), and the time. */
export const theBacklogReaderOver = (crew: CrewStore, run: TheBacklogReader['run'], now: number): TheBacklogReader => ({ place: crew.place(BACKLOG_PLACE), run, now })

/**
 * The backlog as the crew holds it now: the kept read, refreshed first when a read is due and this launch can run `gh`.
 * Undefined when nothing was ever read and nothing can be; a refusal when the crew's store will not answer.
 */
export async function theBacklogNow(reader: TheBacklogReader, places: readonly string[]): Promise<TheKeptRead | undefined | Refused> {
  const kept = theKeptReadIn(reader.place)
  if (kept !== undefined && 'refusal' in kept) return kept
  if (reader.run === undefined || !aReadIsDue(kept, reader.now) || 'refusal' in reader.place) return kept
  const after = theReadAfter(kept, await readTheBacklog(reader.run, places), reader.now)
  const refused = reader.place.keep(THE_READ_FILE, `${JSON.stringify(after)}\n`)
  return refused ?? after
}
