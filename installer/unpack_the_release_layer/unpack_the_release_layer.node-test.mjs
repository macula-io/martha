// Every hostile tar class and every cap, refused by name before a byte is written (martha#21, design step 6).
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import { Refused } from '../refuse_in_words/refuse_in_words.mjs'
import { goodEntries, paxRecord, removeEvenReadOnly, tarOf } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { UNPACK_LIMITS, cleanPath, unpackLayer } from './unpack_the_release_layer.mjs'

/** @param {import('node:test').TestContext} t */
const stage = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-unpack-'))
  t.after(() => removeEvenReadOnly(dir))
  return dir
}

/**
 * @param {import('node:test').TestContext} t
 * @param {Buffer} gzipped
 * @param {RegExp} pattern
 */
const refusedWithNothingWritten = async (t, gzipped, pattern) => {
  const dir = stage(t)
  await assert.rejects(unpackLayer(gzipped, dir), (error) => {
    assert.ok(error instanceof Refused, `expected a refusal, got ${error}`)
    assert.match(error.message, pattern)
    return true
  })
  assert.deepEqual(readdirSync(dir), [], 'nothing was written')
}

/** @param {import('../serve_a_release_locally/serve_a_release_locally.mjs').TarEntry[]} entries */
const layerOf = (entries) => gzipSync(tarOf(entries))

test('a sound layer is written read-only: files 0444/0555, directories 0555, links as given', async (t) => {
  const dir = stage(t)
  await unpackLayer(layerOf(goodEntries()), dir)
  assert.equal(readFileSync(join(dir, 'martha', 'README.md'), 'utf8'), '# Martha\n')
  assert.equal(statSync(join(dir, 'martha', 'bin', 'martha')).mode & 0o777, 0o555)
  assert.equal(statSync(join(dir, 'martha', 'README.md')).mode & 0o777, 0o444)
  assert.equal(statSync(join(dir, 'martha')).mode & 0o777, 0o555)
  assert.equal(readlinkSync(join(dir, 'martha', 'docs')), 'README.md')
})

