// The owner's `/crew-refresh` modes (martha#999 package 3, row 1), on crew-code's numbers: what each mode makes of a
// finished task, the share `on` keeps, the mode a member starts in, and what the command answers. The mode is driven
// through the crew store the host really composes on a disk, so what a launcher reads back is the file it would leave.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { aRefreshIsDue, keepTheFlow, aFlowStarting, REFRESH_MARGIN_PERCENT, refreshesPlace, type TheSessionsReading } from './refresh_a_member.ts'
import { aWaitingAsk } from './the_refresh_flow.ts'
import {
  AUTO_START_MARGIN_PERCENT,
  AUTO_TASK_PERCENT,
  DEFAULT_THRESHOLD,
  ON_PERCENT_HIGHEST,
  ON_PERCENT_LOWEST,
  keepTheMode,
  theAfterATaskOf,
  theModeFile,
  theModeOf,
  theOnPercent,
} from './the_refresh_mode.ts'
import { answerTheRefreshCommand, PACKAGE_MODE_WAITS, THE_OWNER_TYPED_NOW, theRefreshCommandIn } from './the_refresh_command.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-refresh-modes-'))
after(() => removeTheTree(home))

/** A limit far above every share below, so a finished task is judged by the mode alone. */
const A_HIGH_LIMIT = 93

/** A session that finished a task, judged by `mode`'s measure. */
const afterATask = (over: Partial<TheSessionsReading>): TheSessionsReading => ({
  percent: 10,
  limit_percent: A_HIGH_LIMIT,
  started_at_percent: 10,
  finished_report: 'a task',
  after_a_task: null,
  parked: false,
  asked: false,
  flow: undefined,
  ...over,
})

/** A fresh crew store and the member's place in it. */
function aPlace(name: string) {
  const host = hostForTests({ crew: keepTheCrewsFilesAsDirectories(join(home, name)) })
  const place = refreshesPlace(host.host)
  assert.ok(!('refusal' in place), 'the crew store refused the refresh place')
  return { host: host.host, place }
}

test("#999: crew-code's numbers, each a named constant", () => {
  assert.equal(AUTO_TASK_PERCENT, 70)
  assert.equal(AUTO_START_MARGIN_PERCENT, 5)
  assert.equal(DEFAULT_THRESHOLD, 40)
  assert.deepEqual([ON_PERCENT_LOWEST, ON_PERCENT_HIGHEST], [5, 95])
  // The declaration switch keeps Martha's own margin, unchanged (martha#999 r=2, R1).
  assert.equal(REFRESH_MARGIN_PERCENT, 10)
})

test('#999: auto refreshes after a task past 70% once grown 5 past where the session began', () => {
  const auto = theAfterATaskOf({ kind: 'auto' })
  // Began at 68, now 74: past 70 and grown 6, which the declaration switch's margin of 10 would still hold.
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 74, started_at_percent: 68, after_a_task: auto })), { due: true, trigger: 'after_a_task' })
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 72, started_at_percent: 68, after_a_task: auto })), { due: false, why: 'it has not grown past the share this session began at' })
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 66, started_at_percent: 3, after_a_task: auto })), { due: false, why: 'it is under the 70% its refresh mode refreshes at' })
  const between = theAfterATaskOf({ kind: 'between_tasks' })
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 74, started_at_percent: 68, after_a_task: between })), { due: false, why: 'it has not grown past the share this session began at' })
})

test('#999: on <percent> refreshes after a task at that share; off never does, and the limit still hands over', () => {
  const on = theAfterATaskOf({ kind: 'on', percent: 33 })
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 33, started_at_percent: 12, after_a_task: on })), { due: true, trigger: 'after_a_task' })
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 32, started_at_percent: 12, after_a_task: on })), { due: false, why: 'it is under the 33% its refresh mode refreshes at' })
  assert.equal(theAfterATaskOf({ kind: 'off' }), null)
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: 61, started_at_percent: 12 })), { due: false, why: 'its refresh mode is off' })
  assert.deepEqual(aRefreshIsDue(afterATask({ percent: A_HIGH_LIMIT, started_at_percent: 12 })), { due: true, trigger: 'at_the_limit' })
})

