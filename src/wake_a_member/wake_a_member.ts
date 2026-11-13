// `martha wake <member>`: a member that is not running is started from its newest handover (martha#255 part 2).
//
// This exists so a member that outlives its context is not lost with it: an owner who parked a member, or whose member
// ended, wakes it from the handover the host wrote for it, instead of the crew starting the package again from nothing.
//
// A wake refuses before it starts anything, and each refusal names what stopped it: a name the crew does not have, a
// park the store will not answer for, a handover the store will not read, and a member that never handed over. Only when
// all of them are answered is the member started, and only once it is started is its park cleared — so a member that
// failed to start is still parked, and the owner can fix the start and try again.
//
// The prompt names the handover's file and never carries its text: the file is the host's, at the path the host chose
// and stamped, and a copy in an argument would be a second handover that nothing stamped.
//
// What the wake does not do: it does not hand the acts line (a session's launcher already does, through
// ../a_crews_tools's theLineToHandAtStart), and it does not decide who may run it — it is a verb of the `martha` command
// beside `martha start`, and a member starts on the owner's terminal or not at all (martha#98).

import type { HandoverStampStore, Refused, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import {
  clearTheParkOnAWake,
  parkedPlace,
  theNewestHandover,
  theParkOf,
  type AHandover,
  type TheDeclaration,
  type ThePark,
} from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { HANDOVERS_PLACE } from '../write_my_handover/write_my_handover.ts'

/** What this slice asks of a host: the crew's own store, and the stamps the host keeps its handovers' times in. */
export interface WakeHost {
  readonly stores: TheCrewFilesStores
  readonly stamps: HandoverStampStore
}

/** What a start is asked for: the member, and the one prompt Martha adds to its own arguments. */
export interface TheWakeAsking {
  readonly member: string
  readonly prompt: string
}

/** How a member is started. The command supplies it (../run_the_martha_command), so this slice decides and the launcher starts. */
export type TheStart = (asking: TheWakeAsking) => Promise<{ readonly started: boolean; readonly refusal?: string }>

/** A wake: which member, the crew it belongs to, and when the owner asked. */
export interface Waking {
  readonly member: string
  readonly declaration: TheDeclaration
  readonly at: Date
}

/** What clearing the park said, once the member is running. */
export type TheParkAfterWaking =
  | { readonly kind: 'unparked' }
  | { readonly kind: 'was_not_parked' }
  | { readonly kind: 'could_not_be_cleared'; readonly refusal: string }

/** A member woken: the handover it was started on, and what became of its park. */
export interface Woken {
  readonly member: string
  readonly handover: AHandover
  readonly park: TheParkAfterWaking
}

/** A wake that did not happen: why, and whether the start already said it in its own words, so it is not said twice. */
export interface WhyNoWake {
  readonly refusal: string
  readonly told_by_the_start?: boolean
}

/** Why a woken member's park says it is not parked: the reason kept in the marker, so the owner reads what happened. */
export const THE_WAKE_CLEARS_THE_PARK = 'woken from its handover by the owner'

/**
 * The prompt a woken member is started on: its handover's path, and what to do with it. It names the file and never
 * quotes the handover, so the only handover a successor reads is the one the host wrote and stamped.
 */
export const theResumePrompt = (handover: AHandover, member: string): string =>
  `${member}, you are resuming from your handover at ${handover.file}. Read it first: it is what your predecessor left you. ` +
  'Then carry on with the packages it names, and check what became of anything it says was sent and never concluded before you send it again.'

/**
 * Wakes `member`: reads its park and its newest handover, starts it on the resume prompt, then clears its park — or says
 * why it did none of that. Nothing is written and nothing is started until every question has an answer.
 */
export async function wakeAMember(host: WakeHost, waking: Waking, start: TheStart): Promise<Woken | WhyNoWake> {
  const names = waking.declaration.members.map((one) => one.name)
  if (!names.includes(waking.member)) {
    return { refusal: `${waking.member} is not on this crew (its members are ${names.join(', ')}), so there is nothing to wake.` }
  }
  const park = theParkForAWake(host, waking.member)
  if ('refusal' in park) return park
  const handover = theHandoverForAWake(host, waking.member)
  if ('refusal' in handover) return handover
  const asked = await start({ member: waking.member, prompt: theResumePrompt(handover, waking.member) })
  if (!asked.started) return { refusal: asked.refusal ?? `${waking.member} was not started, and nothing says why.`, told_by_the_start: true }
  return { member: waking.member, handover, park: clearedThePark(host, waking, park) }
}

/** What the member's park is, or why the wake may not go on: a park the store will not answer for is not "not parked". */
function theParkForAWake(host: WakeHost, member: string): ThePark | Refused {
  const place = parkedPlace(host)
  if ('refusal' in place) return { refusal: `${member} cannot be woken: ${place.refusal}` }
  const park = theParkOf(place, member)
  return park.kind === 'unreadable' ? { refusal: `${member} cannot be woken: ${park.refusal}` } : park
}

/** The handover the member is started on, or why the wake may not go on. */
function theHandoverForAWake(host: WakeHost, member: string): AHandover | Refused {
  const place = host.stores.crew.place(HANDOVERS_PLACE)
  if ('refusal' in place) return { refusal: `${member} cannot be woken: ${place.refusal}` }
  const newest = theNewestHandover(place, host.stamps, member)
  if (newest.kind === 'unreadable') return { refusal: `${member} cannot be woken: ${newest.refusal}` }
  if (newest.kind === 'no_handover') {
    return { refusal: `${member} cannot be woken: it has handed nothing over, so there is nothing to resume it from.` }
  }
  return newest.handover
}

/** The park cleared once the member is running: a member that was not parked has nothing to clear, and says so. */
function clearedThePark(host: WakeHost, waking: Waking, park: ThePark): TheParkAfterWaking {
  if (park.kind !== 'parked') return { kind: 'was_not_parked' }
  const cleared = clearTheParkOnAWake(host, { member: waking.member, reason: THE_WAKE_CLEARS_THE_PARK, at: waking.at })
  return 'refusal' in cleared ? { kind: 'could_not_be_cleared', refusal: cleared.refusal } : { kind: 'unparked' }
}
