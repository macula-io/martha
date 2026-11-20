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

/** Where the turns of one member go. */
export interface WhereTheTurnsGo {
  /** The session a turn is sent on, read at each turn: a clear moves the member to a new one (martha#999 package 5). */
  readonly session_id: string
  /** The entry's answer for a turn, run in the entry's own order by the caller. */
  readonly aTurnArrived: (session_id: string, turn: ArrivingTurn) => Promise<TheAnswerToATurn>
  /** Sends one turn's text to the engine; settles when the engine's turn has ended. */
  readonly send: (session_id: string, text: string) => Promise<unknown>
  /** Tells the owner a turn did not run, and why. */
  readonly tell: (line: string) => void
  /**
   * After a turn was sent and ended (martha#999 package 5): the turn the launch sends next on its own account, given what
   * `send` ended with, or none. It goes ahead of every turn taken meanwhile, as a hook's act goes ahead of the next
   * prompt, and its own `after` is asked in turn.
   */
  readonly after?: (ended: unknown) => Promise<ATurnToSend | undefined>
}

/** One session's queue: a turn taken is sent after every turn taken before it has ended. */
export interface TheEngineMembersTurns {
  take(turn: ATurnToSend): Promise<WhatATurnDid>
  /** Settles once every turn taken so far, and what the launch asked after it, is done: a launch ends after it (martha#999 package 5). */
  settled(): Promise<void>
}

/** The line the owner is told when a turn is refused or fails. */
export const theLineOfATurnNotRun = (member: string, did: Exclude<WhatATurnDid, { readonly sent: 1 }>): string =>
  'refused' in did ? `A turn for ${member} was refused and never sent: ${did.refused}` : `A turn for ${member} failed: ${did.failed}`

/** The line the owner is told when the launch could not say what follows a turn. */
export const theLineOfNoAct = (member: string, why: string): string => `Martha could not say what follows ${member}'s turn: ${why}`

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The queue of `member`'s turns. */
export function theEngineMembersTurns(member: string, where: WhereTheTurnsGo): TheEngineMembersTurns {
  let last: Promise<unknown> = Promise.resolve()
  /** One turn recorded and sent, and what `send` ended with; or what it came to instead. */
  const one = async (turn: ATurnToSend): Promise<{ readonly did: WhatATurnDid; readonly ended?: unknown }> => {
    const session_id = where.session_id
    const answer = await where.aTurnArrived(session_id, { text: turn.text, arrival: turn.arrival })
    if ('refused' in answer) return { did: { refused: answer.refused } }
    try {
      return { did: { sent: 1 }, ended: await where.send(session_id, turn.text) }
    } catch (error) {
      return { did: { failed: messageOf(error) } }
    }
  }
  const told = async (turn: ATurnToSend): Promise<{ readonly did: WhatATurnDid; readonly ended?: unknown }> => {
    const done = await one(turn).catch((error: unknown) => ({ did: { refused: `the entry did not answer for the turn (${messageOf(error)})` } }))
    if (!('sent' in done.did)) where.tell(theLineOfATurnNotRun(member, done.did))
    return done
  }
  /** The launch's own next turn after one that ended, if any, and the one after that, before the queue moves on. */
  const followUps = async (ended: unknown): Promise<void> => {
    if (where.after === undefined) return
    let next: ATurnToSend | undefined
    try {
      next = await where.after(ended)
    } catch (error) {
      where.tell(theLineOfNoAct(member, messageOf(error)))
      return
    }
    if (next === undefined) return
    const done = await told(next)
    if ('sent' in done.did) await followUps(done.ended)
  }
  return {
    take: (turn) => {
      const did = last.then(async () => {
        const done = await told(turn)
        if ('sent' in done.did) await followUps(done.ended)
        return done.did
      })
      last = did
      return did
    },
    settled: async () => {
      await last
    },
  }
}
