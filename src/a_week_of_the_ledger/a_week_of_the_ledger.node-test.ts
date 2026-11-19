// A week of the crew's ledger, pinned on a recorded ledger (martha#308).
//
// The ledger here is rows on disk in the store the launcher really composes — one directory per stream — read back
// through the same reader the `martha week` command uses. Each figure the owner reads is pinned by name on it: the
// week's bounds, each package's cycle, its rework, its acts and its row count, the crew's totals counted once, and the
// owner's wait by the ask queue's own rule, including an ask taken, settled unticked and ticked in a later batch.
//
// A figure that changes without its row changing is what these tests exist to catch: the mutant script beside this
// package moves one row at a time and expects the figure it feeds to change.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CREW_ROWS_PLACE, CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ledgerStreamOf, readLedger } from '../log_ledger/log_ledger.ts'
import { ASKS_SETTLED, ASKS_TAKEN, ASK_QUEUED, OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  aWeekOfTheLedger,
  theBoundsOfTheWeek,
  theDurationOf,
  theLinesOf,
  theWeekOf,
  type AnAskedWeek,
  type AWeek,
  type TheWeek,
} from './a_week_of_the_ledger.ts'

const A_PACKAGE = 'synthetic-owner/repo#7'
const ANOTHER_PACKAGE = 'synthetic-owner/repo#8'
const A_PACKAGE_OF_ANOTHER_WEEK = 'synthetic-owner/repo#9'
const THE_WEEK = '2026-W47'

/** The UTC instant of a day in November 2026, at an hour and minute: the fixture's clock, in one place. */
const at = (day: number, hour = 0, minute = 0): number => Date.UTC(2026, 10, day, hour, minute)

/** A crew's streams directory on disk, removed with everything in it when the test ends. */
function aCrewRowsPlace(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-308-week-'))
  t.after(() => removeTheTree(root))
  return join(root, CREWS_PLACE, 'a-key', CREW_ROWS_PLACE)
}

/** One row of a package's ledger, kept in the store the ledger really reads. */
async function keep(stored: ReturnType<typeof rowStreamsDirectory>, package_name: string, row: Record<string, unknown>): Promise<void> {
  await stored.append(ledgerStreamOf(package_name), { package: package_name, member: 'Hygiea', ...row })
}

/**
 * The recorded ledger the figures are pinned on: `#7` carried in from the week before and landed inside the week,
 * `#8` touched twice and still open, and `#9` whose rows are all outside the week, so it is not in it at all.
 */
async function theRecordedLedger(stored: ReturnType<typeof rowStreamsDirectory>): Promise<void> {
  await keep(stored, A_PACKAGE, { kind: 'checkpoint_reached', at: at(10), note: 'carried in from the week before' })
  await keep(stored, A_PACKAGE, { kind: 'review_round_closed', at: at(17, 10), note: 'r=1 asked for two things' })
  await keep(stored, A_PACKAGE, { kind: 'act_announced', at: at(17, 11), act: { kind: 'push', what: 'the branch' } })
  await keep(stored, A_PACKAGE, { kind: 'act_concluded', at: at(17, 12), announced_at: 2, outcome: { succeeded: true, detail: 'pushed' } })
  await keep(stored, A_PACKAGE, { kind: 'recovery_decided', at: at(18, 9), act: { kind: 'push', what: 'the branch' }, failure: { class: 'a timeout', evidence: 'the run' }, inspection: { read: 'the run', found: 'a flake' }, decision: 'retried_once' })
  await keep(stored, A_PACKAGE, { kind: 'review_round_closed', at: at(18, 10), note: 'r=2 passed' })
  await keep(stored, A_PACKAGE, { kind: 'fix_shipped_after_release', at: at(19, 11), note: 'the fix after ship' })
  await keep(stored, A_PACKAGE, { kind: 'act_announced', at: at(19, 12), act: { kind: 'handoff', what: 'the verdict' } })
  await keep(stored, A_PACKAGE, { kind: 'act_concluded', at: at(19, 12, 1), announced_at: 7, outcome: { succeeded: true, detail: 'handed off' } })
  await keep(stored, A_PACKAGE, { kind: 'package_landed', at: at(20, 10), note: 'batch 77' })
  await keep(stored, A_PACKAGE, { kind: 'checkpoint_reached', at: at(24), note: 'the week after' })

  await keep(stored, ANOTHER_PACKAGE, { kind: 'review_round_closed', at: at(17, 9), note: 'r=1 still open' })
  await keep(stored, ANOTHER_PACKAGE, { kind: 'act_announced', at: at(17, 10), act: { kind: 'refresh_forced', what: 'a hung turn' } })

  await keep(stored, A_PACKAGE_OF_ANOTHER_WEEK, { kind: 'checkpoint_reached', at: at(9), note: 'before the week' })
  await keep(stored, A_PACKAGE_OF_ANOTHER_WEEK, { kind: 'checkpoint_reached', at: at(25), note: 'after the week' })
}

