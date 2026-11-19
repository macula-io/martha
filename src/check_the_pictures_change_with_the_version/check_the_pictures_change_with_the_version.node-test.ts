// The picture rule's two halves (martha#627): a change may touch a picture only when it bumps the version, and a
// change that bumps the version must leave every picture what the generator draws. Both are read off values here, so
// no test touches git or a tree; the release's own read of a tree is proved end to end in
// prove_the_core/the_release_is_proven/the_pictures_are_drawn_at_the_release.node-test.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DIAGRAMS, THE_C4_DIAGRAMS_PROGRAM, THE_PICTURES_THE_C4_DRAWS } from '../../architecture/c4_diagrams.ts'
import { manifestPathOf } from '../../prove_the_core/read_the_manifest_and_the_linter/declared_in_package_json.ts'
import {
  DRAWN_AT_RELEASE,
  bumpsTheVersion,
  thePicturesChangedIn,
  theRefusalsOfAChange,
  theRefusalsOfATree,
  type AChange,
} from './check_the_pictures_change_with_the_version.ts'

/** The manifest as a range names it: the tree's own declaration of the path, never spelled here. */
const THE_MANIFEST = manifestPathOf('.')

const drawnAt = (at: number): string => DIAGRAMS[at]?.().svg() ?? ''

/** Every picture as a tree holds it, with one of them left stale when `stale` is given. */
const thePictures = (stale?: number) =>
  THE_PICTURES_THE_C4_DRAWS.map((file, at) => ({ file, committed: at === stale ? 'not the picture this tree draws' : drawnAt(at), drawn: drawnAt(at) }))

const aChange = (paths: readonly string[], versionAtBase = '1.0.0', versionAtHead = versionAtBase): AChange => ({ paths, versionAtBase, versionAtHead })

const FIRST = THE_PICTURES_THE_C4_DRAWS[0] ?? ''

test('a picture is touched only by a change that bumps the version', () => {
  const refusals = theRefusalsOfAChange(aChange([FIRST, 'src/a_slice/a_slice.ts']), thePictures())
  assert.deepEqual(refusals, [`${FIRST} changed in a change that does not bump the version: ${DRAWN_AT_RELEASE}`])
})

test('a change that touches no picture passes, whether or not it bumps the version', () => {
  assert.deepEqual(theRefusalsOfAChange(aChange(['src/a_slice/a_slice.ts']), thePictures()), [])
  assert.deepEqual(theRefusalsOfAChange(aChange(['src/a_slice/a_slice.ts'], '1.0.0', '1.1.0'), thePictures()), [])
})

test('a version bump need not redraw: pictures the generator already draws pass it', () => {
  assert.deepEqual(theRefusalsOfAChange(aChange([THE_MANIFEST], '1.0.0', '1.1.0'), thePictures()), [])
})

test('a version bump that leaves a picture stale is refused by name, with the command that redraws it', () => {
  const refusals = theRefusalsOfAChange(aChange([FIRST], '1.0.0', '1.1.0'), thePictures(0))
  assert.deepEqual(refusals, [`${FIRST} is not what ${THE_C4_DIAGRAMS_PROGRAM} draws: run node ${THE_C4_DIAGRAMS_PROGRAM}`])
})

test('a picture the tree does not hold at all is refused, never read as current', () => {
  const missing = thePictures().map((picture, at) => (at === 0 ? { ...picture, committed: undefined } : picture))
  assert.deepEqual(theRefusalsOfAChange(aChange([], '1.0.0', '1.1.0'), missing), [`${FIRST} is not in the tree, and ${THE_C4_DIAGRAMS_PROGRAM} draws it: run node ${THE_C4_DIAGRAMS_PROGRAM}`])
})

test('a tree is judged on its pictures alone, and a tree whose pictures are what it draws is clean', () => {
  assert.deepEqual(theRefusalsOfATree(thePictures()), [])
  assert.equal(theRefusalsOfATree(thePictures(1)).length, 1)
})

test('a bump is read from two versions that both exist, so a side that states none never reads as a bump', () => {
  assert.equal(bumpsTheVersion(aChange([], '1.0.0', '1.1.0')), true)
  assert.equal(bumpsTheVersion(aChange([])), false)
  assert.deepEqual(thePicturesChangedIn([FIRST, 'x']), [FIRST])
})
