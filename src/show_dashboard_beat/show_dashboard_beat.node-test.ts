// The row's shape, its naming, and the rule that settles which beat is the row (martha#254 tests 2 and 3, the rule).
//
// The store that writes a row is the host's (../launch_a_claude_code_member/dashboard_rows_in_state), and its own
// test proves a beat is written whole; what is pinned here is what a reader and a writer must agree on whichever of
// them is looking: what a row is, what it is called, and which of two beats wins.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  beatAfter,
  BEAT_INTERVAL_MS,
  isDashboardRow,
  memberOfRowFileName,
  OFFLINE_AFTER_MS,
  rowFileNameOf,
  type DashboardRow,
} from './show_dashboard_beat.ts'

function beat(member: string, at: number, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: 'a-session',
    at,
    state: 'working',
    holds: 'macula-io/martha#254',
    task: 'Build martha#254, the crew store',
    progress: { step: 1, of: 4 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 12, costUsd: 0.4 },
    ...changes,
  }
}

test('the newest beat wins: a beat taken earlier and landing later never takes the row back (test 2)', () => {
  const held = beat('Vesta', 100, { task: 'the newer beat' })
  assert.deepEqual(beatAfter(null, beat('Vesta', 1)), beat('Vesta', 1), 'a store holding nothing keeps the first beat it is offered')
  assert.equal(beatAfter(held, beat('Vesta', 50)), null, 'an older beat is dropped whole')
  assert.equal(beatAfter(held, beat('Vesta', 100)), null, 'a beat taken at the same instant does not take the row back either')
  assert.equal(beatAfter(held, beat('Vesta', 150))?.task, 'Build martha#254, the crew store', 'a newer beat takes the row over')
})

test('a row is named by its member, and a name that is not one is no member (test 7, the naming)', () => {
  assert.equal(rowFileNameOf('Vesta'), 'Vesta.json')
  assert.equal(memberOfRowFileName('Vesta.json'), 'Vesta')
  assert.equal(memberOfRowFileName('.staging-1'), undefined, 'a staging file is no member')
  assert.equal(memberOfRowFileName('a/b.json'), undefined, 'a name that encodes to something else is no member')
})

test('a row is a row only with every field of one, and what it holds is checked field by field', () => {
  assert.equal(isDashboardRow(beat('Vesta', 1)), true, 'a whole row reads as one')
  assert.equal(isDashboardRow(beat('Vesta', 1, { state: 'working-ish' as never })), false, 'a state nobody writes is not a row')
  assert.equal(isDashboardRow({ ...beat('Vesta', 1), progress: { step: 0, of: 0 } }), false, 'a total below one is not a row')
  assert.equal(isDashboardRow({ ...beat('Vesta', 1), waits: { on: 'Supervisor', for: 'a verdict' } as never }), false, 'a wait with no since is not one')
  assert.equal(isDashboardRow('a row'), false, 'and a string is not a row at all')
})

test('the beat interval and its offline threshold are named once, and the threshold is a whole multiple of it (test 3, the constants)', () => {
  assert.ok(OFFLINE_AFTER_MS > BEAT_INTERVAL_MS, 'a row must miss more than one beat to read offline')
  assert.equal(OFFLINE_AFTER_MS % BEAT_INTERVAL_MS, 0, 'the threshold counts beats')
})
