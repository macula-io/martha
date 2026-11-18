// A crew working in Goose may name, as its review model, any model the engine's provider serves, a local one included,
// because the engine's delegate tool takes any name (macula-io/martha#541, package 6). If the engine closes its list,
// the recording changes and this test goes red, so the change is a decision and never a silent refusal.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostRuns, OPEN_VOCABULARY } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { GOOSE_MODELS } from './goose_models.ts'
import { RECORDED_GOOSE_ENGINE } from './recorded_goose_engine.ts'

test('the Goose vocabulary is the recorded one, it is open, and it runs a local model no list names', () => {
  assert.deepEqual(GOOSE_MODELS, RECORDED_GOOSE_ENGINE.subagent_models)
  assert.equal(GOOSE_MODELS.kind, OPEN_VOCABULARY)
  assert.equal(hostRuns(GOOSE_MODELS, 'a-local-model'), true)
})
