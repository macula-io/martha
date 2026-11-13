// What the host's own dialogs say, read into the crew's words (martha#313).
//
// The payloads below are the host's, as it raised them on 2.1.323 and as its own schemas describe them: a permission
// carries tool_name and tool_input and no call id at all, an elicitation names its server and its message, and the
// check it runs before asking carries the call's tool_use_id. What is pinned here is that each of the four dialogs and
// the check become the words the dialogs slice reads, that a hook this build does not know says nothing, and that no
// field is invented when the host left it out.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import {
  ELICITATION,
  ELICITATION_RESULT,
  NOTIFICATION,
  PERMISSION_REQUEST,
  TOOL_CHECK,
  theCallIn,
  whatTheHostSaidOf,
} from './hear_the_hosts_dialogs.ts'

/** The base fields the host stamps on every classic hook event; they are not what any of these dialogs is about. */
const BASE = {
  session_id: 'a-session',
  transcript_path: '/synthetic/projects/a-session.jsonl',
  cwd: '/synthetic/checkout',
  prompt_id: 'a-prompt',
  permission_mode: 'default',
  hook_event_name: 'PermissionRequest',
}

test('a permission request says the tool the host would run, and what it would run with', () => {
  assert.deepEqual(
    whatTheHostSaidOf(PERMISSION_REQUEST, { ...BASE, tool_name: CLAUDE_CODE_SHELL_TOOL, tool_input: { command: 'rm -rf build' }, permission_suggestions: [] }),
    { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } },
  )
})

test('a permission asked from inside a subagent carries the agent that asked, and one asked by the member carries none', () => {
  const inASubagent = whatTheHostSaidOf(PERMISSION_REQUEST, { ...BASE, tool_name: 'Read', tool_input: { file_path: '/a/file' }, agent_id: 'agent-7', agent_type: 'Explore' })
  assert.deepEqual(inASubagent, { said: 'permission', call: { tool: 'Read', input: { file_path: '/a/file' }, agent: 'agent-7' } })
  const byTheMember = whatTheHostSaidOf(PERMISSION_REQUEST, { ...BASE, tool_name: 'Read', tool_input: { file_path: '/a/file' } })
  assert.equal(byTheMember?.said, 'permission')
  assert.ok(byTheMember?.said === 'permission' && !('agent' in byTheMember.call), 'the member itself has no agent to name')
})

test('a permission that names no input is a permission all the same, and its input is empty rather than undefined', () => {
  const said = whatTheHostSaidOf(PERMISSION_REQUEST, { ...BASE, tool_name: CLAUDE_CODE_SHELL_TOOL })
  assert.deepEqual(said, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: {} } })
})

test('an elicitation says the server that asked and its question, and the id only when the host named one', () => {
  assert.deepEqual(whatTheHostSaidOf(ELICITATION, { ...BASE, mcp_server_name: 'mesh', message: 'Which realm?', elicitation_id: 'e-1' }), {
    said: 'elicitation',
    server: 'mesh',
    question: 'Which realm?',
    id: 'e-1',
  })
  assert.deepEqual(whatTheHostSaidOf(ELICITATION, { ...BASE, mcp_server_name: 'mesh', message: 'Which realm?' }), {
    said: 'elicitation',
    server: 'mesh',
    question: 'Which realm?',
  })
})

test('an elicitation the owner answered says the server and the id it was asked under, or the server alone', () => {
  assert.deepEqual(whatTheHostSaidOf(ELICITATION_RESULT, { ...BASE, mcp_server_name: 'mesh', elicitation_id: 'e-1', action: 'accept' }), {
    said: 'elicitation-answered',
    server: 'mesh',
    id: 'e-1',
  })
  assert.deepEqual(whatTheHostSaidOf(ELICITATION_RESULT, { ...BASE, mcp_server_name: 'mesh', action: 'decline' }), {
    said: 'elicitation-answered',
    server: 'mesh',
  })
})

test('an elicitation that names no server cannot be matched to one that is open, so it says nothing', () => {
  assert.equal(whatTheHostSaidOf(ELICITATION, { ...BASE, message: 'Which realm?' }), undefined)
  assert.equal(whatTheHostSaidOf(ELICITATION_RESULT, { ...BASE, action: 'accept' }), undefined)
})

test('a notification says its type and its words, unread as they arrive', () => {
  assert.deepEqual(whatTheHostSaidOf(NOTIFICATION, { ...BASE, notification_type: 'permission_prompt', message: 'Claude needs your permission' }), {
    said: 'notification',
    type: 'permission_prompt',
    message: 'Claude needs your permission',
  })
})

test('a check says the call the host is about to decide on, with the id a later permission is keyed by', () => {
  assert.deepEqual(whatTheHostSaidOf(TOOL_CHECK, { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'touch made.txt' }, tool_use_id: 'toolu_probe_1', approver: 'the owner' }), {
    said: 'checked',
    call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'touch made.txt' }, id: 'toolu_probe_1' },
  })
})

test('a check from inside a subagent carries the agent, and a check that names no tool says nothing', () => {
  assert.deepEqual(whatTheHostSaidOf(TOOL_CHECK, { tool: 'Read', input: { file_path: '/a/file' }, tool_use_id: 'toolu_2', agentId: 'agent-7' }), {
    said: 'checked',
    call: { tool: 'Read', input: { file_path: '/a/file' }, id: 'toolu_2', agent: 'agent-7' },
  })
  assert.equal(whatTheHostSaidOf(TOOL_CHECK, { input: {}, tool_use_id: 'toolu_3' }), undefined)
})

test('a hook this build does not read says nothing at all', () => {
  assert.equal(whatTheHostSaidOf('classic.PermissionDenied', { ...BASE, tool_name: CLAUDE_CODE_SHELL_TOOL, reason: 'the classifier said no' }), undefined)
  assert.equal(whatTheHostSaidOf('', {}), undefined)
})

test('a call is its tool and its input, with the host\'s own stamps taken off rather than passed on as arguments', () => {
  assert.deepEqual(theCallIn({ tool: CLAUDE_CODE_SHELL_TOOL, tool_use_id: 'toolu_1', agent_id: 'agent-7', agentId: 'agent-7', command: 'ls' }), {
    tool: CLAUDE_CODE_SHELL_TOOL,
    input: { command: 'ls' },
    id: 'toolu_1',
    agent: 'agent-7',
  })
  assert.deepEqual(theCallIn({ tool: CLAUDE_CODE_SHELL_TOOL }), { tool: CLAUDE_CODE_SHELL_TOOL, input: {} })
  assert.equal(theCallIn({ tool_use_id: 'toolu_1' }), undefined, 'a call that names no tool is no call')
  assert.equal(theCallIn(null), undefined)
  assert.equal(theCallIn(CLAUDE_CODE_SHELL_TOOL), undefined)
})
