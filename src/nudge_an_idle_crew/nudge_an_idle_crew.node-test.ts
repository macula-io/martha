// Idle members beside unheld work (martha#319, package B): when the nudge fires, and who never counts.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BACKLOG, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, ProcessOutcome } from '../host_contract/host_contract.ts'
import { theNudgeLine } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { OFFLINE_AFTER_MS, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { UNHELD_IDLE_FILE, theIdleClockAfter, theUnheldNudgesFor, unheldNudges, type UnheldNudgesAsked } from './nudge_an_idle_crew.ts'

const NOW = Date.parse('2026-11-16T12:00:00Z')
const IDLE_MINUTES = 30
const WINDOW = IDLE_MINUTES * MINUTE_MS

/** One member's row: idle and fresh unless the test says otherwise. */
const row = (member: string, changes: Partial<DashboardRow> = {}): DashboardRow => ({
  member,
  session: `session-${member}`,
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

const at = (now: number, rows: readonly DashboardRow[], changes: { parked?: readonly string[]; unheld?: number } = {}) => ({
  rows: rows.map((one) => ({ ...one, at: now })),
  parked: changes.parked ?? [],
  receivers: ['Supervisor'],
  unheld: changes.unheld ?? 2,
  now,
})

test('#319 B test 4: the nudge fires once the window has passed, not before, and keeps its start while the condition holds', () => {
  const started = theIdleClockAfter({}, at(NOW, [row('Vesta')]))
  assert.deepEqual(unheldNudges(started, IDLE_MINUTES, 2, NOW + WINDOW - 1), [], 'the nudge fired inside the window')
  const held = theIdleClockAfter(started, at(NOW + WINDOW, [row('Vesta')]))
  const fired = unheldNudges(held, IDLE_MINUTES, 2, NOW + WINDOW)
  assert.deepEqual(fired, [{ kind: 'unheld', member: 'Vesta', package: '', since: NOW, unheld: 2 }])
  const later = theIdleClockAfter(held, at(NOW + 3 * WINDOW, [row('Vesta')]))
  assert.deepEqual(unheldNudges(later, IDLE_MINUTES, 2, NOW + 3 * WINDOW), fired, 'the nudge changed while the condition held')
})

test('#319 B test 4: the clock starts again only after the condition ended: the member worked, or nothing was left unheld', () => {
  const started = theIdleClockAfter({}, at(NOW, [row('Vesta')]))
  const working = theIdleClockAfter(started, at(NOW + WINDOW, [row('Vesta', { state: 'working' })]))
  assert.deepEqual(working, {})
  const again = theIdleClockAfter(working, at(NOW + 2 * WINDOW, [row('Vesta')]))
  assert.deepEqual(again, { Vesta: NOW + 2 * WINDOW })
  assert.deepEqual(theIdleClockAfter(again, at(NOW + 3 * WINDOW, [row('Vesta')], { unheld: 0 })), {}, 'a member stayed idle beside no unheld work')
})

test('#319 B test 5: a parked member, an offline one, and the Supervisor never count as idle', () => {
  const rows = [row('Vesta'), row('Mars'), row('Supervisor')]
  const clock = theIdleClockAfter({}, at(NOW, rows, { parked: ['vesta'] }))
  assert.deepEqual(Object.keys(clock), ['Mars'], 'a parked member or the receiver was counted idle')
  const offline = theIdleClockAfter({}, { ...at(NOW, []), rows: [row('Mars', { at: NOW - OFFLINE_AFTER_MS - 1 })] })
  assert.deepEqual(offline, {}, 'a member whose row went quiet was counted idle')
})

test('#319 B: a window of 0 turns the nudge off, and its line carries a declared name and a count, never issue text', () => {
  assert.deepEqual(unheldNudges({ Vesta: NOW - 10 * WINDOW }, 0, 2, NOW), [])
  const [nudge] = unheldNudges({ Vesta: NOW - WINDOW }, IDLE_MINUTES, 3, NOW)
  assert.ok(nudge !== undefined)
  assert.equal(theNudgeLine(nudge, { owner: 'Owner', members: [{ name: 'Vesta' }] }), '- unheld: Vesta idle beside 3 issues nobody holds, since 11:30 UTC')
})

/** A crew place held in memory. */
function aPlace(): CrewPlace {
  const files = new Map<string, string>()
  return { path: `/a-crew-store/${BACKLOG}`, keep: (name, text) => void files.set(name, text), read: (name) => (files.has(name) ? { text: files.get(name) ?? '' } : undefined), names: () => [...files.keys()] }
}

/** gh answering one page with two unheld issues. */
const twoUnheld = async (): Promise<ProcessOutcome> => ({
  exit_code: 0,
  stderr: '',
  stdout: JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [1, 2].map((number) => ({ number, title: 't', createdAt: '2026-11-10T00:00:00Z', body: '', repository: { nameWithOwner: 'macula-io/martha' }, labels: { nodes: [] }, timelineItems: { nodes: [] } })),
      },
    },
  }),
})

const asked = (place: CrewPlace, now: number, changes: Partial<UnheldNudgesAsked> = {}): UnheldNudgesAsked => ({
  backlog: { places: ['macula-io'], idle_minutes: IDLE_MINUTES },
  members: ['Supervisor', 'Vesta'],
  reader: { place, run: twoUnheld, now },
  rows: [row('Vesta', { at: now })],
  parked: [],
  receivers: ['Supervisor'],
  ...changes,
})

test('#319 B test 4: the start time survives a refresh, because the crew store keeps it and nothing in memory does', async () => {
  const place = aPlace()
  assert.deepEqual(await theUnheldNudgesFor(asked(place, NOW)), [])
  assert.ok(place.read(UNHELD_IDLE_FILE) !== undefined, 'the idle clock was not kept in the crew store')
  // A refreshed launcher holds nothing from the one before it: only the place carries the clock across.
  const after = await theUnheldNudgesFor(asked(place, NOW + WINDOW))
  assert.deepEqual(after, [{ kind: 'unheld', member: 'Vesta', package: '', since: NOW, unheld: 2 }])
})

test('#319 B: a crew with no backlog, or a window of 0, keeps no clock and asks GitHub nothing', async () => {
  const place = aPlace()
  let calls = 0
  const counting = async (): Promise<ProcessOutcome> => ((calls += 1), await twoUnheld())
  assert.deepEqual(await theUnheldNudgesFor(asked(place, NOW, { backlog: null, reader: { place, run: counting, now: NOW } })), [])
  assert.deepEqual(await theUnheldNudgesFor(asked(place, NOW, { backlog: { places: ['macula-io'], idle_minutes: 0 }, reader: { place, run: counting, now: NOW } })), [])
  assert.equal(calls, 0)
  assert.equal(place.read(UNHELD_IDLE_FILE), undefined)
})
