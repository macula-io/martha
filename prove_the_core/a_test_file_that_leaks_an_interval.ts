// A test file whose test passes but leaves an interval running, for
// every_test_run_ends.node-test.ts: the run must fail it by name. It is not a
// .node-test.ts file, so npm test never runs it; the check runs it on purpose.

import { test } from 'node:test'

test('a test that leaves its interval running', () => {
  setInterval(() => undefined, 1000)
})
