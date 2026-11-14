// The launch held to this machine's version floor (martha#21, build ruling issuecomment-6868833599, question 4): a
// placed release below the record refuses, from its own real path, whatever the environment says. The installer's
// own write is what the launcher must find; that is held in installer/install_a_release/
// install_the_committed_tree.node-test.mjs, against the real installer. Here: the shapes of a tree and a record.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { floorRecordOf, launchBelowTheFloor } from './hold_the_launch_to_the_version_floor.ts'

const HEX = 'a'.repeat(64)

/** A data directory with one placed release of `version`, current linked to it; its tree, and where the record sits. */
function aPlacedRelease(t: TestContext, version: string): { data: string; tree: string; throughCurrent: string; record: string } {
  const data = realpathSync(mkdtempSync(join(tmpdir(), 'martha-floor-launch-')))
  t.after(() => removeTheTree(data))
  const release = join(data, 'martha', 'releases', `${version}-sha256-${HEX}`)
  mkdirSync(join(release, 'martha'), { recursive: true })
  symlinkSync(release, join(data, 'martha', 'current'))
  return { data, tree: join(release, 'martha'), throughCurrent: join(data, 'martha', 'current', 'martha'), record: join(data, 'martha', 'floor') }
}

test('the record of a placed release is beside releases/, found from the real path even through current', (t) => {
  const placed = aPlacedRelease(t, '0.2.0')
  assert.equal(floorRecordOf(placed.tree), placed.record)
  assert.equal(floorRecordOf(placed.throughCurrent), placed.record)
})

test('a tree that is not a placed release has no record: a checkout runs as itself (R12)', (t) => {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'martha-floor-checkout-')))
  t.after(() => removeTheTree(checkout))
  mkdirSync(join(checkout, 'releases', 'not-a-release', 'martha'), { recursive: true })
  assert.equal(floorRecordOf(checkout), undefined)
  assert.equal(floorRecordOf(join(checkout, 'releases', 'not-a-release', 'martha')), undefined)
  assert.equal(launchBelowTheFloor(checkout, '0.0.1'), undefined)
})

test('below the record the launch refuses, naming both versions and `martha install`; at or above it, it runs', (t) => {
  const placed = aPlacedRelease(t, '0.9.0')
  assert.equal(launchBelowTheFloor(placed.tree, '0.9.0'), undefined, 'no record yet: it runs')
  writeFileSync(placed.record, '0.10.0\n')
  assert.equal(
    launchBelowTheFloor(placed.throughCurrent, '0.9.0'),
    `this is Martha 0.9.0, below 0.10.0, the version floor this machine holds (${placed.record}); refused. Put the highest signed release back with: martha install`,
  )
  writeFileSync(placed.record, '0.9.0\n')
  assert.equal(launchBelowTheFloor(placed.tree, '0.9.0'), undefined, 'at the record it runs')
  writeFileSync(placed.record, '0.8.10\n')
  assert.equal(launchBelowTheFloor(placed.tree, '0.9.0'), undefined, 'above the record it runs, compared as numbers')
})

test('a malformed or unreadable record refuses the launch, never read as no floor', (t) => {
  const placed = aPlacedRelease(t, '0.2.0')
  writeFileSync(placed.record, '0.2.0')
  assert.match(launchBelowTheFloor(placed.tree, '0.2.0') ?? '', /floor, this machine's version floor, is not one X\.Y\.Z line; refused, never read as no floor/)
  writeFileSync(placed.record, 'x.y.z\n')
  assert.match(launchBelowTheFloor(placed.tree, '0.2.0') ?? '', /is not one X\.Y\.Z line/)
  const unreadable = aPlacedRelease(t, '0.2.0')
  mkdirSync(unreadable.record)
  assert.match(launchBelowTheFloor(unreadable.tree, '0.2.0') ?? '', /floor, this machine's version floor, could not be read \(EISDIR\); refused/)
})
