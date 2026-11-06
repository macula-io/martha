// The row store on disk keeps the promises the host contract asks of a RowStore
// (#41, threats T9 to T11 of its threat model): a stream name never steers a path,
// two successors cannot both land at one position, and a read never skips a row
// it cannot vouch for.

import assert from 'node:assert/strict'
import fs, { chmodSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import { ROW_FILE_MODE, rowFileNameOf, rowStreamsDirectory, streamDirectoryNameOf } from './row_streams_directory.ts'

const scratch = (t: TestContext): string => {
  const root = mkdtempSync(join(tmpdir(), 'martha-rows-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

/** A rows directory that exists, as the host would make it: this user's, closed. */
const rowsDirectory = (t: TestContext): string => {
  const directory = join(scratch(t), 'rows')
  fs.mkdirSync(directory, { mode: 0o700 })
  return directory
}

const rejectsMoved = async (promise: Promise<unknown>, what: string) =>
  assert.rejects(promise, (error: unknown) => (error as { code?: unknown }).code === ROW_STREAM_MOVED, what)

test('rows append in order and read back with their positions', async (t) => {
  const store = rowStreamsDirectory(rowsDirectory(t))
  assert.equal(await store.append('ledger', { act: 'a' }), 0)
  assert.equal(await store.append('ledger', { act: 'b' }), 1)
  assert.deepEqual(await store.read('ledger'), [
    { position: 0, row: { act: 'a' } },
    { position: 1, row: { act: 'b' } },
  ])
  assert.deepEqual(await store.read('never written'), [])
})

test('stream names holding .., /, NUL or a leading dot never leave the stream directory', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  const names = ['..', '../outside', '/etc/passwd', 'a/b', 'nul\u0000name', '.hidden', '.', '', '%2E%2E']

  for (const [index, name] of names.entries()) {
    assert.equal(await store.append(name, { index }), 0, JSON.stringify(name))
    assert.deepEqual(await store.read(name), [{ position: 0, row: { index } }], JSON.stringify(name))
  }

  // One directory per name, each a plain child of the rows directory, and no two names share one.
  const entries = readdirSync(directory)
  assert.equal(entries.length, names.length)
  assert.equal(new Set(names.map(streamDirectoryNameOf)).size, names.length)
  for (const entry of entries) {
    assert.match(entry, /^[A-Za-z0-9_-]+$/)
    assert.equal(relative(directory, join(directory, entry)), entry)
  }
  assert.deepEqual(readdirSync(join(directory, '..')).sort(), ['rows'])
})

test('two appends at the same expected length: one is kept, the other rejects with ROW_STREAM_MOVED', async (t) => {
  for (let round = 0; round < 100; round += 1) {
    const directory = join(rowsDirectory(t), String(round))
    fs.mkdirSync(directory, { mode: 0o700 })
    const first = rowStreamsDirectory(directory)
    const second = rowStreamsDirectory(directory)
    const outcomes = await Promise.allSettled([
      first.append('acts', { by: 'first' }, 0),
      second.append('acts', { by: 'second' }, 0),
    ])
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected'], `round ${round}`)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    assert.equal((rejected?.reason as { code?: unknown }).code, ROW_STREAM_MOVED, `round ${round}`)
    assert.equal((await first.read('acts')).length, 1, `round ${round}`)
  }
})

test('a rival that lands between the length check and the write wins, and the late one is refused', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  const rival = rowStreamsDirectory(directory)

  // The planted race: as the store is about to put its row in place, the rival
  // writes position 0 by hand, so the length the store checked is already stale.
  const real_link = fs.linkSync
  let raced = false
  t.mock.method(fs, 'linkSync', (...args: Parameters<typeof fs.linkSync>) => {
    if (!raced) {
      raced = true
      const target = join(directory, streamDirectoryNameOf('acts'), rowFileNameOf(0))
      writeFileSync(target, JSON.stringify({ by: 'rival' }), { mode: ROW_FILE_MODE, flag: 'wx' })
    }
    return real_link(...args)
  })

  await rejectsMoved(store.append('acts', { by: 'late' }, 0), 'the late append')
  t.mock.restoreAll()
  assert.deepEqual(await rival.read('acts'), [{ position: 0, row: { by: 'rival' } }])
  assert.deepEqual(readdirSync(join(directory, streamDirectoryNameOf('acts'))), [rowFileNameOf(0)], 'no staging file is left behind')
})

test('an append without an expected length takes the next free position, even after a rival', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  await rowStreamsDirectory(directory).append('acts', { by: 'rival' })
  assert.equal(await store.append('acts', { by: 'me' }), 1)
  await rejectsMoved(store.append('acts', { by: 'stale' }, 1), 'a stale expected length')
})

test('a gap, an unparsable row, a symlinked row or a group-writable row file is refused on read, never skipped', async (t) => {
  const planted: Readonly<Record<string, (stream: string) => void>> = {
    'a gap': (stream) => writeFileSync(join(stream, rowFileNameOf(2)), '{"n":2}', { mode: ROW_FILE_MODE }),
    'an unparsable row': (stream) => writeFileSync(join(stream, rowFileNameOf(2)), '{"n":', { mode: ROW_FILE_MODE }),
    'a row that is not an object': (stream) => writeFileSync(join(stream, rowFileNameOf(2)), '[2]', { mode: ROW_FILE_MODE }),
    'a symlinked row': (stream) => {
      const outside = join(stream, '..', 'outside.json')
      writeFileSync(outside, '{"n":2}', { mode: ROW_FILE_MODE })
      symlinkSync(outside, join(stream, rowFileNameOf(2)))
    },
    'a group-writable row': (stream) => chmodSync(join(stream, rowFileNameOf(1)), 0o620),
    'a world-readable row': (stream) => chmodSync(join(stream, rowFileNameOf(1)), 0o644),
    'an entry the store never writes': (stream) => writeFileSync(join(stream, 'notes.txt'), 'hi', { mode: ROW_FILE_MODE }),
    'a row directory where a row file belongs': (stream) => fs.mkdirSync(join(stream, rowFileNameOf(2))),
    'a group-writable stream directory': (stream) => chmodSync(stream, 0o770),
  }

  for (const [what, plant] of Object.entries(planted)) {
    const directory = join(rowsDirectory(t), 'case')
    fs.mkdirSync(directory, { mode: 0o700 })
    const store = rowStreamsDirectory(directory)
    await store.append('acts', { n: 0 })
    await store.append('acts', { n: 1 })
    plant(join(directory, streamDirectoryNameOf('acts')))
    await assert.rejects(store.read('acts'), Error, what)
    await assert.rejects(store.append('acts', { n: 9 }), Error, `${what}: an append reads first`)
    rmSync(join(directory, '..'), { recursive: true, force: true })
  }
})

test('a rows directory others may write into, or that is a link, is refused', async (t) => {
  const open = rowsDirectory(t)
  chmodSync(open, 0o777)
  await assert.rejects(rowStreamsDirectory(open).read('acts'), Error, 'world-writable')
  await assert.rejects(rowStreamsDirectory(open).append('acts', {}), Error, 'world-writable')

  const real = rowsDirectory(t)
  const linked = join(real, '..', 'linked')
  symlinkSync(real, linked)
  await assert.rejects(rowStreamsDirectory(linked).append('acts', {}), Error, 'a link')
})

test('a row file is written whole, only its owner may read or write it, and no staging file stays', async (t) => {
  const directory = rowsDirectory(t)
  await rowStreamsDirectory(directory).append('acts', { n: 0 })
  const stream = join(directory, streamDirectoryNameOf('acts'))
  assert.deepEqual(readdirSync(stream), [rowFileNameOf(0)])
  assert.equal(fs.statSync(join(stream, rowFileNameOf(0))).mode & 0o777, ROW_FILE_MODE)
  assert.equal(fs.statSync(stream).mode & 0o777, 0o700)
})

test('a row that would not survive as JSON is refused before anything is written', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  const cycle: Record<string, unknown> = {}
  cycle['self'] = cycle
  await assert.rejects(store.append('acts', cycle), Error)
  assert.deepEqual(await store.read('acts'), [])
})
