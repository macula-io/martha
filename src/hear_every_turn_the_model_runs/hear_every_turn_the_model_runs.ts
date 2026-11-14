// Hearing every main turn a member's model runs, whatever started it (martha#440).
//
// This exists so the launcher's record names the source of every turn the member ran, a crew message the mod
// submitted from its own timer included. The host raises a prompt to the plugin's own `prompt.submit` only when the
// submit was made inside a host event the plugin is handling; one made from the plugin's own timer (`$.clock.every`,
// how the crew mod reads its channel while idle) is skipped as re-entry, so the launcher never heard that turn
// (measured on the recorded host 2.1.325, martha#440 §1). `turn.start` reaches the mod for every turn, so the mod
// reports each main one, with its text, and the launcher decides here what that start adds to the record.
//
// The rule, in one place:
//
//   - The crew message a turn took in is the one the channel's carrier decided (martha#253): the record follows that
//     decision and has no rule of its own about which message a turn took in, so the count and the record cannot
//     disagree. Heard through `prompt.submit` already, it is in the record once and nothing more is added; not heard,
//     it is recorded now as the crew message it is.
//   - A turn that took no crew message in and whose text the launcher did not hear is a turn of unnamed source: it
//     is recorded as one, from an origin the launcher cannot name, never as a crew message, and never left out.
//   - What was heard is the texts `prompt.submit` took in since the last main turn start. The turn's own text is
//     checked against them BEFORE this start empties them (Pluto's observation, design r=2), and they are emptied at
//     every main turn start, so a prompt the host folded into a running turn (the owner typing mid-turn starts no
//     turn of its own) cannot be carried into a later one.
//
// The launcher's relay hands this slice a port (WhereEveryTurnIsRecorded): its own record write, the owner's screen, the
// turns it raises and its journal. The relay answers the mod's call and queues the recording among the host's events;
// everything this slice decides, it decides here.
//
// One crew message per turn: the carrier hands nothing while a handed message is not taken in, and the mod submits
// only while the session is idle, so at most one crew message waits for any turn and `text` (the turn's last user
// message) cannot hide a second.

import { THE_TURN_STARTED_ASK } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import type { Arrival, ArrivingTurn } from '../host_contract/host_contract.ts'
import { ARRIVAL_OF_A_PLUGINS_PROMPT, SOURCE_OF_AN_UNKNOWN_ORIGIN } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import type { WhatTheHostSaid } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'

/** The journal's words for a turn whose source the launcher cannot name: the record says where, this says that it ran. */
export const A_TURN_OF_UNNAMED_SOURCE = 'a turn of unnamed source'

/** What one main turn start adds to the session's record. */
export type WhatATurnStartRecords =
  /** The crew message this turn took in, which `prompt.submit` never heard: recorded now, as that message. */
  | { readonly records: 'the crew message'; readonly text: string }
  /** A turn with no crew message and no prompt heard: recorded from an origin the launcher cannot name. */
  | { readonly records: 'an unnamed source' }
  /** A turn already in the record, because `prompt.submit` heard what started it. */
  | { readonly records: 'heard already' }

/** One main turn's start, as the mod reports it and the carrier answered it. */
export interface AMainTurnStart {
  /** The turn's text at its start: the last user message the host put in it, or '' when the host sent none. */
  readonly text: string
  /** The framed crew message the carrier counted this turn as taking in, or '' when it took none in. */
  readonly taken: string
}

/** What a main turn start adds to the record, given the texts `prompt.submit` heard since the last one. */
export function whatATurnStartRecords(heard: ReadonlySet<string>, start: AMainTurnStart): WhatATurnStartRecords {
  if (start.taken !== '') return heard.has(start.taken) ? { records: 'heard already' } : { records: 'the crew message', text: start.taken }
  return heard.has(start.text) ? { records: 'heard already' } : { records: 'an unnamed source' }
}

/** The texts heard per session since its last main turn start: kept by the launcher, emptied at every main start. */
export interface HeardSinceTheLastStart {
  /** `prompt.submit` took this text in for this session. */
  heard(session_id: string, text: string): void
  /** A main turn started: what it adds to the record, decided against what was heard, and only then emptied. */
  aMainTurnStarted(session_id: string, start: AMainTurnStart): WhatATurnStartRecords
}

