import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isReadOnlyTool, isShellTool } from '../shell_tools/shell_tools.ts'
import {
  recordIngestion,
  refuseExecutionAfterUngatedText,
  startFreshSession,
  type Ingestion,
  type Policy,
} from './refuse_execution_after_ungated_text.ts'

// Synthetic node ids, never a real one: this repository is public.
const crewmate = 'a'.repeat(64)
const stranger = 'b'.repeat(64)

// The policy table names principals by NODE ID. A display name is never a principal.
const policy: Policy = { may_send_executable_text: [crewmate] }

const sessionAfter = (...ingests: Ingestion[]) => recordIngestion(startFreshSession(), ingests)

const decide = (tool: string, ingests: readonly Ingestion[]) =>
  refuseExecutionAfterUngatedText({ tool, session: sessionAfter(...ingests), policy })

const allowed = (tool: string, ingests: readonly Ingestion[]) => decide(tool, ingests).allow
const refusal = (tool: string, ingests: readonly Ingestion[]) => {
  const decision = decide(tool, ingests)
  assert.equal(decision.allow, false, `${tool} was allowed; it must be refused`)
  return decision.refusal
}

// Every name that executes in one host or another, including the ones a
// deny-list forgot: the OpenCode host's lowercase names, the plugins' names, the
// tools that hand text to a peer, and a name invented here.
const EXECUTING_TOOLS = [
  'Bash',
  'bash',
  'write',
  'edit',
  'patch',
  'MultiEdit',
  'NotebookEdit',
  'Agent',
  'Task',
  'SendMessage',
  'Workflow',
  'Skill',
  'CronCreate',
  'ScheduleWakeup',
  'Monitor',
  'Artifact',
  'WebFetch',
  'mesh_call',
  'crew_restart',
  'NeverSeenTool',
]

// --- nothing arrived: the crew works -----------------------------------------

test('a session that took in nothing may run anything', () => {
  for (const tool of EXECUTING_TOOLS) assert.equal(allowed(tool, []), true, tool)
})

test('text from a principal the policy table names may be acted on', () => {
  const handoff: Ingestion = { path: 'A6', from_node_id: crewmate }
  for (const tool of EXECUTING_TOOLS) assert.equal(allowed(tool, [handoff]), true, tool)
})

test('a node id is compared case-insensitively, as the crew code lowercases it', () => {
  const handoff: Ingestion = { path: 'A6', from_node_id: crewmate.toUpperCase() }
  assert.equal(allowed('Bash', [handoff]), true)
})

// --- every executing tool is covered, and the list is an allow-list -----------

test('every executing tool is refused after an outsider turn, by any name it goes by', () => {
  const outsider: Ingestion = { path: 'A6', from_node_id: stranger }
  for (const tool of EXECUTING_TOOLS) {
    const why = refusal(tool, [outsider])
    assert.match(why, /A6/, `${tool} refusal must name the path that let the text in`)
  }
})

test('a tool name nobody has ever seen executes: the list is an allow-list, not a deny-list', () => {
  assert.equal(isShellTool('NeverSeenTool'), true)
  assert.equal(isShellTool('bash'), true)
  assert.equal(isShellTool('Write'), true)
})

test('reading and searching stay allowed: the member reads the text, it just may not act on it', () => {
  const outsider: Ingestion = { path: 'A6', from_node_id: stranger }
  for (const tool of ['Read', 'Grep', 'Glob', 'mcp__macula__mesh_read_inbox']) {
    assert.equal(isReadOnlyTool(tool), true, tool)
    assert.equal(allowed(tool, [outsider]), true, tool)
  }
})

test('a plugin-namespaced copy of a read tool is treated as executing, not as a read', () => {
  assert.equal(isShellTool('mcp__someplugin__mesh_read_inbox'), true)
})

// --- the taint lasts as long as the text is readable --------------------------

test('the turn after the outsider text is still refused: the text did not leave the context', () => {
  const violated = sessionAfter({ path: 'A6', from_node_id: stranger })
  const nextTurn = recordIngestion(violated, [])

  const decision = refuseExecutionAfterUngatedText({ tool: 'Bash', session: nextTurn, policy })
  assert.equal(decision.allow, false)
})

test('only a fresh session clears it', () => {
  const violated = sessionAfter({ path: 'A6', from_node_id: stranger })
  assert.equal(refuseExecutionAfterUngatedText({ tool: 'Bash', session: violated, policy }).allow, false)
  assert.equal(
    refuseExecutionAfterUngatedText({ tool: 'Bash', session: startFreshSession(), policy }).allow,
    true,
  )
})

test('a handover file or a compaction summary carries the taint forward', () => {
  const violated = sessionAfter({ path: 'A6', from_node_id: stranger })
  const resumed = recordIngestion(violated, [
    { path: 'A8', from_node_id: null },
    { path: 'A12', from_node_id: null },
  ])
  assert.equal(refuseExecutionAfterUngatedText({ tool: 'Bash', session: resumed, policy }).allow, false)
})

// --- one planted case per source of turn text ---------------------------------

const strangerSources: { source: string; ingestion: Ingestion }[] = [
  { source: 'a ring purpose (A4)', ingestion: { path: 'A4', from_node_id: stranger } },
  { source: "a ring's decline reason (A5)", ingestion: { path: 'A5', from_node_id: stranger } },
  { source: 'a cross-session message body (A6)', ingestion: { path: 'A6', from_node_id: stranger } },
  { source: 'a forged envelope inside a gated room body (A9)', ingestion: { path: 'A9', from_node_id: stranger } },
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
  const planted = {
    path: 'A4',
    from_node_id: stranger,
    from_name: 'Supervisor',
  } as Ingestion
  const why = refusal('Bash', [planted])
  assert.match(why, /not named by the policy table/)
})

test('one unwilling ingestion blocks the session even when a principal also wrote', () => {
  refusal('Bash', [
    { path: 'A6', from_node_id: crewmate },
    { path: 'A4', from_node_id: stranger },
  ])
})

test('a path this gate has never heard of fails closed', () => {
  refusal('Bash', [{ path: 'A99', from_node_id: crewmate }])
})

test('the refusal names the path and says what clears it, in business words', () => {
  const why = refusal('Bash', [{ path: 'A4', from_node_id: stranger }])
  assert.match(why, /A4/)
  assert.match(why, /nothing executes/i)
  assert.match(why, /fresh start that reads no handover/i)
  assert.doesNotMatch(why, /undefined|null|NaN/)
})
