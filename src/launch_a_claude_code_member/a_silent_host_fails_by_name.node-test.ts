// The relay job's budget counts silence, not time (martha#210).
//
// A real model request rides inside the budget, so on a busy hosted runner the runner's speed decided the verdict: run
// 42747883703 went red on `No model request 3 within 120000 ms` for a diff that job never runs, and the same tree
// passed on a re-run. These two cases are the rule the check must hold: a host that stops working fails by name, and a
// host that is only slow is never cut off by how long it takes.
//
// Neither case needs the recorded host, a terminal or the clock, so both run in every CI run and not only in the relay
// job: the wait is given a clock the test moves and a host whose output the test writes.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { HOST_SILENCE_MS, POLL_MS, waitWhileTheHostKeepsShowing } from './wait_while_the_host_keeps_showing.ts'

/** Looks a wait may take before the test calls it a wait that never gives up, rather than asking the harness.
 * Far above the slowest case here (ten budgets of looks, 12 000), so only a wait that never ends reaches it. */
const LOOKS_BEFORE_GIVING_UP = 100_000

/** The host as the wait sees it: a terminal the test writes on and a count of requests the test adds to. */
interface HostOfTheTests {
  readonly shown: () => string
  readonly heard: () => number
  /** Draws on the terminal: output the host showed because it was working. */
  draw: (text: string) => void
  /** A model request arrives from the host. */
  saysARequest: () => void
  readonly now: () => number
  /** Moves the clock by `ms`, without sleeping. */
  readonly sleep: (ms: number) => Promise<void>
}

function aHostOfTheTests(): HostOfTheTests {
  let now = 1_000_000
  let shown = ''
  let heard = 0
  return {
    shown: () => shown,
    heard: () => heard,
    draw: (text) => void (shown += text),
    saysARequest: () => void (heard += 1),
    now: () => now,
    sleep: async (ms) => void (now += ms),
  }
}

/** Fails the test rather than the harness when a wait does not end: a wait that never gives up is the thing at issue. */
const countingLooks = (host: HostOfTheTests, onLook: () => void): ((ms: number) => Promise<void>) => {
  let looks = 0
  return async (ms) => {
    looks += 1
    if (looks > LOOKS_BEFORE_GIVING_UP) throw new Error(`the wait took ${looks} looks without ending`)
    onLook()
    await host.sleep(ms)
  }
}

test('#210: a host that goes silent fails by name, saying how long nothing came and how long the run took', async () => {
  const host = aHostOfTheTests()
  // The run began a minute before this wait did, and this is the run's third wait: the figure the red reports is the
  // run's own time, so it must count that minute and not start again at this wait (martha#210 r=1).
  const run_started_at = host.now() - 60_000
  const started = host.now()
  const why = await waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: () => false,
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at,
    now: host.now,
    sleep: countingLooks(host, () => {}),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.ok(why !== undefined, 'a host that shows nothing and sends nothing must fail the wait')
  assert.match(why.message, /showed nothing new/, 'the red names silence, not a total time that passed')
  const taken = host.now() - started
  assert.ok(taken >= HOST_SILENCE_MS && taken < HOST_SILENCE_MS + 2 * POLL_MS, `the wait gave up after ${taken} ms, which is not the budget it was given`)
  assert.match(
    why.message,
    /has taken 180100 ms in all/,
    'the red reports the run\'s own time: the minute before this wait plus the silence it gave up on',
  )
})

test('#210: a host that stays slow but keeps showing new output is not cut off by how long it takes', async () => {
  const host = aHostOfTheTests()
  const started = host.now()
  const slow_run = 10 * HOST_SILENCE_MS
  const why = await waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: () => host.now() - started >= slow_run,
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at: started,
    now: host.now,
    sleep: countingLooks(host, () => host.draw('.')),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.equal(why, undefined, `a host still drawing ten times the budget was cut off: ${why?.message}`)
  assert.ok(host.now() - started >= slow_run, 'the wait ended before the slow run was done, so it proved nothing')
})

test('#210: a host that draws nothing but keeps sending model requests is progress too', async () => {
  const host = aHostOfTheTests()
  const started = host.now()
  const slow_run = 5 * HOST_SILENCE_MS
  const why = await waitWhileTheHostKeepsShowing({
    what: 'end of martha start',
    holds: () => host.now() - started >= slow_run,
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at: started,
    now: host.now,
    sleep: countingLooks(host, () => host.saysARequest()),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.equal(why, undefined, `a host still answering was cut off: ${why?.message}`)
})

test('#210: what ruled a run out is said at once, and is not reported as silence', async () => {
  const host = aHostOfTheTests()
  const before = host.now()
  const why = await waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: () => false,
    cannotHappen: () => 'the stand-in could not answer: a planted fault',
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at: before,
    now: host.now,
    sleep: countingLooks(host, () => {}),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.ok(why !== undefined)
  assert.equal(why.message, 'the stand-in could not answer: a planted fault')
  assert.equal(host.now(), before, 'a ruled-out run must be ended at once, not held for its budget')
})
