// A host's model vocabulary is read from its recording, and a kind or a shape nothing reads is refused
// (macula-io/martha#541, package 6).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLOSED_VOCABULARY, hostRuns, MODEL_VOCABULARY_KINDS, NO_MODEL_NAMED, OPEN_VOCABULARY, vocabularyOf } from './a_hosts_model_vocabulary.ts'

const LISTED = ['a-listed-model', 'another-listed-model']
const UNLISTED = 'a-local-model'

test('a closed vocabulary runs the names it lists and no other', () => {
  const closed = vocabularyOf(CLOSED_VOCABULARY, LISTED)
  for (const name of LISTED) assert.equal(hostRuns(closed, name), true, name)
  assert.equal(hostRuns(closed, UNLISTED), false)
})

test('an open vocabulary runs a name no list holds', () => {
  assert.equal(hostRuns(vocabularyOf(OPEN_VOCABULARY, []), UNLISTED), true)
})

test('no model named runs nothing', () => {
  for (const name of [...LISTED, UNLISTED]) assert.equal(hostRuns(NO_MODEL_NAMED, name), false, name)
})

test('a kind that is none of the known ones is refused by name, never read as open or closed', () => {
  const unknown = `${OPEN_VOCABULARY}-ish`
  assert.ok(!MODEL_VOCABULARY_KINDS.includes(unknown))
  assert.throws(() => vocabularyOf(unknown, []), new RegExp(JSON.stringify(unknown)))
})

test('an open vocabulary that also names models is refused, so a recording never says both', () => {
  assert.throws(() => vocabularyOf(OPEN_VOCABULARY, LISTED), new RegExp(LISTED.join(', ')))
})
