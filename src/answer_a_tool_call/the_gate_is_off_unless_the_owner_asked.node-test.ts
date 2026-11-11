// The strict shell gate is off unless the owner asked for it (martha#259).
//
// The owner's rule, from the reset: members are trusted helpers, and the safety is review plus a yes on every push.
// So a member that read a file, a tool result or an agent's answer keeps its shell by default, and the gate that
// stopped it runs only for an owner who turned it on in the crew's declaration.
//
// These drive the same seam the host asks, ./answer_a_tool_call, so what is proven is the answer a member gets and
// not a helper's. Each case is given twice: with the gate off (the default an owner who wrote no setting gets) and
// with it on, so the guard is shown to still stand.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import {
  readHandover,
  stampHandover,
  type HandoverStamp,
  type HandoverStampStore,
} from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import type { Policy, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { beginSession, rememberSession, resumeSession, takeInTurn, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { takeInToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

import { answerToolCall, type ApprovedLaunch, type ToolCallAnswer } from './answer_a_tool_call.ts'

const names = claudeCodeToolNames

// A member started in a directory holding no launch config, so these tests see only the rule they are about.
const launch_home = mkdtempSync(join(tmpdir(), 'martha-259-no-launch-config-'))
after(() => rmSync(launch_home, { recursive: true, force: true }))
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
  assert.equal(bash(afterAnUnplacedResult(), { strict_gate: false }), undefined)
})

test('on: the same unplaced result still closes the shell', () => {
  const answer = denied(bash(afterAnUnplacedResult(), { strict_gate: true }), 'a gate that is on')
  assert.match(answer, /nothing executes/i)
})

// --- a background agent that has not stopped (#170) -----------------------------

test('off: a member keeps its shell while an agent it started has not stopped', () => {
  assert.equal(bash(beginSession(store(), 's-1'), { agents_running: ['agent-7'], strict_gate: false }), undefined)
})

test('on: the same running agent still closes the shell', () => {
  denied(bash(beginSession(store(), 's-1'), { agents_running: ['agent-7'], strict_gate: true }), 'a gate that is on')
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
  assert.equal(bash(afterARefresh(), { strict_gate: false }), undefined)
})

test('on: the same handover still carries the taint', () => {
  denied(bash(afterARefresh(), { strict_gate: true }), 'a gate that is on')
})

// --- a record nobody can read ---------------------------------------------------

test('off: a member whose record cannot be read keeps its shell', () => {
  assert.equal(bash(resumeSession(store(), 'a-session-the-store-never-saw'), { strict_gate: false }), undefined)
})

test('on: the same lost record still closes the shell', () => {
  denied(bash(resumeSession(store(), 'a-session-the-store-never-saw'), { strict_gate: true }), 'a gate that is on')
})

// --- the fail-closed default ----------------------------------------------------

test('a call site that says nothing keeps the gate: an out-of-date caller cannot lose it', () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  denied(bash(tainted), 'a call site with no flag')
})

test("off never widens what the owner did not switch: the record is still written, and reading is still allowed", () => {
  const tainted = takeInTurn(beginSession(store(), 's-1'), { source: 'ring' }, bindNothing)
  assert.equal(answerToolCall({ names, tool: 'Read', session: tainted, policy, launch, host: thisMachine, strict_gate: false }), undefined)
  assert.equal(tainted.gate.ingested.length, 1, 'the record still holds what arrived')
})
