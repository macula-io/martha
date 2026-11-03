import assert from 'node:assert/strict'
import { test } from 'node:test'

import { admitsRoomMessage, type RoomMessage, type RoomRoster } from './admit_a_room_message.ts'

// Synthetic node ids, never a real one: this repository is public.
const member = 'c'.repeat(64)
const stranger = 'b'.repeat(64)
const other_member = 'd'.repeat(64)

const roster: RoomRoster = { member_node_ids: [member, other_member] }

const message = (change: Partial<RoomMessage> = {}): RoomMessage => ({
  attested: true,
  from_node_id: other_member,
  to_node_ids: [member],
  kind: 'message',
  ...change,
})

const admits = (change: Partial<RoomMessage> = {}, room: RoomRoster = roster) =>
  admitsRoomMessage({ message: message(change), roster: room, self_node_id: member })

test('an attested message from a rostered member, addressed here, of a talk kind, is admitted', () => {
  assert.equal(admits(), true)
})

test('an unattested message is refused: the station said nothing about the sender', () => {
  assert.equal(admits({ attested: false }), false)
})

test('a sender the roster does not name is refused', () => {
  assert.equal(admits({ from_node_id: stranger }), false)
})

test('a message with no sender at all is refused', () => {
  assert.equal(admits({ from_node_id: null }), false)
})

test('a message from this session to itself is refused', () => {
  assert.equal(admits({ from_node_id: member }), false)
})

test('a message addressed to another session is refused: this is not its business', () => {
  assert.equal(admits({ to_node_ids: [other_member] }), false)
})

test('a message addressed to nobody is refused', () => {
  assert.equal(admits({ to_node_ids: [] }), false)
})

test('a kind that is not a talk kind is refused', () => {
  for (const kind of ['presence_changed', '', 'MESSAGE', 'control_taken']) {
    assert.equal(admits({ kind }), false, kind)
  }
})

test('every talk kind is admitted', () => {
  const talk_kinds = [
    'message',
    'question_asked',
    'answer_given',
    'help_requested',
    'help_offered',
    'remark_made',
    'task_handed_over',
    'result_reported',
  ]
  for (const kind of talk_kinds) assert.equal(admits({ kind }), true, kind)
})

test('a node id is compared case-insensitively, as the crew code lowercases it', () => {
  assert.equal(admits({ from_node_id: other_member.toUpperCase() }), true)
})

test('an empty roster admits nobody', () => {
  assert.equal(admits({}, { member_node_ids: [] }), false)
})
