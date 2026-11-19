// The bound a trial turn gets, made from the model's own pace (macula-io/martha#732, PR 733 R1-R5).
//
// This exists because a fixed bound cost line 4 its verdict: the model spent 141 s of silence on one tool call
// and a bound sized for one answer cut a turn that was still working. The rule these cases pin: a turn is cut
// when the model goes quiet for longer than it has ever taken to answer, never for being long; only the model's
// chat answers are measured, never the engine asking it which model it is; and a pace that cannot fit in what is
// left of the launch is named with the arithmetic rather than launched to be reaped.

import assert from 'node:assert/strict'
import { createServer, request as sendRequest } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { NoAnswerInTime, withinTheCap } from './a_turn_with_goose.ts'
import { THE_KILL_WAIT_MS, THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS, whenTheLaunchStarted } from './drive_the_trial.ts'
import { RecordingProxy } from './record_what_goose_sends.ts'
import {
  THE_LAUNCH_BOUND_KEY, THE_MARGIN_OVER_A_ROUND_TRIP, TheBoundCannotFitTheLaunch, TheModelPace, theCapFor, theLaunchesBoundMs,
  whyTheBoundCannotFit,
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

/** A promise that never settles: a turn that stalls with nothing more to say. */
const neverSettles = (): Promise<void> => new Promise(() => undefined)

/** The idle bound for one round-trip, as the cap makes it. */
const theIdleBound = (roundTripMs: number): number => roundTripMs + Math.round(roundTripMs * THE_MARGIN_OVER_A_ROUND_TRIP)

/** A stand-in model: `api/show` answers at once, a chat answer takes `chatMs`, as the engine's own provider asks. */
async function aStandInModel(chatMs: number): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const answer = (): void => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"done":true}')
      }
      if ((request.url ?? '').includes('api/show')) answer()
      else setTimeout(answer, chatMs)
    })
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', () => settle()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${String(port)}`,
    stop: () => new Promise<void>((settle) => server.close(() => settle())),
  }
}

/** Asks the proxy for a path, and waits for its answer, the way the engine does. */
function askThrough(url: string, path: string): Promise<number> {
  const target = new URL(path, url)
  return new Promise<number>((settle, fail) => {
    const asking = sendRequest({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST' }, (answer) => {
      answer.resume()
      answer.on('end', () => settle(answer.statusCode ?? 0))
    })
    asking.on('error', fail)
    asking.end('{}')
  })
}

test('only the model chat answers set the pace: the engine asking which model it is does not (PR 733 R1)', async () => {
  const model = await aStandInModel(400)
  const pace = new TheModelPace()
  const proxy = new RecordingProxy(model.url, { pace })
  const port = await proxy.start()
  const proxyUrl = `http://127.0.0.1:${String(port)}`
  try {
    await askThrough(proxyUrl, '/api/show')
    assert.equal(pace.theSlowestAnswerSoFar(), 0, 'the model-info answer says nothing about how long an answer takes')
    await askThrough(proxyUrl, '/v1/chat/completions')
    assert.ok(pace.theSlowestAnswerSoFar() >= 350, `the chat answer set the pace: ${String(pace.theSlowestAnswerSoFar())} ms`)
    assert.equal(proxy.answered.length, 2, 'both answers are still in the proxy own log for the evidence')
  } finally {
    await proxy.stop()
    await model.stop()
  }
})

test('the bound is the model own slowest answer plus its margin, and what is left of the launch before any (martha#732)', () => {
  const pace = new TheModelPace()
  assert.equal(theCapFor(pace, () => 600_000).ms(), 600_000, 'nothing is measured, so what is left of the launch is the bound')
  pace.noteAnAnswer(50_000)
  assert.equal(theCapFor(pace, () => 600_000).ms(), theIdleBound(50_000), 'measured, the bound is the idle one')
  pace.noteAnAnswer(80_000)
  assert.equal(theCapFor(pace, () => 600_000).ms(), theIdleBound(80_000), 'the slowest answer, not the last')
})

test('a bound the model paced too slow to fit in what is left is named with the arithmetic (PR 733 R4)', () => {
  const pace = new TheModelPace()
  pace.noteAnAnswer(200_000)
  const made = theCapFor(pace, () => 60_000).made()
  assert.equal(made.fits, false, '220 s of idle bound do not fit in the 60 s left of the launch')
  assert.equal(made.ms, 60_000, 'the bound that runs is what is left, and that is recorded')
  assert.match(whyTheBoundCannotFit(made) ?? '', /^a 200000 ms round-trip plus its 100000 ms margin is 300000 ms, beyond the 60000 ms left of the launch$/)
})

