// The owner's `/crew-refresh` (martha#999 package 3, row 1): set this member's refresh mode, refresh it now, or say the
// mode it is in. Typed at a Claude Code member's tab through the relay, or at a martha-engine member's tab through the
// same decision `/crew` uses (../start_an_engine_member/the_owners_lines_at_the_tab.ts); both reach the launcher as one
// ask, answered here.
//
// crew-code's modes, as crew-code answers them (macula-sponsors 6f353d51, hooks/register.tsx:5392-5447, :6713-6721):
// `auto`, `on [percent]`, `off`, `now`, and the status with no mode given. `package` waits for the board (gap 22, the
// team-mode milestone): until then it is answered with one error naming gap 22 (martha#999 ruling 1).

import type { CrewPlace, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { refreshesPlace, theFlowOf } from './refresh_a_member.ts'
import { askAMemberToRefresh } from './the_refresh_flow.ts'
import {
  AUTO_START_MARGIN_PERCENT,
  AUTO_TASK_PERCENT,
  keepTheMode,
  ON_PERCENT_HIGHEST,
  ON_PERCENT_LOWEST,
  theModeAsSaid,
  theModeOf,
  theOnPercent,
  type RefreshMode,
} from './the_refresh_mode.ts'

/** What the mod asks the launcher when the owner types `/crew-refresh`: never a model's tool. */
export const THE_REFRESH_MODE_ASK = 'the_refresh_mode_typed'

/** The reason a refresh the owner typed `now` for carries, as the member's flow and row say it. */
export const THE_OWNER_TYPED_NOW = 'the owner typed /crew-refresh now'

/** What `/crew-refresh package` answers until the board is ported (martha#999 ruling 1). */
export const PACKAGE_MODE_WAITS =
  'Package mode needs the board, which comes with gap 22 of martha#957 (team mode, after the switch). Nothing was changed.'

/** A mode the owner can type: the declaration's `between_tasks` is only started in. */
export type ATypedMode = Exclude<RefreshMode, { readonly kind: 'between_tasks' }>

/** What the owner typed after `/crew-refresh`, read as crew-code reads it: the first word is the mode. */
export type TheRefreshCommand =
  | { readonly set: ATypedMode }
  | { readonly now: true }
  | { readonly package: true }
  | { readonly status: true }

/** Reads what followed `/crew-refresh`: a word it does not know is the status, as crew-code answers it. */
export function theRefreshCommandIn(typed: string): TheRefreshCommand {
  const [wanted = '', level = ''] = typed.trim().split(/\s+/)
  if (wanted === 'off') return { set: { kind: 'off' } }
  if (wanted === 'auto') return { set: { kind: 'auto' } }
  if (wanted === 'on') return { set: { kind: 'on', percent: theOnPercent(level) } }
  if (wanted === 'now') return { now: true }
  if (wanted === 'package') return { package: true }
  return { status: true }
}

/** Where a command is answered: the crew's store, the member it is typed for, what the declaration says, and the time. */
export interface TheRefreshCommandAsked {
  readonly stores: TheCrewFilesStores
  readonly member: string
  /** The declaration's switch, which gives the mode a member starts in, and the limit it hands over at whatever the mode. */
  readonly refresh_between_tasks: boolean
  readonly handover_percent: number
  readonly now: number
}

/** The answer to one `/crew-refresh`: the line the owner reads, or why it was not done. */
export type TheRefreshCommandAnswer = { readonly answer: string } | { readonly refused: string }

/** Answers what the owner typed, for the member whose tab it was typed at. */
export function answerTheRefreshCommand(asked: TheRefreshCommandAsked, typed: string): TheRefreshCommandAnswer {
  const command = theRefreshCommandIn(typed)
  if ('package' in command) return { refused: PACKAGE_MODE_WAITS }
  if ('now' in command) return refreshNow(asked)
  const place = refreshesPlace(asked)
  if ('refusal' in place) return { refused: place.refusal }
  if ('set' in command) return setTheMode(place, asked.member, command.set)
  return theStatus(place, asked)
}

/** Keeps the mode and says what it does, in crew-code's words for the part Martha runs. */
function setTheMode(place: CrewPlace, member: string, mode: ATypedMode): TheRefreshCommandAnswer {
  const unkept = keepTheMode(place, member, mode)
  if (unkept !== undefined) return { refused: unkept.refusal }
  return { answer: theModeSetLine(member, mode) }
}

/** What setting a mode says. */
function theModeSetLine(member: string, mode: ATypedMode): string {
  if (mode.kind === 'off') return `Auto-refresh off for ${member}.`
  if (mode.kind === 'auto') {
    return (
      `Auto-refresh on for ${member}, auto mode: after a finished task at ${AUTO_TASK_PERCENT}% context or more, ` +
      `once the context has grown ${AUTO_START_MARGIN_PERCENT}% past where this session started, so a fresh session above it refreshes after its work, not on its first report.`
    )
  }
  return `Auto-refresh on for ${member}: after a finished task, when the context is at ${mode.percent}% or more and has grown past where this session started, it writes its handover and restarts from it.`
}

/** `now`: the ask the member's flow takes up at its next question, as `refresh_this_session` leaves one. */
function refreshNow(asked: TheRefreshCommandAsked): TheRefreshCommandAnswer {
  const unkept = askAMemberToRefresh(asked, asked.member, THE_OWNER_TYPED_NOW, asked.now)
  if (unkept !== undefined) return { refused: unkept.refusal }
  return { answer: `Refreshing ${asked.member} now: it writes its handover, then clears and resumes.` }
}

/** The status: the mode, when the member last refreshed, and the usage. */
function theStatus(place: CrewPlace, asked: TheRefreshCommandAsked): TheRefreshCommandAnswer {
  const mode = theModeOf(place, asked.member, asked.refresh_between_tasks)
  if ('refusal' in mode) return { refused: mode.refusal }
  const flow = theFlowOf(place, asked.member)
  const refreshed = flow === undefined || 'refusal' in flow ? [] : flow.refreshed_at
  const last = refreshed.length === 0 ? '' : `; last refreshed ${new Date(refreshed[refreshed.length - 1] as number).toISOString().slice(0, 16).replace('T', ' ')} UTC`
  return {
    answer:
      `Auto-refresh is ${theModeAsSaid(mode)} for ${asked.member}${last}. ` +
      `Usage: /crew-refresh auto | on [percent ${ON_PERCENT_LOWEST}..${ON_PERCENT_HIGHEST}] | off | now (percents of your limit). ` +
      `This session also hands over at ${asked.handover_percent}% of its limit, whatever the mode.`,
  }
}
