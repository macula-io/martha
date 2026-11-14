// The strict shell gate is off unless the owner asked for it (martha#259).
//
// The owner's rule, decided on 2026-11-11: members are trusted helpers, and the safety is review plus a yes on every push.
// So a member that read a file, a tool result or an agent's answer keeps its shell by default, and the gate that
// stopped it runs only for an owner who turned it on in the crew's declaration.
//
// These drive the same seam the host asks, ./answer_a_tool_call, so what is proven is the answer a member gets and
// not a helper's. Each case is given twice: with the gate off (the default an owner who wrote no setting gets) and
// with it on, so the guard is shown to still stand.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { readHandover, stampHandover } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import type { HandoverStamp, HandoverStampStore } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import {
  WHAT_CLEARS_IT,
  type Policy,
  type Session,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  beginSession,
  PATH_OF_SOURCE,
  rememberSession,
  resumeSession,
  takeInTurn,
  type SessionRecordStore,
} from '../take_in_a_turn/take_in_a_turn.ts'
import { takeInToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

import { answerToolCall, type ApprovedLaunch, type ToolCallAnswer } from './answer_a_tool_call.ts'

const names = claudeCodeToolNames

// A member started in a directory holding no launch config, so these tests see only the rule they are about.
const launch_home = mkdtempSync(join(tmpdir(), 'martha-259-no-launch-config-'))
after(() => removeTheTree(launch_home))
const checkout = join(launch_home, 'work')
mkdirSync(checkout)
writeFileSync(join(checkout, 'README.md'), 'a checkout\n')
const launch: ApprovedLaunch = {
  host: 'claude-code',
  launch_dir: checkout,
  stop_dir: launch_home,
  approved_fingerprints: [fingerprintOf(readLaunchState({ host: 'claude-code', launch_dir: checkout, stop_dir: launch_home }, thisMachine))],
}

const policy: Policy = { may_send_executable_text: [] }

const store = (): SessionRecordStore => {
  const records = new Map<string, Session>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session) }
}

type Asked = Parameters<typeof answerToolCall>[0]

/** A shell call, answered the way the host asks it. */
const bash = (session: Asked['session'], more: Partial<Asked> = {}): ToolCallAnswer =>
  answerToolCall({ names, tool: 'Bash', session, policy, launch, host: thisMachine, ...more })

const denied = (answer: ToolCallAnswer, why: string): string => {
  assert.notEqual(answer, undefined, `${why}: the tool call was allowed, and it must be refused`)
  return (answer as { deny: string }).deny
}

/** The refusal names the path the text arrived on, by the registry's own id for it. */
const namesThePath = (answer: string, source: keyof typeof PATH_OF_SOURCE): void => {
  assert.match(answer, new RegExp(`path ${PATH_OF_SOURCE[source]} \\(`))
}

// --- a tool result Martha could not place --------------------------------------

/** The session after a tool the host's own table does not name ran: what an unplaced result records. */
const afterAnUnplacedResult = () =>
  takeInToolResult(
    beginSession(store(), 's-1'),
    {
      tool: 'a-tool-the-host-added-later',
      input: {},
      rows: {},
      launch,
      approved_start: null,
      started_with: undefined,
      read_attaches_nothing: undefined,
      host: thisMachine,
    },
    bindNothing,
  )

test('off: a member keeps its shell after a tool result Martha could not place', () => {
  const session = afterAnUnplacedResult()
  assert.equal(bash(session, { gate: 'off' }), undefined)
  // The record is not switched off with the gate: what arrived is still written down, and nothing reads it.
  assert.equal(session.gate.ingested.length, 1, 'the unplaced result is still recorded')
})

test('on: the same unplaced result still closes the shell', () => {
  const answer = denied(bash(afterAnUnplacedResult(), { gate: 'enforced' }), 'a gate that is on')
  // The words name the result that could not be placed, so a switch that broke another rule cannot pass this.
  assert.match(answer, /a-tool-the-host-added-later/)
  assert.match(answer, /which this gate does not know/i)
  assert.ok(answer.includes(WHAT_CLEARS_IT))
})

