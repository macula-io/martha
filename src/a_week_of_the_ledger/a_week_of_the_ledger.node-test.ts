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
import { ledgerStreamOf, readLedger, REFRESH_FORCED } from '../log_ledger/log_ledger.ts'
import { ASKS_SETTLED, ASKS_TAKEN, ASK_QUEUED, OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  aWeekOfTheLedger,
  theBoundsOfTheWeek,
  theDurationOf,
  theLineOfAPackage,
  theLinesOf,
  theOwnersWaitIn,
  thePackageWeek,
  theWeekOf,
  type AnAskedWeek,
  type AWeek,
  type TheWeek,
} from './a_week_of_the_ledger.ts'

const A_PACKAGE = 'synthetic-owner/repo#7'
const ANOTHER_PACKAGE = 'synthetic-owner/repo#8'
const A_PACKAGE_OF_ANOTHER_WEEK = 'synthetic-owner/repo#9'
const A_PACKAGE_LANDED_BEFORE_THE_WEEK = 'synthetic-owner/repo#10'
const THE_WEEK = '2026-W47'

/** The UTC instant of a day in November 2026, at an hour and minute: the fixture's clock, in one place. */
const at = (day: number, hour = 0, minute = 0): number => Date.UTC(2026, 10, day, hour, minute)

/** A range a verdict's line carries: two commits, forty hex digits each, as the line's own shape asks. */
const A_RANGE = `${'a'.repeat(40)}..${'b'.repeat(40)}`

/** A verdict's note as the crew's protocol writes it: the verdict that closed a review round keeps its line whole. */
const aVerdict = (package_name: string, verdict: 'PASS' | 'FAIL', round: number): string =>
  `VERDICT ${package_name} ${verdict} ${A_RANGE} r=${String(round)} ci=none:paths`

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
 * The recorded ledger the figures are pinned on: `#7` carried in from the week before and landed inside the week, with
 * a first round it failed and a second it passed, `#8` touched twice, still open, with a first round it passed and one
 * recovery sent again and one replanned, `#9` whose rows are all outside the week, so it is not in it at all, and `#10`
 * carried in and landed before the week with one row inside it. The acts are two members' (Hygiea's pushes and one
 * forced refresh, Venus's hand-off), so the per-member split has two names in it.
 */
