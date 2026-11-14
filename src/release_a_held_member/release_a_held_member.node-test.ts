// The owner's release, tested on the slice alone: which answers it gives, and what it writes for each (martha#321).
//
// The member's launcher is not here. What this pins is the act's own decisions — no terminal, a member the declaration
// does not know, no live session, nothing held, a record nobody can read — and that an answer carries the count and
// never the text of what it cleared.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ROW_NOT_DURABLE, type Row, type RowStore, type StoredRow } from '../host_contract/host_contract.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { recordOf, sessionRecordsIn, sessionRecordStreamOf } from '../session_records_in_rows/session_records_in_rows.ts'
import { releaseStreamOf, releaseMarksIn } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { OWNER_AT_THE_TERMINAL, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { A_RELEASE_NEEDS_THE_OWNERS_TERMINAL, releaseAHeldMember, toldOfARelease } from './release_a_held_member.ts'

const MEMBER = 'builder'
const SESSION = 'the-live-session'
const MEMBERS: readonly string[] = [MEMBER, 'reviewer']

/** Rows kept in memory, one list per stream: the same shape the stores answer with, without a disk. */
function rowsInMemory(streams: Readonly<Record<string, readonly Row[]>> = {}): RowStore & { readonly kept: Map<string, Row[]> } {
  const kept = new Map<string, Row[]>(Object.entries(streams).map(([stream, rows]) => [stream, [...rows]]))
  return {
    kept,
    read: async (stream) => (kept.get(stream) ?? []).map((row, position): StoredRow => ({ row, position })),
    append: async (stream, row) => {
      const rows = kept.get(stream) ?? []
      kept.set(stream, [...rows, row])
      return rows.length
    },
  }
}

/** One member's dashboard row, holding the session it is live in. */
const rowIn = (session: string): DashboardRow => ({
  member: MEMBER,
  session,
  at: 1,
  state: 'working',
  holds: '',
  task: '',
  progress: { step: 1, of: 1 },
  waits: null,
  needs: '',
  host: { model: 'opus', provider: '', contextPercent: null, costUsd: null },
})

const strangerText: Ingestion = { path: 'A2', from_node_id: 'a-node-the-policy-does-not-name' }

/** The crew's rows, holding one live session's record and no release for it. */
const rowsHolding = (raw: readonly Ingestion[] = [strangerText]) =>
  rowsInMemory({ [sessionRecordStreamOf(SESSION)]: [{ ingested: raw as unknown as Row[] } as Row] })

const asked = (rows: RowStore, more: Partial<Parameters<typeof releaseAHeldMember>[0]> = {}) => ({
  member: MEMBER,
  members: MEMBERS,
  row: rowIn(SESSION),
  rows,
  onATerminal: true,
  gate: 'enforced' as const,
  ...more,
})

test('#321: a release with no terminal is refused, so a member’s shell cannot release itself', async () => {
  const rows = rowsHolding()
  const release = await releaseAHeldMember(asked(rows, { onATerminal: false }))
  assert.deepEqual(release, { released: false, refusal: A_RELEASE_NEEDS_THE_OWNERS_TERMINAL })
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false, 'a refused release wrote a mark')
})

test('#321: a release writes one mark on the release stream, clearing the whole record it saw', async () => {
  const rows = rowsHolding([strangerText, { path: 'A4', from_node_id: null }])
  const release = await releaseAHeldMember(asked(rows))
  assert.equal(release.released, true)
  if (!release.released) return
  assert.equal(release.cleared, 2)
  const marks = await releaseMarksIn(rows, SESSION)
  assert.equal(marks.length, 1)
  assert.equal(marks[0]?.through, 2)
  assert.equal(marks[0]?.by, OWNER_AT_THE_TERMINAL)
  assert.equal(
    rows.kept.has(sessionRecordStreamOf(SESSION)),
    true,
    'the release wrote somewhere other than its own stream',
  )
  assert.deepEqual(
    recordOf(rows.kept.get(sessionRecordStreamOf(SESSION))!.at(-1) as Row).ingested.length,
    2,
    'the release rewrote the session record instead of marking it',
  )
})

test('#321: a release answers the count and never the text', async () => {
  const rows = rowsHolding()
  const release = await releaseAHeldMember(asked(rows))
  const told = toldOfARelease(release)
  assert.match(told, /1 arrival/)
  assert.equal(told.includes(strangerText.from_node_id ?? ''), false, 'the release answered with what it cleared')
  assert.equal(told.includes(strangerText.path), false, 'the release answered with the path it cleared')
})

test('#321: a member with no live session is refused by name, and no mark is written', async () => {
  const rows = rowsHolding()
  const release = await releaseAHeldMember(asked(rows, { row: null }))
  assert.equal(release.released, false)
  assert.match(toldOfARelease(release), /no live session/)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#321: a member the declaration does not know is refused by name', async () => {
  const rows = rowsHolding()
  const release = await releaseAHeldMember(asked(rows, { member: 'nobody' }))
  assert.match(toldOfARelease(release), /does not know nobody/)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#321: a member whose record holds no arrival is told so, and nothing is written', async () => {
  const rows = rowsHolding([])
  const release = await releaseAHeldMember(asked(rows))
  assert.match(toldOfARelease(release), /holds no arrival/)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#321: a record that reads as lost is never released, because nobody can say what it holds', async () => {
  const rows = rowsInMemory({ [sessionRecordStreamOf(SESSION)]: [{ ingested: 'not a record' } as unknown as Row] })
  const release = await releaseAHeldMember(asked(rows))
  assert.equal(release.released, false)
  assert.match(toldOfARelease(release), /reads as lost/)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#321: a release of a member whose gate is off says the gate was off too', async () => {
  const rows = rowsHolding()
  const release = await releaseAHeldMember(asked(rowsHolding([]), { gate: 'off' }))
  assert.match(toldOfARelease(release), /gate is off/)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#321: a mark that could not be kept is no release, and says so', async () => {
  const rows = rowsHolding()
  const broken: RowStore = {
    read: (stream) => rows.read(stream),
    append: async () => Promise.reject(Object.assign(new Error('full'), { code: ROW_NOT_DURABLE })),
  }
  const release = await releaseAHeldMember(asked(broken))
  assert.equal(release.released, false)
  assert.match(toldOfARelease(release), /ROW_NOT_DURABLE/)
})

test('#424: the release clears the record the launcher wrote, because both name the session’s stream one way', async () => {
  const rows = rowsInMemory()
  const launcher = sessionRecordsIn(rows)
  await launcher.load(SESSION)
  launcher.store.write(SESSION, { ingested: [strangerText] })
  await launcher.flush(SESSION)
  const release = await releaseAHeldMember(asked(rows))
  assert.equal(release.released, true, `the release read another stream than the launcher wrote: ${toldOfARelease(release)}`)
  if (!release.released) return
  assert.equal(release.cleared, 1)
})
