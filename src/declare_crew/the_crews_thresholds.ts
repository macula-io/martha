// The crew's thresholds (martha#931 A): how long a quiet row waits before it reads offline, the context share at which a
// member hands over, and how old a report may grow before its row is flagged. Each was a constant in the slice that
// reads it; the declaration's `thresholds` block now names it, and a declaration that names none reads today's value, so
// a file an earlier release wrote still declares and still behaves as it did.
//
// The parse lives here, beside declare_crew, which hands it the part of the declaration under `thresholds` and its own
// refusal. It takes no host and reads no file.

import { BEAT_INTERVAL_MS } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The declaration's key for the block. */
export const THRESHOLDS = 'thresholds'

/** The fields the block may name; each is optional. */
export const THRESHOLDS_KEYS = ['offline_after_seconds', 'handover_percent', 'progress_stale_minutes'] as const

/** One second, in the milliseconds every clock in the crew counts. */
export const SECOND_MS = 1_000

/**
 * The least offline time, in seconds: the first whole second past one beat. A time no longer than one beat reads a live
 * member offline while its next beat is merely due, the same harm an offline time of 0 does.
 */
export const OFFLINE_AFTER_SECONDS_LEAST = Math.floor(BEAT_INTERVAL_MS / SECOND_MS) + 1

/** One minute, in milliseconds. */
const MINUTE_IN_SECONDS = 60

/** How many beats a row may miss before it reads offline, when the declaration names no time: a slow turn is never a dead session. */
export const BEATS_MISSED_BEFORE_OFFLINE = 6

/** The least and most a handover share may be: 0 would hand over at once, and past the whole context there is nothing to hand over. */
export const HANDOVER_PERCENT_LEAST = 1
export const HANDOVER_PERCENT_MOST = 100

/** What the crew reads when the declaration names no threshold, field by field: the values the code held before #931. */
export const THRESHOLDS_WHEN_UNNAMED: CrewThresholds = Object.freeze({
  offline_after_seconds: (BEAT_INTERVAL_MS * BEATS_MISSED_BEFORE_OFFLINE) / SECOND_MS,
  handover_percent: 70,
  progress_stale_minutes: 30,
})

/** The crew's thresholds, in the units the declaration names them in. */
export interface CrewThresholds {
  /** How quiet, in seconds, a member's row must be to read offline. */
  readonly offline_after_seconds: number
  /** The percent of its context past which a member hands over; a member at or past it takes no new package. */
  readonly handover_percent: number
  /** How old, in minutes, a member's last report may be in the middle of a package before its row is flagged. */
  readonly progress_stale_minutes: number
}

/** How a threshold is refused: the field, dotted under the block, and why. */
export type RefuseAThreshold = (field: string, why: string) => never

/** How quiet a row must be to read offline, in milliseconds. */
export const offlineAfterMsOf = (thresholds: CrewThresholds): number => thresholds.offline_after_seconds * SECOND_MS

/** How old a report may be before its row is flagged, in milliseconds. */
export const progressStaleMsOf = (thresholds: CrewThresholds): number => thresholds.progress_stale_minutes * MINUTE_IN_SECONDS * SECOND_MS

/**
 * The block as the declaration names it, field by field over THRESHOLDS_WHEN_UNNAMED. A value someone wrote that is not a
 * threshold is refused by name, never read as the default: an offline time of 0 would read every member offline.
 */
export function thresholdsOf(value: unknown, refuse: RefuseAThreshold): CrewThresholds {
  if (value === undefined) return THRESHOLDS_WHEN_UNNAMED
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse(THRESHOLDS, `is not an object of ${THRESHOLDS_KEYS.join(', ')}`)
  const block = value as Readonly<Record<string, unknown>>
  const unknown = Object.keys(block).find((key) => !(THRESHOLDS_KEYS as readonly string[]).includes(key))
  if (unknown !== undefined) return refuse(`${THRESHOLDS}.${unknown}`, `is not a field here (they are ${THRESHOLDS_KEYS.join(', ')})`)
  return Object.freeze({
    offline_after_seconds: aWholeNumberAtLeast(block, 'offline_after_seconds', 'seconds', OFFLINE_AFTER_SECONDS_LEAST, refuse),
    handover_percent: aShare(block, refuse),
    progress_stale_minutes: aWholeNumberAtLeast(block, 'progress_stale_minutes', 'minutes', 1, refuse),
  })
}

function aWholeNumberAtLeast(block: Readonly<Record<string, unknown>>, key: 'offline_after_seconds' | 'progress_stale_minutes', unit: string, least: number, refuse: RefuseAThreshold): number {
  const value = block[key]
  if (value === undefined) return THRESHOLDS_WHEN_UNNAMED[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < least) return refuse(`${THRESHOLDS}.${key}`, `is not a whole number of ${unit}, at least ${least}`)
  return value
}

function aShare(block: Readonly<Record<string, unknown>>, refuse: RefuseAThreshold): number {
  const value = block['handover_percent']
  if (value === undefined) return THRESHOLDS_WHEN_UNNAMED.handover_percent
  const inRange = typeof value === 'number' && Number.isInteger(value) && value >= HANDOVER_PERCENT_LEAST && value <= HANDOVER_PERCENT_MOST
  if (!inRange) return refuse(`${THRESHOLDS}.handover_percent`, `is not a whole percent from ${HANDOVER_PERCENT_LEAST} to ${HANDOVER_PERCENT_MOST}`)
  return value
}