/**
 * The asks of the week: one answered at once, one taken and settled with it unticked and then ticked in a later batch
 * (so its wait runs to the second settle), one never ticked, and one made the week before.
 */
async function theRecordedAsks(stored: ReturnType<typeof rowStreamsDirectory>): Promise<void> {
  const ask = (since: number, question: string): Record<string, unknown> => ({ kind: ASK_QUEUED, question, asked_by: 'Hygiea', since })
  await stored.append(OWNER_ASKS_STREAM, ask(at(16, 10), 'Delete the merged branch?'))
  await stored.append(OWNER_ASKS_STREAM, ask(at(17, 10), 'A \u001bred\u001b question?'))
  await stored.append(OWNER_ASKS_STREAM, { kind: ASKS_TAKEN, asks: [0, 1], at: at(17, 11), by: 'the supervisor', session: 'a-session' })
  await stored.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 2, yes: [0], at: at(16, 10, 30), by: 'the owner' })
  await stored.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 3, yes: [1], at: at(18, 9), by: 'the owner' })
  await stored.append(OWNER_ASKS_STREAM, ask(at(18, 10), 'A third ask nobody answered?'))
  await stored.append(OWNER_ASKS_STREAM, ask(at(10), 'An ask from the week before?'))
}

/** The week read back from the recorded ledger, through the same reader the command uses. */
async function theWeekOnDisk(t: TestContext): Promise<AnAskedWeek> {
  const rows = aCrewRowsPlace(t)
  mkdirSync(rows, { recursive: true, mode: 0o700 })
  const stored = rowStreamsDirectory(rows)
  await theRecordedLedger(stored)
  await theRecordedAsks(stored)
  const host = hostForTests({ now: at(20, 12), rows: stored }).host
  const ledger = async (package_name: string) => ({ package: package_name, rows: await readLedger(host, package_name) })
  return {
    week: THE_WEEK,
    ledgers: [await ledger(A_PACKAGE), await ledger(ANOTHER_PACKAGE), await ledger(A_PACKAGE_OF_ANOTHER_WEEK)],
    asks: await host.stores.rows.read(OWNER_ASKS_STREAM),
  }
}

const answered = (answer: AWeek): TheWeek => {
  assert.ok('week' in answer, `the week was refused: ${'refused' in answer ? answer.refused : ''}`)
  return answer.week
}

test('the week stands between Monday 00:00 UTC and the Monday after, and says so in the words the owner reads', () => {
  const bounds = theBoundsOfTheWeek(THE_WEEK)
  if ('refused' in bounds) assert.fail(bounds.refused)
  assert.equal(bounds.from, at(16), 'the week did not start on Monday 16 November 00:00 UTC')
  assert.equal(bounds.to, at(23), 'the week did not end on Monday 23 November 00:00 UTC')
  assert.equal(bounds.printed, '2026-W47 (Mon 16 Nov 00:00 UTC – Mon 23 Nov 00:00 UTC)')
})

test('a word that is not a week is refused by name, and a week a year does not have is refused too', () => {
  for (const [word, expected] of [
    ['2026-47', /is not an ISO week/],
    ['2026-W1', /is not an ISO week/],
    ['2026-W00', /names week 0/],
    ['2026-W60', /names week 60/],
    ['2025-W53', /not a week of 2025/],
  ] as const) {
    const refused = theBoundsOfTheWeek(word)
    assert.ok('refused' in refused, `${word} was taken as a week`)
    assert.match(refused.refused, expected)
  }
})

test('each package of the week answers its cycle, its rework, its acts and its rows, and the week leaves out the package it did not touch', async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  assert.deepEqual(week.packages.map((one) => one.package), [A_PACKAGE, ANOTHER_PACKAGE], 'the package of another week was read into this one')

  const [carried, fresh] = week.packages
  assert.equal(carried!.carriedIn, true, 'the package carried in from the week before was not marked so')
  assert.equal(carried!.landedInTheWeek, true, 'the landing inside the week was not counted')
  assert.equal(carried!.cycleMs, at(20, 10) - at(10), 'the cycle is not the first row to the landing row')
  assert.equal(carried!.reviewRounds, 2)
  assert.equal(carried!.fixesAfterRelease, 1)
  assert.equal(carried!.recoveries, 1)
  assert.equal(carried!.retriedOnce, 1)
  assert.deepEqual(carried!.acts.by, { push: 1, handoff: 1, room_message: 0, tag: 0, refresh_forced: 0 })
  assert.equal(carried!.acts.concluded, 2)
  assert.equal(carried!.rowsWritten, 9, 'the rows inside the week are not nine')

  assert.equal(fresh!.landedAt, undefined, 'a package with no landing row was read as landed')
  assert.equal(fresh!.cycleMs, undefined)
  assert.equal(fresh!.reviewRounds, 1)
  assert.equal(fresh!.acts.by.refresh_forced, 1, 'the forced refresh was not read as one')
})

