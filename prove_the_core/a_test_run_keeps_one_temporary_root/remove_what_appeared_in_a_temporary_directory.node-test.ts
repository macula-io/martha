// What a test file leaves in its own temporary directory goes, when it is one of the two shapes a recorded-host case's
// runs make (martha#724).
//
// A case stops a run on purpose (a_switch_on_the_recorded_host.node-test.ts), and a run stopped that way can be cut off
// before its own end reaches the directory it made. The file still removes what it made: every name that appeared since
// the file began, and made by one of those runs. A name that was already there, or that is a shape the file never
// makes, is somebody else's and is left alone.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { entriesIn, removeWhatAppearedIn } from '../a_test_run_ends/every_test_file_cleans_up.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

test('what appeared in the file\'s own directory goes, and what was already there or is another shape stays', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-724-appeared-'))
  t.after(() => removeTheTree(directory))
  // Before the file began: a run's directory of the same shape, which is not this file's to remove.
  const were_there = mkdtempSync(join(directory, 'm-'))
  const before = new Set(entriesIn(directory))
  // What this file's runs made, and what another process might keep here.
  const a_case_home = join(directory, 'martha-model-host-abc123')
  const a_runs_runtime = mkdtempSync(join(directory, 'm-'))
  const somebody_elses = join(directory, 'not-this-files.txt')
  mkdirSync(a_case_home)
  mkdirSync(somebody_elses)
  removeWhatAppearedIn(directory, before)
  assert.equal(existsSync(a_case_home), false, 'the case\'s own home was left behind')
  assert.equal(existsSync(a_runs_runtime), false, 'the run\'s own runtime directory was left behind')
  assert.equal(existsSync(somebody_elses), true, 'a shape this file never makes was removed')
  assert.equal(existsSync(were_there), true, 'a directory that was there before the file began was removed')
})
