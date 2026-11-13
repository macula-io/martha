// `see_who_is_free`: which member of the crew can take a package now, and, when one cannot, who can instead
// (martha#319, package A).
//
// This exists so the Supervisor gives the next package to a member that can actually take it. In crew-code a member was
// once picked from a one-word state and a remembered model while it sat at 73% of its context; this slice reads what
// the row says, what the park marker says and how old the member's last report is, and answers in one place.
//
// It reads `see_the_crew`'s rows and adds what they lack: the park, read from the marker (../park_and_wake_a_member)
// and never from the row, so a park survives exactly as #255 keeps it; and stale progress, read from `reported_at`,
// which only a report writes, so a heartbeat that keeps a row fresh cannot hide a member that stopped reporting.
//
// The rule a member is free by (the Supervisor's reading of the design, 2026-11-13): it is running, it is not parked
// (a marker Martha cannot read is a "cannot tell", so the answer is no), it does not need the owner, its context is
// under the handover limit, and it is not in the middle of a package (its row is idle, or its last report has step
// equal to of; a member that waits with step under of is busy). Stale progress is a flag, never a refusal by itself.
//
// The slice reads no disk: the park is asked through a function the caller hands it.

import { HANDOVER_LIMIT_PERCENT } from '../refresh_a_member/refresh_a_member.ts'
import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import type { CrewRow } from '../see_the_crew/see_the_crew.ts'
import { IDLE, OFFLINE, type ShownState } from '../show_dashboard_beat/show_dashboard_beat.ts'

/**
 * The context share at which a member is no longer free: the handover limit itself, imported, because a member that
 * would hand over before it starts a package cannot take one.
 */
export const CLAIM_LIMIT_PERCENT = HANDOVER_LIMIT_PERCENT

/** How old a member's last report may be, while it is in the middle of a package, before its row is flagged. */
export const PROGRESS_STALE_AFTER_MS = 30 * 60_000

/** What a declared member that has never started reads as: not idle, because nothing of it runs. */
export const NOT_RUNNING = 'not running'

/** The flag a park marker Martha cannot read raises: nobody can say whether the member is parked. */
export const PARK_UNREADABLE_FLAG = 'park unreadable'

/** A member's state as this view shows it: the row's, or `not running` for a member that never beat. */
export type FreeState = ShownState | typeof NOT_RUNNING

/** One member's row as the Supervisor sees it when it chooses who takes a package. */
export interface FreeRow {
  readonly member: string
  readonly model: string
  readonly provider: string
  readonly state: FreeState
  readonly context_percent: number | null
  readonly holds: string
  readonly progress: { readonly step: number; readonly of: number }
  /** How long ago the member last reported, in milliseconds; null when it never reported. */
  readonly reported_ago: number | null
  /** How long ago its row was last beaten, in milliseconds; null when it never beat. */
  readonly beat_ago: number | null
  readonly flags: readonly string[]
}

/** What this slice is handed: the crew's rows, each declared member's model, and how to ask a member's park. */
export interface WhatTheCrewSays {
  readonly rows: readonly CrewRow[]
  /** The model each member is declared with, by name; null when the declaration leaves it to the host. */
  readonly declared_models: Readonly<Record<string, string | null>>
  readonly parkOf: (member: string) => ThePark
  readonly now: number
}

/** Every declared member's row, in the declaration's order, with what stands in the way flagged. */
export function seeWhoIsFree(crew: WhatTheCrewSays): readonly FreeRow[] {
  return crew.rows.map((row) => freeRowOf(row, crew))
}

function freeRowOf(row: CrewRow, crew: WhatTheCrewSays): FreeRow {
  const reported_ago = row.reported_at === null ? null : Math.max(0, crew.now - row.reported_at)
  return {
    member: row.member,
    model: row.host.model === '' ? (crew.declared_models[row.member] ?? '') : row.host.model,
    provider: row.host.provider,
    state: row.at === null ? NOT_RUNNING : row.state,
    context_percent: row.host.contextPercent,
    holds: row.holds,
    progress: row.progress,
    reported_ago,
    beat_ago: row.quiet_for,
    flags: flagsOf(row, crew.parkOf(row.member), reported_ago),
  }
}

/** The flags a row raises, in a fixed order: the park, offline, needs-you, the context, and stale progress. */
function flagsOf(row: CrewRow, park: ThePark, reported_ago: number | null): readonly string[] {
  const flags: (string | null)[] = [
    parkFlagOf(park),
    row.state === OFFLINE ? OFFLINE : null,
    row.state === 'needs-you' ? 'needs-you' : null,
    atTheLimit(row) ? `context ${String(row.host.contextPercent)}%` : null,
    staleProgress(row, reported_ago) ? `progress ${minutesOf(reported_ago ?? 0)} old` : null,
  ]
  return flags.filter((flag): flag is string => flag !== null)
}

