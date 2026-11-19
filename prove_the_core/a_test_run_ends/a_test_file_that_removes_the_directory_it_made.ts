// A test file that makes the same directory as a_test_file_that_leaves_a_directory_in_its_own_temporary_root.ts and
// removes it: the guard must leave this file alone (martha#724), which is what a file that removes what it made looks
// like. Its twin leaves the directory behind and must fail.

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

test('a file that removes the directory it made', (t: TestContext) => {
  const made = join(tmpdir(), `martha-724-scratch-${process.pid}`)
  mkdirSync(made)
  t.after(() => rmSync(made, { recursive: true, force: true }))
})
