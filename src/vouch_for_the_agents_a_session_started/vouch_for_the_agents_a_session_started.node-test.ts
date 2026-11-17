// What a launcher knows of the agents a session started, and when one may be vouched for (martha#170).
//
// The table is the launcher's own and the relay asks it on every call and every answer: what is pinned here is the
// vouched rule itself — seen to start, seen to stop, every call it made answered here, and nothing those calls read that
// the gate counts — and the placement of a result by what the launcher knows of the agent, never by what a call says.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  agentOfAResult,
  agentsToHold,
  noteAnAgentsAnswer,
  noteTheAgentsCall,
  noteWhatItsCallsRead,
  runOf,
  vouchedRun,
  type AgentRun,
} from './vouch_for_the_agents_a_session_started.ts'

/** The session every run here belongs to, and the id the host stamps on one agent. */
const SESSION = 'session-1'
const AGENT = 'agent-7'

/** A run the host has started and stopped, with one call in it that this launcher answered. */
function aFinishedRun(): AgentRun {
  const run: AgentRun = { session_id: SESSION, calls_seen: new Set(['call-1']), calls_answered: new Set(['call-1']), started: true, stopped: true, calls_recorded: [] }
  return run
}

test('an agent seen to start and stop, every call answered and nothing read, is vouched for', () => {
  assert.equal(vouchedRun(aFinishedRun()), true)
  assert.equal(vouchedRun(undefined), false)
})

test('one call the launcher never answered takes the vouching away', () => {
  const run = aFinishedRun()
  run.calls_seen.add('call-2')
  assert.equal(vouchedRun(run), false)
})

test('a run that read a row the gate counts is not vouched for, however many calls it answered', () => {
  const run = aFinishedRun()
  run.calls_recorded.push('a row of text from outside')
  assert.equal(vouchedRun(run), false)
})

test('a run is made on first sight and vouches for nothing until the host has started and stopped it', () => {
  const runs = new Map<string, AgentRun>()
  const run = runOf(runs, SESSION, AGENT)
  assert.deepEqual({ ...run, calls_seen: [...run.calls_seen], calls_answered: [...run.calls_answered] }, {
    session_id: SESSION, calls_seen: [], calls_answered: [], started: false, stopped: false, calls_recorded: [],
  })
  assert.equal(vouchedRun(run), false)
  assert.equal(runOf(runs, SESSION, AGENT), run, 'a second sighting makes a second run')
})

test('the agents still running under a session hold it, and one this launcher never saw start is named as such', () => {
  const runs = new Map<string, AgentRun>()
  const seen = runOf(runs, SESSION, AGENT)
  seen.started = true
  const unseen = runOf(runs, SESSION, 'agent-8')
  seen.stopped = true
  assert.deepEqual(agentsToHold(runs, SESSION, undefined), ['an agent this launcher never saw start (agent-8)'])
  assert.deepEqual(agentsToHold(runs, SESSION, AGENT), [], "an agent's own call is not held by its run")
  unseen.stopped = true
  assert.deepEqual(agentsToHold(runs, SESSION, undefined), [])
})

test("an agent's call and answer are noted on its run, and the member's own call carries no agent", () => {
  const runs = new Map<string, AgentRun>()
  const call = { tool: 'a_tool', tool_use_id: 'call-1', agent_id: AGENT }
  assert.equal(noteTheAgentsCall(runs, SESSION, { call }), AGENT)
  assert.equal(noteAnAgentsAnswer(runs, { call }), AGENT)
  assert.deepEqual([...runs.get(AGENT)!.calls_seen], ['call-1'])
  assert.deepEqual([...runs.get(AGENT)!.calls_answered], ['call-1'])
  // The member's own call carries no id, notes nothing and makes no run.
  assert.equal(noteTheAgentsCall(runs, SESSION, { call: { tool: 'a_tool', tool_use_id: 'call-2' } }), undefined)
  assert.equal(noteAnAgentsAnswer(runs, { call: { tool: 'a_tool', tool_use_id: 'call-2' } }), undefined)
  assert.equal(runs.size, 1)
})

test("a result is placed by the answer's agent id, else by the call's, and an agent it knows nothing of is unknown", () => {
  const runs = new Map<string, AgentRun>()
  runs.set(AGENT, aFinishedRun())
  assert.deepEqual(agentOfAResult(runs, { agent_id: undefined }, { agentId: AGENT }), { id: AGENT, state: 'vouched' })
  assert.deepEqual(agentOfAResult(runs, { agent_id: AGENT }, {}), { id: AGENT, state: 'vouched' })
  assert.deepEqual(agentOfAResult(runs, { agent_id: 'agent-9' }, {}), { id: 'agent-9', state: 'unknown' })
  assert.equal(agentOfAResult(runs, { agent_id: undefined }, {}), undefined)
})

test('a row an answered call read is kept on its run, and one that read nothing keeps nothing', () => {
  const runs = new Map<string, AgentRun>()
  runOf(runs, SESSION, AGENT)
  noteWhatItsCallsRead(runs, AGENT, ['a row'])
  assert.deepEqual([...runs.get(AGENT)!.calls_recorded], ['a row'])
  noteWhatItsCallsRead(runs, AGENT, [])
  noteWhatItsCallsRead(runs, undefined, ['a row'])
  assert.deepEqual([...runs.get(AGENT)!.calls_recorded], ['a row'])
})
