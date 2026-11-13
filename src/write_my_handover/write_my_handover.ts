// The host writes a member's handover, at the path it chose, whole, and stamps it (martha#255).
//
// A handover is what a fresh session is handed when a member's contexts run out: what it holds, what is left, what is
// decided. If the member chose where it lives, or wrote it with its own file tool, the launcher would be trusting the
// very thing it hands to the successor — so the path is the host's, the write is the host's, and the stamp is the
// host's, and a file a member wrote itself is not a handover and clears nothing (martha#16's rule 3, wired here).
//
// This slice owns the name of the file and the decision to write it; the directory is the crew store's and the writer
// is host glue behind the host contract (src/crew_files_directory), so no slice of the core touches a disk. What it
// keeps is the name: one file per member per day, in the crew's `handovers` place.
//
// The tool a member calls, and the flow that asks for a handover, are #254 part 2, and answer over a seam this does not
// depend on.

import { join } from 'node:path'

import { stampHandover } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { MEMBER_NAME } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, HandoverStampStore, Refused, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** The word a member reads once its handover is written, and the only answer a written handover gives. */
export const CREW_HANDOVER_WRITTEN = 'CREW-HANDOVER-WRITTEN'

/** The word a member answers a handover ask it may not take, with one line saying which ground it gives. */
export const CREW_REFRESH_DECLINED = 'CREW-REFRESH-DECLINED'

/**
 * The tool a member calls to hand over (martha#255): the name the launcher registers and the mod answers. Spelled
 * here, where the file and the stamp are decided, so the prompt that names it quotes this one constant.
 */
export const WRITE_MY_HANDOVER_TOOL = 'write_my_handover'

/** Where a crew keeps its handovers, under the one crew store (martha#254 part 1). */
export const HANDOVERS_PLACE = 'handovers'

/** What this slice asks of a host: the crew's own store, and nothing else. */
export type HandingOverHost = { readonly stores: TheCrewFilesStores }

/**
 * The file a member's handover written on `at` has: the day it was written and the member, and nothing the member
 * chose. A day names one file per member, so a second handover the same day replaces the first rather than leaving two
 * for a successor to choose between.
 */
export const theHandoverFile = (member: string, at: Date): string => `HANDOVER_${at.toISOString().slice(0, 10)}_${member}.md`

/** Where one crew's handovers live, `<crew>/handovers`: made when missing, refused when it is not a place to write. */
export function handoversPlace(host: HandingOverHost): CrewPlace | Refused {
  return host.stores.crew.place(HANDOVERS_PLACE)
}

/** A member handing over: what it wrote, when, and the session whose record a successor inherits. */
export interface HandingOver {
  readonly member: string
  readonly content: string
  readonly at: Date
  readonly stamps: HandoverStampStore
  /** The session handing over, named in the stamp so the successor it is handed to can inherit (#16). */
  readonly session: HostSession
}

/**
 * Writes one member's handover whole at the host's path and stamps it, answering the one word the flow waits for — or
 * saying why it could not: not a member's name, or a crew store that is not safe to write into. A refused write stamps
 * nothing, so a file that was never written can never be inherited from.
 */
export function writeMyHandover(host: HandingOverHost, handing: HandingOver): string | Refused {
  if (!MEMBER_NAME.test(handing.member)) return { refusal: `${handing.member} is not a member's name.` }
  const place = handoversPlace(host)
  if ('refusal' in place) return place
  const name = theHandoverFile(handing.member, handing.at)
  const refused = place.keep(name, handing.content)
  if (refused !== undefined) return refused
  // Stamped with the same moment the file is named for, so the day in the name and the stamp can never disagree.
  const unstamped = stampHandover(
    handing.stamps,
    { member: handing.member, session: handing.session },
    { file: join(place.path, name), content: handing.content },
    () => handing.at.getTime(),
  )
  // A file no stamp was kept for is nobody's handover, so nothing will be cleared or woken from it; the member is told
  // rather than shown the word, and the next handover replaces the file rather than leaving two to choose between.
  return unstamped ?? CREW_HANDOVER_WRITTEN
}

/** What a member's own tool call is answered over: the host's store, the host's stamps, and the session it came from. */
export interface TheHandoverToolPlaces {
  readonly host: HandingOverHost
  readonly stamps: HandoverStampStore
  readonly session: HostSession
  readonly member: string
  readonly now: () => Date
}

/** What `write_my_handover` answers: the one word, or why the handover was not written. */
export type TheHandoverToolAnswer = { readonly answer: string } | Refused

/**
 * `write_my_handover(content)`: the member's whole handover, written and stamped by the host at the path the host
 * chose, and the one word back — or why it was not written. The argument is the text and never a path: a path from the
 * member would be a place the launcher had not checked, and the file a successor reads is the one the host stamped.
 * Empty text is refused rather than written, because an empty handover would clear the session and hand the successor
 * nothing.
 */
export function theHandoverAToolWrote(places: TheHandoverToolPlaces, args: Readonly<Record<string, unknown>>): TheHandoverToolAnswer {
  const content = typeof args['content'] === 'string' ? args['content'].trim() : ''
  if (content === '') return { refusal: 'a handover is text, and this call carried none' }
  const written = writeMyHandover(places.host, {
    member: places.member,
    content: `${content}\n`,
    at: places.now(),
    stamps: places.stamps,
    session: places.session,
  })
  return typeof written === 'string' ? { answer: written } : written
}