const hostile = [
  ['an absolute path', [{ name: '/etc/martha', body: 'x' }], /absolute path/],
  ['a path through ..', [{ name: 'martha/../../escape', body: 'x' }], /through '\.\.'/],
  ['a .. hidden in a pax name', [{ name: 'martha/ok', pax: 'martha/../../escape', body: 'x' }], /through '\.\.'/],
  ['a .. hidden in a GNU long name', [{ name: 'martha/ok', gnuLong: 'martha/../../escape', body: 'x' }], /through '\.\.'/],
  ['a whiteout', [{ name: 'martha/.wh.README.md', body: '' }], /whiteout/],
  ['a fifo', [{ name: 'martha/pipe', type: '6' }], /tar type '6'/],
  ['a character device', [{ name: 'martha/tty', type: '3' }], /tar type '3'/],
  ['a hard link', [{ name: 'martha/hard', type: '1', target: 'martha/README.md' }], /tar type '1'/],
  ['an absolute link', [{ name: 'martha/', type: '5' }, { name: 'martha/out', type: '2', target: '/etc/passwd' }], /not a relative path/],
  ['a link out of the tree', [{ name: 'martha/', type: '5' }, { name: 'martha/out', type: '2', target: '../../etc' }], /outside martha\//],
  ['an entry under a link', [{ name: 'martha/', type: '5' }, { name: 'martha/l', type: '2', target: '.' }, { name: 'martha/l/x', body: 'x' }], /under the link martha\/l/],
  ['an entry written twice', [{ name: 'martha/a', body: 'x' }, { name: 'martha/a', body: 'y' }], /martha\/a twice/],
  ['the top itself a link', [{ name: 'martha', type: '2', target: 'martha/x' }], /martha is a link/],
  ['a path outside martha/', [{ name: 'other/file', body: 'x' }], /outside martha\//]
]

// A link judged on its text alone escapes through another link: X climbs back to martha/ on its own, and esc walks
// into X and on up past it, out of martha/ and past the home directory (martha#21 code review r=1).
const linkThroughLink = [
  { name: 'martha/', type: '5' },
  { name: 'martha/a/b/c/d/e/f/', type: '5' },
  { name: 'martha/a/b/c/d/e/f/X', type: '2', target: '../../../../../..' },
  { name: 'martha/esc', type: '2', target: 'a/b/c/d/e/f/X/../../../../../../../ssh' }
]
hostile.push(
  ['a link that escapes through another link', linkThroughLink, /links martha\/esc outside martha\//],
  ['a link that leaves martha/ and comes back', [{ name: 'martha/', type: '5' }, { name: 'martha/back', type: '2', target: '../martha/README.md' }], /links martha\/back outside martha\//],
  ['a cycle of links', [{ name: 'martha/', type: '5' }, { name: 'martha/p', type: '2', target: 'q' }, { name: 'martha/q', type: '2', target: 'p' }], new RegExp(`through more than ${UNPACK_LIMITS.linkHops} links`)]
)

test('a link through another link that stays inside martha/ is written as given', async (t) => {
  const dir = stage(t)
  await unpackLayer(layerOf([
    { name: 'martha/', type: '5' },
    { name: 'martha/d/', type: '5' },
    { name: 'martha/d/f', body: 'f\n' },
    { name: 'martha/l', type: '2', target: 'd' },
    { name: 'martha/m', type: '2', target: 'l/f' }
  ]), dir)
  assert.equal(readlinkSync(join(dir, 'martha', 'm')), 'l/f')
  assert.equal(readFileSync(join(dir, 'martha', 'm'), 'utf8'), 'f\n')
})

for (const [what, entries, pattern] of hostile) {
  test(`refused: ${what}`, async (t) => {
    await refusedWithNothingWritten(t, layerOf(/** @type {any} */ (entries)), /** @type {RegExp} */ (pattern))
  })
}

test('refused: a gzip stream that unpacks past 256 MiB, never truncated', async (t) => {
  const bomb = gzipSync(Buffer.alloc(UNPACK_LIMITS.unpackedBytes + 1))
  await refusedWithNothingWritten(t, bomb, /unpacks to more than 268435456 bytes/)
})

test('refused: more than 4096 tar headers, long-name records counted', async (t) => {
  /** @type {import('../serve_a_release_locally/serve_a_release_locally.mjs').TarEntry[]} */
  const entries = [{ name: 'martha/', type: '5' }]
  for (let i = 0; entries.length <= UNPACK_LIMITS.entries; i++) entries.push({ name: `martha/f${i}`, body: '' })
  assert.equal(entries.length, UNPACK_LIMITS.entries + 1)
  await refusedWithNothingWritten(t, layerOf(entries), /more than 4096 tar headers/)
  // 2048 entries each behind a pax header are 4096 headers: one more pax-named entry passes the cap.
  /** @type {import('../serve_a_release_locally/serve_a_release_locally.mjs').TarEntry[]} */
  const named = [{ name: 'martha/', type: '5' }]
  for (let i = 0; named.length <= UNPACK_LIMITS.entries / 2; i++) named.push({ name: `martha/p${i}`, pax: `martha/p${i}`, body: '' })
  await refusedWithNothingWritten(t, layerOf(named), /more than 4096 tar headers/)
})

test('refused: a 1025-byte path reached through a pax record', async (t) => {
  const deep = `martha/${'d/'.repeat(508)}xy`
  assert.equal(Buffer.byteLength(deep), UNPACK_LIMITS.pathBytes + 1)
  await refusedWithNothingWritten(t, layerOf([{ name: 'martha/x', pax: deep, body: '' }]), /pax header of \d+ bytes, over the 1024 a name may have/)
})

test('refused: a 1025-byte path reached through a GNU long name', async (t) => {
  const deep = `martha/${'d/'.repeat(508)}xy`
  await refusedWithNothingWritten(t, layerOf([{ name: 'martha/x', gnuLong: deep, body: '' }]), /long name of \d+ bytes, over the 1024 a name may have/)
})

test('a resolved name over 1024 bytes is refused by its own length too', () => {
  assert.throws(() => cleanPath(`martha/${'a/'.repeat(509)}`), /path of 1025 bytes, over the 1024/)
})

test('refused: a 256-byte path part reached through a pax record', async (t) => {
  const part = 'p'.repeat(UNPACK_LIMITS.partBytes + 1)
  await refusedWithNothingWritten(t, layerOf([{ name: 'martha/x', pax: `martha/${part}`, body: '' }]), /path part of 256 bytes, over the 255/)
})

test('refused: a pax record over the cap, whatever its key, before it is parsed', async (t) => {
  const raw = paxRecord('comment', 'c'.repeat(UNPACK_LIMITS.pathBytes))
  assert.ok(Buffer.byteLength(raw) > UNPACK_LIMITS.pathBytes)
  await refusedWithNothingWritten(t, layerOf([{ name: 'martha/x', paxRaw: raw, body: '' }]), /pax header of \d+ bytes, over the 1024 a name may have/)
})

test('refused: a stream that is not gzip', async (t) => {
  await refusedWithNothingWritten(t, Buffer.from('not gzip at all'), /not a gzip stream/)
})