async function theRecordedLedger(stored: ReturnType<typeof rowStreamsDirectory>): Promise<void> {
  await keep(stored, A_PACKAGE, { kind: 'checkpoint_reached', at: at(10), note: 'carried in from the week before' })
  await keep(stored, A_PACKAGE, { kind: 'review_round_closed', at: at(17, 10), note: 'r=1 asked for two things' })
  await keep(stored, A_PACKAGE, { kind: 'verdict_given', at: at(17, 10, 15), note: aVerdict(A_PACKAGE, 'FAIL', 1) })
  await keep(stored, A_PACKAGE, { kind: 'act_announced', at: at(17, 11), act: { kind: 'push', what: 'the branch' } })
  await keep(stored, A_PACKAGE, { kind: 'act_concluded', at: at(17, 12), announced_at: 3, outcome: { succeeded: true, detail: 'pushed' } })
  await keep(stored, A_PACKAGE, { kind: 'recovery_decided', at: at(18, 9), act: { kind: 'push', what: 'the branch' }, failure: { class: 'a timeout', evidence: 'the run' }, inspection: { read: 'the run', found: 'a flake' }, decision: 'retried_once' })
  await keep(stored, A_PACKAGE, { kind: 'review_round_closed', at: at(18, 10), note: 'r=2 passed' })
  await keep(stored, A_PACKAGE, { kind: 'verdict_given', at: at(18, 10, 15), note: aVerdict(A_PACKAGE, 'PASS', 2) })
  await keep(stored, A_PACKAGE, { kind: 'fix_shipped_after_release', at: at(19, 11), note: 'the fix after ship' })
  await keep(stored, A_PACKAGE, { kind: 'act_announced', at: at(19, 12), member: 'Venus', act: { kind: 'handoff', what: 'the verdict' } })
  await keep(stored, A_PACKAGE, { kind: 'act_concluded', at: at(19, 12, 1), announced_at: 9, outcome: { succeeded: true, detail: 'handed off' } })
  await keep(stored, A_PACKAGE, { kind: 'package_landed', at: at(20, 10), note: 'batch 77' })
  await keep(stored, A_PACKAGE, { kind: 'checkpoint_reached', at: at(24), note: 'the week after' })

  await keep(stored, ANOTHER_PACKAGE, { kind: 'review_round_closed', at: at(17, 9), note: 'r=1 passed' })
  await keep(stored, ANOTHER_PACKAGE, { kind: 'verdict_given', at: at(17, 9, 30), note: aVerdict(ANOTHER_PACKAGE, 'PASS', 1) })
  await keep(stored, ANOTHER_PACKAGE, { kind: 'act_announced', at: at(17, 10), act: { kind: REFRESH_FORCED, what: 'a hung turn' } })
  await keep(stored, ANOTHER_PACKAGE, { kind: 'recovery_decided', at: at(17, 11), act: { kind: 'tag', what: 'the release' }, failure: { class: 'a moved tag', evidence: 'the log' }, inspection: { read: 'the log', found: 'the tag had moved' }, decision: 'replanned' })

  await keep(stored, A_PACKAGE_LANDED_BEFORE_THE_WEEK, { kind: 'checkpoint_reached', at: at(9), note: 'the week before' })
  await keep(stored, A_PACKAGE_LANDED_BEFORE_THE_WEEK, { kind: 'package_landed', at: at(15), note: 'the week before' })
  await keep(stored, A_PACKAGE_LANDED_BEFORE_THE_WEEK, { kind: 'fix_shipped_after_release', at: at(18, 12), note: 'a fix in this week' })

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
    ledgers: [
      await ledger(A_PACKAGE),
      await ledger(ANOTHER_PACKAGE),
      await ledger(A_PACKAGE_OF_ANOTHER_WEEK),
      await ledger(A_PACKAGE_LANDED_BEFORE_THE_WEEK),
    ],
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
  assert.deepEqual(
    week.packages.map((one) => one.package),
    [A_PACKAGE_LANDED_BEFORE_THE_WEEK, A_PACKAGE, ANOTHER_PACKAGE],
    'the week did not hold exactly its own packages, sorted by name',
  )

  const carried = week.packages.find((one) => one.package === A_PACKAGE)
  const fresh = week.packages.find((one) => one.package === ANOTHER_PACKAGE)
  const landedBefore = week.packages.find((one) => one.package === A_PACKAGE_LANDED_BEFORE_THE_WEEK)
  assert.ok(carried !== undefined && fresh !== undefined && landedBefore !== undefined)

  assert.equal(carried!.carriedIn, true, 'the package carried in from the week before was not marked so')
  assert.equal(carried!.landedInTheWeek, true, 'the landing inside the week was not counted')
  assert.equal(carried!.cycleMs, at(20, 10) - at(10), 'the cycle is not the first row to the landing row')
  assert.equal(carried!.reviewRounds, 2)
  assert.equal(carried!.fixesAfterRelease, 1)
  assert.equal(carried!.recoveries, 1)
  assert.equal(carried!.retriedOnce, 1)
  assert.deepEqual(carried!.acts.by, { push: 1, handoff: 1, room_message: 0, tag: 0, refresh_forced: 0 })
  assert.equal(carried!.acts.concluded, 2)
  assert.equal(carried!.rowsWritten, 11, 'the rows inside the week are not eleven')

  assert.equal(fresh!.carriedIn, false, 'a package first touched inside the week was read as carried in')
  assert.equal(fresh!.landedAt, undefined, 'a package with no landing row was read as landed')
  assert.equal(fresh!.cycleMs, undefined)
  assert.equal(fresh!.reviewRounds, 1)
  assert.equal(fresh!.recoveries, 1)
  assert.equal(fresh!.retriedOnce, 0, 'a recovery that was replanned was counted as an attempt')
  assert.equal(fresh!.acts.by.refresh_forced, 1, 'the forced refresh was not read as one')

  assert.equal(landedBefore!.carriedIn, true)
  assert.equal(landedBefore!.landedAt, at(15), 'a landing before the week was not read as the landing')
  assert.equal(landedBefore!.landedInTheWeek, false, 'a landing before the week was counted in it')
  assert.equal(landedBefore!.cycleMs, at(15) - at(9), 'the cycle of a package landed before the week is not its own')
  assert.equal(landedBefore!.rowsWritten, 1, 'only the row inside the week is a row it wrote in it')
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
      touched: 3, landed: 1, carriedIn: 2, stillOpen: 1, reviewRounds: 3, fixesAfterRelease: 2,
      recoveries: 2, retriedOnce: 1, forcedRefreshes: 1, announced: 3, concluded: 2, attempts: 1,
    },
  )
  assert.deepEqual(week.crew.acts.by, { push: 1, handoff: 1, room_message: 0, tag: 0, refresh_forced: 1 })
})

