// What a package's ledger shows of the crew's drift (martha#1010): the highest round its HANDOFF and VERDICT lines
// named, and the longest of those lines as the row kept it. The two numbers are read from the rows Martha already
// writes — nothing new is written for a round — and the send notices are built from them before a line goes out.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { noteMilestone, readLedger, sendOutwardAct } from '../log_ledger/log_ledger.ts'
import { HANDOFF_LINES_MOST, REVIEW_ROUNDS_MOST, TRIMS_WHEN_UNNAMED, type TheCrewsTrims } from '../declare_crew/the_crews_trims.ts'
import { driftOnAPackage, theDriftNotices, theDriftOf, theRoundOf } from './the_drift_on_a_package.ts'
import { readACrewLine } from './read_a_crew_line.ts'

const PACKAGE = 'macula-io/martha#1010'
const RANGE = `${'a'.repeat(40)}..${'b'.repeat(40)}`

/** The crew's mosts as a test sets them: numbers none of the defaults is, so a notice read from a default would show. */
const ROUNDS_MOST = 4
const LINES_MOST = 7
const TRIMS = { ...TRIMS_WHEN_UNNAMED, review_rounds_most: ROUNDS_MOST, handoff_lines_most: LINES_MOST }

/** A hand-off line as a member writes one, at the round and with the run ids the test names. */
const handoff = (round: number): string => `HANDOFF ${PACKAGE} ${RANGE} r=${round} ci=none:paths`

/** A verdict line as a reviewer writes one. */
const verdict = (round: number): string => `VERDICT ${PACKAGE} PASS ${RANGE} r=${round} ci=none:paths req=0`

/** A channel-and-ledger host holding nothing. */
const aHost = () => hostForTests({ now: 1_000 }).host

/** A hand-off as the ledger keeps it: announced, sent and concluded, with the lines the message had. */
async function aHandoffRow(host: ReturnType<typeof aHost>, member: string, round: number, lines: number): Promise<void> {
  await sendOutwardAct(host, { package: PACKAGE, member, act: { kind: 'handoff', what: handoff(round) }, lines }, async () => 'sent')
}

test('#1010: the rounds and the longest line come from the HANDOFF and VERDICT rows, and from no other row', async () => {
  const host = aHost()
  await aHandoffRow(host, 'Vesta', 1, 4)
  await noteMilestone(host, { package: PACKAGE, member: 'Mars', milestone: 'verdict_given', note: verdict(2), lines: 6 })
  // A milestone that is not a line at all: its note carries an `r=` in a sentence, and no round is read from it.
  await noteMilestone(host, { package: PACKAGE, member: 'Mars', milestone: 'review_round_closed', note: 'round 9 closed, in words' })

  const drift = driftOnAPackage(await readLedger(host, PACKAGE), PACKAGE)
  assert.equal(drift.rounds, 2, 'the highest round a HANDOFF or VERDICT line named')
  assert.equal(drift.rounds_member, 'Mars', 'the member whose line reached it')
  assert.equal(drift.longest, 6, 'the longest line the rows kept')
  assert.equal(drift.longest_member, 'Mars')
})

test('#1010: a package whose rows kept no line count reads no longest line', async () => {
  const host = aHost()
  await noteMilestone(host, { package: PACKAGE, member: 'Mars', milestone: 'verdict_given', note: verdict(1) })

  const drift = await theDriftOf(host, PACKAGE)
  assert.equal(drift.longest, 0, 'a row an earlier release wrote carries no lines, and 0 is no line kept')
})

test('#1010: the round a line names is read from the line, and a line that reads as none names none', async () => {
  assert.equal(theRoundOf(readACrewLine(handoff(3)).line!), 3)
  assert.equal(theRoundOf(readACrewLine(verdict(4)).line!), 4)
})

test('#1010: a round past the crew\'s most is a notice, and a round up to it is not', async () => {
  const host = aHost()
  await aHandoffRow(host, 'Vesta', 1, 2)
  const drift = await theDriftOf(host, PACKAGE)

  assert.deepEqual(theDriftNotices({ verb: 'VERDICT', round: ROUNDS_MOST, lines: 1 }, drift, TRIMS), [], 'a round at the crew\'s most is inside it')
  assert.deepEqual(
    theDriftNotices({ verb: 'VERDICT', round: ROUNDS_MOST + 1, lines: 1 }, drift, TRIMS),
    [`this is round ${ROUNDS_MOST + 1}; the crew's most is ${ROUNDS_MOST}.`],
  )
})

test('#1010: a line past the crew\'s most is a notice naming what it is and how long', async () => {
  const drift = await theDriftOf(aHost(), PACKAGE)

  assert.deepEqual(theDriftNotices({ verb: 'HANDOFF', round: 1, lines: LINES_MOST }, drift, TRIMS), [], 'a line at the crew\'s most is inside it')
  assert.deepEqual(
    theDriftNotices({ verb: 'HANDOFF', round: 1, lines: LINES_MOST + 21 }, drift, TRIMS),
    [`this HANDOFF is ${LINES_MOST + 21} lines; the crew's most is ${LINES_MOST}.`],
  )
})

test('#1010: 0 is no fixed line and false is notices off, so neither raises one', async () => {
  const host = aHost()
  await aHandoffRow(host, 'Vesta', 30, 300)
  const drift = await theDriftOf(host, PACKAGE)

  const noLine: TheCrewsTrims = { ...TRIMS_WHEN_UNNAMED, [REVIEW_ROUNDS_MOST]: 0, [HANDOFF_LINES_MOST]: 0 }
  assert.deepEqual(theDriftNotices({ verb: 'HANDOFF', round: 31, lines: 301 }, drift, noLine), [], '0 is no fixed line')

  const off: TheCrewsTrims = { ...TRIMS_WHEN_UNNAMED, [REVIEW_ROUNDS_MOST]: false, [HANDOFF_LINES_MOST]: false }
  assert.deepEqual(theDriftNotices({ verb: 'HANDOFF', round: 31, lines: 301 }, drift, off), [], 'false turns the notices off')
})
