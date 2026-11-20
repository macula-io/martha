// The crew's messages as an engine member's turns (martha#511 part B): one read at a time, a message counted taken in
// once its turn ran or was refused, and a message whose turn failed handed again. Over a real carrier and channel, in
// a test host's rows, and a turn queue this test answers.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { carryingTo } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { framed } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { appendToTheChannel, takenInBy, type ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { THE_ARRIVAL_OF_A_CREW_MESSAGE, theCrewsMessagesAsTurns } from './the_crews_messages_as_turns.ts'
import type { ATurnToSend, TheEngineMembersTurns, WhatATurnDid } from './the_engine_members_turns.ts'

const MEMBER = 'a-member'
const A_MATE = 'a-mate'
/** An interval no test waits out: every read here is called by the test itself. */
const NEVER_BY_THE_TIMER = 3_600_000

function aChannel(): ChannelHost {
  const { host } = hostForTests()
  return { clock: host.clock, stores: { rows: host.stores.rows } }
}

/** A turn queue that answers each turn with the next of `answers`, and keeps every turn it took. */
function turnsAnswering(...answers: WhatATurnDid[]): TheEngineMembersTurns & { readonly took: ATurnToSend[] } {
  const took: ATurnToSend[] = []
  return {
    took,
    take: (turn) => {
      took.push(turn)
      return Promise.resolve(answers.shift() ?? { sent: 1 })
    },
  }
}

test('#511 part B: a message for the member becomes one turn, framed, from the crew channel, and is counted taken in once it ran', async () => {
  const channel = aChannel()
  const position = await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'hello', sent_at: 1 })
  const turns = turnsAnswering({ sent: 1 })
  const reader = theCrewsMessagesAsTurns({ carrierOf: () => carryingTo({ member: MEMBER, host: channel }), turns, every_ms: NEVER_BY_THE_TIMER })
  try {
    await reader.readNow()
    await reader.readNow()
    assert.deepEqual(turns.took, [{ text: framed(position, A_MATE, 'hello'), arrival: THE_ARRIVAL_OF_A_CREW_MESSAGE }])
    assert.deepEqual([...(await takenInBy(channel, MEMBER))], [position])
  } finally {
    reader.stop()
  }
})

test('#511 part B: a turn the engine failed is not counted, and the next read hands the same message again (mutant: the carrier kept after a failure)', async () => {
  const channel = aChannel()
  const position = await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'again', sent_at: 1 })
  const turns = turnsAnswering({ failed: 'the engine failed' }, { sent: 1 })
  const reader = theCrewsMessagesAsTurns({ carrierOf: () => carryingTo({ member: MEMBER, host: channel }), turns, every_ms: NEVER_BY_THE_TIMER })
  try {
    await reader.readNow()
    assert.deepEqual([...(await takenInBy(channel, MEMBER))], [])
    await reader.readNow()
    assert.deepEqual(turns.took.map((turn) => turn.text), [framed(position, A_MATE, 'again'), framed(position, A_MATE, 'again')])
    assert.deepEqual([...(await takenInBy(channel, MEMBER))], [position])
  } finally {
    reader.stop()
  }
})

test('#511 part B: a turn the entry refused is counted taken in, so the same refusal is not asked for again, and the next message follows', async () => {
  const channel = aChannel()
  const first = await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'refused', sent_at: 1 })
  const second = await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'next', sent_at: 2 })
  const turns = turnsAnswering({ refused: 'the gate said no' }, { sent: 1 })
  const reader = theCrewsMessagesAsTurns({ carrierOf: () => carryingTo({ member: MEMBER, host: channel }), turns, every_ms: NEVER_BY_THE_TIMER })
  try {
    await reader.readNow()
    await reader.readNow()
    assert.deepEqual(turns.took.map((turn) => turn.text), [framed(first, A_MATE, 'refused'), framed(second, A_MATE, 'next')])
    assert.deepEqual([...(await takenInBy(channel, MEMBER))].sort(), [first, second].sort())
  } finally {
    reader.stop()
  }
})

test('#511 part B: a read that starts while another is still reading the channel does nothing, so one message is never queued twice (mutant: no in-flight guard)', async () => {
  // The carrier marks a message handed only once its channel read has come back, so two reads begun before that both
  // find nothing handed: only the reader's own guard keeps the second from handing the same message again.
  const channel = aChannel()
  await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'once', sent_at: 1 })
  const finishes: ((did: WhatATurnDid) => void)[] = []
  const took: ATurnToSend[] = []
  const turns: TheEngineMembersTurns = {
    take: (turn) => {
      took.push(turn)
      return new Promise((settle) => finishes.push(settle))
    },
  }
  const reader = theCrewsMessagesAsTurns({ carrierOf: () => carryingTo({ member: MEMBER, host: channel }), turns, every_ms: NEVER_BY_THE_TIMER })
  try {
    const both = [reader.readNow(), reader.readNow()]
    while (took.length === 0) await new Promise((settle) => setImmediate(settle))
    for (let tick = 0; tick < 10; tick++) await new Promise((settle) => setImmediate(settle))
    for (const finish of finishes) finish({ sent: 1 })
    await Promise.all(both)
    assert.equal(took.length, 1)
  } finally {
    reader.stop()
  }
})

test('#511 part B r=1: a channel read that fails ends the read quietly, never as a rejection the timer leaves unhandled, and the next read hands the message (mutant: no catch)', async () => {
  // The timer starts each read with `void`, so a read that rejects is an unhandled rejection, which ends node's process:
  // the launch that drives the member. A read that fails is late, never lost and never the launcher's end.
  const channel = aChannel()
  const position = await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'after a failed read', sent_at: 1 })
  let fails = 1
  const carrierOf = () => {
    const carrier = carryingTo({ member: MEMBER, host: channel })
    return { ...carrier, next: () => (fails-- > 0 ? Promise.reject(new Error('the rows could not be read')) : carrier.next()) }
  }
  const turns = turnsAnswering({ sent: 1 })
  const reader = theCrewsMessagesAsTurns({ carrierOf, turns, every_ms: NEVER_BY_THE_TIMER })
  try {
    await reader.readNow()
    assert.deepEqual(turns.took, [])
    await reader.readNow()
    assert.deepEqual(turns.took, [{ text: framed(position, A_MATE, 'after a failed read'), arrival: THE_ARRIVAL_OF_A_CREW_MESSAGE }])
  } finally {
    reader.stop()
  }
})

test('#511 part B: a stopped reader reads nothing more', async () => {
  const channel = aChannel()
  await appendToTheChannel(channel, { from: A_MATE, to: [MEMBER], text: 'late', sent_at: 1 })
  const turns = turnsAnswering()
  const reader = theCrewsMessagesAsTurns({ carrierOf: () => carryingTo({ member: MEMBER, host: channel }), turns, every_ms: NEVER_BY_THE_TIMER })
  reader.stop()
  await reader.readNow()
  assert.deepEqual(turns.took, [])
})
