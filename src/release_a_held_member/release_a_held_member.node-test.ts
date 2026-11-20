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
import { isStaleArrival, releaseStreamOf, releaseMarksIn } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { GATE_GENERATION, OWNER_AT_THE_TERMINAL, UNSTAMPED_GENERATION, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { RECORD_LOST } from '../take_in_a_turn/take_in_a_turn.ts'
import { A_RELEASE_NEEDS_THE_OWNERS_TERMINAL, releaseAHeldMember, releaseEveryMembersStale, toldOfARelease } from './release_a_held_member.ts'

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

// `martha release --stale` (martha#987, gap 15 of #957): only what an older gate recorded, as a prefix mark that counts
// from where the owner's newest release stands, and never a lost record's mark.

/** An arrival the first gate recorded, before the stamp: it carries no generation. */
const unstamped = (path: string): Ingestion => ({ path, from_node_id: null })
/** An arrival a gate of `gen` recorded. */
const stampedBy = (gen: number, path: string): Ingestion => ({ path, from_node_id: null, gen })
/** The arrivals the record holds after every release kept for the session. */
async function heldAfter(rows: ReturnType<typeof rowsInMemory>): Promise<readonly Ingestion[]> {
  const raw = recordOf((rows.kept.get(sessionRecordStreamOf(SESSION)) ?? []).at(-1)!).ingested
  const marks = await releaseMarksIn(rows, SESSION)
  const newest = marks.at(-1)
  return newest === undefined ? raw : raw.slice(newest.through)
}

test('#987: --stale clears what an older gate recorded at the head of the record, and keeps what this gate recorded', async () => {
  const rows = rowsHolding([unstamped('A2'), stampedBy(UNSTAMPED_GENERATION, 'B3'), stampedBy(GATE_GENERATION, 'A6')])
  const release = await releaseAHeldMember(asked(rows, { stale: true }))
  assert.deepEqual(release, { released: true, member: MEMBER, session: SESSION, cleared: 2, still_held: 1 })
  assert.deepEqual((await heldAfter(rows)).map((ingest) => ingest.path), ['A6'])
  assert.equal(toldOfARelease(release), `Released what an older gate recorded for ${MEMBER}: cleared 2 arrivals; 1 arrival this gate recorded still holds it.`)
})

test('#987: --stale releases nothing when this gate recorded the head of the record, and writes no mark', async () => {
  const rows = rowsHolding([stampedBy(GATE_GENERATION, 'A2'), unstamped('B3')])
  const release = await releaseAHeldMember(asked(rows, { stale: true }))
  assert.equal(release.released, false)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false, 'a release that cleared nothing wrote a mark')
})

test('#987: a stale arrival after one this gate recorded stays held, because a mark clears a prefix only', async () => {
  const rows = rowsHolding([unstamped('A2'), stampedBy(GATE_GENERATION, 'A6'), unstamped('B3')])
  const release = await releaseAHeldMember(asked(rows, { stale: true }))
  assert.equal(release.released && release.cleared, 1)
  assert.deepEqual((await heldAfter(rows)).map((ingest) => ingest.path), ['A6', 'B3'])
})

test('#987: --stale counts from the owner\'s newest release, so it never holds again what a whole release cleared', async () => {
  const before = [stampedBy(GATE_GENERATION, 'A2'), stampedBy(GATE_GENERATION, 'B3')]
  const rows = rowsHolding(before)
  assert.equal((await releaseAHeldMember(asked(rows))).released, true)
  const grown = [...before, unstamped('B5'), stampedBy(GATE_GENERATION, 'A6')]
  rows.kept.set(sessionRecordStreamOf(SESSION), [{ ingested: grown as unknown as Row[] } as Row])
  const release = await releaseAHeldMember(asked(rows, { stale: true }))
  assert.equal(release.released && release.cleared, 1)
  assert.equal((await releaseMarksIn(rows, SESSION)).at(-1)?.through, 3, 'the stale mark counts from the whole release, which cleared 2')
  assert.deepEqual((await heldAfter(rows)).map((ingest) => ingest.path), ['A6'])
})

test('#987: --stale refuses when the earlier releases cannot be read, since it could undo one', async () => {
  const rows = rowsHolding([unstamped('A2')])
  const unreadable: RowStore = {
    read: async (stream) => {
      if (stream === releaseStreamOf(SESSION)) throw Object.assign(new Error('no'), { code: 'EACCES' })
      return rows.read(stream)
    },
    append: rows.append,
  }
  const release = await releaseAHeldMember(asked(unreadable, { stale: true }))
  assert.equal(release.released, false)
  assert.ok(!release.released && release.refusal.includes('EACCES'), 'the refusal names why')
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#987: a lost record is never released by --stale, though its mark carries no generation', async () => {
  const rows = rowsHolding([unstamped('A2'), RECORD_LOST])
  const release = await releaseAHeldMember(asked(rows, { stale: true }))
  assert.equal(release.released, false)
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
  assert.equal(isStaleArrival(RECORD_LOST, GATE_GENERATION + 1), false, 'the lost mark is never stale, whatever the generation')
})

test('#987: --stale with no terminal is refused, for one member and for all', async () => {
  const rows = rowsHolding([unstamped('A2')])
  assert.deepEqual(await releaseAHeldMember(asked(rows, { stale: true, onATerminal: false })), { released: false, refusal: A_RELEASE_NEEDS_THE_OWNERS_TERMINAL })
  const all = await releaseEveryMembersStale({ members: MEMBERS, rows, onATerminal: false, rowOf: () => rowIn(SESSION), gateOf: () => 'enforced' })
  assert.deepEqual(all, [{ released: false, refusal: A_RELEASE_NEEDS_THE_OWNERS_TERMINAL }])
  assert.equal(rows.kept.has(releaseStreamOf(SESSION)), false)
})

test('#987: --stale for every member answers once per member, and releases the one an older gate holds', async () => {
  const rows = rowsHolding([unstamped('A2'), stampedBy(GATE_GENERATION, 'A6')])
  const all = await releaseEveryMembersStale({
    members: MEMBERS,
    rows,
    onATerminal: true,
    rowOf: (member) => (member === MEMBER ? rowIn(SESSION) : null),
    gateOf: () => 'enforced',
  })
  assert.equal(all.length, MEMBERS.length)
  assert.deepEqual(all.map((answer) => answer.released), [true, false])
  assert.deepEqual((await heldAfter(rows)).map((ingest) => ingest.path), ['A6'])
})