/** The flag a park raises: a parked member is flagged with the park's own word, read from the marker, never the row. */
const parkFlagOf = (park: ThePark): string | null => (park.kind === 'not_parked' ? null : park.kind === 'unreadable' ? PARK_UNREADABLE_FLAG : park.kind)

const atTheLimit = (row: CrewRow): boolean => row.host.contextPercent !== null && row.host.contextPercent >= CLAIM_LIMIT_PERCENT

const finished = (row: CrewRow): boolean => row.progress.step >= row.progress.of

/** Whether a member in the middle of a package has not reported for longer than the stale age. */
const staleProgress = (row: CrewRow, reported_ago: number | null): boolean => reported_ago !== null && !finished(row) && reported_ago > PROGRESS_STALE_AFTER_MS

const minutesOf = (ms: number): string => `${String(Math.floor(ms / 60_000))}m`

/** Why a member cannot take a package now, or null when it can. The first reason that holds is the one given. */
export function whyNotFree(row: CrewRow, park: ThePark): string | null {
  const reasons: readonly (() => string | null)[] = [
    () => (row.at === null ? `${row.member} is ${NOT_RUNNING}` : null),
    () => (row.state === OFFLINE ? `${row.member} is offline: its row has been quiet for ${minutesOf(row.quiet_for ?? 0)}` : null),
    () => parkReasonOf(row.member, park),
    () => (row.state === 'needs-you' ? `${row.member} needs the owner: ${row.needs}` : null),
    () => (atTheLimit(row) ? `${row.member} is at ${String(row.host.contextPercent)}% of its context, at or past the ${String(CLAIM_LIMIT_PERCENT)}% handover limit` : null),
    () => (row.state !== IDLE && !finished(row) ? `${row.member} is in the middle of ${row.holds === '' ? 'a package' : row.holds} (${row.state}, ${String(row.progress.step)}/${String(row.progress.of)})` : null),
  ]
  for (const reason of reasons) {
    const said = reason()
    if (said !== null) return said
  }
  return null
}

function parkReasonOf(member: string, park: ThePark): string | null {
  if (park.kind === 'parked') return `${member} is parked: ${park.marker.reason}`
  if (park.kind === 'unreadable') return `Martha cannot tell whether ${member} is parked: ${park.refusal}`
  return null
}

/** The answer to "may this member take a package now?": yes, or no with the reason and who fits instead. */
export type MayTakeAPackage =
  | { readonly may: true; readonly member: string }
  | { readonly may: false; readonly member: string; readonly why: string; readonly instead: readonly string[] }

/** What is said when the member asked about is not on the crew: no guess at who was meant. */
export const notOnTheCrew = (member: string, names: readonly string[]): string => `${member} is not on this crew (its members are ${names.join(', ')})`

/**
 * Whether `member` may take a package now. A no names the members that fit instead, those on the same provider first,
 * and never the asker or the member refused; when nobody fits, it names nobody.
 */
export function mayTakeAPackage(crew: WhatTheCrewSays, member: string, asker: string): MayTakeAPackage | { readonly refused: string } {
  const row = crew.rows.find((one) => one.member === member)
  if (row === undefined) return { refused: notOnTheCrew(member, crew.rows.map((one) => one.member)) }
  const why = whyNotFree(row, crew.parkOf(member))
  if (why === null) return { may: true, member }
  // The member refused never fits, because it is refused by the same test; the asker is left out by name.
  const fit = crew.rows.filter((one) => one.member !== asker && whyNotFree(one, crew.parkOf(one.member)) === null)
  const same = fit.filter((one) => one.host.provider === row.host.provider)
  const other = fit.filter((one) => one.host.provider !== row.host.provider)
  return { may: false, member, why, instead: [...same, ...other].map((one) => one.member) }
}

/** What nobody fitting is told as: said, so a refusal that names nobody is not read as an empty list. */
export const NOBODY_FITS = 'Nobody on the crew fits now'

/** The answer to the question in the Supervisor's words. */
export function theAnswerToMayTake(answer: MayTakeAPackage): string {
  if (answer.may) return `yes: ${answer.member} may take a package now.`
  const instead = answer.instead.length === 0 ? `${NOBODY_FITS}.` : `Fit instead: ${answer.instead.join(', ')}.`
  return `no: ${answer.why}. ${instead}`
}
