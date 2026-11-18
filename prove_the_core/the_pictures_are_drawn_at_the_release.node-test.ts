// The release's own check, proved on a tree and not on this one (martha#627). Since the C4 pictures are drawn at
// release rather than carried by every pull request, the release is where a stale picture is caught: it refuses a
// tree whose committed picture is not what architecture/c4_diagrams.ts draws, naming the file and the command that
// redraws it, and passes a tree where they agree. The tree here is a temporary one holding only assets/, so nothing
// this file writes can be read by the tree scan or left behind.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DIAGRAMS, THE_C4_DIAGRAMS_PROGRAM } from '../architecture/c4_diagrams.ts'

const PROGRAM = join(import.meta.dirname, '../src/check_the_pictures_change_with_the_version/main.ts')

/** A tree holding only the pictures the generator draws, written as `draws` says of each. */
const aTreeOfPictures = (draws: (file: string) => string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'pictures-at-release-'))
  mkdirSync(join(directory, 'assets'))
  for (const make of DIAGRAMS) {
    const diagram = make()
    writeFileSync(join(directory, 'assets', diagram.file), draws(diagram.file))
  }
  return directory
}

const checked = (repository: string) =>
  spawnSync('node', [PROGRAM, '--tree', '--repository', repository], { encoding: 'utf8' })

test('a tree whose committed pictures are what the generator draws passes', () => {
  const directory = aTreeOfPictures((file) => DIAGRAMS.map((make) => make()).find((diagram) => diagram.file === file)!.svg())
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 0, `the release check refused a tree that carries the pictures it draws: ${ran.stderr}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a stale picture is refused by name, with the command that redraws it', () => {
  const first = DIAGRAMS[0]().file
  const directory = aTreeOfPictures((file) => (file === first ? 'not the picture this tree draws' : DIAGRAMS.map((make) => make()).find((diagram) => diagram.file === file)!.svg()))
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 1, 'a stale picture passed the release check')
    assert.match(ran.stderr, new RegExp(first.replace(/[.]/g, '\\.')), 'the refusal does not name the stale file')
    assert.ok(ran.stderr.includes(THE_C4_DIAGRAMS_PROGRAM), 'the refusal does not name the command that redraws it')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a picture the tree does not hold at all is refused, never read as current', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pictures-at-release-'))
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 1, 'a tree with no pictures passed the release check')
    assert.match(ran.stderr, /assets\//, 'the refusal names no picture')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
