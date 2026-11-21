// What each of the crew's tools is decided over (martha#254): the shapes the owner's list, the standing items, the
// owner's asks and a model switch are handed, built from one launch's places. None of them acts: each lays out a place,
// this member, this session and the declaration's table for the slice that decides. They sit in their own file of the
// same slice because a_crews_tools.ts holds the dispatch and the answers, and a merge of two packages' tools put it past
// the structural floor's line cap (martha#318 with #959).

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { AnOrderAsked } from '../put_the_owners_model_back/the_guarded_switch.ts'
import type { TheAsksAsked, TheOfferingAsked } from '../queue_the_owners_asks/the_ask_tools.ts'
import type { DashboardRow, DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { TheTriggerPlace } from '../switch_a_members_model/the_switch_tools.ts'
import type { CrewToolPlaces, SessionState } from './a_crews_tools.ts'

/** Every member's beat, by name, for `seeTheCrew` to lay out in the declaration's order. */
export function beatsOf(store: DashboardStore, settings: CrewSettings): Readonly<Record<string, DashboardRow>> {
  const held = store.all()
  const beats: Record<string, DashboardRow> = {}
  for (const member of settings.members) {
    const beat = held[member.name]
    if (beat !== undefined) beats[member.name] = beat
  }
  return beats
}

/** Where a model switch is recorded, for the return a park, a report or the return tool makes of it (martha#315). */
export const triggerPlaceOf = (places: CrewToolPlaces): TheTriggerPlace => ({ stores: places.stores, member: places.member, ledger: places.ledger })

/** What an order is decided over: where the switch is recorded, the owner's settings file, and this session's guard. */
export const anOrderOver = (places: CrewToolPlaces, state: SessionState): AnOrderAsked => ({ ...triggerPlaceOf(places), owners: places.owners_settings, session: state })

/** What the owner's list is handed: the streams, this member, the declaration's table, and the checkout its checks run in. */
export const theOwnersListAsked = (places: CrewToolPlaces, settings: CrewSettings) => ({
  ledger: places.ledger,
  member: places.member,
  settings,
  root: places.root,
  ...(places.processes === undefined ? {} : { processes: places.processes }),
  now: places.ledger.clock.now(),
})

/** What the standing items' tools are handed: the streams, this member, the declaration's table, and the day. */
export const theStandingAsked = (places: CrewToolPlaces, settings: CrewSettings) => ({
  ledger: places.ledger,
  member: places.member,
  settings,
  now: places.ledger.clock.now(),
})

/** What the owner's asks' tools are handed: the stream, this member and session, the table, and a removal's clone. */
export const theAsksAsked = (places: CrewToolPlaces, state: SessionState): TheAsksAsked => ({
  ledger: places.ledger,
  member: places.member,
  session: state.session,
  menus: places.menus,
  ...(places.processes === undefined ? {} : { processes: places.processes }),
  // The clone a branch removal is read in is the one the launch was declared with, as every acting tool reads it.
  clones: places.settings?.house_rules.clones,
})

/** What the two tools that take and settle the asks are handed: the queue's place, and the declaration that says who may. */
export const theOfferingAsked = (places: CrewToolPlaces, state: SessionState, settings: CrewSettings): TheOfferingAsked => ({
  ...theAsksAsked(places, state),
  settings,
})