test("the owner's wait is the queue's own rule: a settle that leaves an ask unticked is not an answer, and a take never is", async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  const waited = week.crew.ownersWait
  assert.equal(waited!.asked, 3, 'the asks made in the week are not three')
  assert.equal(waited!.answered, 2, 'the ask ticked in a later batch was not counted as answered, or the one left unticked was')
  assert.equal(waited!.stillWaiting, 1)
  assert.equal(waited!.totalMs, at(16, 10, 30) - at(16, 10) + (at(18, 9) - at(17, 10)), 'the waits are not the answer minus the ask')
  assert.equal(waited!.longest?.ms, at(18, 9) - at(17, 10), 'the longest wait did not run to the second settle')
})

test('a row after the week has not happened in it: a landing after its end leaves the package open, a settle after it leaves the ask waiting', () => {
  const bounds = theBoundsOfTheWeek(THE_WEEK)
  if ('refused' in bounds) assert.fail(bounds.refused)
  const one = thePackageWeek(A_PACKAGE, [
    { kind: 'checkpoint_reached', at: at(17), package: A_PACKAGE, member: 'Hygiea', note: 'in the week' },
    { kind: 'package_landed', at: at(26), package: A_PACKAGE, member: 'Hygiea', note: 'the week after' },
  ] as never, bounds)
  assert.ok(one !== undefined)
  assert.equal(one!.landedAt, undefined, 'a landing after the week was read as the package landing')
  assert.equal(one!.cycleMs, undefined, 'a cycle was read to a landing after the week')
  assert.equal(one!.landedInTheWeek, false)
  assert.equal(one!.lastAt, at(17), 'the last row is not the last row inside the week')

  const asks = [
    { position: 0, row: { kind: ASK_QUEUED, question: 'Q?', asked_by: 'Hygiea', since: at(18) } },
    { position: 1, row: { kind: ASKS_SETTLED, batch: 1, yes: [0], at: at(27), by: 'the owner' } },
  ] as never
  const waited = theOwnersWaitIn(asks, bounds)
  assert.equal(waited.asked, 1)
  assert.equal(waited.answered, 0, 'a settle after the week was counted as the answer')
  assert.equal(waited.stillWaiting, 1)
})

