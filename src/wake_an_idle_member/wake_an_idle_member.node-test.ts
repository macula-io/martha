// Waking an idle member (martha#959, #957 gap 1): when the wake fires, who is never woken, and the clock that backs off.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE_MS, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { offlineAfterMsOf, THRESHOLDS_WHEN_UNNAMED } from '../declare_crew/the_crews_thresholds.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import type { CrewPlace, ProcessOutcome } from '../host_contract/host_contract.ts'
import { type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { THE_WAKE_TEXT, theClocksIn, theClockAfter, theWakeDue, theWakeFor, theWakeOf, keepTheClocks, type TheWakeLook, type TheWakeClocks, type WakeAsked } from './wake_an_idle_member.ts'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const AFTER_MINUTES = 2
const CAP_MINUTES = 30
const OFFLINE_MS = offlineAfterMsOf(THRESHOLDS_WHEN_UNNAMED)
const AFTER = AFTER_MINUTES * MINUTE_MS
const CAP = CAP_MINUTES * MINUTE_MS

/** One member's row: idle and fresh unless the test says otherwise. */
const row = (changes: Partial<DashboardRow> = {}): DashboardRow => ({
  member: 'Ceres',
  session: 'session-Ceres',
  at: NOW,
  state: 'idle',
  holds: '',
  task: '',
  progress: { step: 0, of: 1 },
  waits: null,
  needs: '',
  host: { model: 'opus', provider: '', contextPercent: 10, costUsd: 0 },
  ...changes,
})

/** What a look holds: every member idle and its row fresh, as the heartbeat keeps it, unless the test says otherwise. */
const look = (changes: Partial<TheWakeLook> = {}): TheWakeLook => ({
  member: 'Ceres',
  row: row({ at: changes.now ?? NOW }),
  parked: false,
  routes: false,
  unheld: 2,
  now: NOW,
  windows: { after_ms: AFTER, cap_ms: CAP, offline_ms: OFFLINE_MS },
  limit_percent: 70,
  context_percent: 10,
  clock: null,
  ...changes,
})

test('#959 test 1: the wake text is the one the design names, exactly', () => {
  const said = THE_WAKE_TEXT
  assert.equal(
    said,
    'The crew mod woke this session: it is idle with nothing in hand.\n' +
      "Read any messages that came in for you and act on them, then look at the crew's work: `see_the_crew` for the rows, `unheld_work` for what nobody holds.\n" +
      'If an earlier instruction told you to stop, that stop stands over this wake-up: call `park_a_member` with your reason, say so in one line, and end your turn.',
  )
})

test('#959 test 2: an idle, live, unparked member with unheld work is woken at the window and not a millisecond before', () => {
  const begun = theClockAfter(look())
  assert.deepEqual(begun, { since: NOW, wakes: 0 }, 'the clock begins when the member is first seen idle')
  const before = look({ clock: begun, now: NOW + AFTER - 1 })
  assert.equal(theWakeDue(before), false, 'woken inside the window')
  const at = look({ clock: begun, now: NOW + AFTER })
  assert.equal(theWakeDue(at), true, 'not woken at the window')
  assert.equal(theWakeOf(at), THE_WAKE_TEXT)
})

test('#959 test 3: every member the crew must leave alone is left alone, each for its own reason', () => {
  const begun = theClockAfter(look())
  const due = { clock: begun, now: NOW + AFTER }
  assert.equal(theWakeOf(look({ ...due, parked: true })), null, 'a parked member was woken')
  assert.equal(theWakeOf(look({ ...due, routes: true })), null, 'the member who routes the work was woken')
  assert.equal(theWakeOf(look({ ...due, row: row({ state: 'working' }) })), null, 'a member holding work was woken')
  assert.equal(theWakeOf(look({ ...due, row: row({ state: 'waiting' }) })), null, 'a member waiting on someone was woken')
  assert.equal(theWakeOf(look({ ...due, unheld: 0 })), null, 'a member was woken with nothing unheld')
  assert.equal(theWakeOf(look({ ...due, row: null })), null, 'a member with no row was woken')
  assert.equal(
    theWakeOf(look({ ...due, row: row({ at: NOW - OFFLINE_MS - 1 }) })),
    null,
    'a row that has gone quiet is offline, not idle, and was woken',
  )
  assert.equal(theWakeOf(look({ ...due, windows: { after_ms: 0, cap_ms: CAP, offline_ms: OFFLINE_MS } })), null, 'a crew that turned wakes off was woken')
})

test('#959 test 4: the wait doubles per wake and stops at the declared cap', () => {
  const windows = { after_ms: AFTER, cap_ms: CAP, offline_ms: OFFLINE_MS }
  const wakeAt = (wakes: number, now: number) => theWakeDue(look({ windows, clock: { since: NOW, wakes }, now, row: row({ at: now }) }))
  assert.equal(wakeAt(1, NOW + 2 * AFTER - 1), false, 'the second wait was shorter than two windows')
  assert.equal(wakeAt(1, NOW + 2 * AFTER), true, 'the second wait did not end at two windows')
  assert.equal(wakeAt(5, NOW + CAP - 1), false, 'a capped wait ended early')
  assert.equal(wakeAt(5, NOW + CAP), true, 'a capped wait did not end at the cap')
  assert.equal(wakeAt(60, NOW + CAP), true, 'the doubling outran its cap')
})

test('#959 test 5: a wake counts itself, and a member that stops being idle starts again', () => {
  const begun = theClockAfter(look())
  const woken = theClockAfter(look({ clock: begun, now: NOW + AFTER, wake: true }))
  assert.deepEqual(woken, { since: NOW + AFTER, wakes: 1 }, 'the wake did not count itself')
  const working = look({ clock: woken, now: NOW + AFTER + MINUTE_MS, row: row({ state: 'working', at: NOW + AFTER + MINUTE_MS }) })
  assert.equal(theClockAfter(working), null, 'a member that worked kept its count')
  const again = theClockAfter(look({ now: NOW + 2 * AFTER, row: row({ at: NOW + 2 * AFTER }) }))
  assert.deepEqual(again, { since: NOW + 2 * AFTER, wakes: 0 }, 'the count did not start again after the member had worked')
})

test('#959 test 6: the clock is kept in the crew store, so a refresh does not reset it', () => {
  const kept: TheWakeClocks = { Ceres: { since: NOW + AFTER, wakes: 3 } }
  const written: { text: string } = { text: '' }
  const place = { keep: (_file: string, text: string) => { written.text = text }, read: () => ({ text: written.text }) } as unknown as CrewPlace
  assert.equal(keepTheClocks(place, kept), undefined, 'the crew store refused the clocks')
  assert.deepEqual(theClocksIn(place), kept, 'a refreshed launch did not read back what the one before it kept')
})

test('#959 test 7: a session at or above its refresh limit is not woken', () => {
  const begun = theClockAfter(look())
  const due = { clock: begun, now: NOW + AFTER }
  assert.equal(theWakeOf(look({ ...due, context_percent: 69 })), THE_WAKE_TEXT, 'a session below its limit was not woken')
  assert.equal(theWakeOf(look({ ...due, context_percent: 70 })), null, 'a session at its limit was woken')
  assert.equal(theWakeOf(look({ ...due, context_percent: 91 })), null, 'a session over its limit was woken')
})

/** A crew place held in memory, as the launcher's own store keeps one. */
function aPlace(): CrewPlace {
  const files = new Map<string, string>()
  return { path: '/a-crew-store/the-clocks', keep: (name, text) => void files.set(name, text), read: (name) => (files.has(name) ? { text: files.get(name) ?? '' } : undefined), names: () => [...files.keys()] }
}

/** gh answering one page with the issues the test hands in. */
const someIssues = (...numbers: readonly number[]) => async (): Promise<ProcessOutcome> => ({
  exit_code: 0,
  stderr: '',
  stdout: JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: numbers.map((number) => ({ number, title: 't', createdAt: '2026-11-10T00:00:00Z', body: '', repository: { nameWithOwner: 'macula-io/martha' }, labels: { nodes: [] }, timelineItems: { nodes: [] } })),
      },
    },
  }),
})

