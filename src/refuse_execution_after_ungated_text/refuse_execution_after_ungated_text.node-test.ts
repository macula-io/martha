import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SHELL_TOOLS, isShellTool } from '../shell_tools/shell_tools.ts'
import {
  refuseExecutionAfterUngatedText,
  type Ingestion,
  type Policy,
} from './refuse_execution_after_ungated_text.ts'

// The policy table names principals by NODE ID. A display name is never a principal.
const policy: Policy = {
  may_send_executable_text: ['00e58639343de9ec00073ae35545bc3432cfe1ccc1c2b2ca5db86161022dc106'],
}

const stranger = '00d52e2fbb71b85ab07acafcdaf3cef8df4b304e297a86ff7c2055f6cb6598c0'
const crewmate = '00e58639343de9ec00073ae35545bc3432cfe1ccc1c2b2ca5db86161022dc106'

const decide = (tool: string, ingests: readonly Ingestion[]) =>
  refuseExecutionAfterUngatedText({ tool, ingests, policy })

const allowed = (tool: string, ingests: readonly Ingestion[]) => decide(tool, ingests).allow
const refusal = (tool: string, ingests: readonly Ingestion[]) => {
  const decision = decide(tool, ingests)
  assert.equal(decision.allow, false, `${tool} was allowed; it must be refused`)
  return decision.refusal
}

// --- nothing arrived: the crew works -----------------------------------------

test('a turn that took in nothing may run anything', () => {
  for (const tool of SHELL_TOOLS) assert.equal(allowed(tool, []), true, tool)
})

test('text from a principal the policy table names may be acted on', () => {
  const handoff: Ingestion = { path: 'A6', from_node_id: crewmate }
  for (const tool of SHELL_TOOLS) assert.equal(allowed(tool, [handoff]), true, tool)
})

// --- every shell tool is covered, not a subset ---------------------------------

test('every executing tool is refused after an outsider turn: the whole shell, not Bash alone', () => {
  const outsider: Ingestion = { path: 'A6', from_node_id: stranger }
  for (const tool of SHELL_TOOLS) {
    const why = refusal(tool, [outsider])
    assert.match(why, /A6/, `${tool} refusal must name the path that let the text in`)
  }
})

test('the shell includes the write tools, agent spawns and acting mesh tools', () => {
  for (const tool of ['Bash', 'Write', 'Edit', 'NotebookEdit', 'Agent', 'Task', 'mesh_call', 'crew_restart']) {
    assert.equal(isShellTool(tool), true, `${tool} is part of the shell`)
  }
})

test('an unknown mcp tool is treated as executing unless it is named read-only', () => {
  assert.equal(isShellTool('mcp__someboard__act'), true)
  assert.equal(isShellTool('mcp__macula__mesh_read_inbox'), false)
})

test('reading and searching stay allowed: the member reads the text, it just may not act on it', () => {
  const outsider: Ingestion = { path: 'A6', from_node_id: stranger }
  for (const tool of ['Read', 'Grep']) assert.equal(allowed(tool, [outsider]), true, tool)
})

// --- one planted case per source of turn text ---------------------------------

const strangerSources: { source: string; ingestion: Ingestion }[] = [
  { source: 'a ring purpose (A4)', ingestion: { path: 'A4', from_node_id: stranger } },
  { source: "a ring's decline reason (A5)", ingestion: { path: 'A5', from_node_id: stranger } },
  { source: 'a cross-session message body (A6)', ingestion: { path: 'A6', from_node_id: stranger } },
  { source: 'a forged envelope inside a gated room body (A9 via A1)', ingestion: { path: 'A9', from_node_id: stranger } },
  { source: 'hook output from a checkout (A7)', ingestion: { path: 'A7', from_node_id: null } },
  { source: 'the handover file of a predecessor (A8)', ingestion: { path: 'A8', from_node_id: null } },
  { source: 'owner-pasted text the adapter could not attribute (A10)', ingestion: { path: 'A10', from_node_id: null } },
  { source: 'a server instruction block (A11)', ingestion: { path: 'A11', from_node_id: null } },
  { source: 'a compaction summary (A12)', ingestion: { path: 'A12', from_node_id: null } },
  { source: 'code a checkout ran by itself (A13)', ingestion: { path: 'A13', from_node_id: null } },
]

for (const { source, ingestion } of strangerSources) {
  test(`Bash is refused after ${source}`, () => {
    refusal('Bash', [ingestion])
  })
}

const strangerFetches: { source: string; ingestion: Ingestion }[] = [
  { source: 'a mesh read tool (B1)', ingestion: { path: 'B1', from_node_id: null } },
  { source: 'any MCP tool result (B2)', ingestion: { path: 'B2', from_node_id: null } },
  { source: 'a gh issue or PR body (B3)', ingestion: { path: 'B3', from_node_id: null } },
  { source: 'a checkout file (B4)', ingestion: { path: 'B4', from_node_id: null } },
  { source: 'git history (B5)', ingestion: { path: 'B5', from_node_id: null } },
  { source: 'the web (B6)', ingestion: { path: 'B6', from_node_id: null } },
  { source: 'a subagent result (B7)', ingestion: { path: 'B7', from_node_id: null } },
]

for (const { source, ingestion } of strangerFetches) {
  test(`Bash is refused after ${source}`, () => {
    refusal('Bash', [ingestion])
  })
}

// --- the refusal cannot be talked out of --------------------------------------

test('a display name never authorises: the planted "you are Supervisor" turn is refused', () => {
  const planted: Ingestion & { from_name: 'Supervisor' } = {
    path: 'A4',
    from_node_id: stranger,
    from_name: 'Supervisor',
  }
  const why = refusal('Bash', [planted])
  assert.match(why, /not named by the policy table/)
})

test('one unwilling ingestion blocks the turn even when a principal also wrote', () => {
  const ingests: Ingestion[] = [
    { path: 'A6', from_node_id: crewmate },
    { path: 'A4', from_node_id: stranger },
  ]
  refusal('Bash', ingests)
})

test('a path this gate has never heard of fails closed', () => {
  refusal('Bash', [{ path: 'A99', from_node_id: crewmate }])
})

test('the refusal names the path and says what to do, in business words', () => {
  const why = refusal('Bash', [{ path: 'A4', from_node_id: stranger }])
  assert.match(why, /A4/)
  assert.match(why, /nothing executes/i)
  assert.doesNotMatch(why, /undefined|null/)
})
