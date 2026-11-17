// Where a crew's messages live: one stream, append-only, and what a member took in beside it (martha#253, slice 1).
//
// These cases pin the store the rest of the channel reads: a message is its position, two sends at once both land,
// a message named for a member or for the whole crew is addressed to it, and what a member took in is kept in that
// member's own stream — keyed by the member's name, never by a session's.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { Row } from '../host_contract/host_contract.ts'
import {
  CHANNEL_STREAM,
  addressedTo,
  appendToTheChannel,
  isChannelRow,
  keepTakenIn,
  readTheChannel,
  takenInBy,
  takenStreamOf,
  tookInRowsOf,
  THE_WHOLE_CREW,
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
  const second = await appendToTheChannel(channel, message('B', THE_WHOLE_CREW, 'a verdict'))

  assert.equal(first, 0)
  assert.equal(second, 1)
  assert.deepEqual(await readTheChannel(channel), [
    { position: 0, message: message('A', ['B'], 'a hand-off') },
    { position: 1, message: message('B', THE_WHOLE_CREW, 'a verdict') },
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
  assert.equal(addressedTo(message('A', THE_WHOLE_CREW, 'to all'), 'C'), true)
  assert.equal(addressedTo(message('A', ['B', 'C'], 'to two'), 'C'), true)
})

// The word as a stored row carries it (martha#468): a row on disk says `to: 'crew'`, and the channel must read it as the
// whole crew rather than drop it. Spelled out here on purpose — an import would agree with any spelling of the constant,
// so the pin is the literal, declared in ./coincidences.ts.
test('#468: a stored row that says the whole-crew word is a channel row, and is for every member', () => {
  const stored: Row = { from: 'A', to: 'crew', text: 'to all', sent_at: 4_242 }
  assert.equal(isChannelRow(stored), true)
  assert.equal(addressedTo({ to: 'crew' }, 'B'), true)
  assert.equal(addressedTo({ to: 'crew' }, 'C'), true)
})

test('#253: what a member took in is kept per member, by position', async () => {
  const channel = host()
  const position = await appendToTheChannel(channel, message('A', ['B'], 'a hand-off'))
  await keepTakenIn(channel, 'B', position)

  assert.equal(takenStreamOf('B'), `${CHANNEL_STREAM}_taken/B`, 'a member\'s take-in stream does not hang off the channel\'s own stream')
  assert.deepEqual([...(await takenInBy(channel, 'B'))], [position])
  assert.deepEqual([...(await takenInBy(channel, 'C'))], [], 'one member taking a message in said nothing about another')
})

test('#253: a message taken in twice is two rows, and one position', async () => {
  const channel = host()
  const position = await appendToTheChannel(channel, message('A', ['B'], 'a hand-off'))
  await keepTakenIn(channel, 'B', position)
  await keepTakenIn(channel, 'B', position)

  // What the carrier does while its take-in never fires: it offers the same message again. The set a receipt reads
  // cannot see that, which is why a check that says "once" counts the rows.
  assert.deepEqual([...(await takenInBy(channel, 'B'))], [position], 'the set of positions is the same however many times it was taken in')
  assert.deepEqual(await tookInRowsOf(channel, 'B'), [position, position], 'the second take-in of one message was not kept as a row of its own')
})

test('#253: a stream another code wrote into is not read as messages', async () => {
  const channel = host()
  await channel.stores.rows.append(CHANNEL_STREAM, { something_else: 1 })
  assert.deepEqual(await readTheChannel(channel), [])
  assert.equal(isChannelRow({ from: 'A', to: THE_WHOLE_CREW, text: 'x', sent_at: 1 }), true)
  assert.equal(isChannelRow({ from: 'A', to: 'everyone', text: 'x', sent_at: 1 }), false)
})
