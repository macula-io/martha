// The end of a running turn, held at a tool boundary (martha#311, ruling D, and the ruling that placed it here).
//
// This exists so ending a member's turn never stops the member. The relay's after-tool gate stops the member when a
// tool's report is not heard, and the host's abort cancels the report of a tool still running; so an end is never
// carried while a tool is in flight. The launcher hears every call start and every report, so it keeps the hold: the
// calls in flight by the host's own ids, per session; the end held on the beat in the same synchronous step that finds
// none in flight; every call denied while it is held; the end handed back on the yes to the last one in flight; and the
// hold dropped only when the turn it names ends, or the end expires. The relay only aborts when told.
//
// It holds nothing on disk itself: one launcher answers one member, and a launcher that dies takes its member with it.
// The one thing it writes is the line that says which call the end rode on, in the journal its launcher hands it with
// the question (martha#498): no other thing knows which call's answer carried the end, and a run reading the order of
// its requests cannot tell that end from one ordered after the tool finished without it.
//
// What this needs of the launcher's journal: one line about one of the host's calls, by the id the host gave it.

import { CARRY_THE_END } from './end_the_running_turn.ts'
import { THE_END_RODE_ON_THE_CALL } from './the_end_rode_on_a_call.ts'

/** Why a call is denied while an end is held: the turn is about to end, and nothing more is started in it. */
export const A_TOOL_WHILE_THE_END_IS_HELD = 'this turn is being ended so the member can hand over; no tool starts in it'

/** What this needs of the launcher's journal, where a run reads which call the end rode on (martha#498). */
export interface TheJournalsRecordOfACall {
  noted(event: string, why: string, tool_use_id?: string): void
}

/** One session's calls in flight, and the end held in it with whether it was handed out yet. */
interface ASessionsHold {
  readonly in_flight: Set<string>
  held?: { readonly turn_id: string; carried: boolean }
}

/** The holds of one launcher, by session. */
export interface TheEndsHold {
  /** The beat ordered the end: held from now on, and carried at once (`now`) or on the last call's answer (`held`). */
  hold(session: string, turn_id: string): 'now' | 'held'
  /** Why a call may not start, or undefined when it may: asked after every other check, so it only narrows. */
  deniesACall(session: string): string | undefined
  /** A call the launcher allowed, by the host's id: in flight until it is answered. */
  aCallAllowed(session: string, tool_use_id: string): void
  /**
   * A call answered yes: the turn to end when it was the last in flight under a held end, else undefined — and, where a
   * journal is handed in, the line that says this call's own answer carried it (martha#498).
   */
  aCallAnswered(session: string, tool_use_id: string, journal?: TheJournalsRecordOfACall): string | undefined
  /** A turn ended: only the one the end names drops the hold and what was in flight, never a subagent's. */
  aTurnEnded(session: string, turn_id: string): void
  /** The end expired before it was carried (ruling D): calls may start again. */
  anEndExpired(session: string): void
}

export function holdingTheEnds(): TheEndsHold {
  const sessions = new Map<string, ASessionsHold>()
  const of = (session: string): ASessionsHold => sessions.get(session) ?? sessions.set(session, { in_flight: new Set() }).get(session)!
  return {
    hold(session, turn_id) {
      const one = of(session)
      one.held = { turn_id, carried: one.in_flight.size === 0 }
      return one.held.carried ? 'now' : 'held'
    },
    deniesACall: (session) => (sessions.get(session)?.held === undefined ? undefined : A_TOOL_WHILE_THE_END_IS_HELD),
    aCallAllowed: (session, tool_use_id) => void of(session).in_flight.add(tool_use_id),
    aCallAnswered(session, tool_use_id, journal) {
      const one = sessions.get(session)
      if (one === undefined || !one.in_flight.delete(tool_use_id)) return undefined
      if (one.held === undefined || one.held.carried || one.in_flight.size > 0) return undefined
      one.held.carried = true
      journal?.noted(CARRY_THE_END, THE_END_RODE_ON_THE_CALL, tool_use_id)
      return one.held.turn_id
    },
    aTurnEnded(session, turn_id) {
      if (sessions.get(session)?.held?.turn_id === turn_id) sessions.delete(session)
    },
    anEndExpired: (session) => void delete of(session).held,
  }
}
