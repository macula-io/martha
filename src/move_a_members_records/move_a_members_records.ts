// The per-name records a member leaves behind, moved to its new name (martha#985, gap 20 of #957).
//
// This exists so `martha rename <Old> <New>` leaves a crew that works as it did under the old name: `martha start <New>`
// resumes the handover `<Old>` left, the crew's dashboard keeps the row it showed, and a parked `<Old>` is a parked
// `<New>`. Nothing is deleted, because the crew's store has no remove: each record is written again under the new name
// and the old file is left as it was written. A handover file is history — the old copy still names the member it was
// written for, and no reader of the new name takes it for their own, since its stamp names the new name only on the
// copy written here.
//
// A record that cannot be read or written is a refusal that names it: half a rename, with the declaration already
// changed, is worse than saying which record stopped it.

import { join } from 'node:path'

import type { CrewPlace, CrewStore, HandoverStampStore, Refused } from '../host_contract/host_contract.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { HANDOVERS_PLACE, theHandoverFile } from '../write_my_handover/write_my_handover.ts'
import { PARKED_PLACE, theParkMarker } from '../park_and_wake_a_member/park_and_wake_a_member.ts'

/** What a rename writes the member's records through: the crew's own store, its stamps and its dashboard. */
export interface TheRecordStores {
  readonly crew: CrewStore
  readonly stamps: HandoverStampStore
  readonly rows: DashboardStore
}

/** What a rename wrote again: the handovers it found, and whether the dashboards row and the park moved. */
export interface TheRecordsMoved {
  readonly handovers: readonly string[]
  readonly row: boolean
  readonly park: boolean
}

/**
 * What a rename wrote again, and the refusal that stopped it part-way (review r=1): the owner is told which records
 * moved and which are still under the old name, since the declaration has already changed by then.
 */
export interface TheRecordsMove extends TheRecordsMoved {
  readonly refusal?: Refused
}

/** The day a handover file's name carries. */
const A_DAY = /\d{4}-\d{2}-\d{2}/

/**
 * The day of `name` when it is exactly a handover file of `member`, as the writer names one, or null. A suffix is not
 * enough: a member may hold an underscore, so `Red_Mars`'s files end in `_Mars.md` too, and a rename of `Mars` must not
 * copy them and stamp the copies for the new name (review r=2).
 */
function theHandoverDayOf(name: string, member: string): Date | null {
  const day = A_DAY.exec(name)?.[0]
  if (day === undefined) return null
  const at = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(at.getTime()) || theHandoverFile(member, at) !== name ? null : at
}

/** The handovers this crew wrote for `from`, and the refusal that stopped the move part-way. */
function handoversMoved(stores: TheRecordStores, from: string, to: string): { readonly moved: readonly string[]; readonly refusal?: Refused } {
  const place = stores.crew.place(HANDOVERS_PLACE)
  if ('refusal' in place) return { moved: [], refusal: place }
  const names = place.names()
  if ('refusal' in names) return { moved: [], refusal: names }
  const moved: string[] = []
  for (const name of names) {
    const at = theHandoverDayOf(name, from)
    if (at === null) continue
    const refusal = oneHandoverMoved(stores, place, name, theHandoverFile(to, at), to)
    if (refusal !== undefined) return { moved, refusal }
    moved.push(name)
  }
  return { moved }
}

/** One handover written again under the new name, and its stamp rewritten; or why it was not. */
function oneHandoverMoved(stores: TheRecordStores, place: CrewPlace, name: string, renamed: string, to: string): Refused | undefined {
  const read = place.read(name)
  if (read === undefined || 'refusal' in read) return { refusal: `${join(place.path, name)} could not be read, so it was not moved to ${to}.` }
  const kept = place.keep(renamed, read.text)
  if (kept !== undefined) return kept
  const stamped = stores.stamps.read(join(place.path, name))
  if (stamped === undefined || 'refusal' in stamped) return undefined
  return stores.stamps.write(join(place.path, renamed), { ...stamped, member: to })
}

/** The member's park marker written again for `to`, unchanged, since a marker names no member; or why not. */
function parkMoved(stores: TheRecordStores, from: string, to: string): Refused | boolean {
  const place = stores.crew.place(PARKED_PLACE)
  if ('refusal' in place) return place
  const read = place.read(theParkMarker(from))
  if (read === undefined || 'refusal' in read) return false
  const kept = place.keep(theParkMarker(to), read.text)
  return kept ?? true
}

/** The member's dashboard row written again for `to`, unchanged; or why not. */
function rowMoved(stores: TheRecordStores, from: string, to: string): Refused | boolean {
  const row = stores.rows.read(from)
  if (row === null) return false
  const kept = stores.rows.change(to, () => row)
  return kept.kept ? true : { refusal: kept.why ?? `the dashboard row for ${to} was not kept.` }
}

/** How many handovers the crew wrote for `name`; none when the place cannot be read. */
function handoverCount(place: CrewPlace, name: string): number {
  const names = place.names()
  return 'refusal' in names ? 0 : names.filter((one) => theHandoverDayOf(one, name) !== null).length
}

/** Whether the crew holds a park marker for `name`. */
function theParkHeld(place: CrewPlace, name: string): boolean {
  const read = place.read(theParkMarker(name))
  return read !== undefined && 'text' in read
}

/**
 * What the crew still keeps under `name`: the handovers written for it, its park, and its dashboard row (martha#985).
 * A rename asks this of the new name before it starts, and of the old one after a refusal, so nothing it would take
 * over and nothing it left behind is guessed.
 */
export function whatIsHeldUnder(stores: TheRecordStores, name: string): readonly string[] {
  const handovers = stores.crew.place(HANDOVERS_PLACE)
  const count = 'refusal' in handovers ? 0 : handoverCount(handovers, name)
  const parked = stores.crew.place(PARKED_PLACE)
  return [
    ...(count > 0 ? [`${count} handover(s)`] : []),
    ...(!('refusal' in parked) && theParkHeld(parked, name) ? ['the park'] : []),
    ...(stores.rows.read(name) === null ? [] : ['the dashboard row']),
  ]
}

/** Every per-name record of `from` written again for `to`, with what moved before any refusal (review r=1). */
export function moveTheRecordedName(stores: TheRecordStores, from: string, to: string): TheRecordsMove {
  const handovers = handoversMoved(stores, from, to)
  if (handovers.refusal !== undefined) return { handovers: handovers.moved, row: false, park: false, refusal: handovers.refusal }
  const park = parkMoved(stores, from, to)
  if (typeof park !== 'boolean') return { handovers: handovers.moved, row: false, park: false, refusal: park }
  const row = rowMoved(stores, from, to)
  if (typeof row !== 'boolean') return { handovers: handovers.moved, row: false, park, refusal: row }
  return { handovers: handovers.moved, row, park }
}
