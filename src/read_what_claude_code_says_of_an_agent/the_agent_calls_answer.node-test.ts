// The model an Agent call resolved to, read from the Claude Code host's own answer (martha#430, moved here by martha#463).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolvedModelIn } from './the_agent_calls_answer.ts'

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
