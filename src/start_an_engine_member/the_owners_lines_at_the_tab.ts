// What a line the owner types at a martha-engine member's tab gets (martha#927 part 2): `/crew` is answered by the
// launcher itself, through the decision a Claude Code member's `/crew` uses (../claude_code_relay/hooks/crew_command.ts),
// so both hosts print the same rows and the same receipt. Nothing here reaches the engine: no line becomes a prompt, so
// the member's model takes no turn (Done-when 6).
//
// The engine's own slash commands stay off (#614), so any other `/…` is refused in one line (Done-when 4). A plain line
// is refused too: typed turns to an engine member are their own feature (martha#953), ruled out of this package.

import { THE_CREW_COMMAND, THE_REFRESH_COMMAND, theCrewCommandAnswers, theRefreshCommandAnswers, type HearTheLauncher } from '../claude_code_relay/hooks/crew_command.ts'

/** What starts a command, as the owner types one. */
const A_COMMAND_STARTS = '/'

/** Why a command other than Martha's own was not sent: the engine's slash commands are off. */
export const ONLY_THE_CREW_COMMAND = (typed: string): string =>
  `Only ${THE_CREW_COMMAND} and ${THE_REFRESH_COMMAND} are taken at a martha-engine member's tab; ${typed} was not sent.`

/** Why a plain line was not sent: a typed turn to an engine member is not there yet (martha#953). */
export const TYPED_TURNS_ARE_NOT_THERE_YET =
  `Typed turns to a martha-engine member are not there yet (martha#953). ${THE_CREW_COMMAND} shows your crew; ${THE_CREW_COMMAND} <member> <text> says the text to that member. Nothing was sent.`

/**
 * What the owner is told for one line they typed, having asked the launcher what `/crew` needed; null for a line with
 * nothing on it, which is told nothing. The command is the line's first word, so `/crewx` is another command, not `/crew`.
 * A refresh `now` the launcher took is handed to `refreshNow`, which starts it at once.
 */
export async function whatTheOwnersLineGets(line: string, hear: HearTheLauncher, refreshNow: () => void = () => {}): Promise<string | null> {
  const typed = line.trim()
  if (typed === '') return null
  if (!typed.startsWith(A_COMMAND_STARTS)) return TYPED_TURNS_ARE_NOT_THERE_YET
  const gap = typed.search(/\s/)
  const command = gap === -1 ? typed : typed.slice(0, gap)
  const rest = gap === -1 ? '' : typed.slice(gap)
  // `/crew-refresh` (martha#999 package 3): the mode is kept for this member, and a refresh `now` starts at once.
  if (command === THE_REFRESH_COMMAND) return await theRefreshCommandTold(rest, hear, refreshNow)
  if (command !== THE_CREW_COMMAND) return ONLY_THE_CREW_COMMAND(command)
  return theCrewCommandAnswers(rest, hear)
}

/** What `/crew-refresh` prints, with a refresh `now` the launcher took started. */
async function theRefreshCommandTold(rest: string, hear: HearTheLauncher, refreshNow: () => void): Promise<string> {
  const told = await theRefreshCommandAnswers(rest, hear)
  if (told.now) refreshNow()
  return told.text
}
