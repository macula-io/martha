// A test file whose child prints its environment into a captured stream the
// test asserts on, for no_test_output_carries_the_environment.node-test.ts:
// nothing reaches the run, so it passes. Not a .node-test.ts file; the check
// runs it on purpose.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { test } from 'node:test'

test('a test that captures what its child prints', () => {
  const run = spawnSync(process.execPath, ['-e', 'process.stderr.write(JSON.stringify(process.env))'], { encoding: 'utf8' })
  assert.equal(run.status, 0)
  assert.ok(run.stderr.length > 0)
})
