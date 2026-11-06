// A test file that never finishes and holds a listening socket open, for
// every_test_run_ends.node-test.ts. It is not a .node-test.ts file, so npm test
// never runs it; the check runs it on purpose, in a process group it kills after.

import { createServer } from 'node:net'
import { test } from 'node:test'

import { HUNG_TEST_NAME } from './every_test_run_ends.ts'

test(HUNG_TEST_NAME, async () => {
  createServer().listen(0, '127.0.0.1')
  await new Promise(() => undefined)
})
