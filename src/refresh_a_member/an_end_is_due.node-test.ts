// When a member's running turn is ended so its handover can run (martha#311, design §2 and §3): only a flow waiting on
// a handover, only past the crew's ceiling or at the whole limit, never while the owner has a dialog open, never while
// an end awaits its outcome, a second end a full ceiling after the first, and with both spent the flow is given up.
//
// Everything here is the pure decision; the beat that asks it and the ledger that records it are tested through the
// crew's own tools in ../a_crews_tools.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HANDOVER_CEILING_MINUTES_WHEN_UNNAMED, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import {
  aFlowStarting,
  anEndIsDue,
  anEndOutlived,
  CONTEXT_FULL_PERCENT,
  FORCED_ENDS,
  HANDOVER_LIMIT_PERCENT,
  theFlowEnded,
  theFlowEnding,
  theFlowGivenUp,
  theFlowNotEnded,
  type AnEndPending,
  type ARefresh,
  type TheRunningTurn,
} from './refresh_a_member.ts'

/** The crew's ceiling when its file names none. */
const CEILING_MS = HANDOVER_CEILING_MINUTES_WHEN_UNNAMED * MINUTE_MS

/** When the handover was asked for, in these tests. */
const ASKED_AT = 1_000

/** A flow waiting on its handover since ASKED_AT. */
const aFlow = (over: Partial<ARefresh> = {}): ARefresh => ({
  ...aFlowStarting({ trigger: 'at_the_limit', reason: 'past the limit', at: ASKED_AT, started_at_percent: 10, percent: HANDOVER_LIMIT_PERCENT, asked_on: '', refreshed_at: [] }),
  ...over,
})

/** A beat on a running turn, `waited` after the ask, below the whole limit, with no dialog open. */
const aBeat = (over: Partial<TheRunningTurn> & { readonly waited?: number } = {}): TheRunningTurn => {
  const { waited = 0, ...rest } = over
  return { turn_id: 'a-turn', flow: aFlow(), dialogs_open: 0, percent: HANDOVER_LIMIT_PERCENT, now: ASKED_AT + waited, ceiling_ms: CEILING_MS, ...rest }
}

/** An end announced at `announced`, with no ledger row (a member that held no package). */
const aPendingEnd = (announced: number): AnEndPending => ({ turn_id: 'a-turn', announced, what: 'an end', ledger_row: null })

test('#311: no end is due before the ceiling, and the first is due at it (mutant: drop the ceiling check)', () => {
  assert.equal(anEndIsDue(aBeat({ waited: CEILING_MS - 1 })).kind, 'none', 'a turn was ended before the crew\'s ceiling passed')
  assert.deepEqual(anEndIsDue(aBeat({ waited: CEILING_MS })), { kind: 'end', why: `its handover waited ${HANDOVER_CEILING_MINUTES_WHEN_UNNAMED} minutes behind a running turn`, n: 1 })
})

test('#311: at the whole limit the end is due at once, ceiling or not', () => {
  const end = anEndIsDue(aBeat({ percent: CONTEXT_FULL_PERCENT }))
  assert.deepEqual(end, { kind: 'end', why: `its context is at ${CONTEXT_FULL_PERCENT}% of its limit`, n: 1 })
})

test('#311: never while the owner has a dialog open on the row (mutant: read the row\'s state instead)', () => {
  assert.equal(anEndIsDue(aBeat({ waited: CEILING_MS, dialogs_open: 1 })).kind, 'none', 'a turn was ended under a dialog the owner had open')
  assert.equal(anEndIsDue(aBeat({ percent: CONTEXT_FULL_PERCENT, dialogs_open: 1 })).kind, 'none', 'the whole limit overrode an open dialog')
})

