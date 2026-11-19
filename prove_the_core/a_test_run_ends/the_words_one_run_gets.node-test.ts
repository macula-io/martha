// The words one run of the tests gets (martha#723): the single-file run reads the suite's words out of the test script
// instead of writing them again, so these pin the reading, the refusal when there is nothing to read, and the globs that
// decide which files the suite runs at all.
//
// The values here are the test's own, deliberately none of the repository's: a case that passed with `--test-timeout=`
// equal to the script's own number would pass whether the reading worked or the number was written down.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { theGlobPicking, theSuiteCommandOf } from './the_words_one_run_gets.ts'

const repository = join(import.meta.dirname, '../..')
const theReader = join(import.meta.dirname, 'the_words_one_run_gets.ts')

/** What the reader answers when it is run the way the runner runs it. */
function theAnswer(...asked: readonly string[]): { readonly status: number | null; readonly out: string; readonly err: string } {
  const ran = spawnSync(process.execPath, [theReader, ...asked], { cwd: repository, encoding: 'utf8' })
  return { status: ran.status, out: ran.stdout ?? '', err: ran.stderr ?? '' }
}

test('#723: the command the tests run with is the one carrying the runner, and its unsets and words are read as written (mutant: the first command taken)', () => {
  const command = theSuiteCommandOf([
    { unsets: [], words: ['node', './a_check.ts'] },
    { unsets: ['A_PLANTED_VARIABLE'], words: ['node', 'a-wrapper.ts', 'node', '--test', '--test-timeout=1234', 'a-file.node-test.ts'] },
  ])
  assert.deepEqual(command.unsets, ['A_PLANTED_VARIABLE'])
  assert.deepEqual(command.words, ['node', 'a-wrapper.ts', 'node', '--test', '--test-timeout=1234', 'a-file.node-test.ts'])
})

test('#723: a test script that runs no command with the runner is refused by name, and so is one that runs two (mutant: the first taken)', () => {
  assert.throws(() => theSuiteCommandOf([{ unsets: [], words: ['node', 'a_check.ts'] }]), /runs no command with --test/)
  const twice = [
    { unsets: [], words: ['node', '--test', 'a-file.node-test.ts'] },
    { unsets: [], words: ['node', '--test', 'another-file.node-test.ts'] },
  ]
  assert.throws(() => theSuiteCommandOf(twice), /runs 2 commands with --test/)
})

test('#723: a path is picked only by a glob that matches it, and nothing is picked otherwise (mutant: the first glob returned)', () => {
  const globs = ['one/**/*.node-test.ts', 'two/**/*.node-test.mjs']
  assert.equal(theGlobPicking(globs, 'two/deep/x.node-test.mjs'), 'two/**/*.node-test.mjs')
  assert.equal(theGlobPicking(globs, 'one/x.node-test.ts'), 'one/**/*.node-test.ts')
  assert.equal(theGlobPicking(globs, 'tree/x.node-test.ts'), undefined)
  assert.equal(theGlobPicking(globs, 'one/x.node-test.mjs'), undefined)
})

test('#723: the reader answers the suite\'s own words, picks a file the suite runs, and refuses one it does not by naming every glob (mutant: the globs not printed)', () => {
  const stage = theAnswer('stage')
  assert.equal(stage.status, 0, stage.err)
  assert.ok(stage.out.trim().split('\n').includes('--test'), stage.out)
  const unsets = theAnswer('unsets')
  assert.equal(unsets.status, 0, unsets.err)
  for (const name of unsets.out.trim().split('\n')) assert.match(name, /^[A-Z][A-Z0-9_]*$/)
  const picked = theAnswer('picks', 'prove_the_core/read_a_source/parse_a_source.node-test.ts')
  assert.equal(picked.status, 0, picked.err)
  assert.equal(picked.out.trim(), 'prove_the_core/**/*.node-test.ts')
  const refused = theAnswer('picks', 'CONTRIBUTING.md')
  assert.equal(refused.status, 1)
  assert.match(refused.err, /the suite runs no CONTRIBUTING\.md; its globs are .*src\/\*\*\/\*\.node-test\.ts/)
  assert.equal(theAnswer('no-such-question').status, 2)
})
