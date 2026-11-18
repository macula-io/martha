// The bound a trial turn gets, made from the model's own pace (macula-io/martha#732).
//
// This exists because a fixed bound cost line 4 its verdict: the model spent 141 s of silence on one tool call,
// the turn needed three requests, and a bound sized for one cut it off and read not-observed. The rule these
// cases pin: a turn is bounded by the model's slowest answer so far times the requests the line's turn makes,
// renewed on every answer, and a line whose requests cannot fit the launch's own bound is named with the
// arithmetic instead of being launched to be cut off.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { NoAnswerInTime, withinTheCap } from './a_turn_with_goose.ts'
import {
  REQUESTS_IN_ONE_TURN, THE_LAUNCH_BOUND_KEY, TheModelPace, requestsOf, theCapFor, theLaunchesBoundMs,
  whyALineCannotFitItsRequests,
} from './the_cap_a_line_gets.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

const made: string[] = []

after(() => {
  for (const directory of made) removeTheTree(directory)
})

function aFreshDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'martha-732-'))
  made.push(directory)
  return directory
}

/** A promise that never settles: a turn that stalls with nothing left to say. */
const neverSettles = (): Promise<void> => new Promise(() => undefined)

test('a line whose turn makes one request gets the model pace, and line 4 gets its three (martha#732)', () => {
  const pace = new TheModelPace()
  pace.noteAnAnswer(50_000)
  assert.equal(requestsOf(4) > requestsOf(1), true, 'line 4 makes more requests than a one-request line')
  assert.equal(theCapFor(4, pace, 600_000).ms(), requestsOf(4) * 50_000)
  assert.equal(theCapFor(1, pace, 600_000).ms(), REQUESTS_IN_ONE_TURN * 50_000)
})

test('before an answer has landed the bound is the launch own (martha#732)', () => {
  const cap = theCapFor(4, new TheModelPace(), 600_000)
  assert.equal(cap.ms(), 600_000, 'nothing is measured yet, so the launch own bound is the only one there is')
  assert.equal(cap.made().fits, true)
})

test('a line whose requests cannot fit the launch own bound is named with the arithmetic (martha#732)', () => {
  const pace = new TheModelPace()
  pace.noteAnAnswer(50_000)
  const made = theCapFor(4, pace, 120_000).made()
  assert.equal(made.fits, false, 'three requests at 50 s do not fit inside two minutes')
  assert.match(whyALineCannotFitItsRequests(made) ?? '', /^3 requests at 50000 ms a round-trip is 150000 ms, beyond the 120000 ms bound$/)
})

test('an answer that lands puts the turn under the pace it set, not the launch own bound (martha#732)', async () => {
  const pace = new TheModelPace()
  // The launch's own bound to start under, as a turn begins; the answer that lands inside it is the model
  // saying how long it takes, and that is what the turn waits under from then on.
  const cap = theCapFor(4, pace, 600)
  const startedAt = Date.now()
  const turn = withinTheCap(neverSettles(), cap)
  setTimeout(() => pace.noteAnAnswer(40), 10)
  await assert.rejects(turn, (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime)
    assert.equal(error.ms, requestsOf(4) * 40, 'renewed: the bound is the answers so far, times the requests')
    return true
  })
  const waited = Date.now() - startedAt
  assert.ok(waited < 600, `the turn was cut at the pace it set (${String(waited)} ms), not left to the launch own bound`)
})

test('a turn that stalls is cut at the pace the model itself set (martha#732)', async () => {
  const pace = new TheModelPace()
  const cap = theCapFor(1, pace, 10_000)
  pace.noteAnAnswer(20)
  await assert.rejects(withinTheCap(new Promise<void>(() => undefined), cap), (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime)
    assert.equal(error.ms, requestsOf(1) * 20, 'the bound is the model pace times the requests the turn makes')
    return true
  })
})

test('the launch own bound is read from the environment the runner exports, else from the fork pins (martha#732)', () => {
  const fork = aFreshDirectory()
  const pins = join(fork, 'martha', 'sync', 'pins.env')
  mkdirSync(dirname(pins), { recursive: true })
  writeFileSync(pins, `TRIAL_LINES=1,2,3\n${THE_LAUNCH_BOUND_KEY}=7\n`)
  assert.equal(theLaunchesBoundMs(fork, {}), 7 * 60_000, 'the fork pins say it, so that is what it is')
  assert.equal(theLaunchesBoundMs(fork, { [THE_LAUNCH_BOUND_KEY]: '9' }), 9 * 60_000,
    'the runner exports it from the same pins, and the environment wins over the file it came from')
  const noPins = aFreshDirectory()
  assert.equal(theLaunchesBoundMs(noPins, {}), undefined, 'nothing says it, so nothing is invented')
})
