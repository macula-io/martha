// A turn a member's host took in is raised to whatever waits on turns (martha#253, slice 0).
//
// The design's slice 0 makes `onTurn` real in a launched member: nothing in a live member listened on it, so a
// message could never be counted as taken in. These cases pin the raising itself — the arrival a listener gets for
// each origin kind, the text unchanged, and that a listener hears only the turns raised after it listened.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ArrivingTurn } from '../host_contract/host_contract.ts'
import { turnsRaised } from './raise_a_turn_to_the_member.ts'

const NOTHING_CARRIED = { command: false, meta: false }

test('#253: a prompt a mod submitted is raised as a result a mod delivered', () => {
  const turns = turnsRaised()
  const heard: ArrivingTurn[] = []
  turns.onTurn((turn) => void heard.push(turn))
  turns.prompted('[crew 1] A: a hand-off', 'plugin', NOTHING_CARRIED)
  assert.deepEqual(heard, [{ text: '[crew 1] A: a hand-off', arrival: { source: 'mcp_result' } }])
})

test('#253: the owner typing at the member is raised as the owner', () => {
  const turns = turnsRaised()
  const heard: ArrivingTurn[] = []
  turns.onTurn((turn) => void heard.push(turn))
  turns.prompted('do the next thing', 'composer', NOTHING_CARRIED)
  assert.deepEqual(heard, [{ text: 'do the next thing', arrival: { source: 'owner_typed' } }])
})

test('#253: typing that carries more than its text is not the owner typing alone', () => {
  const turns = turnsRaised()
  const heard: ArrivingTurn[] = []
  turns.onTurn((turn) => void heard.push(turn))
  turns.prompted('expanded from a command', 'composer', { command: true, meta: false })
  assert.notDeepEqual(heard, [{ text: 'expanded from a command', arrival: { source: 'owner_typed' } }])
})

test('#253: every listener hears every turn, and one that started later hears only the turns after it', () => {
  const turns = turnsRaised()
  const first: string[] = []
  const second: string[] = []
  turns.onTurn((turn) => void first.push(turn.text))
  turns.prompted('before either', 'plugin', NOTHING_CARRIED)
  turns.onTurn((turn) => void second.push(turn.text))
  turns.prompted('after both', 'plugin', NOTHING_CARRIED)
  assert.deepEqual(first, ['before either', 'after both'])
  assert.deepEqual(second, ['after both'])
})
