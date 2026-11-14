// The launch held to this machine's version floor (martha#21, build ruling issuecomment-6868833599, questions 1 and
// 4): a placed release below the record refuses; a checkout has no record (R12). The installer's own write is what
// the launcher must find; that is held in installer/install_a_release/install_the_committed_tree.node-test.mjs,
// against the real installer and the real launcher. Here: the shapes of a path and of a record.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { FLOOR_RECORD, floorRecordOf, launchBelowTheFloor, readTheRecord, RELEASES } from './hold_the_launch_to_the_version_floor.ts'

/** A data directory, the folder a release's tree sits in, and a placed release's name: any names do but the last. */
const KEPT = join('/', 'data', 'kept')
const TREE = 'release-tree'
const PLACED = `0.2.0-sha256-${'a'.repeat(64)}`
const RECORD = join(KEPT, FLOOR_RECORD)

test('the record of a placed release is beside releases/', () => {
  assert.equal(floorRecordOf(join(KEPT, RELEASES, PLACED, TREE)), RECORD)
})

test('a tree that is not inside a placed release has no record: a checkout runs as itself (R12)', () => {
  assert.equal(floorRecordOf(join('/', 'work', 'checkout')), undefined)
  assert.equal(floorRecordOf(join(KEPT, RELEASES, 'not-a-release', TREE)), undefined)
  assert.equal(floorRecordOf(join(KEPT, 'elsewhere', PLACED, TREE)), undefined)
})

test('below the record the launch refuses, naming both versions and `martha install`; at or above it, it runs', () => {
  assert.equal(launchBelowTheFloor(RECORD, { code: 'ENOENT' }, '0.9.0'), undefined, 'no record yet: it runs')
  assert.equal(
    launchBelowTheFloor(RECORD, { text: '0.10.0\n' }, '0.9.0'),
    `this is Martha 0.9.0, below 0.10.0, the version floor this machine holds (${RECORD}); refused. Put the highest signed release back with: martha install`,
  )
  assert.equal(launchBelowTheFloor(RECORD, { text: '0.9.0\n' }, '0.9.0'), undefined, 'at the record it runs')
  assert.equal(launchBelowTheFloor(RECORD, { text: '0.8.10\n' }, '0.9.0'), undefined, 'above the record it runs, compared as numbers')
})

test('a malformed or unreadable record refuses the launch, never read as no floor', () => {
  for (const text of ['0.2.0', 'x.y.z\n', '0.2.0\n0.3.0\n']) {
    assert.equal(launchBelowTheFloor(RECORD, { text }, '0.2.0'), `${RECORD}, this machine's version floor, is not one X.Y.Z line; refused, never read as no floor`, JSON.stringify(text))
  }
  assert.equal(launchBelowTheFloor(RECORD, { code: 'EISDIR' }, '0.2.0'), `${RECORD}, this machine's version floor, could not be read (EISDIR); refused, never read as no floor`)
})

test('reading the record gives its text, or the code the read failed with, never a throw', () => {
  assert.deepEqual(readTheRecord(RECORD, (path) => `${path}\n`), { text: `${RECORD}\n` })
  const failing = (code: string) => (): string => {
    throw Object.assign(new Error(code), { code })
  }
  assert.deepEqual(readTheRecord(RECORD, failing('ENOENT')), { code: 'ENOENT' })
  assert.deepEqual(readTheRecord(RECORD, failing('EACCES')), { code: 'EACCES' })
})
