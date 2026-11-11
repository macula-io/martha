// What became of each message a member sent (martha#253, slice 5).
//
// These cases pin the three states a message can read as — written, taken in by a member, not yet taken in by it —
// and that a member reads only its own sends: two senders' receipts name their own messages, never each other's.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { appendToTheChannel, keepTakenIn, type ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { whatBecameOfWhatISent } from './show_what_a_message_became.ts'

const ROSTER = ['A', 'B', 'C'] as const

const bench = (): ChannelHost => {
  const { host } = hostForTests({ now: 5_000 })
  return { clock: host.clock, stores: { rows: host.stores.rows } }
}

const say = (host: ChannelHost, from: string, to: readonly string[] | 'crew', text: string): Promise<number> =>
  appendToTheChannel(host, { from, to, text, sent_at: 5_000 })

test('#253: a message sent and not taken in reads as written, and not yet taken in', async () => {
  const host = bench()
  await say(host, 'A', ['B'], 'a hand-off')

  assert.equal(await whatBecameOfWhatISent(host, 'A', ROSTER), 'message 0 to B: written, not yet taken in by B')
})

test('#253: once the member took it in, the sender reads that it did', async () => {
  const host = bench()
  const position = await say(host, 'A', ['B'], 'a hand-off')
  await keepTakenIn(host, 'B', position)

  assert.equal(await whatBecameOfWhatISent(host, 'A', ROSTER), 'message 0 to B: written, taken in by B')
})

test('#253: a message to the whole crew reads each member\'s own state, and never the sender\'s', async () => {
  const host = bench()
  const position = await say(host, 'A', 'crew', 'to all')
  await keepTakenIn(host, 'B', position)

  assert.equal(await whatBecameOfWhatISent(host, 'A', ROSTER), 'message 0 to the whole crew: written, taken in by B, not yet taken in by C')
})

test('#253: each sender reads only its own sends', async () => {
  const host = bench()
  await say(host, 'A', ['B'], 'from A')
  await say(host, 'B', ['A'], 'from B')

  assert.equal(await whatBecameOfWhatISent(host, 'A', ROSTER), 'message 0 to B: written, not yet taken in by B')
  assert.equal(await whatBecameOfWhatISent(host, 'B', ROSTER), 'message 1 to A: written, not yet taken in by A')
})

test('#253: a member that sent nothing is told so', async () => {
  const host = bench()
  await say(host, 'A', ['B'], 'a hand-off')
  assert.equal(await whatBecameOfWhatISent(host, 'C', ROSTER), 'You have sent nothing on this crew.')
})
