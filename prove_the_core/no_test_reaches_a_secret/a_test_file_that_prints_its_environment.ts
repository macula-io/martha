// A test file whose test passes but lets a child that prints its environment
// write into the run, the way execFileSync copies a child's stderr to its own,
// for no_test_output_carries_the_environment.node-test.ts: the run must fail.
// It is not a .node-test.ts file, so npm test never runs it; the check runs it
// on purpose.

import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { test } from 'node:test'

test('a test whose child prints its environment', () => {
  execFileSync(process.execPath, ['-e', 'process.stderr.write(JSON.stringify(process.env))'], { encoding: 'utf8' })
})
