// The key a provider is reached with, read from the file the declaration names (martha#511 part B, martha#931; gap 4 of
// martha#957): read by its absolute path or one under the owner's home, and only from this user's own plain file, closed
// to the group and to others. Every refusal names the place of the declaration the file was named at, and none of them
// names the key. Real files, made and removed by this test.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { ENGINE_ENDPOINT } from '../declare_crew/declare_crew.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { THE_MODE_BITS_OF_GROUP_AND_OTHERS, theKeyInAFile, theKeyInTheOwnersFile, whyAKeyFileIsNotTheOwners } from './read_a_providers_key_file.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-key-file-'))
after(() => removeTheTree(home))

const A_KEY = 'a-key-this-test-writes'

/** The field the engine's key file is named at, built the way its two callers build it. */
const ENGINE_KEY_FILE = `${ENGINE_ENDPOINT}.key_file`

/** A member's declared provider, named the way the declaration names one (martha#931). */
const A_PROVIDERS_KEY_FILE = 'providers.a-provider-a-test-names.key_file'

/** A file under the test's home holding `text`, at `mode`. */
function aFile(name: string, text: string, mode: number): string {
  const at = join(home, name)
  writeFileSync(at, text)
  chmodSync(at, mode)
  return at
}

test('#511 part B: the owner\'s own file, closed to everyone else, gives its key without the line end', () => {
  const at = aFile('closed', `${A_KEY}\n`, 0o600)
  assert.deepEqual(theKeyInAFile(at, ENGINE_KEY_FILE), { key: A_KEY })
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
    const read = theKeyInAFile(at, ENGINE_KEY_FILE)
    assert.ok('refusal' in read, `${at} gave a key`)
    assert.match(read.refusal, why)
    assert.ok(read.refusal.startsWith(`${ENGINE_KEY_FILE} ${at}`), read.refusal)
    assert.ok(!read.refusal.includes(A_KEY), read.refusal)
  }
})

test('gap 4: a member\'s key file is refused at the place its provider is named, and never at the engine\'s', () => {
  const open = aFile('open-for-a-member', A_KEY, 0o604)
  const read = theKeyInAFile(open, A_PROVIDERS_KEY_FILE)
  assert.ok('refusal' in read, 'a key file open to others gave a key')
  assert.ok(read.refusal.startsWith(`${A_PROVIDERS_KEY_FILE} ${open}`), read.refusal)
  assert.ok(!read.refusal.includes(`${ENGINE_KEY_FILE}`), read.refusal)
})

test('#931: a provider\'s key file under ~/ is read from the owner\'s home, and a path still not absolute gives no key', () => {
  aFile('under-the-home', `${A_KEY}\n`, 0o600)
  assert.deepEqual(theKeyInTheOwnersFile('~/under-the-home', home, ENGINE_KEY_FILE), { key: A_KEY })
  assert.deepEqual(theKeyInTheOwnersFile(join(home, 'under-the-home'), '/no-such-home', ENGINE_KEY_FILE), { key: A_KEY }, 'an absolute path is read as it is')
  const relative = theKeyInTheOwnersFile('under-the-home', home, A_PROVIDERS_KEY_FILE)
  assert.ok('refusal' in relative && /is not an absolute path or one under ~\//.test(relative.refusal), JSON.stringify(relative))
  assert.ok('refusal' in relative && relative.refusal.startsWith(`${A_PROVIDERS_KEY_FILE}`), JSON.stringify(relative), 'a relative path names the place it was written at')
})

test('#511 part B: a key file is read only when it is this user\'s own plain file with no right for the group or others', () => {
  const owners = { plain_file: true, owner_is_this_user: true, mode: 0o100600 }
  assert.equal(whyAKeyFileIsNotTheOwners(ENGINE_KEY_FILE, '/k', owners), undefined)
  assert.match(whyAKeyFileIsNotTheOwners(ENGINE_KEY_FILE, '/k', { ...owners, plain_file: false }) ?? '', /\/k is not a plain file/)
  assert.match(whyAKeyFileIsNotTheOwners(ENGINE_KEY_FILE, '/k', { ...owners, owner_is_this_user: false }) ?? '', /\/k is not this user's own file/)
  for (let bit = 1; bit <= THE_MODE_BITS_OF_GROUP_AND_OTHERS; bit <<= 1) {
    assert.match(whyAKeyFileIsNotTheOwners(ENGINE_KEY_FILE, '/k', { ...owners, mode: owners.mode | bit }) ?? '', /open to the group or to others/, `mode bit ${bit.toString(8)} was let through`)
  }
})
