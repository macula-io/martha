// The launch records a home's state root holds, for every project in it (martha#472), as a reader of another home's
// state asks for them: the rows each project's records directory keeps, and where they were read.
//
// A launch record is kept per project, in `<state root>/<project>/launches` (start_a_member's places, the launcher's
// records, martha#42), so a reader that knows only a run's HOME and XDG_STATE_HOME cannot name one project: it reads
// every project the state root holds. A home with no state root, or one whose project holds no records place, has
// launched nothing, and says nothing about any member.
//
// What is vouched for, and what is not: a records directory is read only when it is a directory of this user's that
// only this user may enter. Anything else is said, and never read: a records directory another user may write into
// could hold a record naming any process. What a row must say to be a launch is the binder's to decide, not this
// file's: the rows are handed on as they were kept.

import { readdirSync, type Stats, statSync } from 'node:fs'
import { join } from 'node:path'
import { getuid } from 'node:process'

import type { KeyedRow } from '../host_contract/host_contract.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'

/** The crew's own conventions a state root is read by: what this file may not decide, and may not import. */
export interface TheStatesConventions {
  /** Where a home's own environment puts its state root, and under what name. */
  readonly state_root_of: (home: string, xdg_state_home: string | undefined) => string
  /** The directory inside a project's state that holds the launcher's records. */
  readonly records_place: string
  /** The mode of a directory only its owner may enter. */
  readonly only_its_owner_may_enter: number
}

/** One project's launch records, and the directory they were read from. */
export interface RecordsOfAProject {
  readonly where: string
  readonly rows: readonly KeyedRow[]
}

/** What reading a home's state root found, or why this reader will not vouch for one of its places. */
export type RecordsUnder = { readonly projects: readonly RecordsOfAProject[] } | { readonly cannot_tell: string }

/** The reason a records directory this reader will not vouch for is said as. */
export const NOT_OURS = 'is not a directory of yours that only you may enter, so its launch records cannot be vouched for'

/** The bits of a mode that say who may read, write and enter. */
const PERMISSION_BITS = 0o777

/** A reader of the launch records a home's state root holds, for the crew's conventions `the_state` names. Where a
 * home's state root is comes from `the_state` too: it is the state's to decide, not this machine's. */
export function launchRecordsUnder(the_state: TheStatesConventions) {
  return (home: string, xdg_state_home: string | undefined): RecordsUnder => {
    const state_root = the_state.state_root_of(home, xdg_state_home)
    const projects: RecordsOfAProject[] = []
    for (const entry of projectsIn(state_root)) {
      const directory = join(state_root, entry, the_state.records_place)
      const found = statOf(directory)
      // No records place in this project is no record: a project that never launched a member says nothing.
      if (found === undefined) continue
      if (!found.isDirectory() || found.uid !== getuid?.() || (found.mode & PERMISSION_BITS) !== the_state.only_its_owner_may_enter) {
        return { cannot_tell: `${directory} ${NOT_OURS}` }
      }
      projects.push({ where: directory, rows: launchRecordsDirectory(directory).all() })
    }
    return { projects }
  }
}

/** The directories under a state root, by name; none when there is no state root to read. */
function projectsIn(state_root: string): readonly string[] {
  try {
    return readdirSync(state_root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** What is at a path, or undefined when nothing is. */
function statOf(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}
