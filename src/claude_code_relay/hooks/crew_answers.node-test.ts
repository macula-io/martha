// The words on the wire are the same words on both ends (martha#255 r=2, R1 and R2).
//
// The mod is installed as a copy of its own folder and cannot import the core, so its reading of the launcher's
// answers is a second copy of the launcher's shapes, and nothing held the two together: at r=1 a launcher answering
// `submit` where the mod read `prompt` would submit no handover at all, and every one of the 156 tests still passed.
// This file takes the launcher's own answers, from the functions the launcher really calls, and puts them through the
// mod's own parsers — so a word either end rewords is red here, by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { orderIn, PANE_CHROME_ROWS, paneIn, switchTheModelOnTheHost, theOwnersListIn } from './crew_answers.ts'
import { theActAsked, theListForThePane, theStandingLines } from '../../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { STANDING_HEADING } from '../../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { CARRY_A_TEXT, CARRY_THE_CLEAR, CARRY_THE_END, NO_ACT, theOrderOf, type TheAct } from '../../refresh_a_member/the_refresh_flow.ts'
import { NO_MEMBER_HAS_REPORTED, PANE_CHROME_ROWS as THE_LAUNCHERS_CHROME, seeTheCrew, thePaneAnsweredBy } from '../../see_the_crew/see_the_crew.ts'

/** The model a switch moves a session to, in these tests: any name at all, since the slice only passes it on. */
const THE_OTHER_MODEL = 'a-model-the-launcher-named'

/** The launcher's answer to a session's question, as the launcher hands it over: the order, as text. */
const answered = (act: TheAct): string => JSON.stringify(theOrderOf(act))

/** The launcher's pane answer for two members that have reported nothing, as the launcher hands it over. */
const aPaneAnswer = (): string =>
  JSON.stringify(thePaneAnsweredBy(seeTheCrew({ members: [{ name: 'Pallas' }, { name: 'Vesta' }] }, {}, 1_000), false, 1_000))

test('the prompt the launcher answers is the text the mod submits (martha#255 r=2 R1)', () => {
  const read = orderIn(answered({ act: 'prompt', text: 'read my handover' }))
  assert.deepEqual(read, { carry: CARRY_A_TEXT, text: 'read my handover' }, `the mod reads the launcher's own answer: ${answered({ act: 'prompt', text: 'read my handover' })}`)
})

test('the clear the launcher answers is the clear the mod runs (martha#255 r=2 R1)', () => {
  assert.deepEqual(orderIn(answered({ act: CARRY_THE_CLEAR })), { carry: CARRY_THE_CLEAR }, 'the mod runs the clear the launcher answered')
})

