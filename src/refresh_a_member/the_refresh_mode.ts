// A member's refresh mode (martha#999 package 3, row 1): how its session refreshes after a finished task, kept per
// member in the crew's store so a clear, a restart or a relaunch does not lose what the owner chose.
//
// This exists so the owner who switches from crew-code keeps its `/crew-refresh` modes. The numbers are crew-code's
// (macula-sponsors 6f353d51, crew-code/core/auto_refresh.ts and hooks/register.tsx), each a named constant here. A
// member the owner has not set yet starts in the mode the crew's declaration gives: `refresh_between_tasks` keeps
// Martha's own rule, a refresh after any finished task once the session has grown REFRESH_MARGIN_PERCENT past where it
// began. The limit hands over whatever the mode says (./refresh_a_member.ts).

import type { CrewPlace, Refused } from '../host_contract/host_contract.ts'
import { REFRESH_MARGIN_PERCENT, type AfterATask } from './refresh_a_member.ts'

/**
 * The share of its limit at which crew-code's member takes no new card (crew-code core/roster.ts:73): auto mode
 * refreshes once a member could not take its next card (the owner's rule).
 */
export const CLAIM_LIMIT_PERCENT = 70

/** After a finished task, in auto mode: refresh at this share of the member's own limit, or more. */
export const AUTO_TASK_PERCENT = CLAIM_LIMIT_PERCENT

/**
 * How far past where it started a session has to grow before auto or `on` refreshes it: a resume
 * already above the threshold finds a fresh session on its next task, not on its first free report. Martha's
 * declaration switch keeps its own REFRESH_MARGIN_PERCENT, as ruled on martha#999 r=2.
 */
export const AUTO_START_MARGIN_PERCENT = 5

/** The share `/crew-refresh on` takes when it is given none, or one it cannot read. */
export const DEFAULT_THRESHOLD = 40

/** The lowest and highest share `/crew-refresh on <percent>` keeps: a number outside is held to the nearer one. */
export const ON_PERCENT_LOWEST = 5
export const ON_PERCENT_HIGHEST = 95

/** How a member refreshes after a finished task. `between_tasks` is the declaration's switch, never typed. */
export type RefreshMode =
  | { readonly kind: 'off' }
  | { readonly kind: 'auto' }
  | { readonly kind: 'on'; readonly percent: number }
  | { readonly kind: 'between_tasks' }

/** The file one member's mode is kept in, beside its flow. */
export const theModeFile = (member: string): string => `${member}.mode.json`

/** The mode a member starts in: the declaration's switch on is `between_tasks`, and off is off. */
export const theStartingMode = (refresh_between_tasks: boolean): RefreshMode => (refresh_between_tasks ? { kind: 'between_tasks' } : { kind: 'off' })

/** The share `on` keeps for what was typed: held to 5..95, and the default when nothing or no number was typed. */
export function theOnPercent(typed: string): number {
  const asked = Number(typed)
  const chosen = typed.trim() === '' || !Number.isFinite(asked) || asked === 0 ? DEFAULT_THRESHOLD : asked
  return Math.min(ON_PERCENT_HIGHEST, Math.max(ON_PERCENT_LOWEST, chosen))
}

/** What a finished task is measured by in this mode, or null when a finished task refreshes nothing. */
export function theAfterATaskOf(mode: RefreshMode): AfterATask | null {
  if (mode.kind === 'off') return null
  if (mode.kind === 'auto') return { threshold: AUTO_TASK_PERCENT, margin: AUTO_START_MARGIN_PERCENT }
  if (mode.kind === 'on') return { threshold: mode.percent, margin: AUTO_START_MARGIN_PERCENT }
  return { threshold: 0, margin: REFRESH_MARGIN_PERCENT }
}

/** The member's mode as kept, or the starting mode when none is; a file that is not a mode is a refusal, never off. */
export function theModeOf(place: CrewPlace, member: string, refresh_between_tasks: boolean): RefreshMode | Refused {
  const read = place.read(theModeFile(member))
  if (read === undefined) return theStartingMode(refresh_between_tasks)
  if ('refusal' in read) return read
  try {
    const held: unknown = JSON.parse(read.text)
    return isAKeptMode(held) ? held : unreadableMode(member)
  } catch {
    return unreadableMode(member)
  }
}

/** Keeps the member's mode whole, or says why it could not. */
export function keepTheMode(place: CrewPlace, member: string, mode: RefreshMode): Refused | undefined {
  return place.keep(theModeFile(member), `${JSON.stringify(mode)}\n`)
}

/** The mode in the owner's words, as `/crew-refresh` with no mode says it. */
export function theModeAsSaid(mode: RefreshMode): string {
  if (mode.kind === 'auto') return 'on, auto mode'
  if (mode.kind === 'on') return `on at ${mode.percent}%`
  if (mode.kind === 'between_tasks') return "on after every finished task, as the crew's declaration says"
  return 'off'
}

const unreadableMode = (member: string): Refused => ({ refusal: `${theModeFile(member)} is not a refresh mode this launcher reads` })

/** Whether `value` is a mode this launcher keeps: the declaration's `between_tasks` is never kept, only started in. */
function isAKeptMode(value: unknown): value is RefreshMode {
  if (typeof value !== 'object' || value === null) return false
  const mode = value as Record<string, unknown>
  if (mode['kind'] === 'off' || mode['kind'] === 'auto') return true
  return mode['kind'] === 'on' && typeof mode['percent'] === 'number' && mode['percent'] >= ON_PERCENT_LOWEST && mode['percent'] <= ON_PERCENT_HIGHEST
}
