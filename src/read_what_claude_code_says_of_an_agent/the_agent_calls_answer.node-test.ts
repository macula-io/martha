// The model an Agent call resolved to, read from the Claude Code host's own answer (martha#430, moved here by martha#463).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reviewSpawnsRemembered } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { keepWhatTheReviewResolvedTo, resolvedModelIn } from './the_agent_calls_answer.ts'

/** The model the host said the review call resolved to. */
const RESOLVED = 'claude-opus-5-5'

test('the model the call resolved to is read from the host\'s answer and nowhere else (martha#430)', () => {
  assert.equal(resolvedModelIn({ result: { resolvedModel: RESOLVED } }), RESOLVED, 'the model the host answered with was not read')
  assert.equal(resolvedModelIn({ result: { resolvedModel: '' } }), undefined, 'an empty model was read as one')
  assert.equal(resolvedModelIn({ result: {} }), undefined, 'an answer with no model was read as one')
  assert.equal(resolvedModelIn({}), undefined, 'an answer with no result was read as one')
  assert.equal(resolvedModelIn(null), undefined, 'a null answer was read as one')
  assert.equal(resolvedModelIn('claude-opus-5-5'), undefined, 'an answer that is not an object was read as one')
})

/** The model the launcher allowed the review call to name. */
const ALLOWED = 'claude-fable-5-1'

test('a kept review call keeps the model the host answered it with, and no other call is touched (martha#390)', () => {
  const reviews = reviewSpawnsRemembered()
  reviews.remember('kept', ALLOWED)
  keepWhatTheReviewResolvedTo(reviews, 'kept', { result: { resolvedModel: RESOLVED } })
  assert.equal(reviews.theSpawn('kept')?.resolved_model, RESOLVED, 'the resolved model of a kept call was not kept')
  keepWhatTheReviewResolvedTo(reviews, 'never_allowed', { result: { resolvedModel: RESOLVED } })
  assert.equal(reviews.theSpawn('never_allowed'), undefined, 'a call the launcher never allowed was kept')
  keepWhatTheReviewResolvedTo(reviews, undefined, { result: { resolvedModel: RESOLVED } })
  reviews.remember('unanswered', ALLOWED)
  keepWhatTheReviewResolvedTo(reviews, 'unanswered', { result: {} })
  assert.equal(reviews.theSpawn('unanswered')?.resolved_model, undefined, 'an answer with no model was kept as one')
})
