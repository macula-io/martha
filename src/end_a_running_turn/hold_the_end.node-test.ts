// The end of a running turn, held at a tool boundary by the launcher (martha#311, ruling D and its placement ruling):
// the tools in flight tracked by the host's own ids per session, the end held on the beat in the same step that finds
// none in flight, carried on the answer to the last one, every call denied while it is held, and the hold dropped only
// when the turn it names ends or the end expires.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { A_TOOL_WHILE_THE_END_IS_HELD, holdingTheEnds } from './hold_the_end.ts'

const SESSION = 'a-session'
const THE_TURN = 'the-running-turn'

test('#311 ruling D: an end held with nothing in flight is carried at once, and a call after it is denied (mutant: hold only while a tool runs)', () => {
  const ends = holdingTheEnds()
  assert.equal(ends.hold(SESSION, THE_TURN), 'now', 'an end with nothing in flight was not carried at once')
  assert.equal(ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a call approved between the beat and the abort would run into the abort')
})

test('#311 ruling D: an end held while a tool runs rides on that tool\'s answer, and no other call starts meanwhile (mutant: carry while in flight)', () => {
  const ends = holdingTheEnds()
  ends.aCallAllowed(SESSION, 'a-tool')
  assert.equal(ends.hold(SESSION, THE_TURN), 'held', 'the end was carried while a tool was in flight, which cancels that tool\'s report')
  assert.equal(ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a call started in a turn whose end was held')
  assert.equal(ends.aCallAnswered(SESSION, 'a-tool'), THE_TURN, 'the end did not ride on the last tool\'s answer')
  assert.equal(ends.aCallAnswered(SESSION, 'a-tool'), undefined, 'the end rode on a second answer as well')
})

test('#311 ruling D: a second answer for one id does not carry the end while another tool still runs (mutant: a counter in place of ids)', () => {
  const ends = holdingTheEnds()
  ends.aCallAllowed(SESSION, 'one-tool')
  ends.aCallAllowed(SESSION, 'another-tool')
  ends.hold(SESSION, THE_TURN)
  assert.equal(ends.aCallAnswered(SESSION, 'one-tool'), undefined, 'the end was carried with another tool still in flight')
  assert.equal(ends.aCallAnswered(SESSION, 'one-tool'), undefined, 'a repeated answer for one id counted as the other tool\'s')
  assert.equal(ends.aCallAnswered(SESSION, 'never-allowed'), undefined, 'an id never allowed changed what is in flight')
  assert.equal(ends.aCallAnswered(SESSION, 'another-tool'), THE_TURN, 'the end was not carried after the last tool')
})

test('#311 ruling D: only the turn the end names ending drops the hold; a subagent\'s turn ending does not (mutant: drop on any turn end)', () => {
  const ends = holdingTheEnds()
  ends.aCallAllowed(SESSION, 'a-tool')
  ends.hold(SESSION, THE_TURN)
  ends.aTurnEnded(SESSION, 'a-subagent-turn')
  assert.equal(ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a subagent finishing dropped the hold on the main turn')
  ends.aTurnEnded(SESSION, THE_TURN)
  assert.equal(ends.deniesACall(SESSION), undefined, 'the next turn\'s calls were denied by an end held in the last one')
  assert.equal(ends.hold(SESSION, 'the-next-turn'), 'now', 'a tool of the ended turn was still counted in flight')
})

test('#311 ruling D: an expired end lets calls run again, and holds are kept per session (mutants: keep it past expiry; one hold for all sessions)', () => {
  const ends = holdingTheEnds()
  ends.hold(SESSION, THE_TURN)
  assert.equal(ends.deniesACall('another-session'), undefined, 'an end held in one session denied another session\'s calls')
  ends.anEndExpired(SESSION)
  assert.equal(ends.deniesACall(SESSION), undefined, 'an expired end still denied every call')
})