test('nothing to do, and an order the mod cannot make out, both do nothing (martha#255 r=2 R1)', () => {
  assert.deepEqual(orderIn(answered(NO_ACT)), { carry: 'none' }, 'the launcher saying nothing to do is read as nothing to do')
  // The mod does nothing with either shape: `takeTheAct` returns on `none` and on null alike. A reworded third word
  // therefore cannot make the mod do anything but nothing, which is why it needs no copy held.
  assert.equal(orderIn(JSON.stringify({ carry: 'not-a-word-this-mod-knows' })), null, 'an order the mod cannot make out is refused, never guessed at')
  assert.equal(orderIn(JSON.stringify({ carry: CARRY_A_TEXT })), null, 'a submit with no text is not an order the mod can run')
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

// The row's model is written from the mod's report, and only from a command the host resolved (martha#315): a switch the
// host refused is not one to report, or the row says a model the session does not run and the owner reads a switch that
// never happened. r=2 N18: with the `return` gone from the catch, every test was still green.
test('#315 r2: a model command the host refused is not reported, so the row keeps the model this session still runs (mutant: the report sent after a failed command)', async () => {
  const ran: string[] = []
  const told: string[] = []
  await switchTheModelOnTheHost(
    {
      runTheModelCommand: async (model) => {
        ran.push(model)
        throw new Error('the host refused the model command')
      },
      noteTheModel: async (model) => {
        told.push(model)
      },
    },
    THE_OTHER_MODEL,
  )
  assert.deepEqual(ran, [THE_OTHER_MODEL], 'the host command was not run with the model the launcher named')
  assert.deepEqual(told, [], 'a model the host refused was reported, so the row says a switch that never happened')
})

test('#315: a model command the host resolved is reported once, with the model it was given', async () => {
  const ran: string[] = []
  const told: string[] = []
  await switchTheModelOnTheHost(
    {
      runTheModelCommand: async (model) => {
        ran.push(model)
      },
      noteTheModel: async (model) => {
        told.push(model)
      },
    },
    THE_OTHER_MODEL,
  )
  assert.deepEqual(ran, [THE_OTHER_MODEL], 'the host command was not run with the model the launcher named')
  assert.deepEqual(told, [THE_OTHER_MODEL], 'the report of a switch the host made did not name that switch')
})

test('the owner\'s list the launcher answers is the list the pane draws, its copy only on the revealed row (martha#316)', () => {
  const row = theActAsked({ id: 'an-act', title: 'Do a thing', commands: [{ command: 'make release', does: 'cuts the release' }] }, 'Pallas', 0)
  assert.ok(!('refused' in row), 'the test could not build its row')
  const { heading, claim, focus, next, drawn, copy, lines } = theListForThePane([row], '', 0)
  const launchers = { heading, claim, focus, next, drawn, copy, lines }
  assert.deepEqual(theOwnersListIn(JSON.stringify(launchers)), launchers, 'the pane reads the launcher\'s own list answer differently')
  assert.ok(copy !== '' && drawn.filter((line) => line.copy).length === 1, 'the revealed row carries one copy button and the text it copies')
  assert.equal(theOwnersListIn('{"heading":"x"}'), null, 'the pane drew an answer that is not a list')
})

test('the standing items under the list are the lines the launcher answers, and an answer with none to read is not drawn (martha#317)', () => {
  const standing = [STANDING_HEADING, '- HELD martha-353: PR 353. Why: a demo. Until: the demo is over.']
  const { heading, claim, focus, next, drawn, copy, lines } = theListForThePane([], '', 0)
  const launchers = { heading, claim, focus, next, drawn: [...drawn, ...theStandingLines(standing)], copy, lines: lines + standing.length }
  const read = theOwnersListIn(JSON.stringify(launchers))
  assert.deepEqual(read?.drawn.slice(-standing.length).map((line) => line.text), standing, 'the standing lines do not end what the pane draws')
  assert.equal(read?.drawn.at(-standing.length)?.bold, true, 'the standing heading is not drawn bold')
  assert.equal(theOwnersListIn(JSON.stringify({ ...launchers, drawn: undefined })), null, 'an answer with no lines was drawn')
  assert.equal(theOwnersListIn(JSON.stringify({ ...launchers, drawn: [{ text: 1 }] })), null, 'a line that is not text was drawn')
})

// The end of a running turn (martha#311 design §1 and §5): a fourth order word beside the text, the clear and the
// model, which every host's mod carries, and the outcome the mod reports back so only an end that ended is counted.
test('#311: the end the launcher answers is the end the mod carries, with the turn it names (mutant: map it to none)', () => {
  const order = theOrderOf({ act: CARRY_THE_END, turn_id: 'a-turn' })
  assert.deepEqual(order, { carry: CARRY_THE_END, turn_id: 'a-turn' }, 'the launcher does not answer an end with the turn it ends')
  assert.deepEqual(orderIn(JSON.stringify(order)), order, 'the mod reads the launcher\'s end order differently')
})

test('#311: an end that names no turn is not an order the mod carries out (mutant: drop the turn check)', () => {
  assert.equal(orderIn(JSON.stringify({ carry: CARRY_THE_END })), null, 'an end with no turn was read as an order')
  assert.equal(orderIn(JSON.stringify({ carry: CARRY_THE_END, turn_id: '' })), null, 'an end with an empty turn was read as an order')
})
