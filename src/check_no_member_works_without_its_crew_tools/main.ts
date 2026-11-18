// No member works without its crew tools (martha#658 part 3), over this machine's Martha state:
//
//   node src/check_no_member_works_without_its_crew_tools/main.ts [--state-root <dir>]
//
// Exit 0 looked, and found no member whose crew tools window is open; 1 one or more found, each named with when its
// session lost the tools and what it did since, or a window file this check could not read; 2 the check could not be
// made. It never passes because it could not look.
//
// This exists because a session that lost its crew tools cannot say so through them: it works on, unseen, and reads as
// a member that is not running (martha#658, the instance of 2026-11-18). The launcher opens a window for such a member
// and keeps it as one file per member in the crew's store, until a later session of that member holds the tools again.
// So an open window is exactly a member that has worked, or may still work, without its crew tools, and this check
// names every one, in the way no_launcher_outlives_its_run names a launcher a killed run left.
//
// What it counts is what the window counts: the main turns the session ran, and the git pushes and merges in its shell
// lines. A call is counted when the relay hears it, so a push the gates refused is counted too: the member tried, and
// owes a milestone for the try.
//
// It reads every crew under the state root, never one checkout's: a loss is the member's, wherever its crew works. A
// state root, a crews directory or a crew with no windows place has held no window, which is a reading, not a failure:
// nothing is made where it is missing, so running this never creates the place it reads. A place the crew's store
// refuses (not this user's own, or open to others) is a check that could not be made.
//
// `--state-root` reads another state root, which is how a test drives this gate over windows it kept itself.

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { stateRootOf } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREW_TOOLS_PLACE, theMemberOfTheFile, theNoticeOf, theWindowOf, type ACrewToolsWindow } from '../keep_a_members_crew_tools_window/keep_a_members_crew_tools_window.ts'

const NAME = 'check_no_member_works_without_its_crew_tools'

/** What one crew's windows place showed: the open windows, and the files that hold no window this check can read. */
interface WhatACrewShows {
  readonly open: readonly ACrewToolsWindow[]
  readonly unread: readonly string[]
}

/** Whether a directory is there; a missing one is answered false, and anything else that stops a look is thrown. */
function isThere(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** One crew's open windows and unreadable files; a place the store refuses is thrown, so the check could not be made. */
function whatTheCrewShows(crew: string): WhatACrewShows {
  if (!isThere(join(crew, CREW_TOOLS_PLACE))) return { open: [], unread: [] }
  const place = keepTheCrewsFilesAsDirectories(crew).place(CREW_TOOLS_PLACE)
  if ('refusal' in place) throw new Error(place.refusal)
  const names = place.names()
  if ('refusal' in names) throw new Error(names.refusal)
  const open: ACrewToolsWindow[] = []
  const unread: string[] = []
  for (const name of names) {
    const member = theMemberOfTheFile(name)
    const window = member === undefined ? undefined : theWindowOf(place, member)
    if (window === undefined) unread.push(join(place.path, name))
    else if (window.to === undefined) open.push(window)
  }
  return { open, unread }
}

/** What the member did in its open window, as the window counted it. */
const whatItDid = (window: ACrewToolsWindow): string =>
  `${String(window.turns)} turn(s), ${String(window.pushes)} push(es) and ${String(window.merges)} merge(s) tried since`

/** The gate over a state root: every open window and unreadable window file, named, and the status. */
function theGate(state_root: string): number {
  const crews = join(state_root, CREWS_PLACE)
  const open: ACrewToolsWindow[] = []
  const unread: string[] = []
  try {
    for (const crew of isThere(crews) ? readdirSync(crews) : []) {
      const shown = whatTheCrewShows(join(crews, crew))
      open.push(...shown.open)
      unread.push(...shown.unread)
    }
  } catch (error) {
    console.error(`${NAME}: could not be made: ${(error as Error).message}`)
    return 2
  }
  for (const window of open) console.error(`${NAME}: ${theNoticeOf(window)} ${whatItDid(window)}.`)
  for (const file of unread) console.error(`${NAME}: ${file} holds no window this check can read, so a member working without its crew tools cannot be ruled out`)
  const said =
    open.length + unread.length === 0
      ? `no member works without its crew tools (read under ${state_root})`
      : `${String(open.length)} member(s) and ${String(unread.length)} file(s) above: a session lost its crew tools and no later session of that member holds them again`
  console.error(`${NAME}: ${said}`)
  return open.length + unread.length === 0 ? 0 : 1
}

/**
 * The value of `name` in the arguments, or undefined when it was not given. A flag given with no value, or with another
 * flag where its value goes, answers null: reading the home state root in its place would pass over a root nobody asked for.
 */
const option = (name: string): string | null | undefined => {
  const at = process.argv.indexOf(name)
  if (at === -1) return undefined
  const value = process.argv[at + 1]
  return value === undefined || value === '' || value.startsWith('-') ? null : value
}

const asked = option('--state-root')
if (asked === null) console.error(`${NAME}: could not be made: --state-root was given no directory`)
process.exitCode = asked === null ? 2 : theGate(asked ?? stateRootOf(homedir(), process.env['XDG_STATE_HOME']))
