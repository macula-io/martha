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
// two handovers apart. The verb itself is part 2 of this package; what part 1 keeps is the read it starts from.

import { join } from 'node:path'

import type { HandoverStampStore } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { OWNER } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, HostContract, Refused } from '../host_contract/host_contract.ts'

/** Where a crew keeps its park markers, under the one crew store (martha#254 part 1). */
export const PARKED_PLACE = 'parked'

/** What a member's park marker is called: one per member, so two parks never disagree. */
export const theParkMarker = (member: string): string => `${member}.parked.json`

/** What this slice asks of a host: the crew's own store, and nothing else. */
export type ParkingHost = Pick<HostContract, 'stores'>

/** A member's park, as the host wrote it: why, and since when. */
export interface ParkMarker {
  readonly reason: string
  readonly since: string
}

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
 * Whether `actor` may park a member other than itself (martha#255 r=3): the declaration's own table, answered from the
 * facts the launcher already holds. A member's role must be granted `resume_parked_work`; `owner` must be granted it
 * too, which is how a solo crew, whose declaration has no node id anywhere, can still park.
 */
export function mayParkAnother(declaration: TheDeclaration, actor: string): boolean {
  const granted = declaration.mode.may['resume_parked_work'] ?? []
  if (actor === OWNER) return granted.includes(OWNER)
  const role = declaration.members.find((one) => one.name === actor)?.role
  return role !== undefined && granted.includes(role)
}

/** What a member's marker says, or undefined when it is not parked. A marker that does not parse is not a park. */
export function theParkOf(place: CrewPlace, member: string): ParkMarker | undefined {
  const read = place.read(theParkMarker(member))
  if (read === undefined || 'refusal' in read) return undefined
  try {
    const marker: unknown = JSON.parse(read.text)
    return marker !== null && typeof marker === 'object' && 'reason' in marker && 'since' in marker ? (marker as ParkMarker) : undefined
  } catch {
    return undefined
  }
}

/** A member parking, or a member being parked by one that may. */
export interface Parking {
  readonly actor: string
  readonly member: string
  readonly reason: string
  readonly at: Date
  readonly declaration: TheDeclaration
}

/**
 * Parks `member`, the marker written whole under the crew store, or says why it would not: an actor that may not park
 * another member, or a crew store that is not a place to write. A member parking itself is always allowed.
 */
export function parkAMember(host: ParkingHost, parking: Parking): ParkMarker | Refused {
  if (parking.actor !== parking.member && !mayParkAnother(parking.declaration, parking.actor)) {
    return { refusal: `${parking.actor} may not park ${parking.member}: the declaration grants resume_parked_work to nobody of its role.` }
  }
  const place = parkedPlace(host)
  if ('refusal' in place) return place
  const marker: ParkMarker = { reason: parking.reason, since: parking.at.toISOString() }
  const refused = place.keep(theParkMarker(parking.member), `${JSON.stringify(marker)}\n`)
  return refused ?? marker
}

/** One handover of a member, as the successor is handed it. */
export interface AHandover {
  readonly file: string
  readonly content: string
}

/**
 * The newest handover `member` has, read by the time the host stamped it — never by the file's name — or undefined when
 * it has none. A file with no stamp is nobody's handover, so it is not offered, and one the store will not read is not
 * a handover either.
 */
export function theNewestHandover(place: CrewPlace, stamps: HandoverStampStore, member: string): AHandover | undefined {
  const names = place.names()
  if ('refusal' in names) return undefined
  return names
    .map((name) => ({ name, stamp: stamps.read(join(place.path, name)) }))
    .filter((one) => one.stamp !== undefined && one.stamp.member === member)
    .sort((one, other) => (other.stamp?.written_at ?? '').localeCompare(one.stamp?.written_at ?? ''))
    .flatMap(({ name }) => {
      const read = place.read(name)
      return read === undefined || 'refusal' in read ? [] : [{ file: join(place.path, name), content: read.text }]
    })
    .at(0)
}
