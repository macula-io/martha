// When a member's session reads its crew's channel (martha#253, slice 2 r=2).
//
// These cases pin the one rule the recorded host forced: the channel is read only while the session is idle. A tick
// during a turn asks the launcher nothing and submits nothing; an idle tick asks and submits at once; the end of a
// turn is an idle moment and reads; and a session that has just started is idle, so its first read submits.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readingTheChannelWith } from './crew_channel_reading.ts'

/** A fake engine: what the reading asked the launcher for, and what it put into the session. */
interface Bench {
  readonly reading: ReturnType<typeof readingTheChannelWith>
  readonly asked: boolean[]
  readonly submitted: string[]
  next(text: string | null): void
}

const bench = (): Bench => {
  const asked: boolean[] = []
  const submitted: string[] = []
  let answers: (string | null)[] = []
  const reading = readingTheChannelWith(
    async () => {
      asked.push(true)
      return answers.shift() ?? null
    },
    async (text) => void submitted.push(text),
  )
  return { reading, asked, submitted, next: (text) => void answers.push(text) }
}

test('#253: a session that has just started is idle, and its first read submits', async () => {
  const b = bench()
  b.next('[crew #0] reviewer: start')
  await b.reading.readWhileIdle()
  assert.deepEqual(b.submitted, ['[crew #0] reviewer: start'], 'the start of a session is an idle moment and it did not read')
})

test('#253: a tick during a turn asks the launcher nothing and submits nothing', async () => {
  const b = bench()
  b.next('[crew #0] reviewer: during the turn')
  b.reading.aTurnStarted()

  await b.reading.readWhileIdle()

  assert.deepEqual(b.asked, [], 'a tick during a turn asked the launcher')
  assert.deepEqual(b.submitted, [], 'a tick during a turn submitted a prompt')
})

test('#253: the end of a turn reads at once, and exactly once', async () => {
  const b = bench()
  b.reading.aTurnStarted()
  b.next('[crew #0] reviewer: after the turn')

  await b.reading.aTurnEnded()

  assert.deepEqual(b.submitted, ['[crew #0] reviewer: after the turn'], 'the end of a turn read, and read more than once')
  assert.equal(b.asked.length, 1)
})

test('#253: an idle tick reads and submits without a turn having ended', async () => {
  const b = bench()
  b.next('[crew #0] reviewer: while idle')
  await b.reading.readWhileIdle()
  b.next('[crew #0] reviewer: still while idle')
  await b.reading.readWhileIdle()

  assert.deepEqual(b.submitted, ['[crew #0] reviewer: while idle', '[crew #0] reviewer: still while idle'], 'an idle member that never takes a turn stopped reading')
})

test('#253: a turn that was aborted is over, and the next tick reads again', async () => {
  const b = bench()
  b.reading.aTurnStarted()
  b.next('[crew #0] reviewer: after the abort')

  await b.reading.aTurnEnded()

  assert.deepEqual(b.submitted, ['[crew #0] reviewer: after the abort'], 'an aborted turn left the session reading nothing')
})
