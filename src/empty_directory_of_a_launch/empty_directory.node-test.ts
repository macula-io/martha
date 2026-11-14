// The empty directory a launch points git's hooks and direnv's config at is
// made new, 0500 and empty, and nothing else will do (empty_directory.ts).
// Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { lstatSync, mkdtempSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { EMPTY_DIRECTORY_MODE, makeEmptyDirectory } from './empty_directory.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-empty-directory-'))
  t.after(() => removeTheTree(dir))
  return dir
}

test('the empty directory is made new, 0500 and empty; a path that exists or a link refuses', (t) => {
  const dir = scratch(t)
  const made = join(dir, 'nothing')
  assert.deepEqual(makeEmptyDirectory(made), { made: true })
  assert.equal(lstatSync(made).mode & 0o777, EMPTY_DIRECTORY_MODE)
  assert.deepEqual(readdirSync(made), [])

  assert.equal(makeEmptyDirectory(made).made, false, 'an existing directory is never reused')
  const link = join(dir, 'link')
  symlinkSync(dir, link)
  assert.equal(makeEmptyDirectory(link).made, false, 'a link is never followed')
  assert.equal(makeEmptyDirectory(join(dir, 'missing', 'nothing')).made, false, 'a parent that is not there refuses')
})
