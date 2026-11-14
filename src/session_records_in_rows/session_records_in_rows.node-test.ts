// A session's records with the owner's release applied as they are read (martha#321).
//
// The launcher's own test drives this through the relay; what is pinned here is the rule on its own, because the
// relay's path and a resumed session's path hand the core different views of the same stream, and the write-back has
// to keep every arrival after the release whichever one it was handed.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordDigestOf, releaseStreamOf, releasesIn, type ReleaseMark } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { ROW_NOT_DURABLE, type Row, type RowStore, type StoredRow } from '../host_contract/host_contract.ts'
import { OWNER_AT_THE_TERMINAL, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { recordOf, sessionRecordsIn, sessionRecordStreamOf } from './session_records_in_rows.ts'

const SESSION = 'the-session'
const STREAM = sessionRecordStreamOf(SESSION)

/** Rows kept in memory, one list per stream: the same shape the stores answer with, without a disk. */
function rowsInMemory(streams: Readonly<Record<string, readonly Row[]>> = {}): RowStore {
  const kept = new Map<string, Row[]>(Object.entries(streams).map(([stream, rows]) => [stream, [...rows]]))
  return {
    read: async (stream) => (kept.get(stream) ?? []).map((row, position): StoredRow => ({ row, position })),
    append: async (stream, row) => {
      const rows = kept.get(stream) ?? []
      kept.set(stream, [...rows, row])
      return rows.length
    },
  }
}

const anArrival = (path: string): Ingestion => ({ path, from_node_id: 'a-node-the-policy-does-not-name' })
const AUTO_CONTINUATION = anArrival('B7')

/** The record a stream holds, as the rows keep it. */
const keptIn = async (rows: RowStore): Promise<readonly Ingestion[]> => {
  const stored = await rows.read(STREAM)
  const last = stored.at(-1)
  return last === undefined ? [] : recordOf(last.row).ingested
}

/** A release that cleared the first `through` arrivals of this raw record. */
const markClearing = (raw: readonly Ingestion[], through: number): ReleaseMark => ({
  through,
  digest: recordDigestOf(raw.slice(0, through)),
  by: OWNER_AT_THE_TERMINAL,
  at: '2026-11-13T21:00:00.000Z',
  cleared: through,
})

test('#321: what a session takes in after the owner released it is kept, whichever view of the record the core was handed', async () => {
  for (const through of [1, 3]) {
    const raw: readonly Ingestion[] = [anArrival('A2'), anArrival('B2'), anArrival('B4')].slice(0, through)
    const rows = rowsInMemory({
      [STREAM]: [{ ingested: [...raw] as unknown as Row[] } as Row],
      [releaseStreamOf(SESSION)]: [{ ...markClearing(raw, through) } as unknown as Row],
    })
    const records = sessionRecordsIn(rows, releasesIn(rows))
    await records.load(SESSION)

    // The core is handed the record the release leaves, and takes one more arrival in: the resumed session's path.
    const handed = records.store.read(SESSION)
    assert.ok(handed !== undefined)
    assert.deepEqual(handed.ingested, raw.slice(through), 'the release did not clear the prefix it named')
    records.store.write(SESSION, { ingested: [...handed.ingested, AUTO_CONTINUATION] })
    await records.flush(SESSION)

    assert.deepEqual(
      await keptIn(rows),
      [...raw, AUTO_CONTINUATION],
      `a release that cleared ${through} of the record dropped the arrival the session took in after it`,
    )
    await records.check(SESSION)
    assert.deepEqual(
      records.store.read(SESSION)?.ingested,
      [AUTO_CONTINUATION],
      'the gate reads the member as released, without the arrival it took in after the release',
    )
  }
})

test('#321: a session the release reached mid-run is written back from the raw record the core already held', async () => {
  // The session was taken up before the owner typed the release, so the core goes on extending the RAW record while
  // `read` answers the released one: the view the core was handed dates from the load, and the flush must read the
  // written record past that view and not past the release as it stands now.
  const raw: readonly Ingestion[] = [anArrival('A2'), anArrival('B2')]
  const rows = rowsInMemory({ [STREAM]: [{ ingested: [...raw] as unknown as Row[] } as Row] })
  const records = sessionRecordsIn(rows, releasesIn(rows))
  await records.load(SESSION)
  assert.deepEqual(records.store.read(SESSION)?.ingested, raw, 'the session was handed no record of its own')
  await rows.append(releaseStreamOf(SESSION), { ...markClearing(raw, raw.length) } as unknown as Row)

  records.store.write(SESSION, { ingested: [...raw, AUTO_CONTINUATION] })
  await records.flush(SESSION)

  assert.deepEqual(await keptIn(rows), [...raw, AUTO_CONTINUATION], 'an arrival the core wrote past the raw record was dropped')
  await records.check(SESSION)
  assert.deepEqual(records.store.read(SESSION)?.ingested, [AUTO_CONTINUATION], 'the gate reads the member held')
})

test('#321: an arrival identical to one the release cleared is still kept, because the view says where it begins', async () => {
  // The arrival and the cleared prefix are the same ingestion, so the written record begins with BOTH views: what is
  // kept can only follow from the view the core was handed, never from the record's own shape. A store that guessed
  // would read this as a core that had written nothing and lose the arrival (martha#321 r=2).
  const raw: readonly Ingestion[] = [AUTO_CONTINUATION]
  const rows = rowsInMemory({
    [STREAM]: [{ ingested: [...raw] as unknown as Row[] } as Row],
    [releaseStreamOf(SESSION)]: [{ ...markClearing(raw, 1) } as unknown as Row],
  })
  const records = sessionRecordsIn(rows, releasesIn(rows))
  await records.load(SESSION)
  const handed = records.store.read(SESSION)
  assert.deepEqual(handed?.ingested, [], 'the release did not clear the arrival')
  records.store.write(SESSION, { ingested: [AUTO_CONTINUATION] })
  await records.flush(SESSION)

  assert.deepEqual(await keptIn(rows), [AUTO_CONTINUATION, AUTO_CONTINUATION], 'the arrival taken in after the release was dropped')
  assert.deepEqual(records.store.read(SESSION)?.ingested, [AUTO_CONTINUATION], 'the gate reads the member held again')
})

test('#321: a release typed after the session was loaded does not move the view the core was handed', async () => {
  // The owner releases twice while the member runs. The core still holds the record it was handed at load, so the
  // arrivals are read past THAT view: read past the newest release instead, and the record's own tail is written back
  // as if it were an arrival (martha#321 r=2).
  const raw: readonly Ingestion[] = [anArrival('A2'), anArrival('B2')]
  const rows = rowsInMemory({
    [STREAM]: [{ ingested: [...raw] as unknown as Row[] } as Row],
    [releaseStreamOf(SESSION)]: [{ ...markClearing(raw, 1) } as unknown as Row],
  })
  const records = sessionRecordsIn(rows, releasesIn(rows))
  await records.load(SESSION)
  const handed = records.store.read(SESSION)
  assert.deepEqual(handed?.ingested, raw.slice(1), 'the first release did not clear a prefix')

  await rows.append(releaseStreamOf(SESSION), { ...markClearing(raw, 2) } as unknown as Row)
  await records.check(SESSION)
  assert.deepEqual(records.store.read(SESSION)?.ingested, [], 'the second release was not read before the next call')

  records.store.write(SESSION, { ingested: [...(handed?.ingested ?? []), AUTO_CONTINUATION] })
  await records.flush(SESSION)

  assert.deepEqual(await keptIn(rows), [...raw, AUTO_CONTINUATION], 'the record’s own tail was written back as if it were an arrival')
})

test('#321: the view this store answers after a flush is the release read over the record it just kept', async () => {
  // A view left as it was at load would hand the next reader the record from before the arrivals the flush just kept.
  const raw: readonly Ingestion[] = [anArrival('A2')]
  const rows = rowsInMemory({
    [STREAM]: [{ ingested: [...raw] as unknown as Row[] } as Row],
    [releaseStreamOf(SESSION)]: [{ ...markClearing(raw, 1) } as unknown as Row],
  })
  const records = sessionRecordsIn(rows, releasesIn(rows))
  await records.load(SESSION)
  const handed = records.store.read(SESSION)
  assert.deepEqual(handed?.ingested, [], 'the release did not clear the record')
  records.store.write(SESSION, { ingested: [...(handed?.ingested ?? []), AUTO_CONTINUATION] })
  await records.flush(SESSION)

  assert.deepEqual(records.store.read(SESSION)?.ingested, [AUTO_CONTINUATION], 'the view stayed the one this store answered at load')
})

test('#321: a record the store will not keep is not written back, and the check still answers for it', async () => {
  const raw: readonly Ingestion[] = [anArrival('A2')]
  const inner = rowsInMemory({ [STREAM]: [{ ingested: [...raw] as unknown as Row[] } as Row] })
  const refusing: RowStore = {
    read: (stream) => inner.read(stream),
    append: async () => Promise.reject(Object.assign(new Error('full'), { code: ROW_NOT_DURABLE })),
  }
  const records = sessionRecordsIn(refusing)
  await records.load(SESSION)
  records.store.write(SESSION, { ingested: [...raw, AUTO_CONTINUATION] })
  await assert.rejects(records.flush(SESSION), (error: unknown) => (error as { code?: string }).code === ROW_NOT_DURABLE)
  assert.deepEqual(await keptIn(refusing), raw, 'a record the store refused was kept anyway')
})
