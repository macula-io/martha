// The release's own check, proved on a tree and not on this one (martha#627). Since the C4 pictures are drawn at
// release rather than carried by every pull request, the release is where a stale picture is caught: it refuses a
// tree whose committed picture is not what architecture/c4_diagrams.ts draws, naming the file and the command that
// redraws it, and passes a tree where they agree. The tree here is a temporary one holding only assets/, so nothing
// this file writes can be read by the tree scan or left behind.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { DIAGRAMS, THE_C4_DIAGRAMS_PROGRAM } from '../architecture/c4_diagrams.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

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

/** A git command in the planted repository, which must end well. */
const gitIn = (repository: string, ...args: readonly string[]): string => {
  const ran = spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
  assert.equal(ran.status, 0, `git ${args.join(' ')} failed: ${ran.stderr}`)
  return ran.stdout.trim()
}

test('a tree whose committed pictures are what the generator draws passes', () => {
  const directory = aTreeOfPictures((file) => DIAGRAMS.map((make) => make()).find((diagram) => diagram.file === file)!.svg())
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 0, `the release check refused a tree that carries the pictures it draws: ${ran.stderr}`)
  } finally {
    removeTheTree(directory)
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
    removeTheTree(directory)
  }
})

test('a picture the tree does not hold at all is refused, never read as current', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pictures-at-release-'))
  try {
    const ran = checked(directory)
    assert.equal(ran.status, 1, 'a tree with no pictures passed the release check')
    assert.match(ran.stderr, /assets\//, 'the refusal names no picture')
  } finally {
    removeTheTree(directory)
  }
})

test('a change cut before the release bump is read from its merge base, never from the base tip', () => {
  // The shape of a branch cut before a release: main then bumps the version and draws the picture, and the branch
  // touches the model alone. Read two-dot against main's new tip, that change would look like a bump of its own, in
  // reverse — a downgrade counts — with main's redraw as its own picture, and the pictures it never touched are stale.
  const directory = aTreeOfPictures((file) => `the picture ${file} held before the model changed\n`)
  try {
    gitIn(directory, 'init', '-q', '-b', 'main')
    gitIn(directory, 'config', 'user.email', 'planted@example.invalid')
    gitIn(directory, 'config', 'user.name', 'planted')
    writeFileSync(join(directory, 'package.json'), '{"version":"1.0.0"}\n')
    writeFileSync(join(directory, 'the_model.ts'), 'the model, as the work was cut from it\n')
    gitIn(directory, 'add', '-A')
    gitIn(directory, 'commit', '-q', '-m', 'the tree the work was cut from')
    gitIn(directory, 'checkout', '-q', '-b', 'work')
    writeFileSync(join(directory, 'the_model.ts'), 'the model, as the work changed it\n')
    gitIn(directory, 'add', '-A')
    gitIn(directory, 'commit', '-q', '-m', 'a change to the model alone')
    const work = gitIn(directory, 'rev-parse', 'HEAD')
    gitIn(directory, 'checkout', '-q', 'main')
    writeFileSync(join(directory, 'package.json'), '{"version":"1.1.0"}\n')
    writeFileSync(join(directory, 'assets', DIAGRAMS[0]().file), 'the picture as that release drew it\n')
    gitIn(directory, 'add', '-A')
    gitIn(directory, 'commit', '-q', '-m', 'the release bump, and the picture it draws')
    const released = gitIn(directory, 'rev-parse', 'HEAD')
    gitIn(directory, 'checkout', '-q', 'work')

    const ran = spawnSync('node', [PROGRAM, '--base', released, '--head', work, '--repository', directory], { encoding: 'utf8' })
    assert.equal(ran.status, 0, `a change that touches no picture was refused because main had moved: ${ran.stderr}`)
    assert.match(ran.stdout, /no picture is touched/, 'the pass line reads as though the pictures were judged')
  } finally {
    removeTheTree(directory)
  }
})
