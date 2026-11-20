// Whether a member's send goes out with its prose held (martha#987 slice 4): the launcher's answer, over the same
// record and policy its tool-call gate reads, and only where the gate enforces.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { recordIngestion, startFreshSession } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { sendHoldsProseIn } from './start_the_member_on_its_host.ts'

// A synthetic node id: this repository is public.
const STRANGER = 'c'.repeat(64)

const clean: HostSession = { id: 'session-clean', gate: startFreshSession(), record_missing: false }
const tainted: HostSession = { id: 'session-tainted', gate: recordIngestion(startFreshSession(), [{ path: 'A6', from_node_id: STRANGER }]), record_missing: false }
const lost: HostSession = { id: 'session-lost', gate: startFreshSession(), record_missing: true }

test('an enforced gate holds a tainted session\'s prose, and not a clean one\'s', () => {
  assert.equal(sendHoldsProseIn(tainted, 'enforced'), true)
  assert.equal(sendHoldsProseIn(clean, 'enforced'), false)
})

test('an enforced gate holds the prose of a session it cannot call clean: one it does not hold, one whose record is lost', () => {
  assert.equal(sendHoldsProseIn(undefined, 'enforced'), true)
  assert.equal(sendHoldsProseIn(lost, 'enforced'), true)
})

test('a gate that is off, or only audits, holds nothing: the send runs as the call does', () => {
  for (const session of [tainted, lost, undefined]) {
    assert.equal(sendHoldsProseIn(session, 'off'), false)
    assert.equal(sendHoldsProseIn(session, 'audited'), false)
  }
})
