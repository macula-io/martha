// A permission request is answered only with a once-answer, or a cancel, and never falls back to another option
// (macula-io/martha#541 shape 4, martha#677). The options are the recorded Goose engine's own, in its order, and each
// answer is judged as the engine reads it (whatTheEngineMakesOf), not against the module's own constants, so a change
// to what the engine offers, or to the constants, is a case that fails here by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ALLOW_ONCE, REJECT_ONCE, answerOnce, type AnOfferedOption, type ADecision, type TheOutcome } from './answer_a_permission_once.ts'
import { THE_ENGINES_OPTIONS, whatTheEngineMakesOf } from './the_stand_in_agents_script.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

const KINDS = RECORDED_GOOSE_ENGINE.permission_options
/** The answers the engine saves a rule from, and the ones it does not, as the engine reads them. */
const SAVED = KINDS.filter((kind) => whatTheEngineMakesOf(kind).saves === 1)
const NOT_SAVED = KINDS.filter((kind) => whatTheEngineMakesOf(kind).saves === 0)
const offering = (...kinds: string[]): AnOfferedOption[] => kinds.map((kind) => ({ optionId: kind, kind }))
const CANCELLED = { outcome: 'cancelled' }

/** What the engine makes of an outcome: a cancel is an id it never offered. */
const madeOf = (outcome: TheOutcome): { runs: number; saves: number } => {
  const { runs, saves } = whatTheEngineMakesOf(outcome.outcome === 'selected' ? outcome.optionId : outcome.outcome)
  return { runs, saves }
}

test('the two once-answers are the engine\'s two answers that save no rule, one that runs the call and one that does not', () => {
  assert.deepEqual([...NOT_SAVED].sort(), [ALLOW_ONCE, REJECT_ONCE].sort(), 'the once-answers are not the engine\'s answers that save no rule')
  assert.deepEqual(madeOf(answerOnce(THE_ENGINES_OPTIONS, 'allow')), { runs: 1, saves: 0 })
  assert.deepEqual(madeOf(answerOnce(THE_ENGINES_OPTIONS, 'reject')), { runs: 0, saves: 0 })
  assert.equal(SAVED.length, 2, 'the engine no longer offers two answers that save a rule, so the cases below test less')
})

test('the engine\'s first option saves a rule, so a fallback to it is what these cases catch', () => {
  assert.equal(whatTheEngineMakesOf(KINDS[0] ?? '').saves, 1)
})

test('offered only the answers that save a rule, either decision is a cancel, never the first option', () => {
  for (const decision of ['allow', 'reject'] as ADecision[]) assert.deepEqual(answerOnce(offering(...SAVED), decision), CANCELLED)
})

test('offered only the other once-answer, the decision is a cancel: a refusal never becomes the call running', () => {
  assert.deepEqual(answerOnce(offering(...SAVED, ALLOW_ONCE), 'reject'), CANCELLED)
  assert.deepEqual(answerOnce(offering(...SAVED, REJECT_ONCE), 'allow'), CANCELLED)
})

test('an option is taken only when its id and its kind are both the once-answer', () => {
  const [saved] = SAVED
  assert.deepEqual(answerOnce([{ optionId: ALLOW_ONCE, kind: saved }], 'allow'), CANCELLED)
  assert.deepEqual(answerOnce([{ optionId: saved, kind: ALLOW_ONCE }], 'allow'), CANCELLED)
  assert.deepEqual(answerOnce([{ optionId: REJECT_ONCE }], 'reject'), CANCELLED)
})

test('nothing offered is a cancel', () => {
  assert.deepEqual(answerOnce([], 'allow'), CANCELLED)
  assert.deepEqual(answerOnce([], 'reject'), CANCELLED)
})
