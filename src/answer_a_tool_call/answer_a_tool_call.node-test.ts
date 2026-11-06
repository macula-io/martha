import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { Policy, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  beginSession,
  rememberSession,
  replaceSession,
  resumeSession,
  takeInTurn,
  type SessionRecordStore,
} from '../take_in_a_turn/take_in_a_turn.ts'
import { answerToolCall, type ToolCallAnswer } from './answer_a_tool_call.ts'

// Synthetic identities, never a real one: this repository is public.
const supervisor_identity = 'identity-of-the-supervisor'
const stranger_identity = 'identity-of-a-stranger'

const policy: Policy = { may_send_executable_text: [supervisor_identity] }

const store = (): SessionRecordStore => {
  const records = new Map<string, Session>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session) }
}

const denied = (answer: ToolCallAnswer): string => {
  assert.notEqual(answer, undefined, 'the tool call was allowed; it must be refused')
  return (answer as { deny: string }).deny
}

// --- the host's whole loop ----------------------------------------------------

test('a session that took in a stranger may not run a shell, this turn or the next', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'cross_session' }, bindNothing)

  const first = denied(answerToolCall({ tool: 'Bash', session: tainted, policy }))
  assert.match(first, /nothing executes/i)

  const nextTurn = takeInTurn(tainted, { source: 'mesh_read' }, bindNothing)
  denied(answerToolCall({ tool: 'Bash', session: nextTurn, policy }))
})

test('a real replacement lets the crew work again', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'cross_session' }, bindNothing)
  denied(answerToolCall({ tool: 'Bash', session: tainted, policy }))

  const fresh = replaceSession(tainted, 'clear')
  assert.equal(answerToolCall({ tool: 'Bash', session: fresh, policy }), undefined)
})

test('a compaction does not let the crew work again', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  const compacted = replaceSession(tainted, 'compaction')
  denied(answerToolCall({ tool: 'Bash', session: compacted, policy }))
})

test('an unreadable record refuses the shell and says so', () => {
  const resumed = resumeSession(store(), 'a-session-the-store-never-saw')
  const answer = denied(answerToolCall({ tool: 'Bash', session: resumed, policy }))

  assert.match(answer, /record/i)
  assert.match(answer, /cannot be read/i)
  assert.match(answer, /\/clear/)
})

test('an unreadable record still lets the member read', () => {
  const resumed = resumeSession(store(), 'a-session-the-store-never-saw')
  assert.equal(answerToolCall({ tool: 'Read', session: resumed, policy }), undefined)
})

test('a record kept across a restart carries the taint with it', () => {
  const records = store()
  const tainted = takeInTurn(beginSession(records, 's-1'), { source: 'ring' }, bindNothing)
  rememberSession(records, tainted)

  denied(answerToolCall({ tool: 'Bash', session: resumeSession(records, 's-1'), policy }))
})

test('the refusal a host returns names what to do', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  const answer = answerToolCall({ tool: 'Write', session: tainted, policy })

  assert.equal(typeof (answer as { deny: unknown }).deny, 'string')
  assert.match(denied(answer), /\/clear/)
})

// --- reading is still allowed -------------------------------------------------

test('the member may still read the text it is not allowed to act on', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  for (const tool of ['Read', 'Grep', 'Glob']) {
    assert.equal(answerToolCall({ tool, session: tainted, policy }), undefined, tool)
  }
})

// --- a turn the host can attribute --------------------------------------------

test('a turn the policy names may run a shell straight away', () => {
  const session = takeInTurn(beginSession(store(), 's-1'), {
    source: 'crew_room',
    from_identity: supervisor_identity,
  }, bindNothing)
  assert.equal(answerToolCall({ tool: 'Bash', session, policy }), undefined)
})

test('every tool that executes is refused, by whatever name the host uses', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  for (const tool of ['Bash', 'bash', 'patch', 'MultiEdit', 'Agent', 'SendMessage', 'NeverSeenTool']) {
    denied(answerToolCall({ tool, session: tainted, policy }))
  }
})
