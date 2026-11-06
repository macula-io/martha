// The row store on disk keeps the promises the host contract asks of a RowStore
// (#41, threats T9 to T11 of its threat model): a stream name never steers a path,
// two successors cannot both land at one position, and a read never skips a row
// it cannot vouch for.

import assert from 'node:assert/strict'
import fs, { chmodSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ROW_NOT_DURABLE, ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { ACT_NOT_SENT, ActNotSent, ledgerStreamOf, sendOutwardAct, type LedgerHost } from '../log_ledger/log_ledger.ts'
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
    'a gap': (stream) => writeFileSync(join(stream, rowFileNameOf(3)), '{"n":2}', { mode: ROW_FILE_MODE }),
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

/** Every file and directory the store opens, linked into and fsynced, in order, while `run` goes. */
const diskEvents = async (t: TestContext, run: () => Promise<unknown>): Promise<string[]> => {
  const events: string[] = []
  const opened = new Map<number, string>()
  const real_open = fs.openSync
  const real_fsync = fs.fsyncSync
  const real_link = fs.linkSync
  t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    const descriptor = real_open(...args)
    opened.set(descriptor, String(args[0]))
    return descriptor
  })
  t.mock.method(fs, 'fsyncSync', (descriptor: number) => {
    events.push(`fsync ${opened.get(descriptor) ?? `unknown descriptor ${descriptor}`}`)
    real_fsync(descriptor)
  })
  t.mock.method(fs, 'linkSync', (...args: Parameters<typeof fs.linkSync>) => {
    real_link(...args)
    events.push(`link ${String(args[1])}`)
  })
  try {
    await run()
  } finally {
    t.mock.restoreAll()
  }
  return events
}

test('an append resolves only after the row, its position and its stream directory are on disk', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  const stream_directory = join(directory, streamDirectoryNameOf('ledger'))
  const position = join(stream_directory, rowFileNameOf(0))

  const events = await diskEvents(t, () => store.append('ledger', { act: 'a' }))
  const link = events.indexOf(`link ${position}`)
  assert.ok(link > 0, events.join('\n'))
  assert.match(events[link - 1] ?? '', /^fsync .*\.staging-/, 'the row is on disk before it is linked')
  assert.deepEqual(events.slice(link + 1), [`fsync ${stream_directory}`, `fsync ${directory}`, `fsync ${dirname(directory)}`])

  // A second row in a stream that exists: its position is flushed the same way.
  const again = await diskEvents(t, () => store.append('ledger', { act: 'b' }))
  assert.deepEqual(again.slice(again.indexOf(`link ${join(stream_directory, rowFileNameOf(1))}`) + 1), [
    `fsync ${stream_directory}`,
    `fsync ${directory}`,
    `fsync ${dirname(directory)}`,
  ])
})

/** Makes the nth fsync from now fail with EIO, as a dying disk does. */
const failNthFsync = (t: TestContext, nth: number) => {
  const real_fsync = fs.fsyncSync
  let calls = 0
  t.mock.method(fs, 'fsyncSync', (descriptor: number) => {
    calls += 1
    if (calls === nth) throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' })
    real_fsync(descriptor)
  })
}

const rejectsNotDurableAt = async (promise: Promise<unknown>, position: number, what: string) =>
  assert.rejects(
    promise,
    (error: unknown) => (error as { code?: unknown }).code === ROW_NOT_DURABLE && (error as { position?: unknown }).position === position,
    what,
  )

test('an append whose directory cannot be flushed after the link rejects naming the row it left', async (t) => {
  const store = rowStreamsDirectory(rowsDirectory(t))
  // The first fsync is the row's file, the second its stream's directory.
  failNthFsync(t, 2)
  await rejectsNotDurableAt(store.append('ledger', { act: 'a' }), 0, 'the row is in the stream, not durable')
  t.mock.restoreAll()
})

test('a retry after a flush failed cannot keep the row twice, through any store in the process', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  await store.append('ledger', { act: 'before' })
  failNthFsync(t, 2)
  await rejectsNotDurableAt(store.append('ledger', { act: 'a' }), 1, 'the first try')
  t.mock.restoreAll()

  await rejectsNotDurableAt(store.append('ledger', { act: 'a' }), 1, 'the same row again')
  await rejectsNotDurableAt(rowStreamsDirectory(directory).append('ledger', { act: 'a' }), 1, 'through a second store')
  await rejectsNotDurableAt(store.append('ledger', { act: 'a' }, 2), 1, 'at the length after it')
  assert.deepEqual(await rowStreamsDirectory(directory).read('ledger'), [
    { position: 0, row: { act: 'before' } },
    { position: 1, row: { act: 'a' } },
  ])
  // Another stream is not held by this one.
  assert.equal(await store.append('other', { act: 'b' }), 0)
})

test('the ledger never sends an act twice when its row was linked and not made durable', async (t) => {
  const directory = rowsDirectory(t)
  const { host: base } = hostForTests()
  const host: LedgerHost = { clock: base.clock, stores: { ...base.stores, rows: rowStreamsDirectory(directory) } }
  // Synthetic only: this repository is public.
  const work = { package: 'synthetic-owner/repo#7', member: 'member-one' }
  const act = { kind: 'push', what: 'main 1111..2222' } as const
  let sent = 0
  const send = async () => {
    sent += 1
    return 'pushed'
  }

  failNthFsync(t, 2)
  const first: unknown = await sendOutwardAct(host, { ...work, act }, send).catch((error: unknown) => error)
  t.mock.restoreAll()
  const again: unknown = await sendOutwardAct(host, { ...work, act }, send).catch((error: unknown) => error)

  for (const failure of [first, again]) {
    assert.ok(failure instanceof ActNotSent)
    assert.equal(failure.code, ACT_NOT_SENT)
    assert.equal(failure.row_may_stand_at, 0)
  }
  assert.equal(sent, 0, 'the act never ran')
  const rows = await rowStreamsDirectory(directory).read(ledgerStreamOf(work.package))
  assert.equal(rows.length, 1, 'one row for the act, however often it is tried')

  // A different act on the same stream is refused naming the earlier act's row.
  const other: unknown = await sendOutwardAct(host, { ...work, act: { kind: 'tag', what: 'v1.0.0' } }, send).catch((error: unknown) => error)
  assert.ok(other instanceof ActNotSent)
  assert.equal(other.row_may_stand_at, 0, 'the row standing there is the push, not the tag')
  assert.equal(sent, 0)
})

test('a row file is only its owner\'s whatever the umask lets through', async (t) => {
  const directory = rowsDirectory(t)
  const store = rowStreamsDirectory(directory)
  await store.append('ledger', { act: 'a' })
  // A umask that takes the owner's own write bit off a new file.
  const previous = process.umask(0o277)
  try {
    await store.append('ledger', { act: 'b' })
  } finally {
    process.umask(previous)
  }
  const position = join(directory, streamDirectoryNameOf('ledger'), rowFileNameOf(1))
  assert.equal(fs.statSync(position).mode & 0o777, ROW_FILE_MODE)
  assert.deepEqual(await store.read('ledger'), [
    { position: 0, row: { act: 'a' } },
    { position: 1, row: { act: 'b' } },
  ])
})
