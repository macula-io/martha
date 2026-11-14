// The beat a member's running turn is asked about on (martha#311 design §4): only the main turn beats, with the id its
// start carried, and its end stops the beat; a subagent's start or end moves nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { beatingTheTurnWith, REFRESH_BEAT_MS } from './crew_turn_beat.ts'

/** A timer the test fires by hand: every beat it holds, and whether each was cancelled. */
function aHandTimer() {
  const beats: { ms: number; fn: () => void; cancelled: boolean }[] = []
  return {
    beats,
    every: (ms: number, fn: () => void) => {
      const beat = { ms, fn, cancelled: false }
      beats.push(beat)
      return { cancel: () => void (beat.cancelled = true) }
    },
  }
}

test('#311: a main turn beats with the id its start carried, and its end stops the beat', async () => {
  const timer = aHandTimer()
  const asked: string[] = []
  const beat = beatingTheTurnWith(timer.every, async (turn_id) => void asked.push(turn_id))
  beat.aTurnStarted(undefined, 'the-main-turn')
  assert.deepEqual(timer.beats.map((held) => held.ms), [REFRESH_BEAT_MS], 'the main turn did not beat on the refresh beat')
  timer.beats[0]?.fn()
  assert.deepEqual(asked, ['the-main-turn'], 'the beat did not ask about the turn its start carried')
  beat.aTurnEnded(undefined)
  assert.equal(timer.beats[0]?.cancelled, true, 'the main turn\'s end left the beat running')
})

test('#311: a subagent\'s turn never beats, and its end does not stop the main beat (mutant: drop the agentId filter)', () => {
  const timer = aHandTimer()
  const beat = beatingTheTurnWith(timer.every, async () => undefined)
  beat.aTurnStarted(undefined, 'the-main-turn')
  beat.aTurnStarted('a-subagent', 'a-subagent-turn')
  assert.equal(timer.beats.length, 1, 'a subagent\'s turn started a beat of its own')
  beat.aTurnEnded('a-subagent')
  assert.equal(timer.beats[0]?.cancelled, false, 'a subagent finishing stopped the main turn\'s beat')
})

test('#311: a start with no turn id beats nothing, and a new main turn replaces the old beat', () => {
  const timer = aHandTimer()
  const beat = beatingTheTurnWith(timer.every, async () => undefined)
  beat.aTurnStarted(undefined, '')
  assert.equal(timer.beats.length, 0, 'a turn with no id was beaten on')
  beat.aTurnStarted(undefined, 'one')
  beat.aTurnStarted(undefined, 'two')
  assert.deepEqual(timer.beats.map((held) => held.cancelled), [true, false], 'a new main turn left the old beat running beside it')
})

test('#311: a beat whose question fails does not throw out of the timer', async () => {
  const timer = aHandTimer()
  const beat = beatingTheTurnWith(timer.every, async () => {
    throw new Error('the launcher is gone')
  })
  beat.aTurnStarted(undefined, 'the-main-turn')
  assert.doesNotThrow(() => timer.beats[0]?.fn(), 'a failed question threw out of the host\'s timer')
  await new Promise((settled) => setImmediate(settled))
})
