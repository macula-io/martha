// A member is parked by a marker kept beside it, and woken from its newest handover (martha#255).
//
// A park has to outlive the session it is about: a clear, a restart or a refresh all replace the session, so a park kept
// in one would be forgotten exactly when it matters. The marker is therefore a small file per member, in the crew store
// every member reads, under the same rule every crew file is written by — and that writer is host glue behind the host
// contract (src/crew_files_directory), so this slice decides and the host writes.
//
// Who may park another member is answered from what the launcher already holds — the declaration it started its member
// from — and not from who_may_act: that compares node ids against signed lists, and a solo crew has neither (r=3).
//
// Waking is the owner's: `martha wake <member>` starts a member that is not running from its newest handover, read by
// the time the host stamped it rather than by the file's own name, because a name carries a day and a day cannot tell
// two handovers apart. The verb itself, and the prompt it starts the member on, are ../wake_a_member.
//
// Both questions are answered in three ways rather than two (part 2, decision 1). A store that will not vouch for a
// marker, or will not list a place, is not the same fact as a member nobody parked, and part 1 answered `undefined` for
// both because it had no caller. A caller that reads "not parked" from a store it could not read would wake a member
// its owner had parked, and say nothing.
//
// A park is never deleted: the store keeps whole files and replaces them, and it has no remove (part 2, decision 2). An
// unpark is the same marker with `parked: false`, so the record of who unparked a member, why and when is kept.

import { join } from 'node:path'

import { OWNER } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, HandoverStampStore, Refused, TheCrewFilesStores } from '../host_contract/host_contract.ts'

/** Where a crew keeps its park markers, under the one crew store (martha#254 part 1). */
export const PARKED_PLACE = 'parked'

/** What a member's park marker is called: one per member, so two parks never disagree. */
export const theParkMarker = (member: string): string => `${member}.parked.json`

/** What this slice asks of a host: the crew's own store, and nothing else. */
export type ParkingHost = { readonly stores: TheCrewFilesStores }

/** A member's park, as the host wrote it: whether it is parked, why, and since when. An unpark is one of these too. */
export interface ParkMarker {
  readonly parked: boolean
  readonly reason: string
  readonly since: string
}

/**
 * What a member's park is, as far as the store will say (part 2, decision 1): parked, not parked with the last marker
 * that said so, or a question the store would not answer. Never one answer for two facts.
 */
export type ThePark =
  | { readonly kind: 'parked'; readonly marker: ParkMarker }
  | { readonly kind: 'not_parked'; readonly last_marker: ParkMarker | null }
  | { readonly kind: 'unreadable'; readonly refusal: string }

/** The declaration, as much of it as parking is decided by (../declare_crew). */
export interface TheDeclaration {
  readonly members: readonly { readonly name: string; readonly role: string }[]
  readonly mode: { readonly may: Readonly<Record<string, readonly string[]>> }
}

/** Where one crew's park markers live, `<crew>/parked`: made when missing, refused when it is not a place to write. */
export function parkedPlace(host: ParkingHost): CrewPlace | Refused {
  return host.stores.crew.place(PARKED_PLACE)
}

/**
 * Whether `actor` may move a member other than itself into or out of a park (martha#255 r=3): the declaration's own
 * table, answered from the facts the launcher already holds. A member's role must be granted `resume_parked_work`;
 * `owner` must be granted it too, which is how a solo crew, whose declaration has no node id anywhere, can still park.
 *
 * One grant covers both directions: the act is `resume_parked_work`, and a member that may resume another's parked work
 * may also say when it is parked.
 */
export function mayParkOrUnparkAnother(declaration: TheDeclaration, actor: string): boolean {
  const granted = declaration.mode.may['resume_parked_work'] ?? []
  if (actor === OWNER) return granted.includes(OWNER)
  const role = declaration.members.find((one) => one.name === actor)?.role
  return role !== undefined && granted.includes(role)
}

/**
 * What a member's park is: the marker the host keeps, read whole. A marker the store will not hand over is `unreadable`
 * with the store's own reason; a file that holds no marker is `unreadable` too, because nobody can say whether the
 * member is parked and answering "not parked" would be a guess with a member's session behind it.
 */
export function theParkOf(place: CrewPlace, member: string): ThePark {
  const marker_file = theParkMarker(member)
  const read = place.read(marker_file)
  if (read === undefined) return { kind: 'not_parked', last_marker: null }
  if ('refusal' in read) return { kind: 'unreadable', refusal: read.refusal }
  const marker = markerIn(read.text)
  if (marker === undefined) {
    return { kind: 'unreadable', refusal: `${join(place.path, marker_file)} holds no park marker, so Martha cannot say whether ${member} is parked.` }
  }
  return marker.parked ? { kind: 'parked', marker } : { kind: 'not_parked', last_marker: marker }
}

/** The marker `text` holds, or undefined when it holds none: every field of it, or it is nobody's marker. */
function markerIn(text: string): ParkMarker | undefined {
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch {
    return undefined
  }
  if (held === null || typeof held !== 'object') return undefined
  const { parked, reason, since } = held as Record<string, unknown>
  if (typeof parked !== 'boolean' || typeof reason !== 'string' || typeof since !== 'string') return undefined
  return { parked, reason, since }
}

/** A member parking, or being parked by one that may; and a member unparking, or being unparked by one that may. */
export interface Parking {
  readonly actor: string
  readonly member: string
  readonly reason: string
  readonly at: Date
  readonly declaration: TheDeclaration
}

