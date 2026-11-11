// Where a crew's messages live: one stream, append-only, and what a member took in beside it (martha#253, slice 1).
//
// These cases pin the store the rest of the channel reads: a message is its position, two sends at once both land,
// a message named for a member or for the whole crew is addressed to it, and what a member took in is kept in that
// member's own stream — keyed by the member's name, never by a session's.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  CHANNEL_STREAM,
  addressedTo,
  appendToTheChannel,
  isChannelRow,
  keepTakenIn,
  readTheChannel,
  takenInBy,
  takenStreamOf,
  type ChannelHost,
  type ChannelRow,
} from './crew_channel.ts'

const host = (): ChannelHost => {
  const { host } = hostForTests({ now: 4_242 })
  return { clock: host.clock, stores: { rows: host.stores.rows } }
}

const message = (from: string, to: ChannelRow['to'], text: string): ChannelRow => ({ from, to, text, sent_at: 4_242 })

test('#253: a message is kept and read back at the position that is its id', async () => {
  const channel = host()
  const first = await appendToTheChannel(channel, message('A', ['B'], 'a hand-off'))
  const second = await appendToTheChannel(channel, message('B', 'crew', 'a verdict'))

  assert.equal(first, 0)
  assert.equal(second, 1)
  assert.deepEqual(await readTheChannel(channel), [
    { position: 0, message: message('A', ['B'], 'a hand-off') },
    { position: 1, message: message('B', 'crew', 'a verdict') },
  ])
})

test('#253: two members sending at once both keep their rows', async () => {
  const channel = host()
  const [first, second] = await Promise.all([
    appendToTheChannel(channel, message('A', ['B'], 'from A')),
    appendToTheChannel(channel, message('B', ['A'], 'from B')),
  ])

  const kept = await readTheChannel(channel)
  assert.deepEqual(kept.map(({ message: held }) => held.text).sort(), ['from A', 'from B'], 'a send that found the stream moved was lost instead of appended behind it')
  assert.deepEqual([first, second].sort(), [0, 1])
})

test('#253: a message names a member, or the whole crew, and nobody else hears it', () => {
  assert.equal(addressedTo(message('A', ['B'], 'to B'), 'B'), true)
  assert.equal(addressedTo(message('A', ['B'], 'to B'), 'C'), false)
  assert.equal(addressedTo(message('A', 'crew', 'to all'), 'C'), true)
  assert.equal(addressedTo(message('A', ['B', 'C'], 'to two'), 'C'), true)
})

test('#253: what a member took in is kept per member, by position', async () => {
  const channel = host()
  const position = await appendToTheChannel(channel, message('A', ['B'], 'a hand-off'))
  await keepTakenIn(channel, 'B', position)

  assert.equal(takenStreamOf('B'), 'crew_channel_taken/B')
  assert.deepEqual([...(await takenInBy(channel, 'B'))], [position])
  assert.deepEqual([...(await takenInBy(channel, 'C'))], [], 'one member taking a message in said nothing about another')
})

test('#253: a stream another code wrote into is not read as messages', async () => {
  const channel = host()
  await channel.stores.rows.append(CHANNEL_STREAM, { something_else: 1 })
  assert.deepEqual(await readTheChannel(channel), [])
  assert.equal(isChannelRow({ from: 'A', to: 'crew', text: 'x', sent_at: 1 }), true)
  assert.equal(isChannelRow({ from: 'A', to: 'everyone', text: 'x', sent_at: 1 }), false)
})
