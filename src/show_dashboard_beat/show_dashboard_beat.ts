// One member's row on the owner's dashboard: its shape, and the rule that settles which beat is the row (martha#254).
//
// This exists so the owner can watch a crew work: who is working, on what, how far, what holds each one up, without
// asking anyone. The row is one per member of the declaration, never one per session, so a refresh takes the row
// over instead of adding a second one for the same member.
//
// A beat is a whole row, not a change, and the store writes every field every time, so a reader never merges fields
// and never sees half a row: the store that keeps them is the host's (`DashboardStore`, implemented by the launcher
// in ../launch_a_claude_code_member/dashboard_rows_in_state), because a slice of the core reads no disk.
//
// The newest `at` wins, and the WRITER settles it (r=1, O1): a beat taken earlier and landing later is dropped whole
// when it is offered, not blended into the row a newer beat got there. `beatAfter` is that rule, and the store asks it
// before it writes anything.
//
// The row is never removed. A member that stops beating reads `offline` once OFFLINE_AFTER_MS has passed, which is
// the reader's word about a row that has gone quiet, not a state anyone writes.

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

/** The file one member's row is kept in: never a path, and never a dot a person or git could steer with. */
export function rowFileNameOf(member: string): string {
  return `${encodeURIComponent(member).replaceAll('.', '%2E')}.json`
}

/** The member a row file name keeps, or undefined when it is not one a row store writes. */
export function memberOfRowFileName(name: string): string | undefined {
  if (!name.endsWith('.json')) return undefined
  try {
    const member = decodeURIComponent(name.slice(0, -'.json'.length))
    return rowFileNameOf(member) === name ? member : undefined
  } catch {
    return undefined
  }
}

/**
 * The row a store keeps when `beat` is offered: `beat` itself when no row is held or `beat` is newer, and null when
 * the row already holds a beat taken at or after it — the newest `at` wins, and the writer settles it (r=1, O1).
 */
export function beatAfter(held: DashboardRow | null, beat: DashboardRow): DashboardRow | null {
  if (held === null) return beat
  return held.at >= beat.at ? null : beat
}

/** Where a member's row is kept: the host's store, which the launcher implements and a slice of the core only uses. */
export interface DashboardStore {
  /** The member's row as it is, or null when the store holds none. */
  read(member: string): DashboardRow | null
  /** Keeps a whole row if it is newer than the one held; whether it was kept, and why not. */
  keep(row: DashboardRow): { readonly kept: boolean; readonly why?: string }
  /** Every member's row the store holds, by member. */
  all(): Readonly<Record<string, DashboardRow>>
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
