import assert from 'node:assert/strict'
import { test } from 'node:test'

import { startFreshSession, type Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { replaceSession, takeInTurn } from '../take_in_a_turn/take_in_a_turn.ts'
import { answerToolCall, type ToolCallAnswer } from './answer_a_tool_call.ts'

// Synthetic identities, never a real one: this repository is public.
const supervisor_identity = 'identity-of-the-supervisor'
const stranger_identity = 'identity-of-a-stranger'

const policy: Policy = { may_send_executable_text: [supervisor_identity] }

const denied = (answer: ToolCallAnswer): string => {
  assert.notEqual(answer, undefined, 'the tool call was allowed; it must be refused')
  return (answer as { deny: string }).deny
}

// --- the host's whole loop ----------------------------------------------------

test('a session that took in a stranger may not run a shell, this turn or the next', () => {
  const tainted = takeInTurn(startFreshSession(), { source: 'cross_session', from_identity: stranger_identity })

  const first = denied(answerToolCall({ tool: 'Bash', session: tainted, policy }))
  assert.match(first, /nothing executes/i)

  const nextTurn = takeInTurn(tainted, { source: 'compaction' })
  denied(answerToolCall({ tool: 'Bash', session: nextTurn, policy }))
})

test('a real replacement lets the crew work again', () => {
  const tainted = takeInTurn(startFreshSession(), { source: 'cross_session', from_identity: stranger_identity })
  denied(answerToolCall({ tool: 'Bash', session: tainted, policy }))

  const fresh = replaceSession(tainted, 'clear')
  assert.equal(answerToolCall({ tool: 'Bash', session: fresh, policy }), undefined)
})

test('the answer is a refusal object a host can return as-is, and it names what to do', () => {
  const tainted = takeInTurn(startFreshSession(), { source: 'ring' })
  const answer = answerToolCall({ tool: 'Write', session: tainted, policy })

  assert.equal(typeof (answer as { deny: unknown }).deny, 'string')
  assert.match(denied(answer), /fresh session/i)
})

// --- reading is still allowed -------------------------------------------------

test('the member may still read the text it is not allowed to act on', () => {
  const tainted = takeInTurn(startFreshSession(), { source: 'ring' })
  for (const tool of ['Read', 'Grep', 'Glob']) {
    assert.equal(answerToolCall({ tool, session: tainted, policy }), undefined, tool)
  }
})

// --- the supervisor's own turn ------------------------------------------------

test('a turn the policy names may run a shell straight away', () => {
  const session = takeInTurn(startFreshSession(), { source: 'cross_session', from_identity: supervisor_identity })
  assert.equal(answerToolCall({ tool: 'Bash', session, policy }), undefined)
})

test('every tool that executes is refused, by whatever name the host uses', () => {
  const tainted = takeInTurn(startFreshSession(), { source: 'ring' })
  for (const tool of ['Bash', 'bash', 'patch', 'MultiEdit', 'Agent', 'SendMessage', 'NeverSeenTool']) {
    denied(answerToolCall({ tool, session: tainted, policy }))
  }
})
