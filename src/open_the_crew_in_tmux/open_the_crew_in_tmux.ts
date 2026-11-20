// `martha up` and `martha attach [<member>]` for a crew whose declaration says `"terminal": "tmux"` (martha#932):
// every member that is not running opened in a window of its own, in one tmux session named by the declaration's
// `id`, on Martha's own tmux server; and the owner's terminal attached to that session, at a member's window when one
// is named, without the owner typing the server's name.
//
// This exists so the crew runs whatever terminal the owner uses, keeps running when that terminal is closed, and is
// seen again from any terminal (DECIDED 2026-11-20, Raf: "let's go tmux"). The session is opened detached, so
// `martha up` returns and nothing ends with the terminal it was typed in. Each window holds `martha start <member>`,
// as each kitty tab does, so a restart asked of a member starts it again in its own window, and no other window is
// touched; the crew strip is a split under it. The words are ./the_commands_tmux_runs's; this reads the machine,
// writes Martha's config, and runs tmux.

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { EXIT_DONE, refused, tellOwnerOn, type LinesShownToTheOwner } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import {
  THE_SERVERS_CONFIG,
  onMarthasServer,
  opensInTmux,
  outsideAnyTmux,
  theAttach,
  theSessionAsked,
  theSessionOpened,
  theStripSplit,
  theWindowClosed,
  theWindowOpened,
  theWindowsIn,
  theTextTyped,
  theTmuxProgram,
  theTurnSent,
  theWindowsListed,
  whyNotATarget,
  whyTmuxCannotOpen,
  type AMembersWindow,
} from './the_commands_tmux_runs.ts'

/** Martha's config for its own tmux server, under this crew's place in Martha's state. */
export const CONFIG_FILE = 'tmux.conf'
/** This crew's place in Martha's state for the tmux `martha up` opens. */
export const TMUX_PLACE = 'crew-in-tmux'

/** What one tmux command ended with: its status, and what it wrote, out and err together. */
export interface TmuxSaid {
  readonly status: number
  readonly said: string
}

/** What the tmux verbs read and do, so a test can stand in for the machine. */
export interface MarthasTmux {
  /** The name of a tmux server of a test's own; Martha's own server when none is named, never the owner's default one. */
  readonly server?: string
  /** The crew's session name: the declaration's `id`, or null when it names none. */
  readonly id: string | null
  readonly env: Readonly<Record<string, string | undefined>>
  /** Where Martha's config goes, a directory in Martha's state, never in the checkout. */
  readonly place: string
  /** What `tmux -V` says, or undefined when tmux is not on the PATH. */
  readonly tmuxSays: () => string | undefined
  readonly write: (path: string, text: string) => void
  /** Runs tmux with these words and this environment, and waits for it. */
  readonly tmux: (args: readonly string[], env: Readonly<Record<string, string>>) => TmuxSaid
}

/** What opening the crew reads beyond Martha's tmux. */
export interface OpeningTheCrewInTmux extends MarthasTmux {
  readonly root: string
  /** The members to open, in the crew's order. */
  readonly members: readonly string[]
  readonly isRunning: (member: string) => boolean
  /** This release of `martha`: the program and its arguments before the act. */
  readonly martha: readonly string[]
  /** The owner's first prompt for a member, typed in once its session starts (martha#919); none for a member given none. */
  readonly promptFor?: (member: string) => string | undefined
}

/** One tmux command on Martha's own server, with the owner's environment outside any tmux. */
function onTheServer(tmux: MarthasTmux): (args: readonly string[]) => TmuxSaid {
  const server = onMarthasServer(join(tmux.place, CONFIG_FILE), tmux.server)
  const env = outsideAnyTmux(tmux.env)
  return (args) => tmux.tmux([...server, ...args], env)
}

/** The crew opened in tmux, each line told to the owner; resolves to the status the act ends with. */
export function openTheCrewInTmux(io: LinesShownToTheOwner, opening: OpeningTheCrewInTmux): number {
  const cannot = whyTmuxCannotOpen(opening.tmuxSays(), opening.id) ?? opening.members.map(whyNotATarget).find((why) => why !== undefined)
  if (cannot !== undefined) return refused(io, `martha up cannot open the crew in tmux: ${cannot}`)
  const id = opening.id!
  const running = opening.members.filter(opening.isRunning)
  running.forEach((member) => tellOwnerOn(io)(`${member} is already running, so it gets no window.`))
  const members = opening.members.filter((member) => !running.includes(member))
  if (members.length === 0) {
    tellOwnerOn(io)('every member of this crew is running, so nothing was opened.')
    return EXIT_DONE
  }
  opening.write(join(opening.place, CONFIG_FILE), THE_SERVERS_CONFIG)
  const run = onTheServer(opening)
  for (const member of members) {
    const prompt = opening.promptFor?.(member)
    const failed = openAMembersWindow(io, run, { id, root: opening.root, member, martha: opening.martha, ...(prompt === undefined ? {} : { prompt }) })
    if (failed !== undefined) return refused(io, `tmux did not open ${member}'s window: ${failed}`)
  }
  tellOwnerOn(io)(`the crew is in tmux session ${id}: martha attach shows it, from any terminal.`)
  return EXIT_DONE
}

