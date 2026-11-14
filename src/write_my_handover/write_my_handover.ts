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
import type { CrewPlace, HandoverStamp, HandoverStampStore, Refused, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { HANDOVER_LIMIT_PERCENT } from '../refresh_a_member/refresh_a_member.ts'
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

/** The grounds a member may give, in the practice's own words, so the line it writes is the line the design names. */
export const DECLINE_GROUNDS = [
  'an approved range it has not pushed yet, or a push or tag ask it is still waiting on',
  'a change in hand',
  'a reply it must act on',
] as const

/** The ground an at-limit decline may give: the only one the design allows there. */
export const THE_LIMIT_GROUND = 'it cannot reach a safe point at all'

/**
 * The prompt a member is asked to hand over with. The file is the host's and the member is told no path: the tool
 * writes it where the launcher decided, and a path in a prompt would be a second place a handover could come from.
 */
export function theHandoverPrompt(asking: { readonly at_limit: boolean; readonly percent: number }): string {
  const first = asking.at_limit
    ? [
        `Your context is at ${asking.percent}%, past the ${HANDOVER_LIMIT_PERCENT}% handover limit, so this session hands over to a fresh one.`,
        'First reach a safe point: finish the edit you are in, then commit or stash the work so the working tree is clean.',
        'If an approved push has not been made yet, make it first: the yes is for that exact sha.',
      ]
    : [
        'Your task is done and your context is large, so this session will be cleared and restarted from a handover.',
        'First decide whether that is safe.',
      ]
  const grounds = asking.at_limit ? `Only if ${THE_LIMIT_GROUND},` : `If ${DECLINE_GROUNDS.join('; ')},`
  return [
    ...first,
    `${grounds} answer exactly ${CREW_REFRESH_DECLINED} and one line saying which ground it is.`,
    `Otherwise write your handover with the ${WRITE_MY_HANDOVER_TOOL} tool, in the shape the practice gives: first rules;`,
    'what runs; open items in order; pending decisions; gotchas; and one line for each package your row says you hold,',
    `carrying its branch and tip sha or "nothing committed". Then answer exactly ${CREW_HANDOVER_WRITTEN}.`,
  ].join(' ')
}

/** The note a handover that missed something is sent back with: what was missing, and the word to answer with. */
export function theSendBackNote(missing: readonly string[]): string {
  return (
    `Your handover is not accepted yet: ${missing.join('; ')}. Write it again with the ${WRITE_MY_HANDOVER_TOOL} tool, ` +
    `then answer exactly ${CREW_HANDOVER_WRITTEN}.`
  )
}

/**
 * What became of the handover a member says it wrote: accepted, sent back once with what was missing, or — at the
 * limit, and on a second miss — cleared anyway, because a clear that never happens is worse than an imperfect
 * handover. The stamp is the host's, so a file written before this flow asked is never taken for this flow's work.
 */
export type HandoverVerdict =
  | { readonly kind: 'accepted'; readonly missing: readonly string[] }
  | { readonly kind: 'not_written'; readonly why: string }
  | { readonly kind: 'sent_back'; readonly missing: readonly string[] }
  | { readonly kind: 'cleared_anyway'; readonly missing: readonly string[] }

/** What a handover is judged on: the host's stamp for the file, the file's text, and what the member's row holds. */
export interface TheHandoverRead {
  readonly stamp: HandoverStamp | Refused | undefined
  readonly text: string
  readonly asked_at: number
  /** The packages the member's row says it holds. */
  readonly holds: readonly string[]
  /** How many times this flow has already sent one back. */
  readonly sent_back: number
  readonly at_limit: boolean
}

/** Every package line a handover is missing, in the order the row names the packages. */
export function packagesMissingFrom(text: string, holds: readonly string[]): readonly string[] {
  return holds.filter((held) => !text.includes(held)).map((held) => `no line naming ${held}`)
}

/** Whether the handover was written after this flow asked for it, by the host's stamp. */
function writtenAfterAsking(stamp: HandoverStamp | Refused | undefined, asked_at: number): stamp is HandoverStamp {
  if (stamp === undefined || 'refusal' in stamp) return false
  const written = Date.parse(stamp.written_at)
  return Number.isFinite(written) && written >= asked_at
}

/** What the answer to a handover ask means for the flow. */
export function whatBecameOfTheHandover(reading: TheHandoverRead): HandoverVerdict {
  if (reading.stamp === undefined) return { kind: 'not_written', why: 'this session has written no handover' }
  if ('refusal' in reading.stamp) return { kind: 'not_written', why: reading.stamp.refusal }
  if (!writtenAfterAsking(reading.stamp, reading.asked_at)) {
    return { kind: 'not_written', why: 'the handover was written before this session was asked for one' }
  }
  const missing = packagesMissingFrom(reading.text, reading.holds)
  if (missing.length === 0) return { kind: 'accepted', missing }
  // At the limit a clear cannot wait, and a second miss clears anyway: the row says what was missing either way.
  if (reading.at_limit || reading.sent_back >= 1) return { kind: 'cleared_anyway', missing }
  return { kind: 'sent_back', missing }
}

/**
 * The prompt the successor resumes on: its handover's file, and the acts of its package that were sent and never
 * concluded — so it checks them instead of sending them twice (martha#254's read). The file is named, never quoted.
 */
export function theResumePrompt(resuming: { readonly member: string; readonly file: string; readonly acts: readonly string[] }): string {
  const acts =
    resuming.acts.length === 0
      ? ''
      : ` Before you send anything again, check what became of these acts of your package, which were sent and never concluded: ${resuming.acts.join('; ')}.`
  return (
    `You are ${resuming.member}. Martha just refreshed this session. Read your handover at ${resuming.file}: it is what ` +
    `your predecessor left you, and it is the only place your work stands. Then carry on with the packages it names.${acts}`
  )
}
