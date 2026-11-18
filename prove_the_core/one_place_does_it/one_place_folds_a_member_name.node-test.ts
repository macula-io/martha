// One place folds a member's name bites (martha#528).
//
// The rule is proved both ways on planted sources: a fold outside the one rule is named at its line, the rule's own file
// is left alone, a declared file is held to its count in both directions, and a test file is not read. Then the same rule
// runs over the whole of src/, so a copy of the comparison in the tree today is named today. The shared rule itself is
// pinned too: it folds case and drops the spaces around a name.

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { memberNameKey, sameMemberName } from '../src/declare_crew/declare_crew.ts'
import { coreSources } from './core_sources.ts'
import { CORE, manifestOf, testSuffixesOf } from './declared_in_package_json.ts'
import { THE_ONE_RULE, theFoldTold, theFoldsNamedIn } from './one_place_folds_a_member_name.ts'

const repository = join(dirname(fileURLToPath(import.meta.url)), '..')
const test_suffixes = testSuffixesOf(manifestOf(repository))

const source = (path: string, text: string): { path: string; text: string } => ({ path, text })

/** A copy of the comparison, as #528 found a dozen of them. */
const A_COPY = 'const same = (name: string, other: string): boolean => name.trim().toLowerCase() === other.trim().toLowerCase()\n'

test('#528: a member name is the same member however its case or the spaces around it are spelled', () => {
  assert.equal(sameMemberName('Terra', 'terra'), true)
  assert.equal(sameMemberName(' Terra ', 'TERRA'), true)
  assert.equal(sameMemberName('Terra', 'Terra2'), false)
  assert.equal(memberNameKey('  Vesta'), 'vesta')
})

test('#528: a copy of the comparison in another slice is named at its line, and the rule\'s own file is not', () => {
  const copy = source('a_slice/a_slice.ts', `// a comment that says toLowerCase() is not code\n${A_COPY}`)
  const rule = source(THE_ONE_RULE, 'export const memberNameKey = (name: string): string => name.trim().toLowerCase()\n')
  const found = theFoldsNamedIn([copy, rule], { test_suffixes, declared: [] })
  assert.deepEqual(found, [
    { path: 'a_slice/a_slice.ts', line: 2, why: 'folds case outside the one rule' },
    { path: 'a_slice/a_slice.ts', line: 2, why: 'folds case outside the one rule' },
  ])
  assert.match(theFoldTold(found[0]!), /^a_slice\/a_slice\.ts:2: folds case outside the one rule\. Compare member names with sameMemberName/)
})

test('#528: a declared file is held to its count, one more fold and one fewer both, and a declared file that is gone is named', () => {
  const declared = [{ path: 'a_node/a_node.ts', folds: 1, reason: 'a node id' }, { path: 'gone/gone.ts', folds: 1, reason: 'a node id' }]
  const exact = theFoldsNamedIn([source('a_node/a_node.ts', 'const id = node_id.toLowerCase()\n')], { test_suffixes, declared })
  assert.deepEqual(exact.map((fold) => fold.path), ['gone/gone.ts'], 'a file at its declared count was named, or a missing one was not')
  const more = theFoldsNamedIn([source('a_node/a_node.ts', 'const id = node_id.toLowerCase()\nconst who = name.toLocaleLowerCase()\n')], { test_suffixes, declared: declared.slice(0, 1) })
  assert.deepEqual(more.map((fold) => fold.why), ['folds case 2 times, and its declaration says 1'])
  const fewer = theFoldsNamedIn([source('a_node/a_node.ts', 'const id = node_id\n')], { test_suffixes, declared: declared.slice(0, 1) })
  assert.deepEqual(fewer.map((fold) => fold.why), ['folds case 0 times, and its declaration says 1'])
})

test('#528 r=2: a copy that upper-cases both names is named too, in either form', () => {
  const upper = source('a_slice/a_slice.ts', 'const same = (name: string, other: string): boolean => name.toUpperCase() === other.toLocaleUpperCase()\n')
  const found = theFoldsNamedIn([upper], { test_suffixes, declared: [] })
  assert.deepEqual(found, [
    { path: 'a_slice/a_slice.ts', line: 1, why: 'folds case outside the one rule' },
    { path: 'a_slice/a_slice.ts', line: 1, why: 'folds case outside the one rule' },
  ])
})

test('#528: a test file that folds case is not read', () => {
  assert.deepEqual(theFoldsNamedIn([source('a_slice/a_slice.node-test.ts', A_COPY)], { test_suffixes, declared: [] }), [])
})

test('#528: nothing in the tree folds a member\'s name outside the one rule', () => {
  const found = theFoldsNamedIn(coreSources(join(repository, CORE)), { test_suffixes })
  assert.deepEqual(found.map(theFoldTold), [], 'a slice folds case outside the one rule, or a declared count is wrong')
})
