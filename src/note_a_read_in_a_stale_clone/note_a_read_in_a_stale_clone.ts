// A read that lands in a shared clone behind its origin says so (martha#969, gap 9 of #957), ported from crew-code's
// core/stale_clone.ts (where the rule was first kept).
//
// A member who reads code in a clone that is behind origin, and reports what it read, reports code that may already be
// fixed upstream. The rule "fetch, read origin/<default>, cite the sha" lived only in briefs and memory, so nothing
// caught it. This decides which clone a read lands in, what git's count means, and what the reader is told. It does
// no I/O: ../ask_git_how_far_a_clone_is_behind asks git and the disk, and the relay carries the note on the read's own
// result.
//
// A worktree is never checked: it is where a member's own branch lives, and being behind the default branch there is
// what a worktree is for. A clone is the shared reading surface, so it is the one place stale code is read as if it
// were the crew's.
//
// The count alone is not enough: a clone nobody has fetched since origin moved reads 0 behind, because its local
// `origin/<branch>` has not moved either. So the age of the last fetch is part of the answer, and a clone not fetched
// for an hour says so even when the count is zero.

import { join, sep } from 'node:path'

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'

/** The crew's two declared places a read is judged against: where its clones are, and where its worktrees are. */
export interface TheReadPlaces {
  readonly clones: string
  readonly worktrees: string
}

const isUnder = (path: string, place: string): boolean => path === place || path.startsWith(`${place}${sep}`)

/**
 * The clone a read lands in, `<clones>/<org>/<repo>` as the crew lays one out, or null: a read in a worktree, outside
 * the clones, or above any one clone lands in none. The path is the one the read names, as its host resolves it.
 */
export function theCloneAReadLandsIn(path: string, at: TheReadPlaces): string | null {
  if (isUnder(path, at.worktrees) || !isUnder(path, at.clones)) return null
  const [org, repo] = path.slice(at.clones.length + 1).split(sep)
  return org === undefined || org === '' || repo === undefined || repo === '' ? null : join(at.clones, org, repo)
}

/**
 * How old a fetch may be before the count stops meaning anything: inside it, `origin/<branch>` is close enough to what
 * the next fetch would bring that the count is the whole answer.
 */
export const STALE_FETCH_MS = 60 * MINUTE_MS

/**
 * The count git printed for `rev-list --count HEAD..origin/<branch>`. Anything that is not a count (an error, a ref that
 * is not there) is zero, because a note is never invented.
 */
export function behindOf(stdout: string): number {
  const count = /^\s*(\d+)\s*$/.exec(stdout)?.[1]
  return count === undefined ? 0 : Number(count)
}

const MINUTES_SAID_UP_TO = 120
const A_HOUR_IN_MINUTES = 60
const HOURS_SAID_UP_TO = 48
const A_DAY_IN_HOURS = 24

/** How long ago, in the words a reader uses: minutes under two hours, then hours under two days, then days. */
function ageOf(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS))
  if (minutes < MINUTES_SAID_UP_TO) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / A_HOUR_IN_MINUTES)
  if (hours < HOURS_SAID_UP_TO) return `${hours} hours`
  return `${Math.floor(hours / A_DAY_IN_HOURS)} days`
}

/**
 * What the check knows of one clone: the branch it is measured against, how far behind it is, when it was last fetched
 * (null when never), and the caller's clock, so the whole decision is made here and tested as one.
 */
export interface TheCloneFacts {
  readonly dir: string
  readonly branch: string
  readonly behind: number
  readonly fetchedAt: number | null
  readonly now: number
}

/** What the reader must be told, or '' when the clone may be trusted as it stands. */
export function staleCloneNote(at: TheCloneFacts): string {
  const age = at.fetchedAt === null ? null : Math.max(0, at.now - at.fetchedAt)
  const fix = `Run git -C ${at.dir} fetch and read origin/${at.branch} before you base a finding on it.`
  if (at.behind > 0) {
    const commits = at.behind === 1 ? '1 commit' : `${at.behind} commits`
    const asOf = age === null ? 'as far as anything here knows (it has never been fetched)' : `as of the last fetch (${ageOf(age)} ago)`
    return `note: the clone ${at.dir} is ${commits} behind origin/${at.branch} ${asOf}, so what you just read there may already be fixed upstream. ${fix}`
  }
  if (age !== null && age < STALE_FETCH_MS) return ''
  const last = age === null ? 'has never been fetched' : `was last fetched ${ageOf(age)} ago`
  return `note: the clone ${at.dir} ${last}, so what you just read there may already be fixed upstream on origin/${at.branch} and nothing here knows by how far. ${fix}`
}

/** Which clones a session was told about in its running turn: a member reading ten files is told once, not ten times. */
export interface TellingOncePerTurn {
  /** A main turn of `session` started: the clones its last turn was told about are told again. */
  aTurnStarted(session: string): void
  /** Whether `clone` is not yet told in `session`'s running turn; asking marks it told. */
  firstThisTurn(session: string, clone: string): boolean
}

export function tellingOncePerTurn(): TellingOncePerTurn {
  const told = new Map<string, Set<string>>()
  return {
    aTurnStarted(session) {
      told.delete(session)
    },
    firstThisTurn(session, clone) {
      const clones = told.get(session) ?? new Set<string>()
      told.set(session, clones)
      if (clones.has(clone)) return false
      clones.add(clone)
      return true
    },
  }
}
