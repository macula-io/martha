// The crew's messages as an engine member's turns (martha#511 part B, the "crew's turns" #541 package A left for later):
// the launch reads the channel for the member every channel_read_seconds, and hands the next message it has not taken
// in to the member's turn queue, as a turn of its own. A Claude Code member's mod does the same through its hooks; an
// engine has no hook, so its launch, which drives the session, is the reader.
//
// One message at a time, and late rather than lost or read twice (the carrier's rule, martha#253):
// - a read starts only when no read is in flight, and a read lasts until the turn it queued has ended, so a message is
//   never queued behind another of its own and the engine reads the crew in the channel's order;
// - a message is counted taken in once its turn ran, or once the entry refused it (a refusal is the gate's answer, and
//   handing the same text again gets the same answer);
// - a turn the engine failed is not counted: the carrier is begun again, so the next read hands that message again.

import { type MessageCarrier } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import type { Arrival } from '../host_contract/host_contract.ts'
import type { ATurnToSend, TheEngineMembersTurns, WhatATurnDid } from './the_engine_members_turns.ts'

/** Where a crew message's turn comes from, in the host contract's words: the crew's channel, carried by Martha itself. */
export const THE_ARRIVAL_OF_A_CREW_MESSAGE: Arrival = { source: 'channel_message' }

/** What the reader is given: a carrier begun afresh on each call, the member's turn queue, and how often to read. */
export interface TheCrewsMessagesAsked {
  readonly carrierOf: () => MessageCarrier
  readonly turns: TheEngineMembersTurns
  readonly every_ms: number
  /** Hears each crew message's turn and what it came to: a test's hands; a real start gives the start's own seam. */
  readonly heard?: (turn: ATurnToSend, did: WhatATurnDid) => void
}

/** The running reader: one read now, and the stop that ends every later one. */
export interface TheCrewsMessagesAsTurns {
  readNow(): Promise<void>
  stop(): void
}

/** Reads the crew's channel into the member's turns, every `every_ms`, until stopped. */
export function theCrewsMessagesAsTurns(asked: TheCrewsMessagesAsked): TheCrewsMessagesAsTurns {
  let carrier = asked.carrierOf()
  let reading = false
  let stopped = false

  const readNow = async (): Promise<void> => {
    if (reading || stopped) return
    reading = true
    try {
      const text = await carrier.next()
      if (text === null) return
      const turn: ATurnToSend = { text, arrival: THE_ARRIVAL_OF_A_CREW_MESSAGE }
      const did = await asked.turns.take(turn)
      asked.heard?.(turn, did)
      // A failed turn, or a count the store did not keep, leaves the message untaken: a fresh carrier hands it again.
      const counted = 'failed' in did ? null : await carrier.aTurnStarted()
      if (counted === null) carrier = asked.carrierOf()
    } finally {
      reading = false
    }
  }

  const timer = setInterval(() => void readNow(), asked.every_ms)
  return {
    readNow,
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}
