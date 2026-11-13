// The crew's wait-for graph (martha#320, package A): a cycle of waits, and a chain that ends at a member who cannot
// answer.
//
// These pin what the graph must never do: draw one deadlock twice, chain a member that is free or resting into one, or
// read the words a member wrote about what it waits for as a graph of its own.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE_MS, OWNER } from '../declare_crew/declare_crew.ts'
import { IDLE, OFFLINE_AFTER_MS, type DashboardRow, type State } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { NudgeInput } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { deadlockNudges, deadlocksOf } from './watch_waits.ts'

const NOW = 1_762_900_000_000
const PERSON = 30 * MINUTE_MS
const STALLED = 60 * MINUTE_MS
const WINDOWS = { stalled_ms: STALLED, review_ms: 45 * MINUTE_MS, person_ms: PERSON }
const RECEIVERS = ['Supervisor']
/** The dashboard's own word for a parked member, read here as the slice reads it. */
const PARKED_STATE: State = 'parked'

/** One member's row, busy and reported a while ago unless the test says otherwise. */
function row(member: string, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: `session-${member}`,
    at: NOW - 1_000,
    state: 'working',
    holds: 'macula-io/martha#320',
    task: 'Build the stall nudges',
    progress: { step: 1, of: 4, at: NOW - 1_000 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 20, costUsd: 1 },
    ...changes,
  }
}

/** The whole input, from the rows a test names. */
function input(rows: readonly DashboardRow[], changes: Partial<NudgeInput> = {}): NudgeInput {
  return { rows, waits: [], parked: [], windows: WINDOWS, now: NOW, owner: 'Ann', receivers: RECEIVERS, ...changes }
}

test('two members waiting on each other are a cycle with one member to act', () => {
  const rows = [
    row('Vesta', { state: 'waiting', waits: { on: 'Mars', for: 'a ruling', since: NOW - PERSON } }),
    row('Mars', { state: 'waiting', waits: { on: 'Vesta', for: 'a range', since: NOW - PERSON * 2 } }),
  ]
  const found = deadlocksOf(input(rows))
  assert.equal(found.length, 1, 'one situation, one deadlock')
  assert.equal(found[0]?.kind, 'cycle')
  assert.deepEqual(found[0]?.edges.map((edge) => [edge.from, edge.to]).sort(), [['Mars', 'Vesta'], ['Vesta', 'Mars']], 'both waits are named')
  assert.equal(found[0]?.must_act, 'Vesta', 'the member that closed the cycle last must act')

  const nudges = deadlockNudges(input(rows))
  assert.deepEqual(nudges.map((one) => [one.kind, one.member]), [['deadlock', 'Vesta']], 'and it is a nudge with no window')
})

test('three members waiting in a ring are one cycle, not three', () => {
  const rows = [
    row('Vesta', { state: 'waiting', waits: { on: 'Mars', for: 'a ruling', since: NOW - 1_000 } }),
    row('Mars', { state: 'waiting', waits: { on: 'Supervisor', for: 'a yes', since: NOW - 2_000 } }),
    row('Supervisor', { state: 'waiting', waits: { on: 'Vesta', for: 'a report', since: NOW - 3_000 } }),
  ]
  const found = deadlocksOf(input(rows))
  assert.equal(found.length, 1, 'a ring is one deadlock')
  assert.equal(found[0]?.edges.length, 3, 'every wait in it is named')
  assert.equal(found[0]?.holds_receiver, true, 'a ring the receiver is in is the owner\'s too')
})

test('a ring that runs through the owner is one deadlock, and its inferred wait is named', () => {
  const rows = [
    row('Vesta', { state: 'waiting', waits: { on: 'Mars', for: 'a ruling', since: NOW - 1_000 } }),
    row('Mars', { state: 'waiting', waits: { on: OWNER, for: 'a yes', since: NOW - 2_000 } }),
    row('Supervisor', { state: 'waiting', waits: { on: 'Vesta', for: 'a report', since: NOW - 3_000 } }),
  ]
  const found = deadlocksOf(input(rows))
  assert.equal(found.length, 1, 'the owner\'s one inferred edge closes the ring')
  assert.deepEqual(found[0]?.edges.map((edge) => edge.from).sort(), ['Ann', 'Mars', 'Supervisor', 'Vesta'], 'the owner waits on the receiver, and says so')
})

