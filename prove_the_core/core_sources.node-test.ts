// What a walk of the repository's code reads, and what it never reads (martha#748).
//
// `coreSources` is the one walk every check on this code goes through, so the rule lives here once: a file inside a
// `node_modules` directory or a dot-directory is no source of this repository, at any depth, and a file whose own name
// starts with a dot is a source like any other. Only the segments below the root are read that way: a root that sits
// inside a dot-directory is still read in full.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { coreSources } from './core_sources.ts'

/** A tree a test owns, holding `files` by their path under it, removed when the test ends. */
const plantedTree = (t: TestContext, files: Readonly<Record<string, string>>, inside?: string): string => {
  // Resolved, because CI runs the suite with TMPDIR on a symlink and the walk spells its paths from the root it is given.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'martha-748-sources-')))
  t.after(() => removeTheTree(base))
  const root = inside === undefined ? base : join(base, inside)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test('a walk reads no installed package and no dot-directory, at any depth below the root it is given', (t) => {
  const root = plantedTree(t, {
    'src/one/a.ts': 'export const a = 1\n',
    'installer/one.ts': 'export const one = 1\n',
    'installer/node_modules/a-package/a.js': 'export const a = 1\n',
    'installer/deep/node_modules/b-package/b.js': 'export const b = 1\n',
    'installer/.cached/c.js': 'export const c = 1\n',
  })
  assert.deepEqual(coreSources(root).map((source) => source.path).sort(), ['installer/one.ts', 'src/one/a.ts'], 'only this repository\'s own code')
})

test('a script whose own name starts with a dot is a source like any other', (t) => {
  const root = plantedTree(t, { 'installer/.x.ts': 'export const x = 1\n', 'installer/one.ts': 'export const one = 1\n' })
  assert.deepEqual(coreSources(root).map((source) => source.path).sort(), ['installer/.x.ts', 'installer/one.ts'], 'only dot-DIRECTORIES are skipped')
})

test('the root\'s own path is never a reason to skip: a root inside a dot-directory is read in full', (t) => {
  const root = plantedTree(t, { 'src/one/a.ts': 'export const a = 1\n', 'src/two/b.ts': 'export const b = 1\n' }, '.hidden-root')
  assert.deepEqual(coreSources(root).map((source) => source.path).sort(), [join('src', 'one', 'a.ts'), join('src', 'two', 'b.ts')].sort(), 'the segments above the root are the caller\'s business')
})
