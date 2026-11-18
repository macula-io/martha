// A trial line whose turn got no answer in time is recorded as observing nothing, so the fork's check gives it its
// second launch; every other error, and every wrong answer, stays a fail and is never launched again (martha#612).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NoAnswerInTime, withTimeout } from './a_turn_with_goose.ts'
import { theObservationOfALineThatThrew } from './drive_the_trial.ts'
import { lineFour, type Trial } from './the_nine_lines.ts'
import type { GooseOverAcp } from './speak_acp_to_goose.ts'

/** A cap far under any turn the test waits for, so a work that never settles runs it out at once. */
const A_SHORT_CAP_MS = 5

test('#612: a turn the cap runs out on fails with a NoAnswerInTime that carries the cap, and a work that settles first is its own answer', async () => {
  const outOfTime = await withTimeout(new Promise(() => undefined), A_SHORT_CAP_MS).then(() => undefined, (error: unknown) => error)
  assert.ok(outOfTime instanceof NoAnswerInTime, String(outOfTime))
  assert.equal(outOfTime.ms, A_SHORT_CAP_MS)
  const ownError = new Error('the engine closed its pipe')
  assert.equal(await withTimeout(Promise.reject(ownError), A_SHORT_CAP_MS).then(() => undefined, (error: unknown) => error), ownError)
})

test('#612: a line that got no answer in time is not-observed, so it may be launched again (mutant: the timeout kept a fail)', () => {
  const observed = theObservationOfALineThatThrew(new NoAnswerInTime(240000))
  assert.equal(observed.verdict, 'not-observed')
  assert.match(observed.say, /no answer within 240000 ms/)
  assert.deepEqual(observed.evidence, { no_answer_within_ms: 240000 })
})

test('#612: every other error is a fail, a plain error with the same words included: the kind decides, never the message (mutant: the message matched)', () => {
  for (const error of [new Error('no answer within 240000 ms'), new Error('the engine closed its pipe'), 'a thrown text']) {
    const observed = theObservationOfALineThatThrew(error)
    assert.equal(observed.verdict, 'fail', String(error))
    assert.match(observed.say, /^the line could not be run: /)
  }
})

test('#612: a turn that spoke of a subagent and made no tool call stays a fail, so it is never launched again (Raf, 2026-11-18)', async () => {
  const updates: Record<string, unknown>[] = []
  const acp = {
    updates,
    answers: { next: 'reject_once', asked: [] },
    ask: async () => {
      updates.push({ params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'I started a subagent to run it.' } } } })
      return { stopReason: 'end_turn' }
    },
  } as unknown as GooseOverAcp
  const observed = await lineFour({ acp, sessionId: 'a-session' } as unknown as Trial)
  assert.equal(observed.verdict, 'fail')
  assert.equal(observed.say, 'the session spoke of a subagent and no tool call reached the client')
})
