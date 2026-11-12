// The refresh flow's decisions, as martha#255's gated design states them: when a refresh is due, what a handover has
// to be, and what ends a flow.
//
// Every threshold here is measured from where the session began, not from zero (#470): a session resumes at the share
// its predecessor reached, so a threshold measured from zero asks again on the very first report, clears, and resumes
// into the same size. A decline is measured exactly as an ask is, which is the same rule applied to the answer.
//
// The flow's own file is driven through the crew store the host really composes on a disk (../crew_files_directory), so
// what a launcher reads back is the file it would have left.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { CREW_HANDOVER_WRITTEN } from '../write_my_handover/write_my_handover.ts'
import {
  aDeclineIsAllowed,
  theFlowSentBack,
  aFlowStarting,
  aFlowStalled,
  aRefreshIsDue,
  FLOW_WINDOW_MS,
  HANDOVER_LIMIT_PERCENT,
  isAStorm,
  keepTheFlow,
  REFRESH_MARGIN_PERCENT,
  REFRESHES_PLACE,
  refreshesPlace,
  STORM_WINDOW_MS,
  theFlowAbandoned,
  theFlowClearing,
  theFlowDeclined,
  theFlowOf,
  theHandoverPrompt,
  theRefreshFile,
  theSendBackNote,
  whatBecameOfTheHandover,
  type ARefresh,
  type TheSessionsReading,
} from './refresh_a_member.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-refresh-'))
after(() => removeTheTree(home))
const crew = join(home, 'crew')

/** A reading of a session that has done nothing yet: a small context, no flow, no task finished. */
const reading = (over: Partial<TheSessionsReading> = {}): TheSessionsReading => ({
  percent: 10,
  started_at_percent: 10,
  finished_report: '',
  refresh_between_tasks: false,
  parked: false,
  asked: false,
  flow: undefined,
  ...over,
})

/** A flow as the design states one: begun at `percent`, standing in `phase`. */
const aFlow = (over: Partial<ARefresh> = {}): ARefresh => ({
  ...aFlowStarting({ trigger: 'after_a_task', reason: 'its task finished', at: 1_000, started_at_percent: 10, percent: 40, asked_on: 'a task', refreshed_at: [] }),
  ...over,
})

test('#255: past the limit a member hands over whatever the declaration switches on', () => {
  const due = aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT, refresh_between_tasks: false }))
  assert.deepEqual(due, { due: true, trigger: 'at_the_limit' })
})

test('#255: a session that began above the threshold is not asked on its first report (#470)', () => {
  const due = aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT + 5, started_at_percent: HANDOVER_LIMIT_PERCENT + 5, refresh_between_tasks: true, finished_report: 'a task' }))
  assert.deepEqual(due, { due: false, why: 'it has not grown past the share this session began at' })
})

test('#255: a finished task past the margin above where the session began is asked once', () => {
  const beganAt = HANDOVER_LIMIT_PERCENT - 3 * REFRESH_MARGIN_PERCENT
  const due = aRefreshIsDue(reading({ percent: beganAt + REFRESH_MARGIN_PERCENT, started_at_percent: beganAt, refresh_between_tasks: true, finished_report: 'a task' }))
  assert.deepEqual(due, { due: true, trigger: 'after_a_task' })
})

test('#255: the switch being off keeps the after-a-task trigger off, and the limit still bites', () => {
  const under = aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT - 1, started_at_percent: 0, refresh_between_tasks: false, finished_report: 'a task' }))
  assert.deepEqual(under, { due: false, why: 'the crew did not switch the after-a-task trigger on' })
  assert.deepEqual(aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT, refresh_between_tasks: false })), { due: true, trigger: 'at_the_limit' })
})