test('#311: no running turn, a flow not handing over, or an end awaiting its outcome: no end', () => {
  assert.equal(anEndIsDue(aBeat({ waited: CEILING_MS, turn_id: '' })).kind, 'none', 'an end was ordered with no turn to end')
  assert.equal(anEndIsDue(aBeat({ waited: CEILING_MS, flow: aFlow({ phase: 'clearing' }) })).kind, 'none', 'a clearing flow\'s turn was ended')
  assert.equal(anEndIsDue(aBeat({ waited: CEILING_MS, flow: theFlowEnding(aFlow(), aPendingEnd(ASKED_AT)) })).kind, 'none', 'a second end was due while the first awaited its outcome')
})

test('#311: the second end is due a full ceiling after the first ended, never on the next beat (mutant: the second end on the next beat)', () => {
  const firstAt = ASKED_AT + CEILING_MS
  const ended = theFlowEnded(aFlow(), firstAt)
  assert.equal(anEndIsDue(aBeat({ flow: ended, now: firstAt + MINUTE_MS })).kind, 'none', 'the second end came on the next beat')
  assert.equal(anEndIsDue(aBeat({ flow: ended, now: firstAt + CEILING_MS - 1 })).kind, 'none', 'the second end came before a full ceiling')
  assert.deepEqual(anEndIsDue(aBeat({ flow: ended, now: firstAt + CEILING_MS })), { kind: 'end', why: `its handover waited ${HANDOVER_CEILING_MINUTES_WHEN_UNNAMED} minutes behind a running turn`, n: 2 })
})

test('#311: with both ends spent the flow is given up a ceiling later, never a third end (mutant: allow a third end)', () => {
  const secondAt = ASKED_AT + 2 * CEILING_MS
  const spent = theFlowEnded(theFlowEnded(aFlow(), ASKED_AT + CEILING_MS), secondAt)
  assert.equal(spent.forced?.ends, FORCED_ENDS, 'the test did not spend both ends')
  assert.equal(anEndIsDue(aBeat({ flow: spent, now: secondAt + CEILING_MS - 1 })).kind, 'none', 'the flow was given up before the last end had its ceiling')
  assert.equal(anEndIsDue(aBeat({ flow: spent, now: secondAt + CEILING_MS })).kind, 'give_up', 'a flow with its ends spent was not given up')
})

test('#311: an end that ended restarts the window and spends one; a refused one moves and spends nothing', () => {
  const pending = theFlowEnding(aFlow(), aPendingEnd(ASKED_AT + CEILING_MS))
  const ended = theFlowEnded(pending, ASKED_AT + CEILING_MS)
  assert.deepEqual([ended.at, ended.forced, ended.ending], [ASKED_AT + CEILING_MS, { ends: 1, last_at: ASKED_AT + CEILING_MS }, undefined])
  const refused = theFlowNotEnded(pending)
  assert.deepEqual([refused.at, refused.forced, refused.ending], [ASKED_AT, undefined, undefined], 'a refused end moved the window or spent an end')
})

test('#311: a flow given up remembers the turn it was given up on, and is over', () => {
  const given = theFlowGivenUp(aFlow(), 'a reason', 'a-turn', ASKED_AT + CEILING_MS)
  assert.deepEqual([given.phase, given.gave_up_on], ['abandoned', 'a-turn'])
})

test('#311: a pending end is outlived by a new session or by one ceiling, not before (mutants: keep it across a start; never expire it)', () => {
  const pending = aPendingEnd(ASKED_AT)
  assert.equal(anEndOutlived(pending, { now: ASKED_AT + 1, ceiling_ms: CEILING_MS, at_start: true }), true, 'an end was held across a new session')
  assert.equal(anEndOutlived(pending, { now: ASKED_AT + CEILING_MS, ceiling_ms: CEILING_MS, at_start: false }), true, 'an end older than a ceiling never expired')
  assert.equal(anEndOutlived(pending, { now: ASKED_AT + CEILING_MS - 1, ceiling_ms: CEILING_MS, at_start: false }), false, 'an end was dropped before its ceiling')
})
