// What the confining hook lets the mesh server load (martha#73): node's own
// modules and files of its recorded tree, nothing else.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { heldByTheTree } from './confine_to_the_recorded_tree.ts'

const TREE = join('/', 'launcher', 'servers', '7.8.9', 'node_modules')
const inTree = (...parts: string[]): string => pathToFileURL(join(TREE, ...parts)).href

test('node\'s own modules and the files of the tree are held by it', () => {
  for (const url of ['node:fs', 'node:module', inTree('dep', 'index.js'), inTree('@scope', 'dep', 'lib', 'x.mjs')]) assert.ok(heldByTheTree(url, TREE), url)
})

test('a file above the tree, beside it, under a name that only starts like it, or no file at all is not held', () => {
  for (const url of [
    pathToFileURL(join(TREE, '..', 'node_modules-x', 'dep', 'index.js')).href,
    pathToFileURL(join(TREE, '..', '..', 'node_modules', 'dep', 'index.js')).href,
    pathToFileURL(`${TREE}-planted/dep/index.js`).href,
    pathToFileURL(join('/', 'home', 'member', '.node_modules', 'dep', 'index.js')).href,
    pathToFileURL(TREE).href,
    'data:text/javascript,1',
    'https://example.org/dep.js',
  ]) {
    assert.ok(!heldByTheTree(url, TREE), url)
  }
})

test('a tree named with a trailing slash holds the same files', () => {
  assert.ok(heldByTheTree(inTree('dep', 'index.js'), `${TREE}/`))
  assert.ok(!heldByTheTree(pathToFileURL(`${TREE}-planted/dep/index.js`).href, `${TREE}/`))
})
