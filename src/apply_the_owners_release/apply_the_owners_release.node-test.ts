import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  markHolds,
  markOf,
  releaseMarkFor,
  releasedRecordOf,
  releaseStreamOf,
  recordDigestOf,
  type ReleaseMark,
} from './apply_the_owners_release.ts'

const strangers = (count: number): Ingestion[] =>
  Array.from({ length: count }, (_, i) => ({ path: 'A2', from_node_id: `stranger-${i}` }))

const owner = 'the-owner-at-the-terminal'

test('#321: a release clears exactly the prefix its mark names, and leaves what came after', () => {
  const raw = strangers(3)
  const mark = releaseMarkFor(raw, owner, () => Date.UTC(2026, 10, 13, 21, 0, 0))
  assert.deepEqual(releasedRecordOf(raw, [mark]).ingested, [])
  assert.equal(mark.through, 3)
  assert.equal(mark.cleared, 3)
})

test('#321: a mark that clears everything is a mark, never a wider instruction', () => {
  // The arrival the owner never saw: taken in after the release was made, before any reader picked it up.
  const released = strangers(2)
  const mark = releaseMarkFor(released, owner)
  const withALaterArrival = [...released, { path: 'A4', from_node_id: 'stranger-later' }]

  const read = releasedRecordOf(withALaterArrival, [mark]).ingested
  assert.equal(read.length, 1, 'the arrival taken in after the release still holds the member')
  assert.equal(read[0]?.from_node_id, 'stranger-later')
})

test('#321: applying the same mark twice gives the same record, so both readers can apply it', () => {
  const raw = [...strangers(2), { path: 'A3', from_node_id: null }]
  const mark = releaseMarkFor(raw.slice(0, 2), owner)
  const once = releasedRecordOf(raw, [mark])
  const twice = releasedRecordOf(once.ingested, [mark])
  // The second application is against the released record, which no longer begins with the prefix: it changes nothing.
  assert.deepEqual(twice.ingested, once.ingested)
})

test('#321: a mark whose prefix no longer matches is ignored, so the member stays held', () => {
  const mark = releaseMarkFor(strangers(2), owner)
  const replaced: Ingestion[] = [{ path: 'A4', from_node_id: 'someone-else' }]
  assert.equal(markHolds(mark, replaced), false)
  assert.deepEqual(releasedRecordOf(replaced, [mark]).ingested, replaced)
})

test('#321: a mark reaching past the record is ignored rather than trusted', () => {
  const mark: ReleaseMark = { through: 9, digest: recordDigestOf(strangers(2)), by: owner, at: 'now', cleared: 9 }
  assert.equal(markHolds(mark, strangers(2)), false)
})

test('#321: the newest matching mark wins', () => {
  const raw = strangers(3)
  const older = releaseMarkFor(raw.slice(0, 3), owner)
  const newest = releaseMarkFor(raw.slice(0, 2), owner)
  // Both prefixes hold against this record; the later release names the shorter prefix, so less is cleared.
  assert.equal(releasedRecordOf(raw, [older, newest]).ingested.length, 1)
})

test('#321: a release answers the count and never the text', () => {
  const raw: Ingestion[] = [{ path: 'A2', from_node_id: 'stranger', why: 'a secret the owner must not leak' }]
  const mark = releaseMarkFor(raw, owner)
  const written = JSON.stringify(mark)
  assert.equal(mark.cleared, 1)
  assert.ok(!written.includes('secret'), 'the mark carries no arrival text')
  assert.ok(!written.includes('stranger'), 'the mark carries no sender either')
})

test('#321: a release stream is named for its session, and nothing else', () => {
  assert.equal(releaseStreamOf('a-session'), 'release-of:a-session')
})

test('#321: a stream holding something that is not a mark releases nothing', () => {
  for (const junk of [null, 'a string', 42, {}, { through: -1, digest: 'x', by: owner, at: 'now', cleared: 0 }]) {
    assert.equal(markOf(junk), undefined, JSON.stringify(junk))
  }
})
