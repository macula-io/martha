// A test file whose one test fails, for no_test_output_carries_the_environment.node-test.ts:
// node --test lists its failure after the summary, and the run must still read as
// complete (martha#325). It is not a .node-test.ts file, so npm test never runs it;
// the check runs it on purpose.

import { test } from 'node:test'

test('a test that fails', () => {
  throw new Error('this test fails on purpose')
})
