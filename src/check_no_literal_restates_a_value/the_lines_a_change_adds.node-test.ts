// The lines a change adds, read from a diff (martha#289).
//
// The gate judges what a change writes, and this is the half of that reading a
// test can hold without a repository: the new side of each hunk, with a hunk that
// only removes lines adding none, and a deleted file contributing nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addedLinesIn, underCore } from './the_lines_a_change_adds.ts'

test('a hunk adds the lines its new side names, counted from its first line', () => {
  const diff = [
    'diff --git a/src/a_slice/a.ts b/src/a_slice/a.ts',
    '--- a/src/a_slice/a.ts',
    '+++ b/src/a_slice/a.ts',
    '@@ -3,2 +3,4 @@ something',
    "+const one = 'x'",
    "+const two = 'y'",
  ].join('\n')

  assert.deepEqual([...addedLinesIn(diff)], ['a_slice/a.ts:3', 'a_slice/a.ts:4', 'a_slice/a.ts:5', 'a_slice/a.ts:6'])
})

test('a hunk that only removes lines adds none, and a count left out means one line', () => {
  const removes = ['+++ b/src/a_slice/a.ts', '@@ -3,2 +3,0 @@'].join('\n')
  const one = ['+++ b/src/a_slice/a.ts', '@@ -3 +3 @@'].join('\n')

  assert.deepEqual([...addedLinesIn(removes)], [])
  assert.deepEqual([...addedLinesIn(one)], ['a_slice/a.ts:3'])
})

test('a file the change deletes adds nothing, and a path outside the core keeps its own shape', () => {
  const deleted = ['--- a/src/a_slice/a.ts', '+++ /dev/null'].join('\n')
  const outside = ['+++ b/prove_the_core/a_check.ts', '@@ -1 +1 @@'].join('\n')

  assert.deepEqual([...addedLinesIn(deleted)], [])
  assert.deepEqual([...addedLinesIn(outside)], ['prove_the_core/a_check.ts:1'])
  assert.equal(underCore('src/a_slice/a.ts'), 'a_slice/a.ts')
  assert.equal(underCore('prove_the_core/a_check.ts'), 'prove_the_core/a_check.ts')
})

test('two files in one diff each add their own lines', () => {
  const diff = [
    '+++ b/src/one/a.ts',
    '@@ -1 +1,2 @@',
    '+++ b/src/two/b.ts',
    '@@ -5 +5 @@',
  ].join('\n')

  assert.deepEqual([...addedLinesIn(diff)], ['one/a.ts:1', 'one/a.ts:2', 'two/b.ts:5'])
})