test('#255: a parked member is not refreshed between tasks, and still hands over at the limit', () => {
  const parked = aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT, started_at_percent: 0, refresh_between_tasks: true, finished_report: 'a task', parked: true }))
  assert.deepEqual(parked, { due: true, trigger: 'at_the_limit' })
  const underTheLimit = aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT - 1, started_at_percent: 0, refresh_between_tasks: true, finished_report: 'a task', parked: true }))
  assert.deepEqual(underTheLimit, { due: false, why: 'it is parked' })
})

test('#255: a decline holds the ask back on the very task it was taken on, and the next finished task asks again', () => {
  // The design's at-limit rule is one ask per finished turn: a decline taken at the limit is not asked again on the
  // same report, so the flow does not beat, and the next task that finishes asks once more.
  const declined = aFlow({ phase: 'declined', percent: HANDOVER_LIMIT_PERCENT, asked_on: 'a task' })
  const sameTask = aRefreshIsDue(reading({ percent: HANDOVER_LIMIT_PERCENT, started_at_percent: 10, refresh_between_tasks: true, finished_report: 'a task', flow: declined }))
  assert.deepEqual(sameTask, { due: false, why: 'it declined on this task' })
  const nextTask = aRefreshIsDue(
    reading({ percent: HANDOVER_LIMIT_PERCENT, started_at_percent: 10, refresh_between_tasks: true, finished_report: 'another task', flow: declined }),
  )
  assert.deepEqual(nextTask, { due: true, trigger: 'at_the_limit' })
})

test('#255: a flow that is still running holds every later ask back; an ended one does not', () => {
  for (const phase of ['handing_over', 'clearing'] as const) {
    assert.deepEqual(aRefreshIsDue(reading({ percent: 99, flow: aFlow({ phase }) })), { due: false, why: `its flow is ${phase}` })
  }
  assert.deepEqual(aRefreshIsDue(reading({ percent: 99, flow: aFlow({ phase: 'abandoned' }) })), { due: true, trigger: 'at_the_limit' })
})

test('#255: only the two automatic triggers may be declined; a refresh someone asked for never may', () => {
  assert.equal(aDeclineIsAllowed('at_the_limit'), true)
  assert.equal(aDeclineIsAllowed('after_a_task'), true)
  assert.equal(aDeclineIsAllowed('asked'), false)
})

test('#255: a handover written before the flow asked for one is not this flow’s handover', () => {
  const verdict = whatBecameOfTheHandover({
    stamp: { member: 'builder', predecessor_id: 'a-session', written_at: new Date(500).toISOString(), digest: 'x', record_length: 0, record_digest: 'y' },
    text: 'a handover',
    asked_at: 1_000,
    holds: [],
    sent_back: 0,
    at_limit: false,
  })
  assert.deepEqual(verdict, { kind: 'not_written', why: 'the handover was written before this session was asked for one' })
})

test('#255: a handover missing the line of a package the row holds is sent back once, and clears on the second miss', () => {
  const asked = { stamp: { member: 'builder', predecessor_id: 'a-session', written_at: new Date(2_000).toISOString(), digest: 'x', record_length: 0, record_digest: 'y' }, text: 'a handover with no package in it', asked_at: 1_000, holds: ['synthetic-owner/repo#7'] }
  assert.deepEqual(whatBecameOfTheHandover({ ...asked, sent_back: 0, at_limit: false }), { kind: 'sent_back', missing: ['no line naming synthetic-owner/repo#7'] })
  assert.deepEqual(whatBecameOfTheHandover({ ...asked, sent_back: 1, at_limit: false }), { kind: 'cleared_anyway', missing: ['no line naming synthetic-owner/repo#7'] })
  assert.deepEqual(whatBecameOfTheHandover({ ...asked, sent_back: 0, at_limit: true }), { kind: 'cleared_anyway', missing: ['no line naming synthetic-owner/repo#7'] })
  assert.deepEqual(
    whatBecameOfTheHandover({ ...asked, text: 'it holds synthetic-owner/repo#7, at a branch and a sha', sent_back: 1, at_limit: false }),
    { kind: 'accepted', missing: [] },
  )
})

