// Rule (a) on a call the agent ran without asking (#541 package A, design r=7 "The gate on an unasked call", "Proof for
// R1' and R1''"). Each case runs the stand-in agent as a child over real pipes, through the client's update listener,
// as the engine's launch hears it: the stand-in speaks in the engine's order and names its calls the engine's way.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { theEnginesNamingOf, type AStep, type AnAgentScript } from '../stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'
import { theEnginesNameOf } from './answer_a_goose_call_by_the_entry.ts'
import { AcpClient, TOOL_CALL_STATUS, UPDATE, type AToolCall } from './the_acp_client.ts'
import { theCallsAnAgentRan } from './the_calls_an_agent_ran.ts'

const STAND_IN = join(import.meta.dirname, '..', 'stand_in_for_an_acp_agent', 'main.ts')
const NAMING = RECORDED_GOOSE_ENGINE.tool_naming

/** A call named as the engine names it, by the name its `tool_call` update carries; its title when it carries none. */
const nameOf = (call: AToolCall): string =>
  theEnginesNameOf({ sessionId: '', toolCallId: call.toolCallId, title: '', rawInput: undefined, heard: call }, NAMING) ?? call.title ?? call.toolCallId

/** An update for a call the engine reports and never asks about. */
const reported = (id: string, status: string, name?: string): AStep => ({
  update: {
    sessionUpdate: status === TOOL_CALL_STATUS.pending ? UPDATE.toolCall : UPDATE.toolCallUpdate,
    toolCallId: id,
    title: `a call ${id}`,
    status,
    ...(name === undefined ? {} : { _meta: theEnginesNamingOf(name) }),
  },
})

interface WhatTheLaunchHeard {
  readonly stops: readonly string[]
  readonly results: readonly AToolCall[]
}

/** One turn of the stand-in, every permission request answered allow and marked asked, every update judged. */
async function aTurnHeard(script: AnAgentScript): Promise<WhatTheLaunchHeard> {
  const calls = theCallsAnAgentRan(nameOf)
  const stops: string[] = []
  const results: AToolCall[] = []
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify(script)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const client = AcpClient.overAChild(
    child,
    (request) => {
      calls.asked(request.sessionId, request.toolCallId)
      return 'allow'
    },
    (sessionId, update) => {
      const said = calls.heard(sessionId, update)
      if ('stop' in said) stops.push(said.stop)
      if ('result' in said) results.push(said.result)
    },
  )
  try {
    await client.initialize()
    const { sessionId } = await client.newSession('/')
    await client.prompt(sessionId, 'go')
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
  return { stops, results }
}

/** The skill tool Mars's condition names (PASS r=7 ruling B): the config offers it to no session, so a call of it is unasked. */
const LOAD_SKILL = 'load_skill'

test("an unasked load_skill call, Pending then its result, stops the member and the stop names the call (#541 package A, rule (a); Mars's condition on ruling B)", async () => {
  const heard = await aTurnHeard({ turns: [[reported('skill-1', TOOL_CALL_STATUS.pending, LOAD_SKILL), reported('skill-1', TOOL_CALL_STATUS.completed)]] })
  assert.equal(heard.stops.length, 1, JSON.stringify(heard.stops))
  assert.match(heard.stops[0] ?? '', /call skill-1 \(load_skill\)/)
  assert.match(heard.stops[0] ?? '', /without asking/)
  assert.deepEqual(heard.results, [], 'an unasked call is never recorded as a result')
})

test('the real order (Pending, the permission request, the answer, the result) stops nothing and records the result once (#541 package A, rule (a); mutant: judged at Pending)', async () => {
  const heard = await aTurnHeard({ turns: [[{ call: { id: 'asked-1', title: 'shell: ls', input: { command: 'ls' }, name: 'developer__shell' } }]] })
  assert.deepEqual(heard.stops, [])
  assert.equal(heard.results.length, 1)
  assert.equal(heard.results[0]?.status, TOOL_CALL_STATUS.completed)
  assert.deepEqual(heard.results[0]?.rawInput, { command: 'ls' }, 'the result carries the arguments its first update named')
  assert.equal(nameOf(heard.results[0] as AToolCall), 'developer__shell', "the result carries the engine's naming from its first update")
})

test('an unasked call that only says it is in progress stops the member (#541 package A, rule (a))', async () => {
  const heard = await aTurnHeard({ turns: [[reported('running-1', TOOL_CALL_STATUS.inProgress)]] })
  assert.equal(heard.stops.length, 1)
  assert.match(heard.stops[0] ?? '', /call running-1 .*in_progress/)
})

test('an unasked failed result stops the member too (#541 package A, rule (a))', async () => {
  const heard = await aTurnHeard({ turns: [[reported('failed-1', TOOL_CALL_STATUS.failed)]] })
  assert.equal(heard.stops.length, 1)
})

test('a Pending update alone, or one with no status, is never judged (#541 package A, rule (a))', async () => {
  const noStatus: AStep = { update: { sessionUpdate: UPDATE.toolCallUpdate, toolCallId: 'quiet-1', title: 'a call quiet-1' } }
  const heard = await aTurnHeard({ turns: [[reported('quiet-1', TOOL_CALL_STATUS.pending), noStatus]] })
  assert.deepEqual(heard, { stops: [], results: [] })
})

test("an asked call's second final update is not recorded again (#541 package A, rule (a))", async () => {
  const again = reported('asked-2', TOOL_CALL_STATUS.completed)
  const heard = await aTurnHeard({ turns: [[{ call: { id: 'asked-2', title: 'shell: ls', input: { command: 'ls' } } }, again]] })
  assert.deepEqual(heard.stops, [])
  assert.equal(heard.results.length, 1)
})
