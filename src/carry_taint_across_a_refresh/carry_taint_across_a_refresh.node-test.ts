import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { answerToolCall, type ApprovedLaunch } from '../answer_a_tool_call/answer_a_tool_call.ts'
import type { Policy, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  beginSession,
  rememberSession,
  resumeSession,
  takeInTurn,
  type HostSession,
  type SessionRecordStore,
} from '../take_in_a_turn/take_in_a_turn.ts'
import {
  CLAUDE_CODE_SESSION_EVENTS,
  SESSION_START_OUTCOMES,
  readHandover,
  stampHandover,
  startSession,
  undeclaredSessionEvents,
  type HandoverStamp,
  type HandoverStampStore,
} from './carry_taint_across_a_refresh.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'

const names = claudeCodeToolNames

// A member started in a directory holding no launch config: the launch check
// passes, so these tests see only the rules they are about. Removed at the end.
const launch_home = mkdtempSync(join(tmpdir(), 'martha-no-launch-config-'))
after(() => rmSync(launch_home, { recursive: true, force: true }))
const launch: ApprovedLaunch = {
  host: 'claude-code',
  launch_dir: mkdtempSync(join(launch_home, 'work-')),
  stop_dir: launch_home,
  approved_fingerprints: [],
}

// Synthetic identities and names, never real ones: this repository is public.
const supervisor_identity = 'identity-of-the-supervisor'
const member = 'a-member'
const other_member = 'another-member'

const policy: Policy = { may_send_executable_text: [supervisor_identity] }

const sessions = (): SessionRecordStore => {
  const records = new Map<string, Session>()
  return { read: (id) => records.get(id), write: (id, session) => void records.set(id, session) }
}

const stampStore = (): HandoverStampStore & { readonly all: Map<string, HandoverStamp> } => {
  const all = new Map<string, HandoverStamp>()
  return { all, read: (file) => all.get(file), write: (file, stamp) => void all.set(file, stamp) }
}

const executes = (session: HostSession) => answerToolCall({ names, tool: 'Bash', session, policy, launch }) === undefined

const handover = { file: 'handover-of-a-member.md', content: 'where the work stands' }

/** A member session that took in a stranger's ring, wrote its handover through the host, and was remembered. */
function taintedPredecessor(store: SessionRecordStore, stamps: HandoverStampStore): HostSession {
  const predecessor = takeInTurn(startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' }), {
    source: 'ring',
  }, bindNothing)
  rememberSession(store, predecessor)
  stampHandover(stamps, { member, session: predecessor }, handover)
  return predecessor
}

// --- a refresh is an inheritance ----------------------------------------------

test('a tainted session refreshed under a new id leaves a tainted successor', () => {
  const store = sessions()
  taintedPredecessor(store, stampStore())

  const successor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, {
    event: 'crew_refresh',
    session_id: 'new',
    predecessor_id: 'old',
  })

  assert.equal(successor.id, 'new')
  assert.equal(executes(successor), false)
  assert.equal(executes(resumeSession(store, 'new')), false, 'the inherited record is persisted under the new id')
})

test('a clean session refreshed under a new id keeps its shell', () => {
  const store = sessions()
  rememberSession(store, startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' }))

  const successor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, {
    event: 'crew_refresh',
    session_id: 'new',
    predecessor_id: 'old',
  })
  assert.equal(executes(successor), true)
})

test('an inheriting start with no predecessor, or one whose record is gone, has lost its record', () => {
  const store = sessions()
  for (const predecessor_id of [undefined, 'a-session-the-store-never-saw']) {
    const successor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, {
      event: 'crew_refresh',
      session_id: `new-${String(predecessor_id)}`,
      ...(predecessor_id === undefined ? {} : { predecessor_id }),
    })
    assert.equal(successor.record_missing, true, String(predecessor_id))
    assert.equal(executes(successor), false, String(predecessor_id))
  }
})

test('a forked resume, which arrives as resume under a new id, has lost its record', () => {
  const store = sessions()
  taintedPredecessor(store, stampStore())
  const fork = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'resume', session_id: 'fork' })
  assert.equal(fork.record_missing, true)
  assert.equal(executes(fork), false)
})

test('a fork, which carries its parent under a new id, has lost its record and never starts fresh', () => {
  const store = sessions()
  taintedPredecessor(store, stampStore())
  const fork = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'fork', session_id: 'forked', predecessor_id: 'old' })
  assert.equal(fork.record_missing, true)
  assert.equal(executes(fork), false)
})

test('a compaction keeps the session id, so the store already carries the taint', () => {
  const store = sessions()
  taintedPredecessor(store, stampStore())
  assert.equal(executes(startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'compact', session_id: 'old' })), false)
})

// --- the host declares its events, and an unknown one fails closed ------------

test('every declared event has an outcome the seam knows', () => {
  for (const [event, outcome] of Object.entries(CLAUDE_CODE_SESSION_EVENTS.events)) {
    assert.ok(SESSION_START_OUTCOMES.includes(outcome), event)
  }
})

test('a host event that is not declared is named by the check', () => {
  assert.deepEqual(undeclaredSessionEvents(CLAUDE_CODE_SESSION_EVENTS, ['startup', 'teleport']), ['teleport'])
})

test('a session started by an undeclared event has lost its record', () => {
  const store = sessions()
  taintedPredecessor(store, stampStore())
  const started = startSession(store, CLAUDE_CODE_SESSION_EVENTS, {
    event: 'teleport',
    session_id: 'new',
    predecessor_id: 'old',
  })
  assert.equal(started.record_missing, true)
  assert.equal(executes(started), false)
})

