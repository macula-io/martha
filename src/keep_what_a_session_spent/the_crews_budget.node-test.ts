// martha#990 (gap 6 of martha#957): the crew's budget gauges, `/crew-budget`, and the budget line, as crew-code has them.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewPlace, CrewStore } from '../host_contract/host_contract.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { theHostsReadingIn } from './the_hosts_usage.ts'
import {
  BUDGET_GAUGES_PLACE,
  GAUGE_OFF,
  THE_REVIEWER_FILE,
  THE_WEEKLY_FILE,
  WEEK_MS,
  keepTheWeekly,
  theBudgetCommandAnswer,
  theBudgetCommandIn,
  theBudgetLine,
  theBudgetUsage,
  theRunOutOf,
  theSpanOf,
} from './the_crews_budget.ts'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** A reviewer model a crew declares: not a constant of this slice, so a test that passed it through is not blind. */
const REVIEWER = 'sonnet'

/** A crew store held in memory, one place per name. */
function aCrew(): CrewStore & { readonly files: (name: string) => Map<string, string> } {
  const places = new Map<string, Map<string, string>>()
  const files = (name: string): Map<string, string> => {
    const held = places.get(name) ?? new Map<string, string>()
    places.set(name, held)
    return held
  }
  const place = (name: string): CrewPlace => ({
    path: `/a-crew-store/${name}`,
    keep: (file, text) => void files(name).set(file, text),
    read: (file) => (files(name).has(file) ? { text: files(name).get(file) ?? '' } : undefined),
    names: () => [...files(name).keys()],
  })
  return { files, place }
}

/** A host's usage with one weekly window. */
const usageWith = (window: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  startedAt: NOW - HOUR_MS,
  rateLimits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: new Date(NOW + HOUR_MS).toISOString() }, { kind: 'seven_day', ...window }],
})

test('#990: the weekly share and its reset are read from the host\'s seven_day window, and a window with no reset reads as none', () => {
  const resets = NOW + 2 * DAY_MS
  const read = theHostsReadingIn(usageWith({ percentUsed: 37, resetsAt: new Date(resets).toISOString() }))
  assert.ok(typeof read !== 'string', String(read))
  assert.deepEqual(read.weekly, { percent: 37, resets_at: resets })
  const none = theHostsReadingIn(usageWith({ percentUsed: 37 }))
  assert.ok(typeof none !== 'string')
  assert.equal(none.weekly, null)
  const off = theHostsReadingIn({ startedAt: NOW, rateLimits: [] })
  assert.ok(typeof off !== 'string')
  assert.equal(off.weekly, null)
})

test('#990: a weekly window whose share or reset is malformed is refused by name, never read as none', () => {
  assert.equal(theHostsReadingIn(usageWith({ percentUsed: 'most', resetsAt: new Date(NOW).toISOString() })), "the host's seven_day window carries a share used that is not a number")
  assert.equal(theHostsReadingIn(usageWith({ percentUsed: 37, resetsAt: 'next week' })), "the host's seven_day window carries a reset that is not a time")
})

test('#990: the run-out is said only when it falls before the reset, on both sides of that edge', () => {
  // Two days into the window: at 2/7 of it used the pace ends the window exactly at the reset.
  const resets_at = NOW + 5 * DAY_MS
  const started = resets_at - WEEK_MS
  const edge = (100 * (NOW - started)) / WEEK_MS
  assert.equal(theRunOutOf({ percent: edge, resets_at }, NOW), resets_at)
  assert.equal(theBudgetLine({ percent: edge, resets_at }, null, null, NOW), `weekly ${String(edge)}% · resets in 5d`, 'a run-out at the reset itself was said to fall before it')
  const ahead = theBudgetLine({ percent: 40, resets_at }, null, null, NOW)
  assert.equal(ahead, `weekly 40% · resets in 5d · runs out in ${theSpanOf(((NOW - started) * 100) / 40 + started - NOW)}, before the reset`)
  assert.equal(theBudgetLine({ percent: 20, resets_at }, null, null, NOW), 'weekly 20% · resets in 5d', 'a pace that lasts the window said it runs out')
  assert.equal(theRunOutOf({ percent: 0, resets_at }, NOW), null, 'nothing spent yet has no run-out')
})

