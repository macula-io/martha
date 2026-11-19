// A test file the run guard must fail: it leaves a symlink named by its own pid in the temp directory it was given, the
// shape that made part 1 of martha#724 (martha-472-link-<pid>). Run only by every_test_run_ends.node-test.ts: the guard
// names it and fails it, and the leftover goes with the file's own directory, which the run's roots take with them.

import { symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

test('a file that leaves a link in the temp directory behind', () => {
  symlinkSync(join(tmpdir(), 'gone-by-the-time-you-look'), join(tmpdir(), `martha-472-link-${process.pid}`))
})
