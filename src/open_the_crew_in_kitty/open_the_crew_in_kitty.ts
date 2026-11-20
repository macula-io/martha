// Bare `martha start` (#547 S6, for #572): every member of the crew opened in a kitty tab of its own, the member held
// at the project's root, the crew strip as a split under it, and the tab titled from the member's row.
//
// This exists so the owner opens the whole crew with one act, and sees from every tab which member waits on them.
// kitty is the terminal around `martha start <member>`, not a host beside Claude Code and the engine: each tab runs
// exactly that command, so the start table is not touched. The session text, the checker and the refusals are
// ./the_session_kitty_reads's; this reads the machine, writes the two files, and starts kitty.
//
// Martha starts its own kitty instance, never the owner's open one, whose remote-control settings are the owner's:
// remote control is off and there is no socket, whatever the owner's kitty.conf says, and each strip gets a private
// line of its own, judged by the checker alone. A member's window has no line. It is a speed bump, not a boundary:
// the two files belong to the owner's uid, as everything a member could reach does (martha#1 decision 2).

import { spawn, spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { EXIT_DONE, refused, tellOwnerOn, type LinesShownToTheOwner } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { KITTEN, KITTY, THE_STRIPS_ACTIONS, theCheckerSource, theKittyArguments, theSessionText, whyKittyCannotOpen, withoutKittysVariables } from './the_session_kitty_reads.ts'

/** The session file kitty reads, and the checker it runs, under this run's place in Martha's state. */
export const SESSION_FILE = 'crew.kitty-session'
export const CHECKER_FILE = 'the_strips_line.py'
/** This crew's place in Martha's state for the kitty a bare `martha start` opens. */
export const KITTY_PLACE = 'crew-in-kitty'

/** Owner-only: the two files hold the commands kitty runs. */
const OWNER_ONLY = 0o600

/** What opening the crew reads and does, so a test can stand in for the machine. */
export interface OpeningTheCrew {
  readonly root: string
  /** The declared members, in the crew's order. */
  readonly members: readonly string[]
  readonly isRunning: (member: string) => boolean
  /** This release of `martha`: the program and its arguments before the act. */
  readonly martha: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  /** Where this run's files go, a directory in Martha's state, never in the checkout. */
  readonly place: string
  /** What `kitty --version` says, or undefined when kitty or kitten is not on the PATH. */
  readonly kittySays: () => string | undefined
  readonly write: (path: string, text: string) => void
  /** Starts kitty detached with these arguments and environment. */
  readonly startKitty: (args: readonly string[], env: Readonly<Record<string, string>>) => void
}

/** The crew opened in kitty, each line told to the owner; resolves to the status the act ends with. */
export function openTheCrewInKitty(io: LinesShownToTheOwner, opening: OpeningTheCrew): number {
  const cannot = whyKittyCannotOpen({ kitty: opening.kittySays(), env: opening.env })
  if (cannot !== undefined) return refused(io, cannot)
  const running = opening.members.filter(opening.isRunning)
  const members = opening.members.filter((member) => !running.includes(member))
  running.forEach((member) => tellOwnerOn(io)(`${member} is already running, so it gets no tab.`))
  if (members.length === 0) {
    tellOwnerOn(io)('every member of this crew is running, so nothing was opened.')
    return EXIT_DONE
  }
  const checker = join(opening.place, CHECKER_FILE)
  const session = theSessionText({ root: opening.root, members, martha: opening.martha, checker })
  if ('refusal' in session) return refused(io, session.refusal)
  const file = join(opening.place, SESSION_FILE)
  opening.write(checker, theCheckerSource(THE_STRIPS_ACTIONS))
  opening.write(file, session.text)
  opening.startKitty(theKittyArguments(file), withoutKittysVariables(opening.env))
  members.forEach((member) => tellOwnerOn(io)(`${member} opened in kitty`))
  return EXIT_DONE
}

/** What `kitty --version` says on this machine, when both kitty and kitten answer; else undefined. */
export function kittySaysOnThisMachine(): string | undefined {
  const kitty = spawnSync(KITTY, ['--version'], { encoding: 'utf8' })
  const kitten = spawnSync(KITTEN, ['--version'], { encoding: 'utf8' })
  return kitty.status === 0 && kitten.status === 0 ? kitty.stdout : undefined
}

/**
 * Writes `text` at `path`, owner-only, in place of what was there: the old file (or a link left in its place) is
 * removed first, and the new one is made exclusively, so its mode is the one given and no link is followed.
 */
export function writeOwnerOnly(path: string, text: string): void {
  rmSync(path, { force: true })
  writeFileSync(path, text, { mode: OWNER_ONLY, flag: 'wx' })
}

/** Starts kitty detached from this process, so `martha start` returns while the crew runs. */
export function startKittyDetached(args: readonly string[], env: Readonly<Record<string, string>>): void {
  spawn(KITTY, args, { detached: true, stdio: 'ignore', env }).unref()
}
