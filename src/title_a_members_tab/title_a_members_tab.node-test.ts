// A member's tab title (martha#572 T3): made from the reader's row alone, marked when the member needs the owner, with
// what a terminal would act on taken out of the member's own words, and set once per change.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SHOWN_STATES, seeTheCrew, type CrewRow } from '../see_the_crew/see_the_crew.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { NEEDS_YOU_MARK, theTabTitle, theTitleToSet } from './title_a_members_tab.ts'

const NOW = 1_762_900_000_000

const BEAT: DashboardRow = {
  member: 'Vesta',
  session: 'session-Vesta',
  at: NOW - 1_000,
  state: 'working',
  holds: 'macula-io/martha#572',
  task: 'Draw the strip',
  progress: { step: 2, of: 5 },
  waits: null,
  needs: '',
  host: { model: '', provider: '', contextPercent: null, costUsd: null },
}

/** Vesta's row as the reader answers it, with `changes` laid over it. */
function rowOf(changes: Partial<CrewRow> = {}): CrewRow {
  const seen = seeTheCrew({ members: [{ name: 'Vesta' }] }, { Vesta: BEAT }, NOW)
  return { ...seen.rows[0]!, ...changes }
}

test('T3: each shown state is the title\'s state, and only needs-you carries the mark', () => {
  for (const state of SHOWN_STATES) {
    const mark = state === 'needs-you' ? NEEDS_YOU_MARK : ''
    assert.equal(theTabTitle(rowOf({ state })), `${mark}Vesta · ${state} · 2/5 · Draw the strip`, state)
  }
})

test('T3: a member with no task is titled without an empty part', () => {
  assert.equal(theTabTitle(rowOf({ task: '', progress: { step: 0, of: 1 } })), 'Vesta · working · 0/1')
})

test('T3: what a terminal would act on is taken out of the task and the name, and nothing else is', () => {
  const task = 'Fix\u001b]2;owned\u0007 it\u009b‮ now !'
  assert.equal(theTabTitle(rowOf({ task, member: 'Ves\u0000ta' })), 'Vesta · working · 2/5 · Fix]2;owned it now!')
})

test('T3: the same answer twice sets the title once, and a change sets it again', () => {
  const rows = [rowOf()]
  const first = theTitleToSet(rows, 'Vesta', undefined)
  assert.equal(first, 'Vesta · working · 2/5 · Draw the strip', 'the first answer sets a title')
  assert.equal(theTitleToSet(rows, 'Vesta', first), undefined, 'the same answer again sets nothing')
  assert.equal(theTitleToSet([rowOf({ state: 'waiting' })], 'Vesta', first), 'Vesta · waiting · 2/5 · Draw the strip', 'a change sets it')
})

test('T3: a member not on the crew gets no title', () => {
  assert.equal(theTitleToSet([rowOf()], 'Terra', undefined), undefined)
})
