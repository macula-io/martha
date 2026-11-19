// A test file that makes the same link as a_test_file_that_leaves_a_link_in_the_temp_directory.ts and removes it: the
// guard must leave this file alone (martha#724), which is what a file that removes what it made looks like.

import { rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

test('a file that removes the link it made', (t: TestContext) => {
  const link = join(tmpdir(), `martha-472-link-${process.pid}`)
  symlinkSync(join(tmpdir(), 'gone-by-the-time-you-look'), link)
  t.after(() => rmSync(link, { force: true }))
})
