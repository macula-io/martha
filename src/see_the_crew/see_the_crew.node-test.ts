// Every member's row, in the declaration's order, and what has gone quiet (martha#254 tests 3 and 7).
//
// The pane draws what this answers, so these tests pin the two things it must never get wrong: who is on it, and
// whether a quiet row is a working member or a dead session.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OFFLINE, OFFLINE_AFTER_MS, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { NO_MEMBER_HAS_REPORTED, PANE_CHROME_ROWS, seeTheCrew, thePaneAnsweredBy, thePaneHeader, thePaneLine, theRowsThePaneAsksFor } from './see_the_crew.ts'

const CREW = { members: [{ name: 'Vesta' }, { name: 'Uranus' }, { name: 'Terra' }] }
const NOW = 1_762_900_000_000

function beat(member: string, at: number, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: `session-${member}`,
    at,
    state: 'working',
    holds: 'macula-io/martha#254',
    task: 'Build the crew store',
    progress: { step: 2, of: 5 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 20, costUsd: 1 },
    ...changes,
  }
}

test('one row per member of the declaration, in its order, and a member that never beat reads idle (test 7)', () => {
  const seen = seeTheCrew(CREW, { Uranus: beat('Uranus', NOW - 1_000) }, NOW)

  assert.deepEqual(seen.rows.map((row) => row.member), ['Vesta', 'Uranus', 'Terra'], 'the declaration order, one row each')
  assert.equal(seen.rows[0]!.state, 'idle', 'a member that never beat is idle, not working')
  assert.equal(seen.rows[1]!.state, 'working', 'a member that beat is shown its own state')
  assert.equal(seen.rows[2]!.state, 'idle', 'and the last member is there too')
  assert.deepEqual(seen.counts, { members: 3, online: 1, working: 1, waiting: 0, needs_you: 0 }, 'the header counts what is on the crew')
})

test('a row older than OFFLINE_AFTER_MS reads offline, and one younger does not (test 3)', () => {
  const atThreshold = seeTheCrew(CREW, { Vesta: beat('Vesta', NOW - OFFLINE_AFTER_MS) }, NOW)
  assert.equal(atThreshold.rows[0]!.state, 'working', 'exactly at the threshold a row is still the member\'s own state')

  const past = seeTheCrew(CREW, { Vesta: beat('Vesta', NOW - OFFLINE_AFTER_MS - 1) }, NOW)
  assert.equal(past.rows[0]!.state, 'offline', 'one millisecond past it, the row has gone quiet')
  assert.equal(past.rows[0]!.quiet_for, OFFLINE_AFTER_MS + 1, 'and says how long it has been quiet')
  assert.equal(past.counts.online, 0, 'an offline member is not counted online')
})

test('a member whose launcher beat before it reported anything reads idle, and is still on the crew (test 7, r=1 R2)', () => {
  const seen = seeTheCrew(CREW, { Vesta: beat('Vesta', NOW - 500, { state: 'idle', task: '', holds: '', progress: { step: 0, of: 1 } }) }, NOW)

  assert.equal(seen.rows[0]!.state, 'idle', 'a fresh row that says idle reads idle, never offline and never working')
  assert.deepEqual(
    seen.counts,
    { members: 3, online: 1, working: 0, waiting: 0, needs_you: 0 },
    'and the member is counted online, because its row is fresh, though nothing is counted as working on its word alone',
  )
})

test('a member waiting on somebody keeps that wait, and a member that needs the owner is counted (test 7, the counts)', () => {
  const seen = seeTheCrew(
    CREW,
    {
      Vesta: beat('Vesta', NOW - 500, { state: 'waiting', waits: { on: 'Supervisor', for: 'a verdict', since: NOW - 60_000 } }),
      Uranus: beat('Uranus', NOW - 500, { state: 'needs-you', needs: 'a menu: land or hold' }),
    },
    NOW,
  )

  assert.deepEqual(seen.rows[0]!.waits, { on: 'Supervisor', for: 'a verdict', since: NOW - 60_000 }, 'the wait is shown as the member recorded it')
  assert.equal(seen.rows[1]!.needs, 'a menu: land or hold', 'what needs the owner is shown as the member said it')
  assert.deepEqual(seen.counts, { members: 3, online: 2, working: 0, waiting: 1, needs_you: 1 }, 'a wait and a need are each counted')
})

test('the rows the pane asks for are one per member, one more for each member that needs the owner, and the chrome (test 8)', () => {
  const seen = seeTheCrew(CREW, { Uranus: beat('Uranus', NOW - 1_000), Terra: beat('Terra', NOW - 2_000, { state: 'needs-you' }) }, NOW)

  assert.equal(theRowsThePaneAsksFor([]), PANE_CHROME_ROWS, 'a crew with no member still draws its box')
  assert.equal(theRowsThePaneAsksFor(seen.rows), 3 + 1 + PANE_CHROME_ROWS, 'one row per member, one more for the member that needs the owner, and the chrome')
})

test('the pane is answered as words: its header, and one line per member, so the mod formats nothing (martha#255)', () => {
  const seen = seeTheCrew(CREW, { Uranus: beat('Uranus', NOW - 1_000, { waits: { on: 'Supervisor', for: 'a verdict', since: NOW - 1_000 } }) }, NOW)

  assert.equal(thePaneHeader(seen.counts), '1/3 online · 0 waiting · 0 need you', 'the header is the counts, in the owner\'s words')
  const lines = seen.rows.map(thePaneLine)
  assert.equal(lines[0], 'Vesta: idle ·  0/1', 'a member that never beat is one line, and nothing else')
  assert.equal(lines[1], 'Uranus: working · Build the crew store 2/5 · macula-io/martha#254 · waits on Supervisor for a verdict', 'who, how far, what it holds, and what holds it up')
  assert.deepEqual(thePaneAnsweredBy(seeTheCrew({ members: [] }, {}, NOW), false, 1_000).lines, [NO_MEMBER_HAS_REPORTED], 'the empty pane says so, in the words the slice owns')
})

test('the pane opens by itself only when the declaration switched the dashboard on (test 8)', () => {
  const seen = seeTheCrew(CREW, {}, NOW)
  const answered = (switched_on: boolean): boolean => thePaneAnsweredBy(seen, switched_on, 1_000).open_at_start

  assert.equal(answered(true), true, 'a crew that switched the dashboard on opens the pane at a start')
  assert.equal(answered(false), false, 'a crew that did not switch it on opens nothing')
})

test('a row whose host is asking the owner something reads needs you, and is counted (martha#313)', () => {
  const asking = beat('Vesta', NOW, {
    dialogs: [{ key: 'permission::Bash:0', kind: 'permission', reads: 'permission for Bash' }],
  })
  const seen = seeTheCrew(CREW, { Vesta: asking }, NOW)
  const vesta = seen.rows[0]!
  assert.equal(vesta.state, 'needs-you', 'the host is what holds the session up, and the row says so')
  assert.equal(vesta.needs, 'permission for Bash', 'and says what for, in the host\'s own words')
  assert.equal(seen.counts.needs_you, 1, 'the header counts it')
  assert.equal(seen.counts.working, 0, 'a member being asked is not working')

  const opened_but_quiet = beat('Vesta', NOW - OFFLINE_AFTER_MS - 1, {
    dialogs: [{ key: 'permission::Bash:0', kind: 'permission', reads: 'permission for Bash' }],
  })
  assert.equal(seeTheCrew(CREW, { Vesta: opened_but_quiet }, NOW).rows[0]!.state, OFFLINE, 'a row gone quiet says so: nothing is left to answer the prompt')
})