test('#999: on keeps a share held to 5..95, and 40 when given none or no number', () => {
  assert.equal(theOnPercent(''), 40)
  assert.equal(theOnPercent('soon'), 40)
  assert.equal(theOnPercent('0'), 40)
  assert.equal(theOnPercent('2'), 5)
  assert.equal(theOnPercent('99'), 95)
  assert.equal(theOnPercent('57'), 57)
})

test("#999: a member starts in the declaration's mode, and the owner's mode is kept per member", () => {
  const { place } = aPlace('starting')
  assert.deepEqual(theModeOf(place, 'builder', true), { kind: 'between_tasks' })
  assert.deepEqual(theModeOf(place, 'builder', false), { kind: 'off' })
  assert.equal(keepTheMode(place, 'builder', { kind: 'on', percent: 57 }), undefined)
  assert.deepEqual(theModeOf(place, 'builder', true), { kind: 'on', percent: 57 })
  // Another member keeps its own.
  assert.deepEqual(theModeOf(place, 'reviewer', true), { kind: 'between_tasks' })
  place.keep(theModeFile('reviewer'), 'not a mode\n')
  const read = theModeOf(place, 'reviewer', true)
  assert.ok('refusal' in read, 'a file that is not a mode was read as one')
})

test('#999: /crew-refresh reads its first word as the mode, as crew-code does', () => {
  assert.deepEqual(theRefreshCommandIn(' auto '), { set: { kind: 'auto' } })
  assert.deepEqual(theRefreshCommandIn('on 61'), { set: { kind: 'on', percent: 61 } })
  assert.deepEqual(theRefreshCommandIn('off'), { set: { kind: 'off' } })
  assert.deepEqual(theRefreshCommandIn('now'), { now: true })
  assert.deepEqual(theRefreshCommandIn('package all'), { package: true })
  assert.deepEqual(theRefreshCommandIn(''), { status: true })
})

test('#999: /crew-refresh sets the mode, says the status, and package names gap 22 and changes nothing', () => {
  const { host, place } = aPlace('command')
  const asked = { stores: host.stores, member: 'builder', refresh_between_tasks: false, handover_percent: 83, now: 5_000 }
  const status = answerTheRefreshCommand(asked, '')
  assert.ok('answer' in status && status.answer.startsWith('Auto-refresh is off for builder. Usage: /crew-refresh auto'), JSON.stringify(status))
  assert.ok('answer' in status && status.answer.endsWith('hands over at 83% of its limit, whatever the mode.'), JSON.stringify(status))
  assert.ok('answer' in answerTheRefreshCommand(asked, 'on 61'))
  assert.deepEqual(theModeOf(place, 'builder', false), { kind: 'on', percent: 61 })
  assert.deepEqual(answerTheRefreshCommand(asked, 'package'), { refused: PACKAGE_MODE_WAITS })
  assert.match(PACKAGE_MODE_WAITS, /gap 22/)
  assert.deepEqual(theModeOf(place, 'builder', false), { kind: 'on', percent: 61 })
  keepTheFlow(place, 'builder', { ...aFlowStarting({ trigger: 'asked', reason: 'r', at: 1, started_at_percent: 1, percent: 2, asked_on: '', refreshed_at: [Date.UTC(2026, 10, 20, 21, 7)] }), phase: 'abandoned' })
  const now = answerTheRefreshCommand(asked, '')
  assert.ok('answer' in now && now.answer.startsWith('Auto-refresh is on at 61% for builder; last refreshed 2026-11-20 21:07 UTC. '), JSON.stringify(now))
})

test('#999: /crew-refresh now leaves the ask the flow takes up at the next question', () => {
  const { host, place } = aPlace('now')
  const asked = { stores: host.stores, member: 'builder', refresh_between_tasks: true, handover_percent: 83, now: 5_000 }
  assert.equal(aWaitingAsk(place, 'builder'), undefined)
  assert.ok('answer' in answerTheRefreshCommand(asked, 'now'))
  assert.equal(aWaitingAsk(place, 'builder'), THE_OWNER_TYPED_NOW)
})
