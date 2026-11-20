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
import { HANDOVERS_PLACE } from '../write_my_handover/write_my_handover.ts'
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

/** What ends a handover's own file name for one member: the day stands before it, and the file's suffix after. */
const endsWithMember = (from: string): string => `_${from}.md`

/** The handovers this crew wrote for `from`: each one written again for `to`, stamped with the new name; or why not. */
function handoversMoved(stores: TheRecordStores, from: string, to: string): Refused | readonly string[] {
  const place = stores.crew.place(HANDOVERS_PLACE)
  if ('refusal' in place) return place
  const names = place.names()
  if ('refusal' in names) return names
  const moved: string[] = []
  for (const name of names.filter((one) => one.endsWith(endsWithMember(from)))) {
    const refusal = oneHandoverMoved(stores, place, name, from, to)
    if (refusal !== undefined) return refusal
    moved.push(name)
  }
  return moved
}

/** One handover written again under the new name, and its stamp rewritten; or why it was not. */
function oneHandoverMoved(stores: TheRecordStores, place: CrewPlace, name: string, from: string, to: string): Refused | undefined {
  const read = place.read(name)
  if (read === undefined || 'refusal' in read) return { refusal: `${join(place.path, name)} could not be read, so it was not moved to ${to}.` }
  const renamed = `${name.slice(0, name.length - endsWithMember(from).length)}${endsWithMember(to)}`
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

/** Every per-name record of `from` written again for `to`; or the first refusal that stopped it. */
export function moveTheRecordedName(stores: TheRecordStores, from: string, to: string): Refused | TheRecordsMoved {
  const handovers = handoversMoved(stores, from, to)
  if ('refusal' in handovers) return handovers
  const park = parkMoved(stores, from, to)
  if (typeof park !== 'boolean') return park
  const row = rowMoved(stores, from, to)
  if (typeof row !== 'boolean') return row
  return { handovers, row, park }
}
