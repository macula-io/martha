// The owner's screen, kept as the host's events arrive (martha#313).
//
// This exists so a member's launcher has one thing to call when the host says something about the owner's screen, and
// so the two slices that own the row and the bell are never called around each other: every event goes through the
// dialogs slice (../tell_the_owner_a_session_waits), the row is written whole through its store, and the bell is the
// change the row itself shows (../ring_the_owner) — a dialog that closes leaves nothing behind, and the bell rings on
// the change into "needs you", never on a beat.
//
// It holds no disk and no terminal of its own: the row's store and the bytes' destination are handed in, so this is
// core, and the launcher keeps the two things that touch the machine.

import { theRowWithNothingSaid, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theBellsFor, type TheBellsSwitch } from '../ring_the_owner/ring_the_owner.ts'
import { takeAnOwnerDialog, type OwnerDialogEvent } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { NOTHING_IS_ASKED, theAsksAfter, type WhatTheHostIsAsking, type WhatTheHostSaid } from './say_what_the_host_is_asking.ts'

/** Where a member's row is kept, and where the bell's bytes go: the two things this slice is given, never reads. */
export interface AnOwnersScreen {
  readonly beats: DashboardStore
  /** The member whose row is moved: one row per member, never one per session (../show_dashboard_beat). */
  readonly member: string
  /** Whether this member's bells ring at all, as the declaration and the owner's own mute leave it. */
  readonly bells: TheBellsSwitch
  /** Whether the launcher has the owner's terminal at all: a member started without one rings nothing. */
  readonly onTheOwnersTerminal: boolean
  /** Writes the bell's bytes where the owner is looking. */
  write(bytes: string): void
}

/** What a member's launcher does with what the host said: it keeps the asks, writes the row, and rings the bell. */
export interface TheScreenKeeper {
  /** The asks this host has open, as the last event left them. */
  held(): WhatTheHostIsAsking
  /** One thing the host said, applied: the row written, and the bell rung on the change it made. */
  heard(session_id: string, said: WhatTheHostSaid, at: number): void
}

/**
 * The owner's screen for one member: every event the host says is applied to the member's row, and the bell is the row's
 * own change. A session this launch keeps no record of still moves the member's row — the row is per member — and the
 * session id is written beside it, as the beat that moved it says (martha#313).
 */
export function theOwnersScreen(place: AnOwnersScreen): TheScreenKeeper {
  let asks: WhatTheHostIsAsking = NOTHING_IS_ASKED
  return {
    held: () => asks,
    heard: (session_id, said, at) => {
      const left = theAsksAfter(asks, said, at)
      asks = left.state
      for (const event of left.events) applyTheEvent(place, session_id, event)
    },
  }
}

/** One dialog event, applied: the row it makes, and the bytes the change is worth. */
function applyTheEvent(place: AnOwnersScreen, session_id: string, event: OwnerDialogEvent): void {
  const before = place.beats.read(place.member)
  const next = takeAnOwnerDialog(rowBefore(before, place.member, session_id, event.at), event)
  if (!place.beats.keep(next).kept) return
  // The bell is the row's own change, read from the row that was kept: a write the store refused is a change the owner
  // does not see, and a bell for it would say something happened that did not. No bytes is no write at all.
  const bytes = theBellsFor(before, next, place.bells, place.onTheOwnersTerminal)
  if (bytes !== '') place.write(bytes)
}

/**
 * The row the event is applied to: the one the store holds, or, before the member's first beat, one with nothing in it
 * but the member and the session — a dialog is the host's word, and it does not wait for the member to report, nor is
 * the member's own state or words ever papered over by it.
 */
function rowBefore(held: DashboardRow | null, member: string, session_id: string, at: number): DashboardRow {
  return held ?? { ...theRowWithNothingSaid(), member, session: session_id, at }
}
