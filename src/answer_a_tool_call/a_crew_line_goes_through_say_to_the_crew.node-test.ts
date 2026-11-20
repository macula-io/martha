// martha#980 package 2, Done-when 1: a crew line sent by the host's SendMessage, a mesh say or a mesh ring is turned back
// to say_to_the_crew, on any line of the message and whether it reads or not; prose by any of them still goes.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLAUDE_CODE_SEND_MESSAGE_TOOL } from '../claude_code_host/claude_code_messaging_tool.ts'
import { claudeCodeToolNames, openCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import type { ToolNames } from '../host_contract/host_contract.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { RINGS_AND_RETURNS_THE_ANSWER, SENDS_AND_MAY_WAIT } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import type { Policy, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { beginSession, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { answerToolCall, type ApprovedLaunch, type ToolCallAnswer } from './answer_a_tool_call.ts'

// A member started in a directory holding no launch config, so the launch check passes. Removed at the end.
const launch_home = mkdtempSync(join(tmpdir(), 'martha-980-turn-back-'))
after(() => removeTheTree(launch_home))
const launch: ApprovedLaunch = { host: CLAUDE_CODE, launch_dir: mkdtempSync(join(launch_home, 'work-')), stop_dir: launch_home, approved_fingerprints: [] }
const policy: Policy = { may_send_executable_text: [] }

const store = (): SessionRecordStore => {
  const records = new Map<string, Session>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session) }
}

// The mesh server's name as each host installs it: a stand-in, the split is the host's.
const MESH_SERVER = 'a-mesh-server'
const claudeCodeName = (own: string): string => `mcp__${MESH_SERVER}__${own}`
const openCode = openCodeToolNames([MESH_SERVER])
const openCodeName = (own: string): string => `${MESH_SERVER}_${own}`

/** Each path that is not the crew's own: the name a host calls it by, that host's split, and the argument holding the text, as each tool names it. */
const PATHS: readonly { readonly tool: string; readonly names: ToolNames; readonly argument: string }[] = [
  { tool: CLAUDE_CODE_SEND_MESSAGE_TOOL, names: claudeCodeToolNames, argument: 'message' },
  { tool: claudeCodeName(SENDS_AND_MAY_WAIT), names: claudeCodeToolNames, argument: 'text' },
  { tool: claudeCodeName(RINGS_AND_RETURNS_THE_ANSWER), names: claudeCodeToolNames, argument: 'purpose' },
  { tool: openCodeName(SENDS_AND_MAY_WAIT), names: openCode, argument: 'text' },
  { tool: openCodeName(RINGS_AND_RETURNS_THE_ANSWER), names: openCode, argument: 'purpose' },
]

const answerFor = (path: (typeof PATHS)[number], text: string): ToolCallAnswer =>
  answerToolCall({ names: path.names, tool: path.tool, input: { [path.argument]: text }, session: beginSession(store(), 's-1'), policy, launch, host: thisMachine })

const deniedFor = (path: (typeof PATHS)[number], text: string): string => {
  const answer = answerFor(path, text)
  assert.notEqual(answer, undefined, `${path.tool} sent ${JSON.stringify(text)}; it must be turned back`)
  return (answer as { deny: string }).deny
}

const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const A_HANDOFF = `HANDOFF macula-io/martha#980 ${BASE}..${TIP} r=1 ci=1`
const A_BLOCKED = 'BLOCKED macula-io/martha#980 on=ci | waiting on the runner'
const A_HANDOFF_THAT_DOES_NOT_READ = 'HANDOFF macula-io/martha#980 r=1'

test('#980: a crew line on any line of a message sent by a path not the crew\'s own is turned back to say_to_the_crew, naming the line', () => {
  for (const path of PATHS) {
    for (const line of [A_HANDOFF, A_BLOCKED]) {
      const deny = deniedFor(path, `Here is the hand-off.\n${line}\nThanks.`)
      assert.ok(deny.includes(SAY_TO_THE_CREW), `${path.tool}: the refusal does not name ${SAY_TO_THE_CREW}: ${deny}`)
      assert.ok(deny.includes(`Line 2: ${JSON.stringify(line)}`), `${path.tool}: the refusal does not name line 2 as written: ${deny}`)
      assert.doesNotMatch(deny, /does not read/, `${path.tool}: a line that reads was called unreadable: ${deny}`)
    }
  }
})

test('#980: a single crew line is named without a line number', () => {
  for (const path of PATHS) assert.ok(deniedFor(path, A_HANDOFF).includes(`The line: ${JSON.stringify(A_HANDOFF)}`), path.tool)
})

test('#980: a line that counts as a crew line and does not read is turned back too, with what did not read', () => {
  for (const path of PATHS) {
    const deny = deniedFor(path, A_HANDOFF_THAT_DOES_NOT_READ)
    assert.ok(deny.includes(SAY_TO_THE_CREW), path.tool)
    assert.match(deny, /does not read/, `${path.tool}: the refusal does not say the line does not read: ${deny}`)
    assert.match(deny, /HANDOFF: range is not a range/, `${path.tool}: the refusal does not name the field: ${deny}`)
  }
})

test('#980: prose goes by every path, a sentence opening with YES included', () => {
  for (const path of PATHS) {
    for (const prose of ['Morning. The suite is green on my side.', 'YES received and acted on', 'handoff tomorrow, the HANDOFF line follows']) {
      assert.equal(answerFor(path, prose), undefined, `${path.tool} refused prose: ${JSON.stringify(prose)}`)
    }
  }
})

test('#980: the crew\'s own path, and a mesh call that sends no text of its own, are not turned back', () => {
  const session = beginSession(store(), 's-1')
  const crews = answerToolCall({ names: claudeCodeToolNames, tool: claudeCodeName(SAY_TO_THE_CREW), input: { text: A_HANDOFF }, session, policy, launch, host: thisMachine })
  assert.equal(crews, undefined)
  const publish = answerToolCall({ names: claudeCodeToolNames, tool: claudeCodeName('mesh_publish'), input: { text: A_HANDOFF }, session, policy, launch, host: thisMachine })
  assert.equal(publish, undefined)
})
