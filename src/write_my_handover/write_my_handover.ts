// The host writes a member's handover, at the path it chose, whole, and stamps it (martha#255).
//
// A handover is what a fresh session is handed when a member's contexts run out: what it holds, what is left, what is
// decided. If the member chose where it lives, or wrote it with its own file tool, the launcher would be trusting the
// very thing it hands to the successor — so the path is the host's, the write is the host's, and the stamp is the
// host's, and a file a member wrote itself is not a handover and clears nothing (martha#16's rule 3, wired here).
//
// What this slice owns is the path and the file. The tool a member calls, and the flow that asks for a handover, are
// #254 part 2, and answer over a seam this does not depend on.

import { join } from 'node:path'

import { stampHandover, type HandoverStampStore } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { MEMBER_NAME } from '../declare_crew/declare_crew.ts'
import { crewSubdirectory, keepCrewFile, type Refused } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** The word a member reads once its handover is written, and the only answer a written handover gives. */
export const CREW_HANDOVER_WRITTEN = 'CREW-HANDOVER-WRITTEN'

/** Where a crew keeps its handovers, under the one crew store (martha#254 part 1). */
export const HANDOVERS_PLACE = 'handovers'

/**
 * The file a member's handover written on `at` has: the day it was written and the member, and nothing the member
 * chose. A day names one file per member, so a second handover the same day replaces the first rather than leaving two
 * for a successor to choose between.
 */
export const theHandoverFile = (member: string, at: Date): string => `HANDOVER_${at.toISOString().slice(0, 10)}_${member}.md`

/** Where one crew's handovers live, `<crew>/handovers`: made when missing, refused when it is not a place to write. */
export function handoversPlace(state_root: string, root: string): { readonly path: string } | Refused {
  return crewSubdirectory(state_root, root, HANDOVERS_PLACE)
}

/** A member handing over: what it wrote, when, and the session whose record a successor inherits. */
export interface HandingOver {
  readonly state_root: string
  readonly root: string
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
export function writeMyHandover(handing: HandingOver): string | Refused {
  if (!MEMBER_NAME.test(handing.member)) return { refusal: `${handing.member} is not a member's name.` }
  const place = handoversPlace(handing.state_root, handing.root)
  if ('refusal' in place) return place
  const name = theHandoverFile(handing.member, handing.at)
  const file = join(place.path, name)
  keepCrewFile(place.path, name, handing.content)
  stampHandover(handing.stamps, { member: handing.member, session: handing.session }, { file, content: handing.content })
  return CREW_HANDOVER_WRITTEN
}
