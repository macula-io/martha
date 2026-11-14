import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { answerToolCall, type ApprovedLaunch } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { claudeCodeToolNames, openCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { MESH_TOOLS_REFUSED, MESH_TOOLS_THAT_RUN } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import type { Policy, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { beginSession, takeInTurn, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'

const names = claudeCodeToolNames

// A member started in a directory holding no launch config: the launch check
// passes, so these tests see only the rule they are about. Removed at the end.
const launch_home = mkdtempSync(join(tmpdir(), 'martha-no-launch-config-'))
after(() => removeTheTree(launch_home))
const launch: ApprovedLaunch = {
  host: 'claude-code',
  launch_dir: mkdtempSync(join(launch_home, 'work-')),
  stop_dir: launch_home,
  approved_fingerprints: [],
}

// A synthetic node id, never a real one: this repository is public.
const supervisor = '1'.repeat(64)
const policy: Policy = { may_send_executable_text: [supervisor] }

const store = (): SessionRecordStore => {
  const records = new Map<string, Session>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session) }
}

const NAMESPACES = ['mcp__macula__', 'mcp__plugin_macula-mcp_macula__', 'mcp__a-prefix-nobody-installed-yet__']
const OPENCODE_SERVERS = ['macula', 'macula-mcp']
const openCode = openCodeToolNames(OPENCODE_SERVERS)

// The tools martha#48's threat model names: mesh_serve leaves a standing
// procedure that runs on any caller's payload after the session moves on, and
// the trust tools let the model rewrite the owner's contact list (in either
// direction: removing an entry breaks the crew's rings). Each must be refused
// in a member session, clean or tainted, under every namespace and host form.
const REQUIRED_REACH_TOOLS = ['mesh_serve', 'mesh_trust_agent', 'mesh_untrust_agent']

const sessionsOfBothKinds = () => {
  const clean = beginSession(store(), 's-1')
  return { clean, tainted: takeInTurn(clean, { source: 'mcp_result' }, bindNothing) }
}

type BothKinds = ReturnType<typeof sessionsOfBothKinds>

// One tool, refused in a clean and in a tainted session, the refusal naming the owner.
const assertRefusedForTheOwner = (tool: string, { clean, tainted }: BothKinds) => {
  for (const [kind, session] of [['clean', clean], ['tainted', tainted]] as const) {
    const answer = answerToolCall({ names, tool, session, policy, input: {}, launch, host: thisMachine })
    assert.notEqual(answer, undefined, `${tool} in a ${kind} session`)
    assert.match(answer?.deny ?? '', /owner/, `${tool} in a ${kind} session`)
  }
}

// One tool in OpenCode's server_tool form, refused in a clean and in a tainted session.
const assertRefusedOnOpenCode = (tool: string, { clean, tainted }: BothKinds) => {
  for (const session of [clean, tainted]) {
    assert.notEqual(answerToolCall({ names: openCode, tool, session, policy, input: {}, launch, host: thisMachine }), undefined, tool)
  }
}

test('the tools that widen a member reach are refused in a clean and in a tainted session, under every namespace', () => {
  const sessions = sessionsOfBothKinds()
  assert.notEqual(answerToolCall({ names, tool: CLAUDE_CODE_SHELL_TOOL, session: sessions.tainted, policy, launch, host: thisMachine }), undefined, 'the session is tainted')
  for (const prefix of NAMESPACES) {
    for (const own of REQUIRED_REACH_TOOLS) assertRefusedForTheOwner(`${prefix}${own}`, sessions)
  }
})

test('on OpenCode, the tools that widen a member reach are refused in its own server_tool form', () => {
  const sessions = sessionsOfBothKinds()
  for (const server of OPENCODE_SERVERS) {
    for (const own of REQUIRED_REACH_TOOLS) assertRefusedOnOpenCode(`${server}_${own}`, sessions)
  }
})

test('no tool that widens a member reach is on the allow-list, and each is named as refused', () => {
  for (const own of REQUIRED_REACH_TOOLS) {
    assert.equal(MESH_TOOLS_THAT_RUN.includes(own), false, own)
    assert.equal(MESH_TOOLS_REFUSED.includes(own), true, own)
  }
})

test('a refused reach tool is not told to read a room through its gate: that is not why it is refused', () => {
  const { clean } = sessionsOfBothKinds()
  for (const own of REQUIRED_REACH_TOOLS) {
    const answer = answerToolCall({ names, tool: `mcp__macula__${own}`, session: clean, policy, input: {}, launch, host: thisMachine })
    assert.doesNotMatch(answer?.deny ?? '', /through its gate/, own)
  }
})
