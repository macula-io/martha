// A test file the run guard must fail, and one that passes on its own: it leaves a symlink named by its own pid in the
// temp directory, the shape every_test_file_cleans_up.ts holds test files to (martha-472-link-<pid>). Run only by
// every_test_run_ends.node-test.ts, which removes what it leaves.

import { symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

test('a file that leaves a link in the temp directory behind', () => {
  symlinkSync(join(tmpdir(), 'gone-by-the-time-you-look'), join(tmpdir(), `martha-472-link-${process.pid}`))
})
