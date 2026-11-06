// A test file whose test passes but leaves a listening server open, for
// every_test_run_ends.node-test.ts: the run must fail it by name. It is not a
// .node-test.ts file, so npm test never runs it; the check runs it on purpose.

import { createServer } from 'node:net'
import { test } from 'node:test'

test('a test that leaves its server listening', () => {
  createServer().listen(0, '127.0.0.1')
})
