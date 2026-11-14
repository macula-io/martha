// The end of a member's running turn, so its handover can run (martha#311; split out of refresh_a_member by martha#443).
//
// This exists so a handover the refresh flow asked for is not held forever behind a turn that never ends: past the
// crew's ceiling, or at the whole limit, the running turn is ended, at most FORCED_ENDS times, and then the flow is given
// up. Here are the end's pure rules: when one is due, what it is announced as, and the flow each of its outcomes leaves.
// The hold that carries an end at a tool boundary is ./hold_the_end.ts.

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { theFlowAbandoned, type ARefresh } from '../refresh_a_member/refresh_a_member.ts'

/**
 * The share of its limit at which a member's running turn is ended at once, whatever the crew's ceiling says
 * (martha#311): a member past its whole limit is handed over now. A constant like HANDOVER_LIMIT_PERCENT, never a
 * setting.
 */
export const CONTEXT_FULL_PERCENT = 100

/** How many ends that ended one flow may spend before it is abandoned (martha#311, the owner's gate, question 3). */
export const FORCED_ENDS = 2

/** An end of the running turn, announced and not yet concluded. */
export interface AnEndPending {
  readonly turn_id: string
  readonly announced: number
  /** What the end was announced as: why, and which end it is. */
  readonly what: string
  /** The ledger row it was announced at, and the package whose ledger holds it: null when the member held none. */
  readonly ledger_row: { readonly package: string; readonly at: number } | null
}

/**
 * What a beat reads to decide whether the member's running turn is ended so its handover can run (martha#311): the
 * turn, the flow, the owner dialogs open on the member's row, the context, and the crew's ceiling.
 */
export interface TheRunningTurn {
  /** The running main turn, as the mod kept it from that turn's start: '' when the question did not come from a beat. */
  readonly turn_id: string
  readonly flow: ARefresh
  /** How many dialogs the row holds open for the owner: never the row's working state, which a dialog does not move. */
  readonly dialogs_open: number
  readonly percent: number
  readonly now: number
  readonly ceiling_ms: number
}

/** Whether the running turn is ended now: no, end it (the nth end), or give the flow up because its ends are spent. */
export type AnEnd = { readonly kind: 'none' } | { readonly kind: 'end'; readonly why: string; readonly n: number } | { readonly kind: 'give_up'; readonly why: string }

const NO_END: AnEnd = { kind: 'none' }

/**
 * Whether a beat ends the running turn (martha#311 design §2). Only a `handing_over` flow's turn, never while an end
 * awaits its outcome, never while the owner has a dialog open; then past the ceiling since the flow's ask or its last
 * end that ended, or at once at CONTEXT_FULL_PERCENT; a second end a full ceiling after the first; and the time these
 * hold once more with FORCED_ENDS spent, the flow is given up.
 */
export function anEndIsDue(turn: TheRunningTurn): AnEnd {
  if (heldFromAnEnd(turn)) return NO_END
  const why = whyTheTurnIsEnded(turn)
  if (why === undefined) return NO_END
  const forced = turn.flow.forced
  if (forced !== undefined && turn.now - forced.last_at < turn.ceiling_ms) return NO_END
  const ends = forced?.ends ?? 0
  return ends >= FORCED_ENDS ? { kind: 'give_up', why } : { kind: 'end', why, n: ends + 1 }
}

/** The holds no reason answers over: no running turn, a flow not waiting on one, an end in flight, or the owner asked. */
function heldFromAnEnd(turn: TheRunningTurn): boolean {
  return turn.turn_id === '' || turn.flow.phase !== 'handing_over' || turn.flow.ending !== undefined || turn.dialogs_open > 0
}

/** Why the turn is ended, in the owner's words, or undefined while neither the context nor the ceiling says so. */
function whyTheTurnIsEnded(turn: TheRunningTurn): string | undefined {
  if (turn.percent >= CONTEXT_FULL_PERCENT) return `its context is at ${turn.percent}% of its limit`
  const waited = turn.now - turn.flow.at
  if (waited >= turn.ceiling_ms) return `its handover waited ${Math.round(waited / MINUTE_MS)} minutes behind a running turn`
  return undefined
}

/** The reason a flow whose ends are spent is abandoned with, as the row says it. */
export function theEndsSpentReason(why: string): string {
  return `the handover never ran after ${FORCED_ENDS} forced ends (${why})`
}

/** What one end is announced as, in the ledger and on the row: why, and which of the ends it is. */
export function theEndAnnounced(end: { readonly why: string; readonly n: number }): string {
  return `${end.why}: end ${end.n} of ${FORCED_ENDS}`
}

/** The line the Supervisor hears for each end that ended: one per end, never one per beat. */
export function theEndLine(ended: { readonly member: string; readonly what: string }): string {
  return `${ended.member}'s running turn was ended so its handover can run (${ended.what}).`
}

/** The line the Supervisor hears once when a flow is given up after its ends are spent. */
export function theGiveUpLine(given_up: { readonly member: string; readonly why: string }): string {
  return `${given_up.member} could not be handed over: ${theEndsSpentReason(given_up.why)}. No new refresh starts on that turn.`
}

/** The flow once an end is announced: the pending end held in it until its outcome arrives (design 3d). */
export function theFlowEnding(flow: ARefresh, pending: AnEndPending): ARefresh {
  return { ...flow, ending: pending }
}

/** The flow once an end ended: one end spent, and the stall window restarted at the end (design 3b). */
export function theFlowEnded(flow: ARefresh, at: number): ARefresh {
  const { ending: _ended, ...rest } = flow
  return { ...rest, at, forced: { ends: (flow.forced?.ends ?? 0) + 1, last_at: at } }
}

/**
 * The flow once an end the mod held behind a running tool expired (ruling D on martha#311): the end was tried and was
 * blocked, so it spends one end and restarts the gap to the next, but it never ended, so the stall window stays.
 */
export function theFlowEndExpired(flow: ARefresh, at: number): ARefresh {
  return { ...theFlowNotEnded(flow), forced: { ends: (flow.forced?.ends ?? 0) + 1, last_at: at } }
}

/** The flow once an end was refused or its session replaced: the pending end gone, nothing spent or moved. */
export function theFlowNotEnded(flow: ARefresh): ARefresh {
  const { ending: _refused, ...rest } = flow
  return rest
}

/** The flow given up after its ends are spent, remembering the turn no new flow may start on. */
export function theFlowGivenUp(flow: ARefresh, why: string, turn_id: string, at: number): ARefresh {
  return { ...theFlowNotEnded(theFlowAbandoned(flow, theEndsSpentReason(why), at)), gave_up_on: turn_id }
}

/** Whether a pending end still holds, was outlived by a new session, or expired at one ceiling (design 3d, ruling D). */
export type AnEndsHold = 'holds' | 'new_session' | 'expired'

/**
 * Whether a pending end no longer holds (design 3d): a new session has started, so no end is in flight across it, and
 * its act is left open for the successor; or the end is older than one ceiling, so the mod held it behind a tool that
 * never finished (ruling D).
 */
export function anEndOutlived(pending: AnEndPending, at: { readonly now: number; readonly ceiling_ms: number; readonly at_start: boolean }): AnEndsHold {
  if (at.at_start) return 'new_session'
  return at.now - pending.announced >= at.ceiling_ms ? 'expired' : 'holds'
}
