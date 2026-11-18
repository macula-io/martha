// Where the record a killed run left is kept, and the one paragraph a member is told on its next start (#693).
//
// The record belongs to the crew's own place, which the store makes 0700 a file 0600 under, because a command line can
// carry a token: it is never posted, never put on a dashboard row, and never copied anywhere but into the prompt. The
// telling is built by one function and handed to both resume prompts (the wake's and the refresh flow's), so there is
// one text and no third prompt; the start that read it keeps the record back with its telling marked read, so a member
// is told once while its leftovers still stand for the refusals.

import type { CrewStore, Refused } from '../host_contract/host_contract.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'

import {
  KEPT_IN_A_RECORD,
  theKeptText,
  theRecordIn,
  theTellingOf,
  toldAt,
  type AKeptRecord,
  type IReleasedPath,
  type WhatAKilledRunLeft,
} from './tell_a_member_what_its_relaunch_killed.ts'

/** What a launch hands its end, so the record can be read and kept (martha#693): the crew's store, and its layout. */
export interface TheLeftoversALaunchKeeps {
  readonly crew: CrewStore
  readonly workspace: TheWorkspace | undefined
}

/** The crew's own place a member's record is kept under, one file per member. */
export const LEFTOVER_RECORDS_PLACE = 'leftover-records'

/** The file a member's record is kept under, as its own name spells it. */
export const theRecordFileNameOf = (member: string): string => `${member}.json`

/** Why the record could not be kept, or nothing when it was. */
export const keepTheLeftoverRecordOf = (crew: CrewStore, record: WhatAKilledRunLeft): string | undefined => {
  const place = crew.place(LEFTOVER_RECORDS_PLACE)
  if ('refusal' in place) return place.refusal
  const refused = place.keep(theRecordFileNameOf(record.member), theKeptText(record))
  return refused === undefined ? undefined : refused.refusal
}

/**
 * What the crew's place holds for `member`: the record, why it cannot be read, `undefined` when nothing was kept for it,
 * or why the place cannot be asked. A record nobody can read is never answered as "nothing was left" (the slice's rule
 * 3), so the caller says the reason rather than judging nothing.
 */
export const theLeftoverRecordOf = (crew: CrewStore, member: string): AKeptRecord | Refused | undefined => {
  const place = crew.place(LEFTOVER_RECORDS_PLACE)
  if ('refusal' in place) return place
  const kept = place.read(theRecordFileNameOf(member))
  if (kept === undefined || 'refusal' in kept) return kept
  return theRecordIn(kept.text)
}

/** The file a member's releases are kept under: beside its record, in the same place, one file per member. */
export const theReleaseFileNameOf = (member: string): string => `${member}-released.json`

/** One release as the place keeps it: the path, and the extra value a caller put with it, if any. */
const aReleased = (value: unknown): value is IReleasedPath => {
  if (typeof value !== 'object' || value === null) return false
  const one = value as IReleasedPath
  return typeof one.path === 'string' && one.path !== '' && (one.worktree === undefined || typeof one.worktree === 'string')
}

/** What a release file holds, read back: the entries it parses, and nothing at all from one nobody can read (rule 3). */
const theReleasesIn = (text: string): readonly IReleasedPath[] => {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter(aReleased) : []
  } catch {
    return []
  }
}

/**
 * The paths `member` has released (martha#693): what the refusals read so a file the member says is its own is not
 * refused again, and what the telling leaves out. A place that cannot be asked, or a file nobody can read, releases
 * nothing — the refusal it stands behind fails open, and a path wrongly refused is still answered by the act.
 */
export const theReleasedPathsOf = (crew: CrewStore, member: string): readonly IReleasedPath[] => {
  const place = crew.place(LEFTOVER_RECORDS_PLACE)
  if ('refusal' in place) return []
  const kept = place.read(theReleaseFileNameOf(member))
  return kept === undefined || 'refusal' in kept ? [] : theReleasesIn(kept.text)
}

/** Why the release could not be kept, or nothing when it was: each path once, the newest release of it last. */
export const keepTheReleaseOf = (crew: CrewStore, member: string, released: readonly IReleasedPath[]): string | undefined => {
  const place = crew.place(LEFTOVER_RECORDS_PLACE)
  if ('refusal' in place) return place.refusal
  const key = (one: IReleasedPath): string => `${one.worktree ?? ''}\u0000${one.path}`
  const byKey = new Map(theReleasedPathsOf(crew, member).map((one) => [key(one), one]))
  for (const one of released) byKey.set(key(one), one)
  const kept = [...byKey.values()].slice(-KEPT_IN_A_RECORD)
  const refused = place.keep(theReleaseFileNameOf(member), JSON.stringify(kept))
  return refused === undefined ? undefined : refused.refusal
}

/**
 * The paragraph a member reads on its next start, and the record kept back with its telling marked read. One function,
 * so both resume prompts carry one text. A record already told says nothing this time; its leftovers still stand for the
 * refusals until they are released or their bytes change.
 */export const theTellingOnTheNextStart = (the: {
  readonly crew: CrewStore
  readonly member: string
  readonly now_ms: number
  readonly released?: readonly IReleasedPath[]
  readonly gone?: readonly string[]
}): { readonly telling?: string; readonly unreadable?: string } => {
  const kept = theLeftoverRecordOf(the.crew, the.member)
  if (kept === undefined) return {}
  if ('refusal' in kept) return { unreadable: kept.refusal }
  if ('unreadable' in kept) return { unreadable: kept.unreadable }
  if (kept.record.told_at_ms !== undefined) return {}
  const telling = theTellingOf(kept.record, the.released ?? theReleasedPathsOf(the.crew, the.member), the.gone ?? [])
  if (telling === undefined) return {}
  // A mark that could not be kept only means the member is told once more on its next start: the telling is never held
  // back for the store's sake, and the leftovers stand either way.
  keepTheLeftoverRecordOf(the.crew, toldAt(kept.record, the.now_ms))
  return { telling }
}
