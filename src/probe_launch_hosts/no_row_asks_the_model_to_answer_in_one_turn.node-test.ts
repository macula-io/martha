// The reported flake had one cause worth a standing check (martha#223): a row started the model
// with a budget of one turn, so a host that spent its turn on a tool call exited without
// answering, and the row read that as a failure of the tree under test. These tests hold every
// real row to a budget with room for a look-up, and hold the memory control -- whose rows are
// not probes and so are not in that list -- to room for the two calls its look-up can take.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MEMORY_CLAUDE, turnBudgets } from './probe_hosts.ts'

/** The fewest turns a row may start the model with: one to spend, and one to answer in. */
const ROOM_TO_ANSWER = 2
/** The fewest the memory control may start with: the index, the note it names, and the answer. */
const ROOM_FOR_A_LOOK_UP = 3

/** The value a command line gives a switch, by the switch's own name. */
const valueOf = (args: readonly string[], flag: string): number => Number(args[args.indexOf(flag) + 1])

test('no row asks the model to answer in one turn (martha#223)', () => {
  const oneTurn = turnBudgets().filter((row) => row.maxTurns !== undefined && row.maxTurns < ROOM_TO_ANSWER)
  assert.deepEqual(oneTurn, [])
})

test('the memory control asks for room to look the codeword up (martha#223)', () => {
  assert.ok(MEMORY_CLAUDE.includes('--max-turns'), 'the memory control names a turn budget')
  assert.ok(valueOf(MEMORY_CLAUDE, '--max-turns') >= ROOM_FOR_A_LOOK_UP, 'the memory control has room for a look-up and the answer')
  assert.deepEqual(MEMORY_CLAUDE.slice(-2), ['--output-format', 'json'], 'the memory control asks for the answer as json, so a run that never answered can be told apart')
})