test('#255: the send-back note names what was missing and the word to answer with', () => {
  const note = theSendBackNote(['no line naming synthetic-owner/repo#7'])
  assert.ok(note.includes('no line naming synthetic-owner/repo#7'), 'the note does not say what was missing')
  assert.ok(note.includes(CREW_HANDOVER_WRITTEN), 'the note does not say which word to answer with')
})

test('#255: the handover prompt names the limit and the tool, and asks for the word', () => {
  const atTheLimit = theHandoverPrompt({ at_limit: true, percent: HANDOVER_LIMIT_PERCENT + 2 })
  assert.ok(atTheLimit.includes(`${HANDOVER_LIMIT_PERCENT}%`), 'the prompt does not name the limit')
  assert.ok(atTheLimit.includes('write_my_handover'), 'the prompt does not name the tool that writes the handover')
  assert.ok(atTheLimit.includes(CREW_HANDOVER_WRITTEN), 'the prompt does not name the word to answer with')
  assert.ok(!theHandoverPrompt({ at_limit: false, percent: 30 }).includes('handover limit'), 'a task’s end reads as the limit')
})

test('#255: two refreshes inside the window are a storm, and one outside it is not', () => {
  const now = 10 * STORM_WINDOW_MS
  assert.equal(isAStorm([now - STORM_WINDOW_MS / 2], now), true)
  assert.equal(isAStorm([now - STORM_WINDOW_MS - 1], now), false)
  assert.equal(isAStorm([], now), false)
})

test('#255: a flow past its window is stalled, and one inside it is not', () => {
  const flow = aFlow({ at: 1_000 })
  assert.equal(aFlowStalled(flow, 1_000 + FLOW_WINDOW_MS - 1), false)
  assert.equal(aFlowStalled(flow, 1_000 + FLOW_WINDOW_MS), true)
})

test('#255: a flow is kept whole in the crew’s own store, and read back as it was written', () => {
  const host = hostForTests({ crew: crewFilesDirectory(crew) })
  const place = refreshesPlace(host.host)
  assert.ok(!('refusal' in place), `the crew's store refused the flow place: ${'refusal' in place ? place.refusal : ''}`)
  assert.equal(theFlowOf(place, 'builder'), undefined)
  const flow = theFlowClearing(theFlowSentBack(aFlow(), ['no line naming a package'], 2_000), 'the-session-before', [], 3_000)
  assert.equal(keepTheFlow(place, 'builder', flow), undefined)
  assert.deepEqual(theFlowOf(place, 'builder'), flow)
  // The file is the member's own, in the flow's place: the name a launcher reads is the name it wrote.
  const names = place.names()
  assert.ok(!('refusal' in names) && names.includes(theRefreshFile('builder')), 'the flow file is not in the place it was kept in')
  const held = place.read(theRefreshFile('builder'))
  assert.ok(held !== undefined && !('refusal' in held), 'the flow the store wrote cannot be read back')
})

test('#255: a flow file that is not one is a refusal, never read as no flow', () => {
  const host = hostForTests({ crew: crewFilesDirectory(join(home, 'other-crew')) })
  const place = refreshesPlace(host.host)
  assert.ok(!('refusal' in place), 'the crew store refused the flow place')
  place.keep(theRefreshFile('builder'), 'not a flow at all\n')
  const read = theFlowOf(place, 'builder')
  assert.ok(read !== undefined && 'refusal' in read, 'a file that is not a flow was read as no flow')
})

test('#255: the flow place is one named place in the crew’s store', () => {
  assert.equal(REFRESHES_PLACE, 'refresh')
  assert.equal(theRefreshFile('builder'), 'builder.refresh.json')
  // An ended flow keeps its reason, so the owner reads why rather than only that nothing is running.
  const ended = theFlowAbandoned(theFlowDeclined(aFlow(), 'a change in hand', 2_000), 'no answer to the handover ask', 3_000)
  assert.equal(ended.phase, 'abandoned')
  assert.equal(ended.reason, 'no answer to the handover ask')
})