// --- a background agent that has not stopped (#170) -----------------------------

test('off: a member keeps its shell while an agent it started has not stopped', () => {
  assert.equal(bash(beginSession(store(), 's-1'), { agents_running: ['agent-7'], gate: 'off' }), undefined)
})

test('on: the same running agent still closes the shell', () => {
  const answer = denied(bash(beginSession(store(), 's-1'), { agents_running: ['agent-7'], gate: 'enforced' }), 'a gate that is on')
  // The words name the agent, so a switch that broke another rule cannot pass this.
  assert.match(answer, /an agent this host started \(agent-7\) has not stopped/i)
  assert.match(answer, /the shell comes back when it stops/i)
})

// --- a refresh, which inherits the predecessor's record -------------------------

/** The stamps a host keeps, in memory: a real one keeps them beside the handover files. */
const stampStore = (): HandoverStampStore & { readonly kept: Map<string, HandoverStamp> } => {
  const kept = new Map<string, HandoverStamp>()
  return { kept, read: (file) => kept.get(file), write: (file, stamp) => void kept.set(file, stamp) }
}

/** A successor that read the handover a tainted predecessor's host wrote. */
const afterARefresh = () => {
  const records = store()
  const stamps = stampStore()
  const tainted = takeInTurn(beginSession(records, 's-1'), { source: 'cross_session' }, bindNothing)
  rememberSession(records, tainted)

  const handover = { file: join(launch_home, 'HANDOVER.md'), content: 'what the predecessor was doing\n' }
  stampHandover(stamps, { member: 'builder', session: tainted }, handover)
  return readHandover(records, stamps, { member: 'builder', session: beginSession(records, 's-2') }, handover)
}

test("off: a successor that read a tainted predecessor's handover keeps its shell", () => {
  const successor = afterARefresh()
  assert.equal(bash(successor, { gate: 'off' }), undefined)
  // The carry is not switched off with it: the successor's record still holds the predecessor's text, unread.
  assert.equal(successor.gate.ingested.length, 1, 'the predecessor\'s record is still carried')
})

test('on: the same handover still carries the taint', () => {
  const answer = denied(bash(afterARefresh(), { gate: 'enforced' }), 'a gate that is on')
  // The words name the path the inherited text arrived on, so a switch that broke another rule cannot pass this.
  namesThePath(answer, 'cross_session')
  assert.match(answer, /an unattributed sender/i)
  assert.ok(answer.includes(WHAT_CLEARS_IT))
})

// --- a record nobody can read ---------------------------------------------------

test('off: a member whose record cannot be read keeps its shell', () => {
  assert.equal(bash(resumeSession(store(), 'a-session-the-store-never-saw'), { gate: 'off' }), undefined)
})

test('on: the same lost record still closes the shell', () => {
  const answer = denied(bash(resumeSession(store(), 'a-session-the-store-never-saw'), { gate: 'enforced' }), 'a gate that is on')
  // The words say the record cannot be read, so a switch that broke another rule cannot pass this.
  assert.match(answer, /its record of what it has taken in cannot be read/i)
  assert.ok(answer.includes(WHAT_CLEARS_IT))
})

// --- the fail-closed default ----------------------------------------------------

test('a call site that says nothing keeps the gate: an out-of-date caller cannot lose it', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  const answer = denied(bash(tainted), 'a call site with no flag')
  // The owner's taint rule, in the words it always used, not one of the two the switch turns off.
  namesThePath(answer, 'ring')
  assert.match(answer, /an unattributed sender/i)
  assert.ok(answer.includes(WHAT_CLEARS_IT))
})

test("off never widens what the owner did not switch: the record is still written, and reading is still allowed", () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  assert.equal(answerToolCall({ names, tool: 'Read', session: tainted, policy, launch, host: thisMachine, gate: 'off' }), undefined)
  assert.equal(tainted.gate.ingested.length, 1, 'the record still holds what arrived')
})
