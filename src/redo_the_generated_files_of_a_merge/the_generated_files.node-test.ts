// The pictures a landing redraws are the C4 program's own (martha#381).
//
// A landing redoes a clash in the pictures by running the program that draws them, and treats a path as a picture only
// when that program draws it. This pins the two ends together: every picture the program draws is one a landing redraws,
// every one of them is a file this repository holds, and the program a landing runs is the one that draws them.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { DIAGRAMS } from '../../architecture/c4_diagrams.ts'
import { isAPictureRedrawn, THE_PICTURES_REDRAWN_AS } from './the_generated_files.ts'

const repository = join(import.meta.dirname, '..', '..')

test('#381: every picture the C4 program draws is one a landing redraws, and one the repository holds', () => {
  const drawn = DIAGRAMS.map((make) => join('assets', make().file))
  for (const picture of drawn) {
    assert.ok(isAPictureRedrawn(picture), `${picture} is drawn by the C4 program, and a landing would not redo it`)
    assert.ok(existsSync(join(repository, picture)), `${picture} is named as a picture and the repository does not hold it`)
  }
})

test('#381: the program a landing runs to redraw them is the one that draws them', () => {
  const program = THE_PICTURES_REDRAWN_AS[1]
  assert.ok(existsSync(join(repository, program)), `the landing runs ${program}, which is not in this repository`)
})
