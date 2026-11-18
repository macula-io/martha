// One place asks GitHub bites (martha#320, package B).
//
// The check is proved both ways: a planted poll in a slice that is not the budget is named, at its own line, and the
// budget's own poll is left alone. Then the same rule runs over the whole of src/, so a poll that is in the tree today
// is named today rather than at the first review that reads it.

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { coreSources } from './core_sources.ts'
import { manifestOf, testSuffixesOf } from './declared_in_package_json.ts'
import { CORE } from './declared_in_package_json.ts'
import { THE_ONE_PLACE, thePollTold, thePollsIn } from './one_place_asks_github.ts'

const repository = join(dirname(fileURLToPath(import.meta.url)), '..')
const test_suffixes = testSuffixesOf(manifestOf(repository))

const source = (path: string, text: string): { path: string; text: string } => ({ path, text })

test('#320 B: a poll in another slice is named, at its line, and the budget\'s own is not', () => {
  const elsewhere = source('a_reader/a_reader.ts', "const args = ['run', 'list', '--commit', sha]\n")
  const inTheBudget = source(`${THE_ONE_PLACE}/${THE_ONE_PLACE}.ts`, "const args = ['run', 'watch']\n")
  const found = thePollsIn([elsewhere, inTheBudget], { test_suffixes })
  assert.deepEqual(found, [{ path: 'a_reader/a_reader.ts', line: 1, what: 'gh run list' }], 'the poll outside the budget was not the one named')
  assert.match(thePollTold(found[0]!), /polls GitHub outside spend_the_github_budget/)
})

test('#320 B: a poll written as a shell line is named too, and a one-shot read is not a poll', () => {
  const shell = source('a_shell/a_shell.ts', "  exec('gh run watch 43478458759')\n")
  const oneShot = source('a_reader/a_reader.ts', "  run('gh', ['api', 'repos/acme/widget/actions/runs?head_sha=abc'])\n")
  const found = thePollsIn([shell, oneShot], { test_suffixes })
  assert.deepEqual(found.map((poll) => poll.what), ['gh run watch'], 'a shell poll was not named, or a one-shot read was')
})

test('#320 B: a test file that names a poll is not a poll', () => {
  const planted = source('a_slice/a_slice.node-test.ts', "// the plant: `gh run list` in a script\n")
  assert.deepEqual(thePollsIn([planted], { test_suffixes }), [], 'the planted case in a test file was named as a poll')
})

test('#320 B: nothing in the tree polls GitHub outside the one place', () => {
  const found = thePollsIn(coreSources(join(repository, CORE)), { test_suffixes })
  assert.deepEqual(found.map(thePollTold), [], 'a slice polls GitHub on its own')
})
