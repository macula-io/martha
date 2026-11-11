// The pane opens at a session's start only when the declaration switched it on (martha#254 test 8).
//
// The pane itself is the host's to draw and can only be read on a real crew; what can be pinned here is the one
// decision it makes: whether a session's start opens it by itself, and how many rows it asks the host for.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { opensAtStartOf, PANE_CHROME_ROWS, rowsToOpen } from './pane_rule.ts'

/** A `see_the_crew` answer with the declaration's switch however the test names it. */
const answer = (pane_at_start: unknown, rows: readonly unknown[] = []): string =>
  JSON.stringify({
    rows,
    counts: { members: rows.length, online: rows.length, working: rows.length, waiting: 0, needs_you: 0 },
    pane_at_start,
  })

test('the pane opens by itself only when the declaration switched the dashboard on (test 8)', () => {
  assert.equal(opensAtStartOf(answer(true)), true, 'a crew that switched the dashboard on opens the pane at a start')
  assert.equal(opensAtStartOf(answer(false)), false, 'a crew that did not switch it on opens nothing')
  assert.equal(opensAtStartOf('not an answer at all'), false, 'an answer the launcher could not give opens nothing')
  assert.equal(opensAtStartOf(answer('true')), false, 'a switch that is not the boolean true opens nothing')
})

test('the rows the pane asks for are one per member, one more for each member that needs the owner, and the chrome (test 8)', () => {
  const member = (state: string): unknown => ({ member: 'Vesta', state })
  assert.equal(rowsToOpen(answer(false)), PANE_CHROME_ROWS, 'a crew that has reported nothing still draws its box')
  assert.equal(rowsToOpen(answer(false, [member('working'), member('waiting')])), 2 + PANE_CHROME_ROWS, 'one row per member')
  assert.equal(rowsToOpen(answer(false, [member('working'), member('needs-you')])), 2 + 1 + PANE_CHROME_ROWS, 'a member that needs the owner takes a block of its own')
  assert.equal(rowsToOpen('{"nothing":1}'), PANE_CHROME_ROWS, 'an answer with no rows asks for the chrome alone')
})
