// The audit of the gate for one member (martha#321), driven through the seam the host asks: ./answer_a_tool_call.
//
// What is proven: an audited member's call runs and leaves one line naming the path, the sender and the gate's own
// words; an enforced member refuses and leaves no line; and an audited member's call is refused when its line cannot
// be kept, because an audit that can lose its evidence is worse than none.

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { appendStateLine, readStateFile } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The crew's own files, as the host keeps them: these tests read and write them through the launcher's own calls. */
const STATE_LINES = { append: appendStateLine, read: readStateFile }
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { CLAUDE_CODE, fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { beginSession, takeInTurn, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { answerToolCall, type ApprovedLaunch, type ToolCallAnswer } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { GATE_AUDIT_PLACE, auditFileIn, theLinesIn, type GateAuditPlace } from './audit_the_gate_for_a_member.ts'

const names = claudeCodeToolNames
const policy: Policy = { may_send_executable_text: [] }

/** A member started in a directory holding no launch config, so these tests see only the rule they are about. */
const launch_home = mkdtempSync(join(tmpdir(), 'martha-321-audit-launch-'))
after(() => removeTheTree(launch_home))
const checkout = join(launch_home, 'work')
mkdirSync(checkout)
writeFileSync(join(checkout, 'README.md'), 'a checkout\n')
const launch: ApprovedLaunch = {
  host: CLAUDE_CODE,
  launch_dir: checkout,
  stop_dir: launch_home,
  approved_fingerprints: [fingerprintOf(readLaunchState({ host: CLAUDE_CODE, launch_dir: checkout, stop_dir: launch_home }, thisMachine))],
}

/** A crew's own folder for this test, removed after it, holding the audit folder the launcher would have made. */
function aCrewsPlace(t: TestContext): GateAuditPlace {
  const crew = mkdtempSync(join(tmpdir(), 'martha-321-audit-'))
  t.after(() => removeTheTree(crew))
  const directory = join(crew, GATE_AUDIT_PLACE)
  mkdirSync(directory, { mode: 0o700 })
  return { directory, member: 'builder', lines: STATE_LINES }
}

/** A session that took a stranger's ring in: the arrival the gate refuses on, and the one the audit names. */
const aSessionAForeignerReached = () => {
  const records: SessionRecordStore = { read: () => undefined, write: () => {} }
  return takeInTurn(beginSession(records, 's-1'), { source: 'ring' }, bindNothing)
}

type Asked = Partial<Parameters<typeof answerToolCall>[0]>

/** A shell call, answered the way the host asks it: the gate and the audit are each case's own. */
const bash = (session: Parameters<typeof answerToolCall>[0]['session'], more: Asked): ToolCallAnswer =>
  answerToolCall({ names, tool: CLAUDE_CODE_SHELL_TOOL, session, policy, launch, host: thisMachine, ...more })

test('#321: an audited member’s would-be refusal runs the call and writes one line, with the path, the sender and the words', (t) => {
  const audit = aCrewsPlace(t)
  const answer = bash(aSessionAForeignerReached(), { gate: 'audited', audit })
  assert.equal(answer, undefined, 'an audited member’s call was refused')

  const lines = theLinesIn(audit)
  assert.ok(!('refusal' in lines), 'the audit could not be read back')
  assert.equal(lines.length, 1, 'the audit kept no line, or more than one')
  const line = lines[0]!
  assert.equal(line['path'], 'A4', 'the line does not name the path the text arrived on')
  assert.equal(line['sender'], null, 'the line claims a sender the record does not hold')
  assert.equal(line['tool'], CLAUDE_CODE_SHELL_TOOL)
  assert.match(String(line['refusal']), /Nothing executes in this session/)
  assert.equal(Number.isNaN(Date.parse(String(line['at']))), false, 'the line carries no moment')
})

test('#321: an enforced member still refuses, word for word, and writes no audit line', (t) => {
  const audit = aCrewsPlace(t)
  const answer = bash(aSessionAForeignerReached(), { gate: 'enforced', audit })
  assert.match((answer as { deny: string }).deny, /Nothing executes in this session/)
  assert.deepEqual(theLinesIn(audit), [], 'an enforced member wrote an audit line')
})

test('#321: an off member neither refuses nor writes a line', (t) => {
  const audit = aCrewsPlace(t)
  assert.equal(bash(aSessionAForeignerReached(), { gate: 'off', audit }), undefined)
  assert.deepEqual(theLinesIn(audit), [], 'a member the gate is off for wrote an audit line')
})

test('#321: an audited call whose line cannot be kept is refused, so the audit cannot lose its own evidence', (t) => {
  const audit = aCrewsPlace(t)
  // The folder only this user may write is closed to writing: the first line cannot be kept.
  chmodSync(audit.directory, 0o500)
  let answer: ToolCallAnswer
  try {
    answer = bash(aSessionAForeignerReached(), { gate: 'audited', audit })
  } finally {
    chmodSync(audit.directory, 0o700)
  }
  assert.notEqual(answer, undefined, 'the call ran with no line kept for it')
  assert.match((answer as { deny: string }).deny, /Nothing executes in this session/)
  assert.match((answer as { deny: string }).deny, /could not be kept/)
})

test('#321: an audited member whose launcher was given no audit place is refused, never silently unaudited', () => {
  const answer = bash(aSessionAForeignerReached(), { gate: 'audited' })
  assert.notEqual(answer, undefined, 'an audited member ran with nowhere to write its line')
  assert.match((answer as { deny: string }).deny, /no place to write it/)
})

test('#321: a line is one line of JSON, so the next one can be appended after it', (t) => {
  const audit = aCrewsPlace(t)
  const session = aSessionAForeignerReached()
  bash(session, { gate: 'audited', audit })
  bash(session, { gate: 'audited', audit })
  const text = readFileSync(auditFileIn(audit), 'utf8')
  assert.equal(text.split('\n').filter((line) => line !== '').length, 2, 'two refusals did not leave two lines')
  for (const line of text.split('\n').filter((each) => each !== '')) JSON.parse(line)
})

/** A session that took nothing in: its only reason to be held is the one the case is about. */
const aSessionThatTookNothingIn = () => {
  const records: SessionRecordStore = { read: () => undefined, write: () => {} }
  return beginSession(records, 's-clean')
}

test('#321: an audited member’s shell call while an agent runs is allowed and still writes one line, naming the agent', (t) => {
  const audit = aCrewsPlace(t)
  const answer = bash(aSessionThatTookNothingIn(), { gate: 'audited', audit, agents_running: ['agent-7'] })
  assert.equal(answer, undefined, 'an audited member’s call was refused for a reason the owner never named')

  const lines = theLinesIn(audit)
  assert.ok(!('refusal' in lines), 'the audit could not be read back')
  assert.equal(lines.length, 1, 'a refusal enforcement would have given left no line for the owner')
  const line = lines[0]!
  assert.equal(line['path'], null, 'the line claims a path the refusal does not stand on')
  assert.equal(line['sender'], null, 'the line claims a sender the refusal does not stand on')
  assert.match(String(line['why']), /agent-7/, 'the line does not say which agent the shell waits on')
  assert.match(String(line['refusal']), /Nothing executes in this session/)
})

test('#321: an audited member whose record cannot be read is allowed and still writes one line, saying why', (t) => {
  const audit = aCrewsPlace(t)
  const lost = { id: 's-lost', gate: { ingested: [] }, record_missing: true }
  const answer = bash(lost, { gate: 'audited', audit })
  assert.equal(answer, undefined, 'an audited member’s call was refused for a reason the owner never named')

  const lines = theLinesIn(audit)
  assert.ok(!('refusal' in lines), 'the audit could not be read back')
  assert.equal(lines.length, 1, 'a refusal enforcement would have given left no line for the owner')
  const line = lines[0]!
  assert.equal(line['path'], null, 'the line claims a path the refusal does not stand on')
  assert.match(String(line['why']), /record .*cannot be read/i, 'the line does not say why the gate would have refused')
})
