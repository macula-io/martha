// The key an engine member's endpoint names a file for (martha#511 part B): read under the home the start runs with, and
// only from this user's own plain file, closed to the group and to others. Real files, made and removed by this test.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { ENGINE_ENDPOINT, THE_HOMES_PREFIX } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theKeyInAFile } from './start_an_engine_member.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-key-file-'))
after(() => removeTheTree(home))

const A_KEY = 'a-key-this-test-writes'

/** A file under the test's home holding `text`, at `mode`. */
function aFile(name: string, text: string, mode: number): string {
  const at = join(home, name)
  writeFileSync(at, text)
  chmodSync(at, mode)
  return at
}

test('#511 part B: the owner\'s own file, closed to everyone else, gives its key without the line end, by an absolute path or one under the home', () => {
  const at = aFile('closed', `${A_KEY}\n`, 0o600)
  assert.deepEqual(theKeyInAFile(at, '/a-home-never-read'), { key: A_KEY })
  assert.deepEqual(theKeyInAFile(`${THE_HOMES_PREFIX}closed`, home), { key: A_KEY })
})

test('#511 part B: a file open to the group or others, a link, a missing file or an empty one gives no key, and no refusal says the key', () => {
  const open = aFile('open', A_KEY, 0o640)
  const link = join(home, 'a-link')
  symlinkSync(aFile('target', A_KEY, 0o600), link)
  const empty = aFile('empty', '\n', 0o600)
  for (const [at, why] of [
    [open, /is open to the group or to others/],
    [link, /is not a plain file/],
    [join(home, 'missing'), /cannot be read \(ENOENT\)/],
    [empty, /is empty/],
  ] as const) {
    const read = theKeyInAFile(at, home)
    assert.ok('refusal' in read, `${at} gave a key`)
    assert.match(read.refusal, why)
    assert.ok(read.refusal.startsWith(`${ENGINE_ENDPOINT}.key_file ${at}`), read.refusal)
    assert.ok(!read.refusal.includes(A_KEY), read.refusal)
  }
})
