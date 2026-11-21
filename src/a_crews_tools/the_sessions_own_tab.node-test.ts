// A session's own tab: what the host's task list, its work in hand and a finished turn put on the member's row
// (martha#1000, gap 8 of #957).
//
// These are plain tests of the rules the slice holds: the row a task list is written onto, the agents a Stop leaves, and
// the state a turn settles to. Nothing is planted to prove them (Raf's trims of 2026-11-20: mutants on guard and
// security code only); each case is one read of a real row.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AGENTS_FIELD,
  TASKS_FIELD,
  theRowWithNothingSaid,
  type AnAgentOnARow,
  type DashboardRow,
} from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { AWorkInHandReported } from '../host_contract/host_contract.ts'
import {
  anAskTheSessionsOwnTabMakes,
  holdsASettledWait,
  mayPutAQuestionToTheOwner,
  PROGRESS_REPORTING_IS_OFF,
  THE_TASKS_ASK,
  theAgentsInHand,
  theProgressSwitched,
  theRowSettledBetweenTurns,
  theSessionsOwnState,
  theStateAFinishedTurnSettlesTo,
  theTasksIn,
  theTasksNoted,
  theWorkInHandHeld,
  type AnOwnTabAsked,
  type TheOwnTabAsksPlace,
} from './a_sessions_own_tab.ts'

/** A row of a member that said nothing yet, at a time this test names. */
const aRow = (over: Partial<DashboardRow> = {}): DashboardRow => ({
  member: 'Vesta',
  session: 'a-session',
  at: 1_000,
  ...theRowWithNothingSaid(),
  ...over,
})

/** The waits a member declared on a person: a HANDOFF it waits for, from a moment this test names. */
const A_DECLARED_WAIT = { on: 'Supervisor', for: 'a verdict', since: 900 }

/** What a task list ask is handed, and every change it wrote, so a test reads the row as the launcher would. */
function anAskedTab(row: DashboardRow): { readonly asked: AnOwnTabAsked; readonly row: () => DashboardRow } {
  let held = row
  const asked: AnOwnTabAsked = { member: row.member, writeTheRow: (change) => void (held = change(held)) }
  return { asked, row: () => held }
}

/** What the three asks of a session's own tab are answered over, for a task list alone. */
const aTabPlace = (asked: AnOwnTabAsked): TheOwnTabAsksPlace => ({
  asked,
  own: theSessionsOwnState(),
  session: 'a-session',
  park: { member: 'Vesta', stores: {} as never, now: 1_000 },
})