test('#959 test 8: the launcher wakes the member once, keeps its clock, and is silent on the next look', async () => {
  const place = aPlace()
  const asked = (now: number, changes: Partial<WakeAsked> = {}): WakeAsked => ({
    settings: settings(),
    member: 'Ceres',
    rows: { Ceres: row({ at: now }) },
    place,
    parked: [],
    reader: { place, run: someIssues(1, 2), now },
    now,
    context_percent: 10,
    ...changes,
  })
  assert.equal(await theWakeFor(asked(NOW)), null, 'the member was woken the moment it went idle')
  assert.equal(await theWakeFor(asked(NOW + AFTER)), THE_WAKE_TEXT, 'the member was not woken at its window')
  assert.deepEqual(theClocksIn(place), { Ceres: { since: NOW + AFTER, wakes: 1 } }, 'the wake did not keep its clock')
  assert.equal(await theWakeFor(asked(NOW + AFTER + MINUTE_MS)), null, 'the member was woken again inside its doubled wait')
})

test('#959 test 9: a crew that declared no wake, a store that will not keep a clock, and a read that failed are each silent', async () => {
  const place = aPlace()
  const at = (changes: Partial<WakeAsked> = {}): WakeAsked => ({
    settings: settings(),
    member: 'Ceres',
    rows: { Ceres: row({ at: NOW + AFTER }) },
    place,
    parked: [],
    reader: { place, run: someIssues(1, 2), now: NOW + AFTER },
    now: NOW + AFTER,
    context_percent: 10,
    ...changes,
  })
  const off = { ...settings(), house_rules: { ...settings().house_rules, wake: false } }
  assert.equal(await theWakeFor(at({ settings: off })), null, 'a crew that declared no wake was woken')
  const turnedOff = { ...settings(), house_rules: { ...settings().house_rules, wake_after_minutes: 0 } }
  assert.equal(await theWakeFor(at({ settings: turnedOff })), null, 'a crew that turned the wake off was woken')
  const noBacklog = { ...settings(), backlog: null }
  assert.equal(await theWakeFor(at({ settings: noBacklog })), null, 'a crew with no backlog was woken')
  const broke = async (): Promise<ProcessOutcome> => ({ exit_code: 1, stderr: 'gh: refused', stdout: '' })
  assert.equal(await theWakeFor(at({ reader: { place, run: broke, now: NOW + AFTER } })), null, 'a member was woken on a backlog read that failed')
  assert.equal(await theWakeFor(at({ place: { refusal: 'the crew keeps no place for these' } })), null, 'a member was woken where no clock could be kept')
  assert.equal(await theWakeFor(at({ rows: { Ceres: row({ at: NOW + AFTER }) }, parked: ['ceres'] })), null, 'a parked member was woken')
})

/** A crew that declared the wake, as `martha init` writes a team crew. */
const settings = (): CrewSettings =>
  ({
    house_rules: {
      owner_items: false,
      workspace_layout: false,
      member_work: false,
      practice: false,
      strict_gate: false,
      dashboard: false,
      refresh_between_tasks: false,
      owner_bell: false,
      nudges: false,
      wake: true,
      wake_after_minutes: AFTER_MINUTES,
      wake_cap_minutes: CAP_MINUTES,
      review_model: null,
      clones: null,
      worktrees: null,
      stalled_minutes: null,
      review_minutes: null,
      person_minutes: null,
    },
    thresholds: { ...THRESHOLDS_WHEN_UNNAMED, handover_percent: 70 },
    members: [{ name: SUPERVISOR, role: SUPERVISOR }, { name: 'Ceres', role: 'builder' }],
    mode: { may: { assign_work: ['supervisor'] } },
    owner: 'Owner',
    backlog: { places: ['macula-io'], idle_minutes: 30 },
  }) as unknown as CrewSettings

