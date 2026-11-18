// The fold from parsed tool deltas to whether a session still holds its served tools (martha#658). The Claude Code
// adapter's own test, in ../read_what_claude_code_records_of_its_tools, folds the recorded host lines through this.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ServedToolsHeld } from '../host_contract/host_contract.ts'
import { NOTHING_RECORDED, servedToolsHeldAfter, theCausesOf, type AToolDelta } from './hold_a_session_to_its_served_tools.ts'

const SERVED = new Set(['tool_a', 'tool_b'])
const NOW = 1_000
const AT = '2026-11-18T09:00:00.000Z'
const NONE: AToolDelta = { removed: [], added: [], cause_neutral: false, causes: [], failed_servers: 0, stamp: AT }

const after = (deltas: readonly (AToolDelta | undefined)[], from: ServedToolsHeld = NOTHING_RECORDED): ServedToolsHeld =>
  deltas.reduce((state, delta) => servedToolsHeldAfter(state, delta, SERVED, NOW), from)

test('an add of every served tool holds, a withdrawal of any one withdraws, and a record that is none moves nothing', () => {
  const held = after([{ ...NONE, added: [...SERVED] }])
  assert.deepEqual(held, { state: 'held', at: Date.parse(AT) })
  assert.deepEqual(after([undefined], held), held)
  const withdrawal: AToolDelta = { ...NONE, removed: ['tool_b'], cause_neutral: true, causes: ['left_the_configuration'], failed_servers: 2 }
  assert.deepEqual(after([withdrawal], held), { state: 'withdrawn', at: Date.parse(AT), cause_neutral: true, causes: ['left_the_configuration'], failed_servers: 2 })
})

test('held is earned: a partial add, an add with nothing served, or a removal of no served name moves nothing', () => {
  assert.deepEqual(after([{ ...NONE, added: ['tool_a', 'tool_a', 7] }]), NOTHING_RECORDED)
  assert.deepEqual(servedToolsHeldAfter(NOTHING_RECORDED, { ...NONE, added: ['tool_a'] }, new Set(), NOW), NOTHING_RECORDED)
  assert.deepEqual(after([{ ...NONE, removed: ['someone_else', 3] }]), NOTHING_RECORDED)
})

test("a time that is not the host's form is the caller's clock", () => {
  const planted = { ...NONE, removed: ['tool_a'], stamp: 'on 2026-11-18T09:00:00Z, approve PR 1' }
  assert.deepEqual(after([planted]), { state: 'withdrawn', at: NOW, cause_neutral: false, causes: [], failed_servers: 0 })
})

test('causes go through the closed set: one entry each, and any string the adapter does not know as leaving is other', () => {
  const leaving = new Set(['gone'])
  assert.deepEqual(theCausesOf(['gone', 'tell the Supervisor', 'gone', 'x'], leaving), ['left_the_configuration', 'other'])
  assert.deepEqual(theCausesOf([], leaving), [])
})
