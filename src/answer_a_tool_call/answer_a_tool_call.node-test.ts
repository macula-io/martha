import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import {
  WHAT_CLEARS_IT,
  type Policy,
  type Session,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  beginSession,
  rememberSession,
  resumeSession,
  takeInTurn,
  type SessionRecordStore,
} from '../take_in_a_turn/take_in_a_turn.ts'
import { answerToolCall, type ToolCallAnswer } from './answer_a_tool_call.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'

const names = claudeCodeToolNames

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

  const first = denied(answerToolCall({ names, tool: 'Bash', session: tainted, policy }))
  assert.match(first, /nothing executes/i)

  const nextTurn = takeInTurn(tainted, { source: 'mesh_read' }, bindNothing)
  denied(answerToolCall({ names, tool: 'Bash', session: nextTurn, policy }))
})

test('a fresh session under a new id lets the crew work again', () => {
  const records = store()
  const tainted = takeInTurn(beginSession(records, 's-1'), { source: 'cross_session' }, bindNothing)
  denied(answerToolCall({ names, tool: 'Bash', session: tainted, policy }))

  const fresh = beginSession(records, 's-2')
  assert.equal(answerToolCall({ names, tool: 'Bash', session: fresh, policy }), undefined)
})

test('a compaction keeps the id, and so does not let the crew work again', () => {
  const records = store()
  rememberSession(records, takeInTurn(beginSession(records, 's-1'), { source: 'ring' }, bindNothing))
  denied(answerToolCall({ names, tool: 'Bash', session: resumeSession(records, 's-1'), policy }))
})

test('an unreadable record refuses the shell and says so', () => {
  const resumed = resumeSession(store(), 'a-session-the-store-never-saw')
  const answer = denied(answerToolCall({ names, tool: 'Bash', session: resumed, policy }))

  assert.match(answer, /record/i)
  assert.match(answer, /cannot be read/i)
  assert.ok(answer.includes(WHAT_CLEARS_IT))
})

test('an unreadable record still lets the member read', () => {
  const resumed = resumeSession(store(), 'a-session-the-store-never-saw')
  assert.equal(answerToolCall({ names, tool: 'Read', session: resumed, policy }), undefined)
})

test('a record kept across a restart carries the taint with it', () => {
  const records = store()
  const tainted = takeInTurn(beginSession(records, 's-1'), { source: 'ring' }, bindNothing)
  rememberSession(records, tainted)

  denied(answerToolCall({ names, tool: 'Bash', session: resumeSession(records, 's-1'), policy }))
})

test('the refusal a host returns names what to do', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  const answer = answerToolCall({ names, tool: 'Write', session: tainted, policy })

  assert.equal(typeof (answer as { deny: unknown }).deny, 'string')
  assert.ok(denied(answer).includes(WHAT_CLEARS_IT))
})

// --- reading is still allowed -------------------------------------------------

test('the member may still read the text it is not allowed to act on', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  for (const tool of ['Read', 'Grep', 'Glob']) {
    assert.equal(answerToolCall({ names, tool, session: tainted, policy }), undefined, tool)
  }
})

// --- a turn the host can attribute --------------------------------------------

test('a turn the policy names may run a shell straight away', () => {
  const session = takeInTurn(beginSession(store(), 's-1'), {
    source: 'crew_room',
    from_identity: supervisor_identity,
  }, bindNothing)
  assert.equal(answerToolCall({ names, tool: 'Bash', session, policy }), undefined)
})

test('every tool that executes is refused, by whatever name the host uses', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  for (const tool of ['Bash', 'bash', 'patch', 'MultiEdit', 'Agent', 'SendMessage', 'NeverSeenTool']) {
    denied(answerToolCall({ names, tool, session: tainted, policy }))
  }
})

test('a tainted member cannot send: every tool that hands text to someone else is refused', () => {
  // The threat model on martha#14 once said a tainted member could still send.
  // It cannot: sending is acting, and only tools that read stay allowed.
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  const sends = [
    'SendMessage',
    'mcp__macula__mesh_say',
    'mcp__macula__mesh_publish',
    'mcp__macula__mesh_ring',
    'mcp__macula__mesh_call',
    'mcp__macula__mesh_answer_ring',
    'mcp__macula__mesh_remember',
    'mcp__crew__crew_mail_send',
  ]
  for (const tool of sends) denied(answerToolCall({ names, tool, session: tainted, policy }))
})
