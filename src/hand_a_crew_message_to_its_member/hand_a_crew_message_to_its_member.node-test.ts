// Handing a message to the member it is for, and counting it taken in only when the host raises it back
// (martha#253, slices 2 and 3).
//
// These cases drive the carrier the launcher builds: what a member is handed, in what frame, what a second read
// hands, and when a message becomes "taken in" — only on the turn a mod's own submitted prompt carries, with exactly
// the text that was handed. A message handed but never raised is handed to the next session first; a message taken in
// is never handed again.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { appendToTheChannel, readTheChannel, takenInBy, type ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { turnsRaised, type TurnRaising } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { carryingTo, framed, type MessageCarrier } from './hand_a_crew_message_to_its_member.ts'

/** One crew's channel and the raising a launch would hold. */
interface Bench {
  readonly host: ChannelHost
  readonly turns: TurnRaising
  carrierFor(member: string): MessageCarrier
}

const bench = (): Bench => {
  const { host } = hostForTests({ now: 9_000 })
  const channel: ChannelHost = { clock: host.clock, stores: { rows: host.stores.rows } }
  const turns = turnsRaised()
  return { host: channel, turns, carrierFor: (member) => carryingTo({ member, host: channel, turns }) }
}

const say = (bench: Bench, from: string, to: readonly string[] | 'crew', text: string): Promise<number> =>
  appendToTheChannel(bench.host, { from, to, text, sent_at: 9_000 })

/** Gives the carrier's turn listener the moment it needs to write its taken row. */
const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Raises a turn as a mod's own submitted prompt does: origin kind `plugin`, which maps to `mcp_result`. */
const raised = async (bench: Bench, text: string): Promise<void> => {
  bench.turns.prompted(text, 'plugin', { command: false, meta: false })
  await settled()
}

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

test('#253: a message counts as taken in only when the host raises exactly the text that was handed', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  const carrier = b.carrierFor('B')
  const handed = await carrier.next()
  assert.ok(handed !== null)

  await raised(b, 'some other text the host raised')
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [], 'a turn carrying other text counted a message as taken in')

  await raised(b, handed)
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [0], 'the host raised the handed text and the message was not counted as taken in')
})

test('#253: a turn the owner typed that says the same words does not count as the member taking the message in', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'a hand-off')
  const carrier = b.carrierFor('B')
  const handed = await carrier.next()
  assert.ok(handed !== null)

  b.turns.prompted(handed, 'composer', { command: false, meta: false })
  await settled()
  assert.deepEqual([...(await takenInBy(b.host, 'B'))], [], 'typing the same words counted as the member taking the message in')
})

test('#253: a member started again on the same streams is never handed what it already took in', async () => {
  const b = bench()
  await say(b, 'A', ['B'], 'first')
  await say(b, 'A', ['B'], 'second')
  const firstSession = b.carrierFor('B')
  const handed = await firstSession.next()
  assert.ok(handed !== null)
  await raised(b, handed)

  const nextSession = b.carrierFor('B')
  assert.equal(await nextSession.next(), framed(1, 'A', 'second'), 'the next session was handed a message the member had already taken in')
})

test('#253: a message handed but never raised is the first the next session is handed', async () => {
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
