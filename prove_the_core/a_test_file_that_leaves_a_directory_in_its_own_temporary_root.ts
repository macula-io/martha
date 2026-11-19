// A test file the run guard must fail: it makes a directory in the temp directory it was given, and never removes it —
// the shape a scratch a test forgets takes, and the shape the general check is for (martha#724). Its twin removes what
// it made, and the guard must leave that one alone. Run only by every_test_run_ends.node-test.ts.

import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

test('a file that leaves a directory in the temp directory it was given', () => {
  mkdirSync(join(tmpdir(), `martha-724-scratch-${process.pid}`))
})
