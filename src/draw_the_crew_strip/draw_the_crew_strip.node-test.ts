// The crew strip (martha#572 T1, T2, T4): it draws exactly the reader's header and lines, what the reader answers
// wins over what a beat says, and a member whose launcher went quiet reads offline in the strip and in its title.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NO_MEMBER_HAS_REPORTED, READER_BEAT_MS, seeTheCrew, thePaneGoal, thePaneHeader, thePaneLine } from '../see_the_crew/see_the_crew.ts'
import { OFFLINE, OFFLINE_AFTER_MS, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theTabTitle } from '../title_a_members_tab/title_a_members_tab.ts'
import { drawOnce, drawTheStrip, NOTHING_DRAWN, theStripFrame, type TheStripsSeam } from './draw_the_crew_strip.ts'

const CREW = { members: [{ name: 'Vesta' }, { name: 'Uranus' }] }
const NOW = 1_762_900_000_000

function beat(member: string, at: number, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: `session-${member}`,
    at,
    state: 'working',
    holds: 'macula-io/martha#572',
    task: 'Draw the strip',
    progress: { step: 2, of: 5 },
    waits: null,
    needs: '',
    host: { model: '', provider: '', contextPercent: null, costUsd: null },
    ...changes,
  }
}

/** A seam over `beats` at the clock `now()`, recording every frame drawn and every title set. */
function seamOver(beats: Readonly<Record<string, DashboardRow>>, now: () => number, member?: string) {
  const frames: (readonly string[])[] = []
  const titles: string[] = []
  const seam: TheStripsSeam = {
    crew: CREW,
    beats: () => beats,
    clock: { now },
    draw: (frame) => void frames.push(frame),
    ...(member === undefined ? {} : { title: { member, set: (text: string) => void titles.push(text) } }),
    wait: async () => {},
  }
  return { seam, frames, titles }
}

test('T1: the strip draws exactly the reader\'s header, then one line per member in the declaration\'s order', () => {
  const seen = seeTheCrew(CREW, { Uranus: beat('Uranus', NOW - 1_000, { state: 'waiting', waits: { on: 'ci', for: 'a run', since: NOW - 1_000 } }) }, NOW)
  assert.deepEqual(theStripFrame(seen), [thePaneGoal(seen.goal), thePaneHeader(seen.counts), thePaneLine(seen.rows[0]!), thePaneLine(seen.rows[1]!)])
  assert.equal(theStripFrame(seen)[3], 'Uranus: waiting · Draw the strip 2/5 · macula-io/martha#572 · waits on ci for a run')
})

test('T1: a crew with no member draws the header and the reader\'s own words for it', () => {
  const seen = seeTheCrew({ members: [] }, {}, NOW)
  assert.deepEqual(theStripFrame(seen), [thePaneGoal(null), thePaneHeader(seen.counts), NO_MEMBER_HAS_REPORTED])
})

test('a declared goal is the strip\'s first line, above the header (martha#309)', () => {
  const withGoal = seeTheCrew({ members: [{ name: 'Vesta' }], goal: { says: 'Ship the dashboard', packages: [] } }, {}, NOW)
  assert.equal(theStripFrame(withGoal)[0], 'Goal: Ship the dashboard')
  assert.equal(theStripFrame(withGoal)[1], thePaneHeader(withGoal.counts), 'the header still follows the goal')
})

test('T2: what the reader answers is what the strip and the title show, even against the beat under it', () => {
  const seen = seeTheCrew(CREW, { Vesta: beat('Vesta', NOW - 1_000) }, NOW)
  assert.equal(seen.rows[0]!.state, 'working', 'the beat under the answer says working')
  const answered = { ...seen, rows: [{ ...seen.rows[0]!, state: OFFLINE }, seen.rows[1]!] }
  assert.equal(theStripFrame(answered)[2], 'Vesta: offline · Draw the strip 2/5 · macula-io/martha#572')
  assert.equal(theTabTitle(answered.rows[0]!), 'Vesta · offline · 2/5 · Draw the strip')
})

test('T4: a member whose launcher stopped beating past OFFLINE_AFTER_MS reads offline in its strip and its title', () => {
  let now = NOW
  const { seam, frames, titles } = seamOver({ Vesta: beat('Vesta', NOW) }, () => now, 'Vesta')

  let drawn = drawOnce(seam, NOTHING_DRAWN)
  now = NOW + OFFLINE_AFTER_MS
  drawn = drawOnce(seam, drawn)
  assert.deepEqual(titles, ['Vesta · working · 2/5 · Draw the strip'], 'at the threshold the member still reads its own state, so nothing is retitled')
  now = NOW + OFFLINE_AFTER_MS + 1
  drawn = drawOnce(seam, drawn)
  drawOnce(seam, drawn)

  assert.deepEqual(titles, ['Vesta · working · 2/5 · Draw the strip', 'Vesta · offline · 2/5 · Draw the strip'], 'one title per change, none per redraw')
  assert.equal(frames.length, 2, 'a frame is drawn when it changes, and only then')
  assert.equal(frames[1]![2], 'Vesta: offline · Draw the strip 2/5 · macula-io/martha#572')
})

test('the strip with no title setter titles nothing, and still draws', () => {
  const { seam, frames, titles } = seamOver({ Vesta: beat('Vesta', NOW) }, () => NOW)
  drawOnce(seam, NOTHING_DRAWN)
  assert.equal(frames.length, 1)
  assert.deepEqual(titles, [])
})

test('drawTheStrip looks once per reader interval and ends when it is stopped', async () => {
  const stopped = new AbortController()
  const waits: number[] = []
  const { seam, frames } = seamOver({ Vesta: beat('Vesta', NOW) }, () => NOW)
  await drawTheStrip({ ...seam, wait: async (ms) => {
    waits.push(ms)
    if (waits.length === 3) stopped.abort()
  } }, stopped.signal)
  assert.deepEqual(waits, [READER_BEAT_MS, READER_BEAT_MS, READER_BEAT_MS], 'three looks, one interval apart, then the stop')
  assert.equal(frames.length, 1, 'an unchanged crew is drawn once')
})