test('an answer renews a turn\'s bound and never narrows it, and a model gone quiet is still cut at the bound it set (martha#732)', async () => {
  // A turn that starts before anything is measured runs under what is left of the launch to its end: the engine's
  // own bookkeeping answer, the shortest chat it makes, lands while the turn's request is open, and measured into a
  // narrower bound it cut that request a third of a second later on the fork's run (martha#732).
  const fresh = new TheModelPace()
  const launchesOwn = theCapFor(fresh, () => WHAT_IS_LEFT_MS)
  const underTheLaunchesOwnBound = withinTheCap(neverSettles(), launchesOwn)
  setTimeout(() => fresh.noteAnAnswer(A_FAST_ANSWER_MS), THE_ANSWER_LANDS_AFTER_MS)
  await assert.rejects(underTheLaunchesOwnBound, (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime)
    assert.equal(error.ms, WHAT_IS_LEFT_MS, `the fast answer did not narrow the bound the turn was given: ${String(error.ms)} ms`)
    return true
  })
  assert.equal(launchesOwn.made().ranUnderMs, WHAT_IS_LEFT_MS, 'the result records the bound the turn ran under, not a later one')
  // A turn that starts after the model has been measured is cut at the model's own pace, not left to the launch.
  const paced = new TheModelPace()
  paced.noteAnAnswer(A_SLOW_ANSWER_MS)
  const startedAt = Date.now()
  await assert.rejects(withinTheCap(neverSettles(), theCapFor(paced, () => WHAT_IS_LEFT_MS)), (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime)
    assert.equal(error.ms, theIdleBound(A_SLOW_ANSWER_MS), 'the bound is the model own answer plus its margin')
    return true
  })
  assert.ok(Date.now() - startedAt < WHAT_IS_LEFT_MS, 'cut at the model own pace, not left to what is left of the launch')
  // What a cut leaves behind: nothing listening for the answers that land afterwards. The launch's end here is the
  // cut, but the launch itself has minutes left, so an answer that armed a bound for this turn would leave a timer
  // longer than the file and the runner fails a file that leaves one by name (martha#732: that timer is what held
  // a launch open after its verdict on the fork's run).
  const minutesAfterTheCut = new TheModelPace()
  let left = WHAT_IS_LEFT_MS
  const cutTurn = withinTheCap(neverSettles(), theCapFor(minutesAfterTheCut, () => left))
  await assert.rejects(cutTurn, (error: unknown) => error instanceof NoAnswerInTime)
  left = WHAT_IS_LEFT_MS * 1000
  minutesAfterTheCut.noteAnAnswer(A_SLOW_ANSWER_MS * 100)
  // And the same for a turn that ended on its own: an answer that lands afterwards arms nothing either.
  const minutesAfterTheEnd = new TheModelPace()
  const ended = withinTheCap(Promise.resolve('the turn ended'), theCapFor(minutesAfterTheEnd, () => left))
  assert.equal(await ended, 'the turn ended', 'the turn ended on its own')
  minutesAfterTheEnd.noteAnAnswer(A_SLOW_ANSWER_MS * 100)
})

test('a bound a turn keeps is still what is left of the launch once that is less (martha#732)', async () => {
  // The turn is given a launch that has a second left; the launch's end then comes close, and an answer renews the
  // bound. The renewal may keep the turn's own floor, never past what is left of the launch.
  const pace = new TheModelPace()
  let left = A_LAUNCH_WITH_A_SECOND_LEFT_MS
  const turn = withinTheCap(neverSettles(), theCapFor(pace, () => left))
  left = LITTLE_LEFT_MS
  setTimeout(() => pace.noteAnAnswer(A_FAST_ANSWER_MS), THE_ANSWER_LANDS_AFTER_MS)
  await assert.rejects(turn, (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime)
    assert.equal(error.ms, LITTLE_LEFT_MS,
      `the renewal is what is left of the launch, not the bound the turn started with: ${String(error.ms)} ms`)
    return true
  })
})

