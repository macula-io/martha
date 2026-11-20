// The owner's `/crew` at a member's tab (martha#927): see the crew, or say one thing to one member, with no model turn.
//
// This exists so whoever sits at a member's tab reaches the crew without asking the member's model to call a tool. The
// command answers through the very launcher calls the model makes (`see_the_crew` and `say_to_the_crew`), so what it
// prints is what the model would have been told, and a send is attributed, checked and kept the same way. It lives in
// its own file, as ./crew_answers.ts does, because the host loads ./crew.tsx as a copy no test can import: the decision
// is here, and ./crew.tsx only binds it to the host.

import { paneIn } from './crew_answers.ts'

/** What the launcher heard, or why it could not be heard: the two are not the same, and only one of them is an answer. */
export type Heard = { readonly said: string } | { readonly why: string }

/** One question to the launcher: a core tool's name and its arguments. */
export type HearTheLauncher = (tool: string, args: Readonly<Record<string, unknown>>) => Promise<Heard>

/** The launcher's tool that answers the crew's rows, as ./crew.tsx asks it for the pane. */
const SEE = 'see_the_crew'

/** The launcher's tool a member says something to the crew with, as ./crew.tsx answers the model's call of it. */
const SAY = 'say_to_the_crew'

/** The command as the owner types it, on either host (martha#927): the engine's tab reads the same word. */
export const THE_CREW_COMMAND = '/crew'

/** What `/crew` says when it is given a member and nothing to say to them. */
export const CREW_USAGE = '/crew shows your crew. /crew <member> <text> says the text to that member. Nothing was sent.'

/** What the owner typed after `/crew`: nothing, to see the crew; or a member's name and what to say to them. */
export type TheCrewCommand = { readonly see: true } | { readonly say: { readonly to: string; readonly text: string } } | { readonly usage: true }

/** Reads what followed `/crew`: the first word is the member, everything after it, as typed, is the text. */
export function crewCommandOf(args: string): TheCrewCommand {
  const typed = args.trim()
  if (typed === '') return { see: true }
  const gap = typed.search(/\s/)
  if (gap === -1) return { usage: true }
  return { say: { to: typed.slice(0, gap), text: typed.slice(gap).trim() } }
}

/** The crew as text: the pane's header, then each line under it, exactly as the launcher wrote them. */
export function theCrewAsText(said: string): string {
  const pane = paneIn(said)
  return pane === null ? `Martha answered with something /crew cannot read: ${said}` : [pane.header, ...pane.lines].join('\n')
}

/**
 * What `/crew` prints, having asked the launcher what it needed. A send names one member and goes as the member this
 * session is; a launcher that could not be heard, or that refused, is printed as it said it, and nothing else is tried.
 */
export async function theCrewCommandAnswers(args: string, hear: HearTheLauncher): Promise<string> {
  const command = crewCommandOf(args)
  if ('usage' in command) return CREW_USAGE
  if ('see' in command) {
    const heard = await hear(SEE, {})
    return 'said' in heard ? theCrewAsText(heard.said) : heard.why
  }
  const heard = await hear(SAY, { to: [command.say.to], text: command.say.text })
  return 'said' in heard ? heard.said : heard.why
}

/**
 * The host's answer to `/crew` (martha#927 Done-when 6): the text, shown to the owner alone. Answered without `next`, no
 * command runs beneath it, and `isTextDisplayOnly` keeps the text out of every request, so the model takes no turn and
 * never reads it.
 */
export const theCrewCommandResult = (text: string): { readonly text: string; readonly isTextDisplayOnly: true } => ({ text, isTextDisplayOnly: true })

/** The owner's `/crew-refresh` on either host (martha#999 package 3): the engine's tab reads the same word. */
export const THE_REFRESH_COMMAND = '/crew-refresh'

/** What the mod asks the launcher when the owner types `/crew-refresh`: never a model's tool. */
const THE_REFRESH_MODE_QUESTION = 'the_refresh_mode_typed'

/** The word that asks for a refresh now, as crew-code reads it: the first word typed. */
const NOW = 'now'

/** What `/crew-refresh` prints, and whether the launcher took a refresh now, which the host then starts. */
export interface TheRefreshCommandTold {
  readonly text: string
  readonly now: boolean
}

/**
 * What `/crew-refresh` prints, having asked the launcher with what was typed, as it was typed. A refresh `now` the
 * launcher took is one this session starts at once, as crew-code does; one it refused starts nothing.
 */
export async function theRefreshCommandAnswers(args: string, hear: HearTheLauncher): Promise<TheRefreshCommandTold> {
  const typed = args.trim()
  const heard = await hear(THE_REFRESH_MODE_QUESTION, { typed })
  if (!('said' in heard)) return { text: heard.why, now: false }
  return { text: heard.said, now: typed.split(/\s+/)[0] === NOW }
}