/** `window.member`'s window opened, in place of one whose member has ended; what tmux said when it could not, else undefined. */
function openAMembersWindow(io: LinesShownToTheOwner, run: (args: readonly string[]) => TmuxSaid, window: AMembersWindow): string | undefined {
  const sessionUp = (): boolean => run(theSessionAsked(window.id)).status === 0
  const left = sessionUp() ? theWindowsIn(run(theWindowsListed(window.id)).said).find((one) => one.name === window.member) : undefined
  if (left !== undefined && !left.ended) {
    tellOwnerOn(io)(`${window.member} has a window that is still open, so it gets no other: martha attach ${window.member}`)
    return undefined
  }
  if (left !== undefined) run(theWindowClosed(window.id, window.member))
  const opened = run(sessionUp() ? theWindowOpened(window) : theSessionOpened(window))
  if (opened.status !== 0) return opened.said.trim()
  const strip = run(theStripSplit(window))
  if (strip.status !== 0) return strip.said.trim()
  tellOwnerOn(io)(`${window.member} opened in tmux`)
  return undefined
}

/** What `martha attach` reads beyond Martha's tmux: the crew's terminal and members, and the member asked for. */
export interface AttachingToTheCrew extends MarthasTmux {
  readonly terminal: string
  readonly members: readonly string[]
  readonly member: string | undefined
  /** Runs tmux on the owner's own terminal until the owner detaches; resolves to its status. */
  readonly attach: (args: readonly string[], env: Readonly<Record<string, string>>) => number
}

/** `martha attach [<member>]`: the owner's terminal attached to the crew's session; the status the act ends with. */
export function attachToTheCrew(io: LinesShownToTheOwner, attaching: AttachingToTheCrew): number {
  if (!opensInTmux(attaching.terminal)) return refused(io, `this crew opens in ${attaching.terminal}, its declaration's "terminal", so there is no tmux session to attach to.`)
  const cannot = whyTmuxCannotOpen(attaching.tmuxSays(), attaching.id)
  if (cannot !== undefined) return refused(io, `martha attach cannot reach the crew: ${cannot}`)
  const id = attaching.id!
  if (attaching.member !== undefined && !attaching.members.includes(attaching.member)) {
    return refused(io, `${attaching.member} is not on this crew (its members are ${attaching.members.join(', ')}).`)
  }
  if (onTheServer(attaching)(theSessionAsked(id)).status !== 0) return refused(io, `the crew's tmux session ${id} is not open. Open it with: martha up`)
  return attaching.attach([...onMarthasServer(join(attaching.place, CONFIG_FILE), attaching.server), ...theAttach(id, attaching.member)], outsideAnyTmux(attaching.env))
}

/**
 * How long, in ms, the member's composer is given after the relay reports the session's start before the first prompt
 * is typed: the host reports the start as its screen is drawn, before its composer reads keys.
 */
export const THE_COMPOSER_SETTLES_MS = 1500

/**
 * The owner's first prompt typed into the member's own pane on Martha's server, as the owner's keys, then Enter
 * (martha#919): the host takes it from its composer, stamped as a typed turn is. What tmux said when it could not, else
 * undefined.
 */
export function typeTheFirstPrompt(tmux: MarthasTmux, pane: string, text: string): string | undefined {
  const run = onTheServer(tmux)
  const typed = run(theTextTyped(pane, text))
  if (typed.status !== 0) return typed.said.trim()
  const sent = run(theTurnSent(pane))
  return sent.status === 0 ? undefined : sent.said.trim()
}

/** What `tmux -V` says on this machine, or undefined when tmux does not answer. */
export function tmuxSaysOnThisMachine(): string | undefined {
  const tmux = spawnSync(theTmuxProgram(), ['-V'], { encoding: 'utf8' })
  return tmux.status === 0 ? tmux.stdout : undefined
}

/** One tmux command on this machine, waited for. */
export function tmuxOnThisMachine(args: readonly string[], env: Readonly<Record<string, string>>): TmuxSaid {
  const ran = spawnSync(theTmuxProgram(), args, { encoding: 'utf8', env })
  return { status: ran.status ?? 1, said: `${ran.stdout ?? ''}${ran.stderr ?? ''}` }
}

/** tmux on the owner's own terminal, until the owner detaches. */
export function attachOnThisTerminal(args: readonly string[], env: Readonly<Record<string, string>>): number {
  return spawnSync(theTmuxProgram(), args, { stdio: 'inherit', env }).status ?? 1
}
