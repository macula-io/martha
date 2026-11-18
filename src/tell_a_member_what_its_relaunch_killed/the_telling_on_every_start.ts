// Where the record a killed run left is kept, and the one paragraph a member is told on its next start (#693).
//
// The record belongs to the crew's own place, which the store makes 0700 a file 0600 under, because a command line can
// carry a token: it is never posted, never put on a dashboard row, and never copied anywhere but into the prompt. The
// telling is built by one function and handed to both resume prompts (the wake's and the refresh flow's), so there is
// one text and no third prompt; the start that read it keeps the record back with its telling marked read, so a member
// is told once while its leftovers still stand for the refusals.

import type { CrewStore, Refused } from '../host_contract/host_contract.ts'

import {
  theKeptText,
  theRecordIn,
  theTellingOf,
  toldAt,
  type AKeptRecord,
  type IReleasedPath,
  type WhatAKilledRunLeft,
} from './tell_a_member_what_its_relaunch_killed.ts'

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

/**
 * The paragraph a member reads on its next start, and the record kept back with its telling marked read. One function,
 * so both resume prompts carry one text. A record already told says nothing this time; its leftovers still stand for the
 * refusals until they are released or their bytes change.
 */
export const theTellingOnTheNextStart = (the: {
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
  const telling = theTellingOf(kept.record, the.released ?? [], the.gone ?? [])
  if (telling === undefined) return {}
  // A mark that could not be kept only means the member is told once more on its next start: the telling is never held
  // back for the store's sake, and the leftovers stand either way.
  keepTheLeftoverRecordOf(the.crew, toldAt(kept.record, the.now_ms))
  return { telling }
}
