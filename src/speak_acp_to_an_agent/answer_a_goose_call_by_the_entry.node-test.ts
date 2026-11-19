// A Goose call answered by the entry (macula-io/martha#541, packages 7-8, part C4). Each case runs the stand-in agent
// as a child over real pipes, speaking as the recorded Goose engine does, with the real client and the Decide package
// 9a builds over this slice's gate, and reads what the engine heard from the agent's side of the wire. The entry is a
// stand-in that records what it was asked and answers from the case. The tool is on the owner's approved list, so an
// allow runs once and no case waits on the owner: the screen the asks would be raised on fails any case that touches it.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import type { ACalledTool, TheAnswerToACall } from '../host_contract/host_contract.ts'
import { theOwnersAsks } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { TheScreenKeeper } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import { STAND_IN_SESSION, type AnAgentScript, type AStep } from '../stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'
import { ALLOW_ONCE, REJECT_ONCE } from './answer_a_permission_once.ts'
import { gooseToolNames, theGooseGate, theGooseShellTool } from './answer_a_goose_call_by_the_entry.ts'
import { AcpClient } from './the_acp_client.ts'

const STAND_IN = join(import.meta.dirname, '..', 'stand_in_for_an_acp_agent', 'main.ts')
const NAMING = RECORDED_GOOSE_ENGINE.tool_naming
/** A server-prefixed name whose own part holds the separator too, so where the name is split shows. */
const A_SERVERS_TOOL = { server: 'crew_tools', own: `hand${NAMING.separator}over` }
const A_NAMED_CALL = { id: 'call-7', title: 'crew tools: hand  over', input: { to: 'the-reviewer' }, name: `${A_SERVERS_TOOL.server}${NAMING.separator}${A_SERVERS_TOOL.own}` }
const A_DENIAL = 'the gate refuses this call'
/** What the engine makes of a refusal, and of an allow, from the call's own update. */
const REFUSED = { heard: REJECT_ONCE, runs: 0, saves: 0 }
const RAN = { heard: ALLOW_ONCE, runs: 1, saves: 0 }

/** A screen no case may reach: an allowed tool is on the approved list, and a refused call asks no one. */
const NO_SCREEN = new Proxy({}, { get: (_target, key) => { throw new Error(`the owner was asked: the screen's ${String(key)} was read`) } }) as TheScreenKeeper

/** One turn of one scripted call, decided by the gate through package 9a's Decide; what the engine made of it, and what the entry was asked. */
async function oneCall(call: Extract<AStep, { call: unknown }>['call'], answer: unknown): Promise<{ heard: unknown; asked: readonly ACalledTool[]; notes: readonly string[] }> {
  const script: AnAgentScript = { turns: [[{ call }]] }
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify(script)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const asked: ACalledTool[] = []
  const entry = { aToolCalled: async (called: ACalledTool): Promise<TheAnswerToACall> => { asked.push(called); return answer as TheAnswerToACall } }
  const asks = theOwnersAsks({ screen: NO_SCREEN, now: () => 0, anOwnerActStandsBehind: () => false })
  const client = AcpClient.overAChild(child, asks.decide(theGooseGate(entry, NAMING), [A_NAMED_CALL.name]))
  try {
    await client.initialize()
    const { sessionId } = await client.newSession('/')
    const turn = await client.prompt(sessionId, 'go')
    return { heard: turn.toolCalls[0]?.rawOutput, asked, notes: client.notes }
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
}

test('an entry that allows is the only allow: the engine hears allow_once and runs the call', async () => {
  const { heard, asked } = await oneCall(A_NAMED_CALL, { allowed: 1 })
  assert.deepEqual(heard, RAN)
  assert.equal(asked.length, 1)
})

test('an entry that denies is answered reject_once, and the call does not run', async () => {
  const { heard, asked } = await oneCall(A_NAMED_CALL, { denied: A_DENIAL })
  assert.deepEqual(heard, REFUSED)
  assert.equal(asked.length, 1)
})

test('any other answer from the entry is a refusal that says so: the call does not run', async () => {
  for (const answer of [{ allowed: 0 }, { allowed: true }, {}, { allowed: 1, denied: A_DENIAL }, { denied: 1 }, 'allowed', undefined]) {
    const { heard, notes } = await oneCall(A_NAMED_CALL, answer)
    assert.deepEqual(heard, REFUSED, JSON.stringify(answer))
    assert.match(notes.join('\n'), /the entry answered call call-7 with neither an allow nor a deny/, JSON.stringify(answer))
  }
})

test('the entry is asked the call in the contract\'s words: the session, the engine\'s name, the input and the call\'s id', async () => {
  const { asked } = await oneCall(A_NAMED_CALL, { allowed: 1 })
  assert.deepEqual(asked, [{ session_id: STAND_IN_SESSION, tool: A_NAMED_CALL.name, input: A_NAMED_CALL.input, call_id: A_NAMED_CALL.id }])
})

test('a call the engine named nowhere is never put to the entry, and is refused saying why', async () => {
  const { name: _unnamed, ...unnamed } = A_NAMED_CALL
  const { heard, asked, notes } = await oneCall(unnamed, { allowed: 1 })
  assert.deepEqual(heard, REFUSED)
  assert.deepEqual(asked, [])
  assert.match(notes.join('\n'), /the engine named no tool for call call-7/)
})

test('a call whose arguments are not an object is never put to the entry, and is refused saying why', async () => {
  const { heard, asked, notes } = await oneCall({ ...A_NAMED_CALL, input: 'rm -rf /' }, { allowed: 1 })
  assert.deepEqual(heard, REFUSED)
  assert.deepEqual(asked, [])
  assert.match(notes.join('\n'), /the arguments of call call-7 are not an object/)
})

test('a server-prefixed name is split at the end the recording says, and a name with nothing to split is its own', () => {
  assert.equal(NAMING.split_at, 'first', 'the recording now splits at the last separator: this case\'s expectation is the other one')
  assert.equal(gooseToolNames(NAMING).ownNameOf(A_NAMED_CALL.name), A_SERVERS_TOOL.own)
  assert.equal(gooseToolNames({ ...NAMING, split_at: 'last' }).ownNameOf(A_NAMED_CALL.name), A_SERVERS_TOOL.own.split(NAMING.separator).at(-1))
  assert.equal(gooseToolNames(NAMING).ownNameOf(A_SERVERS_TOOL.server), A_SERVERS_TOOL.server)
  assert.equal(gooseToolNames(NAMING).ownNameOf(`${A_SERVERS_TOOL.server}${NAMING.separator}`), `${A_SERVERS_TOOL.server}${NAMING.separator}`)
})

test('the Goose shell tool is the kept extension\'s, joined by the recorded separator', () => {
  const another = { ...NAMING, separator: `${NAMING.separator}+` }
  assert.equal(gooseToolNames(another).ownNameOf(theGooseShellTool(another)), gooseToolNames(NAMING).ownNameOf(theGooseShellTool(NAMING)))
  assert.ok(theGooseShellTool(another).includes(another.separator))
})