test('#990: the reviewer gauge is named after the declared reviewer model and says how long ago it was set', () => {
  assert.equal(theBudgetLine(null, { percent: 56, at: NOW - 3 * HOUR_MS }, REVIEWER, NOW), 'Sonnet 56% (set 3h ago)')
  assert.equal(theBudgetLine(null, { percent: 56, at: NOW }, null, NOW), '', 'a crew with no reviewer model showed a gauge')
  assert.equal(theBudgetLine(null, null, REVIEWER, NOW), '')
  assert.equal(theSpanOf(40 * MINUTE_MS), '40m')
  assert.equal(theSpanOf(MINUTE_MS / 4), '1m')
  assert.equal(theSpanOf(3 * DAY_MS), '3d')
})

test('#990: /crew-budget shows the line, sets the reviewer gauge, clears it with off, and holds a percent between 0 and 100', () => {
  const crew = aCrew()
  const usage = theBudgetUsage(REVIEWER)
  assert.equal(theBudgetCommandAnswer(crew, { gauge: '', value: '' }, REVIEWER, NOW), `No budget reading yet. ${usage}`)
  assert.equal(keepTheWeekly(crew, { percent: 12, resets_at: NOW + 6 * DAY_MS }), undefined)
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: '56' }, REVIEWER, NOW), `Budget: weekly 12% · resets in 6d · Sonnet 56% (set 1m ago). ${usage}`)
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: '140' }, REVIEWER, NOW), `Budget: weekly 12% · resets in 6d · Sonnet 100% (set 1m ago). ${usage}`)
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: '-5' }, REVIEWER, NOW), `Budget: weekly 12% · resets in 6d · Sonnet 0% (set 1m ago). ${usage}`)
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: GAUGE_OFF }, REVIEWER, NOW), `Budget: weekly 12% · resets in 6d. ${usage}`)
  assert.equal(crew.files(BUDGET_GAUGES_PLACE).get(THE_REVIEWER_FILE), 'null\n', 'off did not clear the kept gauge')
})

test('#990: /crew-budget with another gauge, a value it does not take, or any gauge on a crew with no reviewer model shows the usage alone', () => {
  const crew = aCrew()
  assert.equal(theBudgetCommandAnswer(crew, { gauge: 'opus', value: '50' }, REVIEWER, NOW), theBudgetUsage(REVIEWER))
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: 'half' }, REVIEWER, NOW), theBudgetUsage(REVIEWER))
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: '' }, REVIEWER, NOW), theBudgetUsage(REVIEWER))
  assert.equal(theBudgetCommandAnswer(crew, { gauge: REVIEWER, value: '50' }, null, NOW), theBudgetUsage(null))
  assert.equal(theBudgetUsage(null), 'Usage: /crew-budget shows the budget.')
  assert.equal(crew.files(BUDGET_GAUGES_PLACE).has(THE_REVIEWER_FILE), false, 'a refused set kept a gauge')
})

test('#990: what the owner typed is read as the gauge and its value, and a kept file that is not a gauge is shown as no reading', () => {
  assert.deepEqual(theBudgetCommandIn({ typed: `  ${REVIEWER}   56 ` }), { gauge: REVIEWER, value: '56' })
  assert.deepEqual(theBudgetCommandIn({ typed: '' }), { gauge: '', value: '' })
  assert.equal(theBudgetCommandIn({}), 'the /crew-budget ask carries no text the owner typed')
  const crew = aCrew()
  crew.files(BUDGET_GAUGES_PLACE).set(THE_WEEKLY_FILE, '{"percent":"x"}')
  assert.equal(theBudgetCommandAnswer(crew, { gauge: '', value: '' }, null, NOW), `No budget reading yet. ${theBudgetUsage(null)}`)
})
