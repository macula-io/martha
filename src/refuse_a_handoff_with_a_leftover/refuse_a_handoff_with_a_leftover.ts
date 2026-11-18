// The hand-off refused while a killed run's leftover still stands (martha#719).
//
// The record a killed run left refuses a commit that would carry its bytes (martha#693). A hand-off is the other way the
// same bytes leave a member's tree: the message it sends names what the member did, and the crew that reads it cannot
// tell the run's bytes from the member's. So a HANDOFF line is refused while a leftover still stands where the record
// says it stands — judged on the bytes at that path now, never on the path alone — and the same message is sent once the
// path is restored or released. The sentence is the commit refusal's own, built with the act passed in
// (theRefusalOfWhatAKilledRunLeft), so the two cannot drift apart in either direction.
//
// It fails open exactly as that refusal does: no record, a record nobody can read, a place that cannot be asked, or a
// path whose bytes cannot be read refuses nothing.
//
// Stated limit (martha#719, R4): a hand-off is judged only where the crew's `say_to_crew` is the act that makes it. A
// hand-off by any other path — the host's own messaging between sessions, which is how this crew's members hand off
// today — is not judged. This is a speed bump on the crew's act, and not on handing off as such; the commit refusal
// stays the gate that holds for every path, because every path ends in a commit.

import { join } from 'node:path'

import type { CrewStore, TheFilesAndProcesses } from '../host_contract/host_contract.ts'
import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import {
  theDigestOf,
  theRefusalOfWhatAKilledRunLeft,
  theStandingLeftoversOf,
  WHAT_A_HAND_OFF_COMES_WHILE,
  type ILeftover,
  type IWhatACommitWouldCarry,
  type WhatAKilledRunLeft,
} from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'
import { theLeftoverRecordOf, theReleasedPathsOf } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'

/** What one call is judged with: the call, the member making it, the crew's store, and the machine its files live on. */
export interface AHandOffAsked {
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
  readonly member: string
  /** The crew's own store, where the member's record is kept; a crew that kept none refuses nothing. */
  readonly leftovers?: CrewStore
  readonly host: TheFilesAndProcesses
}

/** The text a call carries, or undefined when it carries none: a value of another shape is never read as a message. */
const theTextOf = (input: Readonly<Record<string, unknown>>): string | undefined =>
  typeof input['text'] === 'string' ? input['text'] : undefined

/** Whether the call's first line reads as a HANDOFF line: a question, a VERDICT, prose, or a line that did not read is no hand-off. */
const isAHandOff = (text: string): boolean => {
  const read = readACrewLine(text)
  return 'line' in read && read.line !== null && read.line.verb === 'HANDOFF'
}

/**
 * The bytes a leftover's path holds now, read at the tree the record names and never at the crew's checkout: undefined
 * when the record names no tree (kept before every record did, one launch long), when the file is gone, or when the
 * port will not answer — each of which is not standing, and is not refused on.
 */
const theBytesNowAt = (host: TheFilesAndProcesses, one: ILeftover): Uint8Array | undefined => {
  if (one.worktree === undefined) return undefined
  try {
    return host.stores.files.bytesOf(join(one.worktree, one.path))
  } catch {
    return undefined
  }
}

/** What the hand-off carries of the record's standing leftovers: each one's bytes as they are now, at its own tree. */
const whatStandsNow = (host: TheFilesAndProcesses, record: WhatAKilledRunLeft, released: readonly { readonly path: string; readonly worktree?: string; readonly digest: string }[]): readonly IWhatACommitWouldCarry[] =>
  theStandingLeftoversOf(record, released).flatMap((one) => {
    const bytes = theBytesNowAt(host, one)
    return bytes === undefined ? [] : [{ path: one.path, ...(one.worktree === undefined ? {} : { worktree: one.worktree }), digest: theDigestOf(bytes) }]
  })

/**
 * Why a hand-off is refused while a killed run's leftover stands, or undefined when nothing refuses it: not a
 * `say_to_crew` call, a message whose first line is no HANDOFF, a crew that kept no record for this member, a record
 * nobody can read, or no path whose bytes still hold the kept digest.
 */
export function refuseAHandOffWithALeftover(asked: AHandOffAsked): string | undefined {
  if (asked.tool !== SAY_TO_THE_CREW) return undefined
  const text = theTextOf(asked.input)
  if (text === undefined || !isAHandOff(text)) return undefined
  if (asked.leftovers === undefined) return undefined
  const kept = theLeftoverRecordOf(asked.leftovers, asked.member)
  if (kept === undefined || 'refusal' in kept || 'unreadable' in kept) return undefined
  const released = theReleasedPathsOf(asked.leftovers, asked.member)
  const carrying = whatStandsNow(asked.host, kept.record, released)
  return theRefusalOfWhatAKilledRunLeft(kept.record, carrying, WHAT_A_HAND_OFF_COMES_WHILE, released)
}