/** The launcher's memory of what it heard, for every session of one launch. */
export function heardSinceTheLastStart(): HeardSinceTheLastStart {
  const held = new Map<string, Set<string>>()
  return {
    heard: (session_id, text) => {
      const texts = held.get(session_id) ?? new Set<string>()
      texts.add(text)
      held.set(session_id, texts)
    },
    aMainTurnStarted: (session_id, start) => {
      const decided = whatATurnStartRecords(held.get(session_id) ?? new Set<string>(), start)
      held.delete(session_id)
      return decided
    },
  }
}

/** Where a main turn start is recorded: the relay's own record, and what it tells the owner, the listeners and the run. */
export interface WhereEveryTurnIsRecorded {
  /** Takes `arrival` into the session's record and keeps it; false when the session or its record is refused. */
  keep(session_id: string, arrival: Arrival): Promise<boolean>
  readonly screen?: { heard(session_id: string, said: WhatTheHostSaid, at: number): void }
  readonly turns?: { arrived(turn: ArrivingTurn): void }
  readonly journal?: { noted(event: string, why: string): void }
  readonly now: () => number
}

/** A main turn start the mod reported, for one session. */
export type ATurnStartReported = AMainTurnStart & { readonly session_id: string }

/** What one launch hears of its turns: the prompts the host raised, and every main turn start the mod reported. */
export interface HearingEveryTurn {
  /** `prompt.submit` took this text in for this session: the turn it starts, or the one it is folded into, is recorded. */
  heard(session_id: string, text: string): void
  /** The main turn start a mod's call reported, with what the carrier answered it took in; undefined for any other call. */
  startIn(call: unknown, answer: { readonly answer: string } | { readonly refused: string }): ATurnStartReported | undefined
  /** Records what a main turn start adds: the crew message never heard, or a turn of unnamed source; else nothing. */
  recorded(start: ATurnStartReported): Promise<void>
}

/** The hearing of one launch, recording through `where`. */
export function hearingEveryTurn(where: WhereEveryTurnIsRecorded): HearingEveryTurn {
  const heard = heardSinceTheLastStart()
  return {
    heard: (session_id, text) => heard.heard(session_id, text),
    startIn: aMainTurnStartIn,
    recorded: async (start) => {
      const decided = heard.aMainTurnStarted(start.session_id, start)
      if (decided.records === 'heard already') return
      const arrival: Arrival = decided.records === 'the crew message' ? ARRIVAL_OF_A_PLUGINS_PROMPT : { source: SOURCE_OF_AN_UNKNOWN_ORIGIN }
      if (!(await where.keep(start.session_id, arrival))) return
      // Recorded on the path a heard prompt takes: the screen told a turn started, and the turn raised once.
      where.screen?.heard(start.session_id, { said: 'turn-started' }, where.now())
      if (decided.records === 'the crew message') where.turns?.arrived({ text: decided.text, arrival })
      else where.journal?.noted(THE_TURN_STARTED_ASK, A_TURN_OF_UNNAMED_SOURCE)
    },
  }
}

/** The fields of a call the mod posted, `{ session_id, tool, args }`, or undefined when it is not one. */
function fieldsOf(call: unknown): { readonly session_id: unknown; readonly tool: unknown; readonly args: Record<string, unknown> } | undefined {
  if (typeof call !== 'object' || call === null) return undefined
  const { session_id, tool, args } = call as Record<string, unknown>
  return typeof args === 'object' && args !== null ? { session_id, tool, args: args as Record<string, unknown> } : undefined
}

/** The main turn start in a call the mod posted, with the turn's text; never a subagent's, and never a refused one. */
function aMainTurnStartIn(call: unknown, answer: { readonly answer: string } | { readonly refused: string }): ATurnStartReported | undefined {
  const fields = fieldsOf(call)
  if (fields === undefined || !('answer' in answer) || fields.tool !== THE_TURN_STARTED_ASK || typeof fields.session_id !== 'string') return undefined
  const { agentId, text } = fields.args
  // A subagent's turn is part of the member's own turn: the host stamps it with its agent, and it records nothing.
  if (agentId !== undefined) return undefined
  return { session_id: fields.session_id, text: typeof text === 'string' ? text : '', taken: answer.answer }
}
