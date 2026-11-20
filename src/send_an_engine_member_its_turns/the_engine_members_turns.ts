// One engine member's turns, one at a time (martha#541 package A, design r=1 step 8): every turn is recorded through the
// launch's entry before the engine sees its text (shape 2), a turn the entry refuses is told and never sent, and the next
// turn waits until the one before it has ended. The start's own prompt is this package's only producer; the owner's
// terminal (package B) and the crew's turns (package C) add theirs.

import type { Arrival, ArrivingTurn, TheAnswerToATurn } from '../host_contract/host_contract.ts'

/** One turn for the member: its text, and where it came from. */
export interface ATurnToSend {
  readonly text: string
  readonly arrival: Arrival
}

/** What one turn came to: sent and ended, refused by the entry and never sent, or sent and failed. */
export type WhatATurnDid = { readonly sent: 1 } | { readonly refused: string } | { readonly failed: string }

/** Where the turns of one session go. */
export interface WhereTheTurnsGo {
  readonly session_id: string
  /** The entry's answer for a turn, run in the entry's own order by the caller. */
  readonly aTurnArrived: (session_id: string, turn: ArrivingTurn) => Promise<TheAnswerToATurn>
  /** Sends one turn's text to the engine; settles when the engine's turn has ended. */
  readonly send: (session_id: string, text: string) => Promise<unknown>
  /** Tells the owner a turn did not run, and why. */
  readonly tell: (line: string) => void
}

/** One session's queue: a turn taken is sent after every turn taken before it has ended. */
export interface TheEngineMembersTurns {
  take(turn: ATurnToSend): Promise<WhatATurnDid>
}

/** The line the owner is told when a turn is refused or fails. */
export const theLineOfATurnNotRun = (member: string, did: Exclude<WhatATurnDid, { readonly sent: 1 }>): string =>
  'refused' in did ? `A turn for ${member} was refused and never sent: ${did.refused}` : `A turn for ${member} failed: ${did.failed}`

/** The queue of one session of `member`. */
export function theEngineMembersTurns(member: string, where: WhereTheTurnsGo): TheEngineMembersTurns {
  let last: Promise<unknown> = Promise.resolve()
  const one = async (turn: ATurnToSend): Promise<WhatATurnDid> => {
    const answer = await where.aTurnArrived(where.session_id, { text: turn.text, arrival: turn.arrival })
    if ('refused' in answer) return { refused: answer.refused }
    try {
      await where.send(where.session_id, turn.text)
      return { sent: 1 }
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) }
    }
  }
  return {
    take: (turn) => {
      const did = last.then(async () => {
        const done = await one(turn).catch((error: unknown): WhatATurnDid => ({ refused: `the entry did not answer for the turn (${error instanceof Error ? error.message : String(error)})` }))
        if (!('sent' in done)) where.tell(theLineOfATurnNotRun(member, done))
        return done
      })
      last = did
      return did
    },
  }
}
