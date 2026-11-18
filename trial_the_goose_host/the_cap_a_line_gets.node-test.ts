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
import { RecordingProxy } from './record_what_goose_sends.ts'
import {
  THE_LAUNCH_BOUND_KEY, THE_MARGIN_OVER_A_ROUND_TRIP, TheModelPace, theCapFor, theLaunchesBoundMs, whyTheBoundCannotFit,
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

test('a turn is renewed on every answer, and a model gone quiet is cut at the bound it set (martha#732)', async () => {
  const pace = new TheModelPace()
  const cap = theCapFor(pace, () => 600_000)
  const startedAt = Date.now()
  const turn = withinTheCap(neverSettles(), cap)
  setTimeout(() => pace.noteAnAnswer(40), 10)
  await assert.rejects(turn, (error: unknown) => {
    assert.ok(error instanceof NoAnswerInTime)
    assert.equal(error.ms, theIdleBound(40), 'the bound is the model own answer plus its margin')
    return true
  })
  assert.ok(Date.now() - startedAt < 600_000, 'cut at the model own pace, not left to what is left of the launch')
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
  assert.throws(() => theLaunchesBoundMs(aFreshDirectory()), /the launch's bound is defined there and nowhere else/)
})
