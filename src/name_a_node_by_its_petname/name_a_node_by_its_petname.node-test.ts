// The recorded petnames are what the pinned server derives, not what this copy of
// the derivation says (martha#251). A release that reorders a word list, changes
// the digest or moves the suffix goes red here, by name, instead of quietly making
// every hello answer's `petname` a leaf the gate can no longer compute — which
// would send every hello answer to B2 and take #251's fix away without a word.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { petnameOf, recordedNodeId, type RecordedId } from './name_a_node_by_its_petname.ts'

interface RecordedPetnames {
  readonly server_versions: readonly string[]
  readonly pairs: readonly { readonly id: RecordedId; readonly petname: string }[]
}

const RECORDED = JSON.parse(
  readFileSync(new URL('./recorded_petnames.json', import.meta.url), 'utf8'),
) as RecordedPetnames

test('every recorded id gets the petname the pinned server gave it', () => {
  assert.ok(RECORDED.pairs.length >= 5, 'the recording holds too few ids to pin the derivation')
  for (const pair of RECORDED.pairs) {
    const node_id = recordedNodeId(pair.id)
    assert.equal(petnameOf(node_id), pair.petname, node_id)
  }
})

test('a petname is the same for an id in any case, as the server lowercases first', () => {
  for (const pair of RECORDED.pairs) {
    const node_id = recordedNodeId(pair.id)
    assert.equal(petnameOf(node_id.toUpperCase()), pair.petname, node_id.toUpperCase())
  }
})
