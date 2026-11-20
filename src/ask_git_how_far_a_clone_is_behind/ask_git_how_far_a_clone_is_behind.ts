// Asking git how far a read's clone is behind its origin (martha#969, gap 9 of #957), ported from crew-code's
// hooks/register.tsx (where the rule was first kept): the I/O half of ../note_a_read_in_a_stale_clone.
//
// A host adapter: it asks git through the host contract's processes and reads the FETCH_HEADs on this machine's disk,
// as ../ask_git_what_a_member_is_about_to_change reads real paths. Every git run carries Martha's own settings
// (../run_marthas_own_git) and only reads: `rev-parse --git-common-dir`, `symbolic-ref` for the default branch, and
// `rev-list --count`. Nothing here fetches or writes.
//
// It never stands in the read's way. A git that cannot be run, a place that is no repository, or a default branch git
// cannot name gives no note: a note is never invented, and the read's own result goes back unchanged.
//
// The clone is measured against its default branch as origin names it. crew-code's per-clone working branch is
// not in Martha (gap 11 of #957), so it is not here either.

import { readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import type { TheFilesAndProcesses } from '../host_contract/host_contract.ts'
import { theDefaultBranchOf } from '../ask_git_what_a_member_is_about_to_change/ask_git_what_a_member_is_about_to_change.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import {
  behindOf,
  staleCloneNote,
  tellingOncePerTurn,
  theCloneAReadLandsIn,
  type TheReadPlaces,
} from '../note_a_read_in_a_stale_clone/note_a_read_in_a_stale_clone.ts'

/** How long a clone's facts are held before git is asked again: a member reading ten files runs git once. */
export const HELD_FACTS_MS = MINUTE_MS / 2

/** The file git writes at every fetch, once per worktree: the clone's own, and each linked worktree's. */
const FETCH_HEAD = 'FETCH_HEAD'

/** Where a repository's linked worktrees keep their own files, under its common directory. */
const LINKED_WORKTREES = 'worktrees'

/** The words git takes to name the directory a clone and all its worktrees share. */
const THE_COMMON_DIR = ['rev-parse', '--git-common-dir']

/** The stale-read note of one launch: told of each main turn's start, and asked for each read's note. */
export interface TheStaleReads {
  /** A main turn of `session` started: a clone told about in its last turn is told again. */
  aTurnStarted(session: string): void
  /** The note a read of `path` carries, or '' when it carries none. `path` is the one the read names, as its host resolves it. */
  theNoteForARead(session: string, path: string): Promise<string>
}

/** What the adapter asks through: the host that runs git, the crew's declared places, and the launch's clock. */
export interface TheStaleReadPlaces {
  readonly host: TheFilesAndProcesses
  readonly places: TheReadPlaces
  readonly now: () => number
}

/** What git and the disk said of one clone, and when they were asked. */
interface HeldFacts {
  readonly at: number
  readonly branch: string
  readonly behind: number
  readonly fetchedAt: number | null
}

/** What git printed, trimmed, or undefined when it could not be run or did not end well. */
async function whatGitPrinted(host: TheStaleReadPlaces['host'], cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await host.processes.run({ command: 'git', args: marthasOwnGitArgs(args), cwd }).catch(() => undefined)
  return outcome === undefined || outcome.exit_code !== 0 ? undefined : outcome.stdout.trim()
}

/** When a file was last written, or null when it is not there. */
function modifiedAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

/** The names under a directory, or none when it cannot be read. */
function namesUnder(directory: string): readonly string[] {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

/**
 * When a clone was last fetched: the newest of its own FETCH_HEAD and every linked worktree's. A fetch run in a
 * worktree moves the shared refs but writes only that worktree's FETCH_HEAD, so the clone's own can be days older than
 * the fetch that made it current. Null when nothing was ever fetched.
 */
function theLastFetchOf(common: string): number | null {
  const paths = [join(common, FETCH_HEAD), ...namesUnder(join(common, LINKED_WORKTREES)).map((name) => join(common, LINKED_WORKTREES, name, FETCH_HEAD))]
  const times = paths.map(modifiedAt).filter((at): at is number => at !== null)
  return times.length === 0 ? null : Math.max(...times)
}

/** What git and the disk say of one clone now, or undefined when the clone is no repository or names no default branch. */
async function theFactsOf(host: TheStaleReadPlaces['host'], clone: string, at: number): Promise<HeldFacts | undefined> {
  const common = await whatGitPrinted(host, clone, THE_COMMON_DIR)
  if (common === undefined || common === '') return undefined
  const branch = await theDefaultBranchOf(host, clone)
  if (branch === null) return undefined
  const count = await whatGitPrinted(host, clone, ['rev-list', '--count', `HEAD..origin/${branch}`])
  return { at, branch, behind: behindOf(count ?? ''), fetchedAt: theLastFetchOf(isAbsolute(common) ? common : join(clone, common)) }
}

/** The stale-read note over the crew's places, asking git through `host`. */
export function staleReadsOver(over: TheStaleReadPlaces): TheStaleReads {
  const held = new Map<string, HeldFacts>()
  const told = tellingOncePerTurn()

  const factsOf = async (clone: string): Promise<HeldFacts | undefined> => {
    const now = over.now()
    const known = held.get(clone)
    if (known !== undefined && now - known.at < HELD_FACTS_MS) return known
    const facts = await theFactsOf(over.host, clone, now)
    if (facts === undefined) held.delete(clone)
    else held.set(clone, facts)
    return facts
  }

  return {
    aTurnStarted: (session) => told.aTurnStarted(session),
    theNoteForARead: async (session, path) => {
      const clone = theCloneAReadLandsIn(path, over.places)
      if (clone === null) return ''
      const facts = await factsOf(clone).catch(() => undefined)
      if (facts === undefined) return ''
      const note = staleCloneNote({ dir: clone, branch: facts.branch, behind: facts.behind, fetchedAt: facts.fetchedAt, now: over.now() })
      return note !== '' && told.firstThisTurn(session, clone) ? note : ''
    },
  }
}
