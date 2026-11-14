// The reported flake had one cause worth a standing check (martha#223): a row started the model
// with a budget of one turn, so a host that spent its turn on a tool call exited without doing
// what the row reads -- an answer, a clean exit, a marker the agent writes -- and the row
// reported it as a failure of the tree under test. This holds every real row to a budget with
// room for a look-up.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { turnBudgets } from './probe_hosts.ts'
import { ROOM_TO_FINISH } from '../declare_a_launch_probe/declare_a_launch_probe.ts'

test('no row asks the model to answer in one turn (martha#223)', () => {
  const oneTurn = turnBudgets().filter((row) => row.maxTurns !== undefined && row.maxTurns < ROOM_TO_FINISH)
  assert.deepEqual(oneTurn, [])
})
