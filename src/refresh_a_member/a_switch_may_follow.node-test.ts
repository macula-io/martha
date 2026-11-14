// When the crew's model may be switched after the refresh flow has answered (martha#311, Uranus's ruling R3): only when
// the flow orders nothing, and never on the beat the mod takes while the main turn runs, since a switch cannot run
// inside a turn. The crew's tools only ask this; the rule is the refresh flow's.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { aSwitchMayFollow, CARRY_THE_CLEAR, NO_ACT, theOrderOf, theQuestionIn, type TheSessionsQuestion } from './the_refresh_flow.ts'

/** A question as the mod asks it at a turn's end, or as its beat asks it while the turn runs. */
function asked(turn_running: 1 | undefined): TheSessionsQuestion {
  const question = theQuestionIn({ turn_id: 'a-turn', answer: 'an answer', turn_running }, 'a-session')
  assert.ok(typeof question !== 'string', `the question is read: ${String(question)}`)
  return question
}

test('a beat taken while the turn runs gets no model switch, and a turn that ended with nothing ordered does (martha#311 R3)', () => {
  const nothing = theOrderOf(NO_ACT)
  assert.equal(aSwitchMayFollow(nothing, asked(1)), false, 'the beat inside a running turn')
  assert.equal(aSwitchMayFollow(nothing, asked(undefined)), true, 'the end of a turn')
})

test('an order the flow carries is never followed by a model switch, whether the turn runs or not (martha#311 R3)', () => {
  const clear = theOrderOf({ act: CARRY_THE_CLEAR })
  for (const turn_running of [1, undefined] as const) assert.equal(aSwitchMayFollow(clear, asked(turn_running)), false, String(turn_running))
})

test('a running turn marked with anything but 1 is refused, never read as a turn that ended (martha#311)', () => {
  assert.equal(typeof theQuestionIn({ turn_id: 'a-turn', answer: 'an answer', turn_running: 0 }, 'a-session'), 'string')
})