test('a free member is never chained into a deadlock, and a parked one only while it rests', () => {
  const free = row('Vesta', { state: IDLE, progress: { step: 4, of: 4, at: NOW - 1_000 }, waits: { on: 'Mars', for: 'work', since: NOW - PERSON } })
  assert.deepEqual(deadlocksOf(input([free])), [], 'a member with nothing in hand waits for work, which is nobody\'s fault')

  // The pair that would close a ring if a free member's wait counted: Mars waits on Vesta, and Vesta has nothing in hand.
  const pair = [free, row('Mars', { state: 'waiting', waits: { on: 'Vesta', for: 'a range', since: NOW - PERSON * 2 } })]
  assert.deepEqual(deadlocksOf(input(pair)), [], 'a member waiting for work is no link in a cycle')
  const working = row('Vesta', { state: 'waiting', progress: { step: 1, of: 4, at: NOW - 1_000 }, waits: { on: 'Mars', for: 'a ruling', since: NOW - PERSON } })
  assert.equal(deadlocksOf(input([working, pair[1]!])).length, 1, 'the same pair, with the member at work, is the cycle it looks like')

  const resting = row('Vesta', { state: PARKED_STATE, progress: { step: 1, of: 4, at: NOW - 1_000 }, waits: { on: 'Mars', for: 'a ruling', since: NOW - PERSON } })
  assert.deepEqual(deadlocksOf(input([resting])), [], 'a parked member waits on nobody while it rests')
})

test('a list of things waited for is never read as a chain', () => {
  const listed = row('Vesta', {
    state: 'waiting',
    waits: { on: 'Mars', for: 'a verdict on macula-io/martha#320; a ruling from Supervisor; the owner\'s yes', since: NOW - PERSON },
  })
  const rows = [listed, row('Mars', { state: 'waiting', waits: { on: 'Vesta', for: 'a range', since: NOW - 1_000 } })]
  const found = deadlocksOf(input(rows))
  const fromVesta = found.flatMap((deadlock) => deadlock.edges.filter((edge) => edge.from === 'Vesta'))
  assert.equal(fromVesta.length <= 1, true, 'the words a member wrote in `for` add no edges of their own')
})

test('a chain that ends at a member who cannot answer is a dead end, and the one that must act is named', () => {
  const rows = [
    row('Vesta', { state: 'waiting', waits: { on: 'Mars', for: 'a verdict', since: NOW - PERSON } }),
    row('Mars', { at: NOW - OFFLINE_AFTER_MS - 1, state: 'idle', progress: { step: 4, of: 4, at: NOW - PERSON } }),
  ]
  const found = deadlocksOf(input(rows))
  assert.equal(found.length, 1, 'one dead end')
  assert.equal(found[0]?.kind, 'dead-end')
  assert.equal(found[0]?.must_act, 'Supervisor', 'the receiver brings a quiet member back, since nobody else starts it')
  assert.match(found[0]?.act ?? '', /is quiet/, 'and says why the member cannot answer')
})

test('a stalled member inside a cycle is one deadlock, not the cycle plus a chain into the same member', () => {
  const rows = [
    row('Vesta', { state: 'waiting', waits: { on: 'Mars', for: 'a ruling', since: NOW - PERSON }, progress: { step: 1, of: 4, at: NOW - STALLED } }),
    row('Mars', { state: 'waiting', waits: { on: 'Vesta', for: 'a range', since: NOW - PERSON * 2 } }),
  ]
  const found = deadlocksOf(input(rows))
  assert.equal(found.length, 1, 'the same waits were drawn twice: the cycle is the one kept')
  assert.equal(found[0]?.kind, 'cycle', 'and it is the whole situation')
})
