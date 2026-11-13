// The words on the wire are the same words on both ends (martha#255 r=2, R1 and R2).
//
// The mod is installed as a copy of its own folder and cannot import the core, so its reading of the launcher's
// answers is a second copy of the launcher's shapes, and nothing held the two together: at r=1 a launcher answering
// `submit` where the mod read `prompt` would submit no handover at all, and every one of the 156 tests still passed.
// This file takes the launcher's own answers, from the functions the launcher really calls, and puts them through the
// mod's own parsers — so a word either end rewords is red here, by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { orderIn, PANE_CHROME_ROWS, paneIn } from './crew_answers.ts'
import { NO_ACT, theOrderOf, type TheAct } from '../../refresh_a_member/the_refresh_flow.ts'
import { NO_MEMBER_HAS_REPORTED, PANE_CHROME_ROWS as THE_LAUNCHERS_CHROME, seeTheCrew, thePaneAnsweredBy } from '../../see_the_crew/see_the_crew.ts'

/** The launcher's answer to a session's question, as the launcher hands it over: the order, as text. */
const answered = (act: TheAct): string => JSON.stringify(theOrderOf(act))

/** The launcher's pane answer for two members that have reported nothing, as the launcher hands it over. */
const aPaneAnswer = (): string =>
  JSON.stringify(thePaneAnsweredBy(seeTheCrew({ members: [{ name: 'Pallas' }, { name: 'Vesta' }] }, {}, 1_000), false, 1_000))

test('the prompt the launcher answers is the text the mod submits (martha#255 r=2 R1)', () => {
  const read = orderIn(answered({ act: 'prompt', text: 'read my handover' }))
  assert.deepEqual(read, { carry: 'submit', text: 'read my handover' }, `the mod reads the launcher's own answer: ${answered({ act: 'prompt', text: 'read my handover' })}`)
})

test('the clear the launcher answers is the clear the mod runs (martha#255 r=2 R1)', () => {
  assert.deepEqual(orderIn(answered({ act: 'clear' })), { carry: 'clear' }, 'the mod runs the clear the launcher answered')
})

test('nothing to do, and an order the mod cannot make out, both do nothing (martha#255 r=2 R1)', () => {
  assert.deepEqual(orderIn(answered(NO_ACT)), { carry: 'none' }, 'the launcher saying nothing to do is read as nothing to do')
  // The mod does nothing with either shape: `takeTheAct` returns on `none` and on null alike. A reworded third word
  // therefore cannot make the mod do anything but nothing, which is why it needs no copy held.
  assert.equal(orderIn(JSON.stringify({ carry: 'not-a-word-this-mod-knows' })), null, 'an order the mod cannot make out is refused, never guessed at')
  assert.equal(orderIn(JSON.stringify({ carry: 'submit' })), null, 'a submit with no text is not an order the mod can run')
})

test("the pane's chrome is the launcher's count, not a second one (martha#255 r=2 R2)", () => {
  assert.equal(PANE_CHROME_ROWS, THE_LAUNCHERS_CHROME, 'the mod draws the chrome the launcher counts; neither side may revalue it alone')
})

test('the pane draws how many rows the launcher asked for (martha#255 r=2 R2)', () => {
  const read = paneIn(aPaneAnswer())
  const asked = JSON.parse(aPaneAnswer()) as { header: string; lines: readonly string[]; rows: number }
  assert.ok(read !== null, `the mod reads the launcher's own pane answer: ${aPaneAnswer()}`)
  assert.equal(read.rows, asked.rows, 'the mod asks the host for the rows the launcher counted, not its own fallback')
  assert.equal(read.header, asked.header, 'the header drawn is the one the launcher wrote')
  assert.deepEqual(read.lines, asked.lines, 'the lines drawn are the ones the launcher wrote')
  assert.equal(read.open_at_start, false, 'a pane the launcher does not open by itself stays closed')
})

test('an answer that does not say how many rows is drawn in the pane\'s own chrome (martha#255 r=2 R2)', () => {
  const read = paneIn(JSON.stringify({ header: '0/0 online', lines: [NO_MEMBER_HAS_REPORTED] }))
  assert.equal(read?.rows, PANE_CHROME_ROWS, 'an answer with no count is drawn with the chrome alone')
})

test('an answer that is not a pane at all is not drawn (martha#255 r=2 R2)', () => {
  assert.equal(paneIn('not an answer'), null, 'text the mod cannot parse is a read that failed, not an empty crew')
  assert.equal(paneIn(JSON.stringify({ lines: [] })), null, 'an answer with no header is not one the mod can draw')
})