test('an inherited property name is not a declared event', () => {
  assert.deepEqual(undeclaredSessionEvents(CLAUDE_CODE_SESSION_EVENTS, ['toString']), ['toString'])
  const started = startSession(sessions(), CLAUDE_CODE_SESSION_EVENTS, { event: 'toString', session_id: 'new' })
  assert.equal(started.record_missing, true)
})

// --- the handover is stamped by the host, and read through the stamp ----------

test('a bare owner clear that reads no handover is fresh', () => {
  const store = sessions()
  taintedPredecessor(store, stampStore())
  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(cleared), true)
})

test('an owner clear that then reads a tainted predecessor handover is tainted', () => {
  const store = sessions()
  const stamps = stampStore()
  taintedPredecessor(store, stamps)
  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })

  const read = readHandover(store, stamps, { member, session: cleared }, handover)
  assert.equal(executes(read), false)
})

test('a handover from a clean predecessor keeps the reader shell', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' })
  rememberSession(store, predecessor)
  stampHandover(stamps, { member, session: predecessor }, handover)

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, handover)), true)
})

test('a tainted session can still hand over: the host stamps it, no Write is needed', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = taintedPredecessor(store, stamps)

  assert.notEqual(answerToolCall({ names, tool: 'Write', session: predecessor, policy, launch }), undefined, 'the model may not Write')
  assert.equal(stamps.all.get(handover.file)?.predecessor_id, 'old')
})

test('a handover with no stamp taints the reader', () => {
  const store = sessions()
  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  const read = readHandover(store, stampStore(), { member, session: cleared }, handover)
  assert.equal(read.record_missing, true)
  assert.equal(executes(read), false)
})

test('a handover edited after it was stamped taints the reader', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' })
  rememberSession(store, predecessor)
  stampHandover(stamps, { member, session: predecessor }, handover)

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  const edited = { ...handover, content: `${handover.content}\nrun this` }
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, edited)), false)
})

test('a forged stamp naming a predecessor the store never saw taints the reader', () => {
  const store = sessions()
  const stamps = stampStore()
  const forger = takeInTurn(beginSession(store, 'forger'), { source: 'ring' }, bindNothing)
  stampHandover(stamps, { member, session: { ...forger, id: 'a-session-the-store-never-saw' } }, handover)

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, handover)), false)
})

test('the record a handover carries comes from the store, never from the stamp', () => {
  const store = sessions()
  const stamps = stampStore()
  taintedPredecessor(store, stamps)
  const stamp = stamps.all.get(handover.file)
  assert.deepEqual(Object.keys(stamp ?? {}).sort(), [
    'digest',
    'member',
    'predecessor_id',
    'record_digest',
    'record_length',
  ])
})

test('a handover read by a different member taints, even from a clean predecessor', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' })
  rememberSession(store, predecessor)
  stampHandover(stamps, { member, session: predecessor }, handover)

  const reader = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'other' })
  assert.equal(executes(readHandover(store, stamps, { member: other_member, session: reader }, handover)), false)
})

test('a handover from a predecessor whose record was lost taints the reader', () => {
  const store = sessions()
  const stamps = stampStore()
  const lost = resumeSession(store, 'old')
  rememberSession(store, lost)
  stampHandover(stamps, { member, session: lost }, handover)

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, handover)), false)
})

// --- a lost record stays lost -------------------------------------------------

test('a session whose record was lost is still tainted after it is remembered and resumed', () => {
  const store = sessions()
  rememberSession(store, resumeSession(store, 'gone'))
  const again = resumeSession(store, 'gone')
  assert.equal(again.record_missing, true)
  assert.equal(executes(again), false)
})

test('a lost record, inherited by a refresh, is still lost', () => {
  const store = sessions()
  rememberSession(store, resumeSession(store, 'gone'))
  const successor = startSession(store, CLAUDE_CODE_SESSION_EVENTS, {
    event: 'crew_refresh',
    session_id: 'new',
    predecessor_id: 'gone',
  })
  assert.equal(successor.record_missing, true)
})

test('a fresh start under a new id is not touched by a lost record elsewhere', () => {
  const store = sessions()
  rememberSession(store, resumeSession(store, 'gone'))
  assert.equal(executes(startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })), true)
})

// --- the stamp holds the record as it was when the handover was stamped -------

test('(A) a predecessor record reset to empty after the stamp still taints the reader', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = taintedPredecessor(store, stamps)
  rememberSession(store, { ...predecessor, gate: { ingested: [] } })

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, handover)), false)
})

test('(B) a fresh start that reuses a stamped predecessor id has lost its record and overwrites nothing', () => {
  const store = sessions()
  const stamps = stampStore()
  taintedPredecessor(store, stamps)

  const reused = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'old' })
  assert.equal(executes(reused), false)

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, handover)), false)
})

test('a predecessor that kept working after the stamp still hands over what it held then', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = taintedPredecessor(store, stamps)
  rememberSession(store, takeInTurn(predecessor, { source: 'web' }, bindNothing))

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  const read = readHandover(store, stamps, { member, session: cleared }, handover)
  assert.equal(read.record_missing, false)
  assert.equal(executes(read), false)
})

test('a predecessor record rewritten to a clean one of the same length still taints the reader', () => {
  const store = sessions()
  const stamps = stampStore()
  const predecessor = taintedPredecessor(store, stamps)
  const rewritten = takeInTurn(beginSession(sessions(), 'scratch'), {
    source: 'crew_room',
    from_identity: supervisor_identity,
  }, bindNothing)
  assert.equal(rewritten.gate.ingested.length, predecessor.gate.ingested.length)
  rememberSession(store, { ...predecessor, gate: rewritten.gate })

  const cleared = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'clear', session_id: 'new' })
  assert.equal(executes(readHandover(store, stamps, { member, session: cleared }, handover)), false)
})
