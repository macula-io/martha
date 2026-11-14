// Handing a message to the member it is for, and counting it taken in at the next main turn (martha#253, slices 2
// and 3).
//
// These cases drive the carrier the launcher builds: what a member is handed, in what frame, what a second read
// hands, and when a message becomes "taken in" — at the first main turn start after it was handed, never at a
// subagent's (Pluto's ruling (a)). A message handed but never taken in is handed to the next session first; a message
// taken in is never handed again.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { appendToTheChannel, readTheChannel, takenInBy, type ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { carryingTo, framed, type MessageCarrier } from './hand_a_crew_message_to_its_member.ts'

/** One crew's channel, and a carrier for any member over it. */
interface Bench {
  readonly host: ChannelHost
  carrierFor(member: string): MessageCarrier
}

const bench = (): Bench => {
  const { host } = hostForTests({ now: 9_000 })
  const channel: ChannelHost = { clock: host.clock, stores: { rows: host.stores.rows } }
  return { host: channel, carrierFor: (member) => carryingTo({ member, host: channel }) }
}

const say = (bench: Bench, from: string, to: readonly string[] | 'crew', text: string): Promise<number> =>
  appendToTheChannel(bench.host, { from, to, text, sent_at: 9_000 })


test('#253: a message is handed in the exact frame [crew #<position>] <sender>: <text>', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  await say(b, 'A', ['B'], 'a hand-off')
  const carrier = b.carrierFor('B')

  // Spelled out rather than built with `framed`: a frame written by the same function that hands it would move with the
  // code and pin nothing.
  assert.equal(await carrier.next(), '[crew #0] A: a hand-off')
  await carrier.aTurnStarted()
  assert.equal(await carrier.next(), '[crew #1] A: a hand-off', 'two messages with one sender and one text were handed in the same frame')
})

test('#253: a message already handed is not handed again until it is taken in', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  await say(b, 'A', ['B'], 'a second hand-off')
  const carrier = b.carrierFor('B')

  assert.equal(await carrier.next(), '[crew #0] A: a hand-off')
  // The host queues every submit until it is idle, so a second hand of the same text while the first is unanswered
  // puts the same message in the model's context again — once per read tick. Mercurius r=1 saw ten copies of one.
  assert.equal(await carrier.next(), null, 'the same message was handed again before it was taken in')
  assert.equal(await carrier.next(), null, 'the same message was handed again before it was taken in')

  await carrier.aTurnStarted()
  assert.equal(await carrier.next(), '[crew #1] A: a second hand-off', 'nothing was handed after the first message was taken in')
})

test('#253: a message that arrives after the carrier has asked once is handed on the next ask', async () => {
  const b = bench()
  const carrier = b.carrierFor('B')
  assert.equal(await carrier.next(), null, 'an empty channel handed a message')

  await say(b, 'A', ['B'], 'arrived later')
  assert.equal(await carrier.next(), '[crew #0] A: arrived later', 'the carrier stopped reading the channel after its first ask')
})

test('#253: a message to one member is handed to that member alone', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')

  assert.equal(await b.carrierFor('B').next(), framed(0, 'A', 'a hand-off'))
  assert.equal(await b.carrierFor('A').next(), null, 'the sender was handed its own message')
})

test('#253: a message to the crew reaches every member but the sender', async () => {
  const b = bench()
  await say(b, 'A', 'crew', 'a remark')

  assert.equal(await b.carrierFor('B').next(), framed(0, 'A', 'a remark'))
  assert.equal(await b.carrierFor('C').next(), framed(0, 'A', 'a remark'))
  assert.equal(await b.carrierFor('A').next(), null, 'a crew broadcast came back to the member who sent it')
})

test('#253: a handed message is taken in when the next main turn starts, with no prompt raised back', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  const carrier = b.carrierFor('B')
  assert.equal(await carrier.next(), framed(0, 'A', 'a hand-off'))

  // The interval tick's submit into an idle session reached the model and was never raised through the prompt hook
  // (Pallas's live run on 93437b7, builder rows []). The turn the host starts is reported all the same.
  await carrier.aTurnStarted()
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [0], 'a main turn started after the hand-over and the message was not counted as taken in')
})

test("#253: a subagent's turn start never takes a handed message in; the main turn after it does", async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  const carrier = b.carrierFor('B')
  assert.equal(await carrier.next(), framed(0, 'A', 'a hand-off'))

  // A background agent's turn can start while the member is idle with a message handed: the host stamps it with the agent.
  await carrier.aTurnStarted('agent-1')
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [], "a subagent's turn start counted the member as taking the message in")
  assert.equal(await carrier.next(), null, "the message was handed again after a subagent's turn start")

  await carrier.aTurnStarted()
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [0], 'the main turn after the subagent did not take the message in')
})

test('#253: a turn start with nothing handed takes nothing in', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  const carrier = b.carrierFor('B')

  await carrier.aTurnStarted()
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [], 'a turn start counted a message that was never handed')
  assert.equal(await carrier.next(), framed(0, 'A', 'a hand-off'), 'a turn start before the hand-over lost the message')
})

test('#253: a member started again on the same streams is never handed what it already took in', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'first')
  await say(b, 'A', ['B'], 'second')
  const firstSession = b.carrierFor('B')
  assert.ok((await firstSession.next()) !== null)
  await firstSession.aTurnStarted()

  const nextSession = b.carrierFor('B')
  assert.equal(await nextSession.next(), framed(1, 'A', 'second'), 'the next session was handed a message the member had already taken in')
})

test('#253: a message handed but never taken in is the first the next session is handed', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  await b.carrierFor('B').next()

  const nextSession = b.carrierFor('B')
  assert.equal(await nextSession.next(), framed(0, 'A', 'a hand-off'), 'a message handed but never taken in was lost to the next session')
})

test('#253: a member with nothing addressed to it is handed nothing', async () => {
  const b = bench()
  await say(b, 'A', ['C'], 'not for B')
  assert.equal(await b.carrierFor('B').next(), null)
  assert.equal((await readTheChannel(b.host)).length, 1)
})