/**
 * Parks `member`, the marker written whole under the crew store, or says why it would not: an actor that may not move
 * another member's park, or a crew store that is not a place to write. A member parking itself is always allowed.
 */
export function parkAMember(host: ParkingHost, parking: Parking): ParkMarker | Refused {
  return moveThePark(host, parking, true)
}

/**
 * Unparks `member` — the marker written whole with `parked: false`, never deleted, so the record of who unparked it and
 * why is kept — or says why it would not. The same grant decides it as decides a park.
 */
export function unparkAMember(host: ParkingHost, parking: Parking): ParkMarker | Refused {
  return moveThePark(host, parking, false)
}

/** The one writer of a park marker, for every direction, so a park and an unpark can never be kept differently. */
function keepTheMarker(host: ParkingHost, member: string, parked: boolean, reason: string, at: Date): ParkMarker | Refused {
  const place = parkedPlace(host)
  if ('refusal' in place) return place
  const marker: ParkMarker = { parked, reason, since: at.toISOString() }
  const refused = place.keep(theParkMarker(member), `${JSON.stringify(marker)}\n`)
  return refused ?? marker
}

/** A park or an unpark asked for by someone: the grant is checked, then the marker is kept. */
function moveThePark(host: ParkingHost, parking: Parking, parked: boolean): ParkMarker | Refused {
  const act = parked ? 'park' : 'unpark'
  if (parking.actor !== parking.member && !mayParkOrUnparkAnother(parking.declaration, parking.actor)) {
    return { refusal: `${parking.actor} may not ${act} ${parking.member}: the declaration grants resume_parked_work to nobody of its role.` }
  }
  return keepTheMarker(host, parking.member, parked, parking.reason, parking.at)
}

/**
 * The owner's own wake clears the park of the member it is starting (`martha wake`, ../wake_a_member), and asks no
 * table: the grant decides who may move another member's park from *inside* the crew, and a wake is the owner at their
 * own terminal, as `martha start` is. The marker says so, so the record reads that the member was woken and not that
 * it unparked itself.
 */
export function clearTheParkOnAWake(host: ParkingHost, waking: { readonly member: string; readonly reason: string; readonly at: Date }): ParkMarker | Refused {
  return keepTheMarker(host, waking.member, false, waking.reason, waking.at)
}

/** One handover of a member, as the successor is handed it. */
export interface AHandover {
  readonly file: string
  readonly content: string
}

/**
 * What a wake has to start a member on: the newest handover the host stamped for it, no handover at all, or a question
 * the store would not answer (part 2, decision 1).
 */
export type TheHandoverToWakeFrom =
  | { readonly kind: 'a_handover'; readonly handover: AHandover }
  | { readonly kind: 'no_handover' }
  | { readonly kind: 'unreadable'; readonly refusal: string }

/**
 * The newest handover `member` has, read by the time the host stamped it — never by the file's name. A file with no
 * stamp is nobody's handover, so it is not offered. A place the store cannot list, or a handover it will not read, is
 * `unreadable` with its reason rather than `no_handover`.
 */
export function theNewestHandover(place: CrewPlace, stamps: HandoverStampStore, member: string): TheHandoverToWakeFrom {
  const names = place.names()
  if ('refusal' in names) return { kind: 'unreadable', refusal: names.refusal }
  const stamped: { readonly name: string; readonly written_at: string }[] = []
  for (const name of names) {
    const stamp = stamps.read(join(place.path, name))
    if (stamp === undefined) continue
    // A stamp the store will not hand over is a question it would not answer, for any member's handover in the place.
    if ('refusal' in stamp) return { kind: 'unreadable', refusal: stamp.refusal }
    if (stamp.member === member) stamped.push({ name, written_at: stamp.written_at })
  }
  const newest = stamped.sort((one, other) => other.written_at.localeCompare(one.written_at)).at(0)
  if (newest === undefined) return { kind: 'no_handover' }
  const read = place.read(newest.name)
  if (read === undefined) {
    return { kind: 'unreadable', refusal: `${join(place.path, newest.name)} was listed and is not there, so Martha cannot hand it over.` }
  }
  if ('refusal' in read) return { kind: 'unreadable', refusal: read.refusal }
  return { kind: 'a_handover', handover: { file: join(place.path, newest.name), content: read.text } }
}

/** Two refreshes of one member inside this window are a storm, and a storm is parked, not refused. */
export const STORM_WINDOW_MS = 30 * 60_000

/** How many refreshes inside the window are a storm. */
export const STORM_THRESHOLD = 2

/** Whether this refresh is one too many inside the window: a storm, parked rather than refused. */
export function isAStorm(refreshed_at: readonly number[], now: number): boolean {
  const inside = refreshed_at.filter((at) => now - at < STORM_WINDOW_MS)
  return inside.length + 1 >= STORM_THRESHOLD
}

/** The line a storm sends the Supervisor, once: which member, at which contexts, from which handover. */
export function theStormLine(storm: { readonly member: string; readonly percents: readonly number[]; readonly file: string }): string {
  const minutes = Math.round(STORM_WINDOW_MS / 60_000)
  return (
    `${storm.member} was parked after ${storm.percents.length} refreshes inside ${minutes} minutes ` +
    `(at ${storm.percents.join('%, ')}%), the last from ${storm.file}. It stays parked until the owner or the Supervisor wakes it.`
  )
}
