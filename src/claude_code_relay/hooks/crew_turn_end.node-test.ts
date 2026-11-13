// The end of a running turn, held at a tool boundary (martha#311, ruling D): carried at once with no tool in flight,
// held while one runs and carried after the last is answered, a tool that starts while it is held denied, and a turn
// that ends by itself leaving nothing held. The after-tool gate that reports each tool is not touched by any of it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { A_TOOL_WHILE_THE_END_IS_HELD, holdingTheEnd } from './crew_turn_end.ts'

const THE_TURN = 'the-running-turn'

/** Hands that record each abort the hold asks the host for, and never refuse one. */
function recordingHands() {
  const aborted: string[] = []
  return { aborted, hands: { abort: async (turn_id: string) => void aborted.push(turn_id), report: async () => undefined } }
}

test('#311 ruling D: an end ordered with no tool in flight is carried at once', async () => {
  const end = holdingTheEnd()
  const { aborted, hands } = recordingHands()
  await end.ordered(THE_TURN, hands)
  assert.deepEqual(aborted, [THE_TURN], 'an end with nothing in flight was not carried at once')
})

test('#311 ruling D: an end ordered while a tool runs is held, and carried once that tool is answered (mutant: carry while in flight)', async () => {
  const end = holdingTheEnd()
  const { aborted, hands } = recordingHands()
  assert.equal(end.aToolStarts(), undefined, 'a tool was denied with no end held')
  await end.ordered(THE_TURN, hands)
  assert.deepEqual(aborted, [], 'the end was carried while a tool was in flight, which cancels that tool\'s report')
  await end.aToolWasAnswered()
  assert.deepEqual(aborted, [THE_TURN], 'the held end was not carried after the tool was answered')
})

test('#311 ruling D: a tool that starts while the end is held is denied (mutant: no deny)', async () => {
  const end = holdingTheEnd()
  const { hands } = recordingHands()
  end.aToolStarts()
  await end.ordered(THE_TURN, hands)
  assert.equal(end.aToolStarts(), A_TOOL_WHILE_THE_END_IS_HELD, 'a tool started in a turn whose end was held')
})

test('#311 ruling D: with two tools in flight the end is carried after the last, not the first (mutant: carry after the first)', async () => {
  const end = holdingTheEnd()
  const { aborted, hands } = recordingHands()
  end.aToolStarts()
  end.aToolStarts()
  await end.ordered(THE_TURN, hands)
  await end.aToolWasAnswered()
  assert.deepEqual(aborted, [], 'the end was carried while the second tool was still in flight')
  await end.aToolWasAnswered()
  assert.deepEqual(aborted, [THE_TURN], 'the end was not carried after the last tool')
})

test('#311 ruling D: a turn that ends by itself drops the held end, and the next turn\'s tools run (mutant: keep the hold)', async () => {
  const end = holdingTheEnd()
  const { aborted, hands } = recordingHands()
  end.aToolStarts()
  await end.ordered(THE_TURN, hands)
  end.theTurnEnded()
  assert.equal(end.aToolStarts(), undefined, 'a tool of the next turn was denied by an end held in the last one')
  await end.aToolWasAnswered()
  assert.deepEqual(aborted, [], 'an end held in a turn that already ended was carried into the next')
})
