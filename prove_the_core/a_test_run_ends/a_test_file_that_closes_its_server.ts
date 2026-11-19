// A test file that starts a server and closes it in t.after, registered before
// anything can fail, for every_test_run_ends.node-test.ts: the run must pass it.
// It is not a .node-test.ts file, so npm test never runs it.

import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'

test('a test that closes its server after itself', async (t) => {
  const server = createServer()
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
})