test("the crew's week counts each figure once, with a recovery counted under rework and not added again", async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  assert.deepEqual(
    {
      touched: week.crew.touched,
      landed: week.crew.landed,
      carriedIn: week.crew.carriedIn,
      stillOpen: week.crew.stillOpen,
      reviewRounds: week.crew.reviewRounds,
      fixesAfterRelease: week.crew.fixesAfterRelease,
      recoveries: week.crew.recoveries,
      retriedOnce: week.crew.retriedOnce,
      forcedRefreshes: week.crew.forcedRefreshes,
      announced: week.crew.acts.announced,
      concluded: week.crew.acts.concluded,
      attempts: week.crew.acts.attempts,
    },
    {
      touched: 2, landed: 1, carriedIn: 1, stillOpen: 1, reviewRounds: 3, fixesAfterRelease: 1,
      recoveries: 1, retriedOnce: 1, forcedRefreshes: 1, announced: 3, concluded: 2, attempts: 1,
    },
  )
  assert.deepEqual(week.crew.acts.by, { push: 1, handoff: 1, room_message: 0, tag: 0, refresh_forced: 1 })
})

test("the owner's wait is the queue's own rule: a settle that leaves an ask unticked is not an answer, and a take never is", async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  const waited = week.crew.ownersWait
  assert.equal(waited.asked, 3, 'the asks made in the week are not three')
  assert.equal(waited.answered, 2, 'the ask ticked in a later batch was not counted as answered, or the one left unticked was')
  assert.equal(waited.stillWaiting, 1)
  assert.equal(waited.totalMs, at(16, 10, 30) - at(16, 10) + (at(18, 9) - at(17, 10)), 'the waits are not the answer minus the ask')
  assert.equal(waited.longest?.ms, at(18, 9) - at(17, 10), 'the longest wait did not run to the second settle')
})

test('the view prints the week it read, says money is not in the rows, and quotes an ask with its control characters stripped', async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  const lines = theLinesOf(week)
  assert.equal(lines[0], '2026-W47 (Mon 16 Nov 00:00 UTC – Mon 23 Nov 00:00 UTC)')
  assert.equal(lines[1], 'packages: 2 touched, 1 landed, 1 carried in, 1 still open')
  assert.ok(lines.some((line) => /^money: not in the rows/.test(line)), 'the view did not say money is not in the rows')
  assert.ok(lines.some((line) => line.startsWith(`${A_PACKAGE} — cycle 10 d 10 h`)), 'a package line did not carry its cycle')
  const quoted = lines.find((line) => line.startsWith('owner wait: '))
  assert.ok(quoted !== undefined)
  assert.ok(quoted.includes('A red question?'), 'the quoted ask did not print as its own words')
  assert.ok(!quoted.includes('\u001b'), 'the quoted ask carried a control character into the owner\'s terminal')
})

test('a week with no row answers nothing in this week, and a stream the command could not use is named as skipped', () => {
  const empty = answered(aWeekOfTheLedger({ week: THE_WEEK, ledgers: [], asks: [] }))
  assert.equal(empty.crew.touched, 0)
  assert.deepEqual(empty.packages, [])
  assert.equal(theLinesOf(empty)[1], 'packages: 0 touched, 0 landed, 0 carried in, 0 still open')

  const withSkipped = answered(aWeekOfTheLedger({ week: THE_WEEK, ledgers: [], asks: [], skipped: ['ledger/not-a-package (not a package name)'] }))
  assert.ok(theLinesOf(withSkipped).some((line) => line === 'skipped: ledger/not-a-package (not a package name)'))
})

test('an instant names the ISO week it falls in, so a week nobody typed is the one the clock says', () => {
  assert.equal(theWeekOf(at(19, 12)), THE_WEEK)
  assert.equal(theWeekOf(at(16)), THE_WEEK, 'Monday 00:00 is the first instant of its week')
  assert.equal(theWeekOf(at(23) - 1), THE_WEEK, 'the last instant before the next Monday is still in the week')
  assert.equal(theWeekOf(at(23)), '2026-W48')
  assert.equal(theWeekOf(Date.UTC(2026, 11, 31)), '2026-W53', 'the last day of a 53-week year is in its last week')
  assert.equal(theWeekOf(Date.UTC(2027, 0, 1)), '2026-W53', 'a January day can belong to the week before it')
})

test('a duration is read as the owner reads it: days and hours, hours and minutes, minutes, or under a minute', () => {
  assert.equal(theDurationOf(10 * 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000), '10 d 10 h')
  assert.equal(theDurationOf(23 * 60 * 60 * 1000), '23 h 0 min')
  assert.equal(theDurationOf(30 * 60 * 1000), '30 min')
  assert.equal(theDurationOf(30 * 1000), 'under a minute')
})