test('a bad launch bound is refused by name rather than becoming a bound of zero or of none (PR 733 R5)', () => {
  const forkWith = (value: string): string => {
    const fork = aFreshDirectory()
    const pins = join(fork, 'martha', 'sync', 'pins.env')
    mkdirSync(dirname(pins), { recursive: true })
    writeFileSync(pins, `TRIAL_LINES=1,2,3\n${THE_LAUNCH_BOUND_KEY}=${value}\n`)
    return fork
  }
  assert.equal(theLaunchesBoundMs(forkWith('7')), 7 * 60_000, 'a positive number of minutes is the bound')
  assert.throws(() => theLaunchesBoundMs(forkWith('')), /says nothing of TRIAL_MINUTES_PER_LAUNCH|not a positive number/)
  assert.throws(() => theLaunchesBoundMs(forkWith('x')), /not a positive number of minutes/)
  for (const zero of ['0', '0.0']) {
    assert.throws(() => theLaunchesBoundMs(forkWith(zero)), /not a positive number of minutes/, `${zero} minutes is no bound (PR 733 A3)`)
  }
  assert.throws(() => theLaunchesBoundMs(aFreshDirectory()), /the launch's bound is defined there and nowhere else/)
})

/** A model's answer, and what is left of the launch, both short enough for a unit case to wait out. */
const A_SLOW_ANSWER_MS = 200
const LITTLE_LEFT_MS = 100
/** The engine's own bookkeeping answer: the shortest chat it makes, well under any turn's bound. */
const A_FAST_ANSWER_MS = 20
/** What a launch leaves when the floor a turn keeps is what the case observes: past every idle bound above. */
const WHAT_IS_LEFT_MS = 400
/** A launch with a second left, for a case that then brings its end close before an answer renews the bound. */
const A_LAUNCH_WITH_A_SECOND_LEFT_MS = 1000
const THE_TURN_ENDS_AFTER_MS = 50
const THE_ANSWER_LANDS_AFTER_MS = 10

test('a model slower than what is left is never refused at its answer: a turn that ends inside what is left is its own (PR 733 A1)', async () => {
  const pace = new TheModelPace()
  const cap = theCapFor(pace, () => LITTLE_LEFT_MS)
  const turnEnds = new Promise<string>((settle) => setTimeout(() => settle('the turn ended'), THE_TURN_ENDS_AFTER_MS))
  const turn = withinTheCap(turnEnds, cap)
  setTimeout(() => pace.noteAnAnswer(A_SLOW_ANSWER_MS), THE_ANSWER_LANDS_AFTER_MS)
  assert.equal(await turn, 'the turn ended', 'the slow answer left the turn the time the launch still had')
})

test('a turn the launch end cuts is a NoAnswerInTime that names the arithmetic, so it reads not-observed (PR 733 A1)', async () => {
  const pace = new TheModelPace()
  const turn = withinTheCap(neverSettles(), theCapFor(pace, () => LITTLE_LEFT_MS))
  setTimeout(() => pace.noteAnAnswer(A_SLOW_ANSWER_MS), THE_ANSWER_LANDS_AFTER_MS)
  await assert.rejects(turn, (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime, String(error))
    assert.equal(error.ms, LITTLE_LEFT_MS)
    const wanted = theIdleBound(A_SLOW_ANSWER_MS)
    assert.equal(error.message, `no answer within ${LITTLE_LEFT_MS} ms, the launch's end: a ${A_SLOW_ANSWER_MS} ms round-trip plus its ${wanted - A_SLOW_ANSWER_MS} ms margin is ${wanted} ms, beyond the ${LITTLE_LEFT_MS} ms left of the launch`)
    return true
  })
})

test('only a turn that starts with nothing left of the launch is refused outright (PR 733 A1)', async () => {
  await assert.rejects(withinTheCap(neverSettles(), theCapFor(new TheModelPace(), () => 0)), TheBoundCannotFitTheLaunch)
})

test('a launch is counted from its node process start, as the runner counts it, and its end has room past the kill (PR 733 A2)', () => {
  assert.equal(whenTheLaunchStarted(0), Math.floor(performance.timeOrigin), 'the first line of a process: from the process start')
  const before = Date.now()
  const later = whenTheLaunchStarted(1)
  assert.ok(later >= before && later <= Date.now(), 'a later line of the same process: from its own start')
  assert.ok(THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS > THE_KILL_WAIT_MS, 'the room covers what follows the kill, not the kill alone')
})