test('a week whose ask queue could not be read says so and prints no owner-wait line', () => {
  const week = answered(aWeekOfTheLedger({ week: THE_WEEK, ledgers: [], asks: undefined, skipped: ['owner_asks (could not be read: the store refused it)'] }))
  assert.equal(week.crew.ownersWait, undefined)
  const lines = theLinesOf(week)
  assert.ok(lines.every((line) => !line.startsWith('owner wait: ')), 'the view printed an owner-wait line for a queue it could not read')
  assert.ok(lines.some((line) => line === 'skipped: owner_asks (could not be read: the store refused it)'))
})

test('the view prints the week it read, says money is not in the rows, and quotes an ask with its control characters stripped', async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  const lines = theLinesOf(week)
  assert.equal(lines[0], '2026-W47 (Mon 16 Nov 00:00 UTC – Mon 23 Nov 00:00 UTC)')
  assert.equal(lines[1], 'packages: 3 touched, 1 landed, 2 carried in, 1 still open')
  assert.ok(lines.some((line) => /^money: not in the rows/.test(line)), 'the view did not say money is not in the rows')
  assert.ok(lines.some((line) => line.startsWith(`${A_PACKAGE} — cycle 10 d 10 h`)), 'a package line did not carry its cycle')
  assert.equal(
    theLineOfAPackage(week.packages.find((one) => one.package === A_PACKAGE)!),
    `${A_PACKAGE} — cycle 10 d 10 h (carried in), landed Fri 20 Nov 10:00 UTC | owner wait not in the rows | 2 review rounds, 1 fix after a release | acts 2 acts announced, 2 concluded, 1 retried | 11 rows`,
    'a package line does not read as the owner reads it, plural fixes and all',
  )
  assert.equal(
    lines.find((line) => line.startsWith('work: ')),
    'work: 3 review rounds, 2 fixes after a release, 2 recoveries (1 retried), 1 forced refresh',
    'the crew work line does not read as the owner reads it, plural fixes and all',
  )
  const quoted = lines.find((line) => line.startsWith('owner wait: '))
  assert.ok(quoted !== undefined)
  assert.ok(quoted.includes('A red question?'), 'the quoted ask did not print as its own words')
  assert.ok(!quoted.includes('\u001b'), 'the quoted ask carried a control character into the owner\'s terminal')
})

test("the first pass is the r=1 PASS and no other verdict, and the acts are split per member with the model said to be missing", async (t) => {
  const week = answered(aWeekOfTheLedger(await theWeekOnDisk(t)))
  // Three verdicts in the week: #7's FAIL at r=1, #7's PASS at r=2, and #8's PASS at r=1.
  assert.deepEqual(week.crew.firstPass, { verdicts: 3, passedAtFirst: 1 }, 'the first pass did not count the r=1 PASS and only it')
  assert.deepEqual(week.crew.members, { Hygiea: 2, Venus: 1 }, 'the week acts were not split per member')
  const lines = theLinesOf(week)
  assert.equal(lines.find((line) => line.startsWith('first pass: ')), 'first pass: 1 of 3 verdicts passed at the first round')
  assert.equal(lines.find((line) => line.startsWith('members: ')), 'members: Hygiea 2 acts, Venus 1 act')
  assert.equal(lines.find((line) => line.startsWith('model: ')), 'model: not in the rows (a row names its member, never the model)')
})

test('a week with no row answers nothing in this week, and a stream the command could not use is named as skipped', () => {
  const empty = answered(aWeekOfTheLedger({ week: THE_WEEK, ledgers: [], asks: [] }))
  assert.equal(empty.crew.touched, 0)
  assert.deepEqual(empty.packages, [])
  assert.equal(theLinesOf(empty)[1], 'packages: 0 touched, 0 landed, 0 carried in, 0 still open')
  assert.ok(theLinesOf(empty).includes('first pass: no verdict in this week'), 'a week with no verdict did not say so')
  assert.ok(theLinesOf(empty).includes('members: no act in this week'), 'a week with no act did not say so')
  assert.ok(theLinesOf(empty).includes('nothing in this week'), 'a week with no row did not say nothing is in it')

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