test('a task list is written onto the row, and the report\'s own task, progress and wait are left as they were', () => {
  const before = aRow({ task: 'the member\'s own line', progress: { step: 2, of: 5, at: 800 }, waits: A_DECLARED_WAIT })
  const tab = anAskedTab(before)
  const answered = anAskTheSessionsOwnTabMakes(
    aTabPlace(tab.asked),
    THE_TASKS_ASK,
    { tasks: [{ subject: 'write the tests', status: 'in_progress' }, { subject: 'push', status: 'pending' }] },
  )
  assert.ok(answered !== undefined && 'answer' in answered, `the task list was refused: ${answered !== undefined && 'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(tab.row()[TASKS_FIELD], [
    { subject: 'write the tests', status: 'in_progress' },
    { subject: 'push', status: 'pending' },
  ], 'the row does not carry the list the session posted')
  assert.equal(tab.row().task, 'the member\'s own line', 'a task-list write took the member\'s own task line')
  assert.deepEqual(tab.row().progress, { step: 2, of: 5, at: 800 }, 'a task-list write moved the member\'s reported progress')
  assert.deepEqual(tab.row().waits, A_DECLARED_WAIT, 'a task-list write ended the wait the member declared, which only its own report ends')
})

test('a task list that is no list is refused by name, and the row keeps the list it had', () => {
  const before = aRow({ [TASKS_FIELD]: [{ subject: 'kept', status: 'pending' as const }] })
  const tab = anAskedTab(before)
  for (const bad of [{ tasks: 'one task' }, { tasks: [{ subject: 'no standing' }] }, { tasks: [{ status: 'pending' }] }, { tasks: [{ subject: 'a', status: 'archived' }] }]) {
    const answered = anAskTheSessionsOwnTabMakes(aTabPlace(tab.asked), THE_TASKS_ASK, bad)
    assert.ok(answered !== undefined && 'refused' in answered, `a task list of ${JSON.stringify(bad)} was taken`)
  }
  assert.deepEqual(tab.row()[TASKS_FIELD], [{ subject: 'kept', status: 'pending' }], 'a refused list rewrote the row')
})

test('the list a row carries is read back as the three standings, and no other', () => {
  assert.deepEqual(theTasksIn([{ subject: 'a', status: 'completed' }]), [{ subject: 'a', status: 'completed' }], 'a list the row can carry was refused')
  assert.equal(theTasksIn([{ subject: 'a', status: 'done' }]), undefined, 'a standing the host never writes was taken as a task')
  assert.equal(theTasksIn(undefined), undefined, 'an ask that carries no list was read as an empty one, which would blank the row')
})

test('a Stop leaves the work in hand on the row, and a background command keeps no id', () => {
  const held: readonly AnAgentOnARow[] = []
  const work: AWorkInHandReported = {
    background_tasks: [
      { id: 'agent-1', type: 'subagent', description: 'reviewing PR 981', agent_type: 'Explore' },
      { id: 'shell-1', type: 'shell', description: 'npm test', command: 'npm test' },
    ],
    session_crons: 2,
  }
  assert.deepEqual(theAgentsInHand(work, held, 5_000), [
    { id: 'agent-1', label: 'Explore: reviewing PR 981', started: 5_000 },
    { id: '', label: 'shell: npm test', started: 5_000 },
  ], 'the work in hand is not the list the host reported, as the row reads it')
})

test('a piece of work already in hand keeps the moment it was first in hand', () => {
  const held: readonly AnAgentOnARow[] = [{ id: 'agent-1', label: 'Explore: something else by now', started: 1_000 }]
  const again = theAgentsInHand({ background_tasks: [{ id: 'agent-1', type: 'subagent', description: 'the same agent' }], session_crons: 0 }, held, 9_000)
  assert.equal(again[0]?.started, 1_000, 'a re-read of an agent restamped when it started')
})

test('a Stop\'s work in hand is written onto the row\'s background, in the one write the tab makes', () => {
  const tab = anAskedTab(aRow({ [TASKS_FIELD]: [{ subject: 'write the tests', status: 'in_progress' as const }] }))
  const own = theSessionsOwnState()
  theWorkInHandHeld(tab.asked, own, 'a-session', { background_tasks: [{ id: 'agent-1', type: 'subagent', description: 'reviewing PR 981', agent_type: 'Explore' }], session_crons: 0 }, 5_000, () => true)
  assert.deepEqual(tab.row()[AGENTS_FIELD], [{ id: 'agent-1', label: 'Explore: reviewing PR 981', started: 5_000 }], 'the work the host reported is not on the row')
  assert.deepEqual(tab.row()[TASKS_FIELD], [{ subject: 'write the tests', status: 'in_progress' }], 'a Stop took the session\'s task list off the row')
  assert.equal(own.wakeups.get('a-session'), 0, 'the wake-ups a Stop reports are not what the session holds')
  // A second Stop that no longer names the agent drops it from the row: what ended is no longer in hand.
  theWorkInHandHeld(tab.asked, own, 'a-session', { background_tasks: [], session_crons: 0 }, 6_000, () => true)
  assert.deepEqual(tab.row()[AGENTS_FIELD], [], 'an agent the host stopped stayed on the row as work in hand')
})

test('a finished turn settles to what the member holds: needs-you, reviewing, waiting, idle', () => {
  const settle = (over: Partial<Parameters<typeof theStateAFinishedTurnSettlesTo>[0]>) =>
    theStateAFinishedTurnSettlesTo({ in_hand: [], waits: null, wakeups: 0, answer: 'done', may_ask_the_owner: true, is_a_review: () => false, ...over })
  const aReview = (label: string) => label.includes('reviewing')
  assert.equal(settle({ answer: 'shall I land it?', in_hand: ['Explore: reviewing PR 981'], is_a_review: aReview }), 'needs-you', 'a closing question the member may put to its owner did not ask for the owner')
  assert.equal(settle({ answer: 'shall I land it?', may_ask_the_owner: false }), 'idle', 'a member whose crew routes its asks elsewhere asked the owner anyway')
  assert.equal(settle({ in_hand: ['Explore: reviewing PR 981'], is_a_review: aReview }), 'reviewing', 'a review in flight did not read as reviewing')
  assert.equal(settle({ in_hand: ['Explore: chasing a flaky test'], is_a_review: aReview }), 'waiting', 'work in hand that is no review did not read as waiting')
  assert.equal(settle({ waits: A_DECLARED_WAIT }), 'waiting', 'a wait the member declared did not read as waiting')
  assert.equal(settle({ wakeups: 1 }), 'waiting', 'a scheduled wake-up did not read as waiting')
  assert.equal(settle({}), 'idle', 'a member that holds nothing did not settle to idle')
})

test('between turns a row that said it was waiting is settled again when what it held is gone, and anything else is left alone', () => {
  const own = theSessionsOwnState()
  const waiting = aRow({ state: 'waiting' })
  assert.equal(theRowSettledBetweenTurns(waiting, own, 'a-session', () => false).state, 'idle', 'a row waiting on work that is gone kept its old state between turns')
  own.in_hand.set('a-session', [{ id: 'agent-1', label: 'Explore: still working', started: 1 }])
  assert.equal(theRowSettledBetweenTurns(waiting, own, 'a-session', () => false).state, 'waiting', 'a row whose work is still in hand was settled to idle')
  assert.equal(theRowSettledBetweenTurns(aRow({ state: 'working' }), own, 'a-session', () => false).state, 'working', 'the member\'s own working state was overwritten between turns')
  assert.equal(holdsASettledWait('working'), false, 'a state a member wrote itself was read as one the beat may settle')
  assert.equal(holdsASettledWait('reviewing'), true, 'a reviewing row was left unsettled between turns')
})

test('a turn still running settles nothing', () => {
  const own = theSessionsOwnState()
  own.turn_running = true
  own.in_hand.clear()
  const running = aRow({ state: 'waiting' })
  assert.equal(theRowSettledBetweenTurns(running, own, 'a-session', () => false).state, 'waiting', 'a beat mid-turn rewrote the member\'s state')
})

test('the closing question is read only at a turn\'s end, and only when it ends in one', async () => {
  const no = async () => false
  assert.equal(await mayPutAQuestionToTheOwner({ at_start: false, turn_running: false, answer: 'land it?' }, async () => true), true, 'a closing question from a finished turn went unread')
  assert.equal(await mayPutAQuestionToTheOwner({ at_start: true, turn_running: false, answer: 'land it?' }, async () => true), false, 'a session\'s start was read as a closing question')
  assert.equal(await mayPutAQuestionToTheOwner({ at_start: false, turn_running: true, answer: 'land it?' }, async () => true), false, 'a question inside a running turn was read as the turn\'s closing one')
  assert.equal(await mayPutAQuestionToTheOwner({ at_start: false, turn_running: false, answer: 'landed' }, async () => true), false, 'an answer with no question was read as one')
  assert.equal(await mayPutAQuestionToTheOwner({ at_start: false, turn_running: false, answer: 'land it?' }, no), false, 'the crew\'s own routing table was not asked')
})

test('a row a session wrote is written by the same one writer the tab asks: nothing here is a second writer', () => {
  const tab = anAskedTab(aRow())
  const answered = theTasksNoted(tab.asked, theSessionsOwnState(), 'a-session', { tasks: [] })
  assert.ok('answer' in answered, `an empty list, which a cleared set of tasks is, was refused: ${'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(tab.row()[TASKS_FIELD], [], 'a list of no tasks is not written as the row\'s own empty list')
})

test('progress reporting turned off clears the task list taken, and takes no other until it is on again (review r=1)', () => {
  // A reader shows the list's open task where the report's is blank (see_the_crew), so a list left on the row, or one
  // taken after off, is progress the owner asked for none of.
  const tab = anAskedTab(aRow({ [TASKS_FIELD]: [{ subject: 'write the tests', status: 'in_progress' as const }] }))
  const own = theSessionsOwnState()
  const at = { ...aTabPlace(tab.asked), own }
  assert.ok('answer' in theProgressSwitched(tab.asked, own, at.session, { wanted: 'off' }))
  assert.equal(tab.row()[TASKS_FIELD], undefined, 'the task list taken stood after progress reporting was turned off')
  const list = { tasks: [{ subject: 'push', status: 'in_progress' }] }
  assert.deepEqual(anAskTheSessionsOwnTabMakes(at, THE_TASKS_ASK, list), { answer: PROGRESS_REPORTING_IS_OFF })
  assert.equal(tab.row()[TASKS_FIELD], undefined, 'a task list was taken while progress reporting was off')
  theProgressSwitched(tab.asked, own, at.session, { wanted: 'on' })
  anAskTheSessionsOwnTabMakes(at, THE_TASKS_ASK, list)
  assert.deepEqual(tab.row()[TASKS_FIELD], list.tasks, 'a task list was not taken again once progress reporting was on')
})
