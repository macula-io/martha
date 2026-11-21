// The engine driven by its launch (#541 package A, design G1 and r=7, "Proof for R1' and R1''"): the stand-in agent
// runs as a child over real pipes and speaks in the engine's order; the session store is one this test spells, in WAL
// mode with a writer held open, as the engine keeps its own; the entry is a stand-in that records what it was asked.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'

import { THE_EXTENSION_A_MEMBER_KEEPS } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import type { ACalledTool, AResultOfACall, TheAnswerToAResult } from '../host_contract/host_contract.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { SessionStore } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { STAND_IN_SESSION, theEnginesNamingOf, theStandInsSession, type AStep, type AnAgentScript } from '../stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'
import { TOOL_CALL_STATUS, UPDATE } from '../speak_acp_to_an_agent/the_acp_client.ts'
import { driveTheEngine, theLineOfAnotherSession, theSessionsGateKept, type ASessionOpened, type TheEngineDriven } from './drive_the_engine.ts'

const STAND_IN = join(import.meta.dirname, '..', 'stand_in_for_an_acp_agent', 'main.ts')
const NAMING = RECORDED_GOOSE_ENGINE.tool_naming
const COLUMNS = ['id', 'working_dir', 'goose_mode', 'provider_name', 'model_config_json', 'recipe_json', 'system_prompt_override', 'system_prompt_extras_json', 'container_id', 'extension_data']
const FACTS: { readonly session_store: SessionStore; readonly tool_naming: typeof NAMING } = {
  session_store: { file: 'a.db', journal_mode: 'Wal', table: 'the_rows', columns: COLUMNS, extension_states: ['enabled_extensions.v0'] },
  tool_naming: NAMING,
}
/** A mode, a provider, a model and two extensions of this test's own: no engine's, so nothing typed elsewhere can pass for them. */
const LAUNCHED = { mode: 'a-mode-that-asks', provider: 'a-provider', model: 'a-model', extensions: ['kept', 'a-crew-server'] }

/** The shell call the stand-in makes in the engine's order, named the engine's way. */
const SHELL = `${THE_EXTENSION_A_MEMBER_KEEPS}${NAMING.separator}shell`
const A_CALL: AStep = { call: { id: 'call-1', title: 'shell: ls', input: { command: 'ls' }, name: SHELL } }

interface AStore {
  readonly store: string
  readonly launch_dir: string
  readonly set: (column: string, value: string) => void
  /** Adds a session's row as the engine writes one at `session/new` (martha#1002): the launch's fields, the mode given. */
  readonly add: (session_id: string, mode?: string) => void
}

/** A store holding the stand-in's session as the launch created it on `launch_dir`, and the writer the engine holds. */
function aStore(t: TestContext, { working_dir }: { readonly working_dir?: string } = {}): AStore {
  const at = realpathSync(mkdtempSync(join(tmpdir(), 'martha-541-drive-')))
  const store = join(at, FACTS.session_store.file)
  const launch_dir = join(at, 'checkout')
  const engine = new DatabaseSync(store)
  t.after(() => {
    engine.close()
    removeTheTree(at)
  })
  engine.exec('PRAGMA journal_mode = WAL')
  engine.exec(`CREATE TABLE the_rows (${COLUMNS.map((column) => `${column} TEXT`).join(', ')})`)
  const states = JSON.stringify({ 'enabled_extensions.v0': { extensions: LAUNCHED.extensions.map((name) => ({ name })) } })
  const add = (session_id: string, mode = LAUNCHED.mode): void =>
    void engine
      .prepare('INSERT INTO the_rows (id, working_dir, goose_mode, provider_name, model_config_json, extension_data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(session_id, working_dir ?? launch_dir, mode, LAUNCHED.provider, JSON.stringify({ model_name: LAUNCHED.model }), states)
  add(STAND_IN_SESSION)
  const set = (column: string, value: string): void => void engine.prepare(`UPDATE the_rows SET ${column} = ? WHERE id = ?`).run(value, STAND_IN_SESSION)
  return { store, launch_dir, set, add }
}

interface WhatTheEntryHeard {
  readonly called: ACalledTool[]
  readonly results: AResultOfACall[]
  readonly stops: string[]
}

/** The stand-in driven to the end of one turn, or the refusal its start met; `between` runs after the session is read back. */
async function driven(
  t: TestContext,
  script: Omit<AnAgentScript, 'currentModeId'> & { readonly currentModeId?: string | undefined },
  { at, answerToAResult = { taken: 1 }, between, after, session_gate = theSessionsGateKept() }: { readonly at: AStore; readonly answerToAResult?: TheAnswerToAResult; readonly between?: () => void; readonly after?: (engine: TheEngineDriven) => Promise<void>; readonly session_gate?: ReturnType<typeof theSessionsGateKept> },
): Promise<WhatTheEntryHeard & { readonly refusal?: string }> {
  const heard: WhatTheEntryHeard = { called: [], results: [], stops: [] }
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify({ currentModeId: LAUNCHED.mode, ...script })], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  t.after(async () => {
    if (child.exitCode === null) child.kill()
    await exited
  })
  let queue: Promise<unknown> = Promise.resolve()
  const engine = await driveTheEngine({
    facts: FACTS,
    child,
    launch_dir: at.launch_dir,
    store: at.store,
    launched: LAUNCHED,
    answers: {
      inOrder: <T>(work: () => Promise<T>): Promise<T> => {
        const next = queue.then(work)
        queue = next.catch(() => undefined)
        return next
      },
      aToolCalled: async (call) => (heard.called.push(call), { allowed: 1 }),
      aResultCame: async (result) => (heard.results.push(result), answerToAResult),
    },
    session_gate,
    decideOver: (gate) => async (request) => ((await gate(request)).verdict === 'allow' ? 'allow' : 'reject'),
    stopMember: (why) => void heard.stops.push(why),
  })
  if ('refusal' in engine) return { ...heard, refusal: engine.refusal }
  between?.()
  await oneTurn(engine, after)
  await queue
  return heard
}

async function oneTurn(engine: TheEngineDriven, after?: (engine: TheEngineDriven) => Promise<void>): Promise<void> {
  try {
    await engine.client.prompt(engine.session_id, 'go')
    await after?.(engine)
  } finally {
    engine.client.end()
  }
}

test("the real order reaches the entry: the call under the engine's name, then its result once, and nothing stops (#541 package A, rule (a) real order)", async (t) => {
  const heard = await driven(t, { turns: [[A_CALL]] }, { at: aStore(t) })
  assert.equal(heard.refusal, undefined)
  assert.deepEqual(heard.stops, [])
  assert.deepEqual(heard.called.map((call) => call.tool), [SHELL])
  assert.equal(heard.results.length, 1)
  assert.deepEqual({ ...heard.results[0], answer: undefined }, { session_id: STAND_IN_SESSION, tool: SHELL, input: { command: 'ls' }, call_id: 'call-1', answer: undefined, from_a_tool_server: false })
})

test('an unasked call, Pending then its result, stops the member naming it, and its result never reaches the entry (#541 package A, rule (a); mutant: the listener not wired)', async (t) => {
  const pending: AStep = { update: { sessionUpdate: UPDATE.toolCall, toolCallId: 'unasked-1', title: 'a call', status: TOOL_CALL_STATUS.pending, _meta: theEnginesNamingOf(SHELL) } }
  const ended: AStep = { update: { sessionUpdate: UPDATE.toolCallUpdate, toolCallId: 'unasked-1', status: TOOL_CALL_STATUS.completed } }
  const heard = await driven(t, { turns: [[pending, ended]] }, { at: aStore(t) })
  assert.equal(heard.stops.length, 1)
  assert.match(heard.stops[0] ?? '', /call unasked-1 \(developer__shell\)/)
  assert.deepEqual(heard.results, [])
})

test("a row rewritten to another mode while a permission request waits is refused at that request, and the gate is never asked (#541 package A, design r=6 item 4; mutant: no read-back at the request)", async (t) => {
  const at = aStore(t)
  const heard = await driven(t, { turns: [[A_CALL]] }, { at, between: () => at.set('goose_mode', 'auto') })
  assert.equal(heard.stops.length, 1, JSON.stringify(heard.stops))
  assert.match(heard.stops[0] ?? '', /goose_mode|mode/)
  assert.deepEqual(heard.called, [], 'the gate was asked about a call the read-back refused')
})

test('a session/new whose stored working folder is not the launch folder is refused before any turn (#541 package A, design R3 and r=5 item 1)', async (t) => {
  const heard = await driven(t, { turns: [[A_CALL]] }, { at: aStore(t, { working_dir: '/somewhere/else' }) })
  assert.match(heard.refusal ?? '', /working folder/)
  assert.deepEqual(heard.called, [])
})

test('a session whose reported mode is another, or none, is refused before any turn (#541 package A, design r=1 row 2; mutant: the mode check dropped)', async (t) => {
  const other = await driven(t, { turns: [[A_CALL]], currentModeId: 'auto' }, { at: aStore(t) })
  assert.match(other.refusal ?? '', /reports mode auto/)
  const none = await driven(t, { turns: [[A_CALL]], currentModeId: undefined }, { at: aStore(t) })
  assert.match(none.refusal ?? '', /reports mode undefined/)
})

test("a result the entry answers with a stop stops the member with the entry's words (#541 package A, design r=1 step 9)", async (t) => {
  const heard = await driven(t, { turns: [[A_CALL]] }, { at: aStore(t), answerToAResult: { stop: 'the recheck after the call failed' } })
  assert.deepEqual(heard.stops, ['the recheck after the call failed'])
})

test("a call of the crew's tool server is a tool server's result, a developer call is not (#541 package A, design G1)", async (t) => {
  const crew = `a-crew-server${NAMING.separator}a_crew_tool`
  const heard = await driven(t, { turns: [[{ call: { id: 'crew-1', title: 'a crew tool', input: {}, name: crew } }]] }, { at: aStore(t) })
  assert.equal(heard.results[0]?.tool, crew)
  assert.equal(heard.results[0]?.from_a_tool_server, true)
})

/** The stand-in's second session, as a clear opens it. */
const THE_NEXT_SESSION = theStandInsSession(2)

/** A clear after the first turn: the next session opened, then one turn on it; what it opened, and the ids closed. */
function aClearThenATurn(at: AStore, mode?: string): { readonly after: (engine: TheEngineDriven) => Promise<void>; readonly opened: () => ASessionOpened | undefined; readonly closed: () => unknown } {
  let opened: ASessionOpened | undefined
  let closed: unknown
  return {
    after: async (engine) => {
      at.add(THE_NEXT_SESSION, mode)
      opened = await engine.aNewSession()
      if ('refusal' in opened) return
      const turn = await engine.client.prompt(opened.session_id, 'next')
      closed = JSON.parse(turn.text || 'null')
    },
    opened: () => opened,
    closed: () => closed,
  }
}

test("a clear opens the next session, reads it back, makes it current, and closes the predecessor once its prompt has returned (martha#1002 design points 1-3; mutant: the opened set holds only the first id)", async (t) => {
  const at = aStore(t)
  const gate = theSessionsGateKept()
  const clear = aClearThenATurn(at)
  const heard = await driven(t, { turns: [[A_CALL], [{ closed: 1 }]] }, { at, after: clear.after, session_gate: gate })
  assert.deepEqual(clear.opened(), { session_id: THE_NEXT_SESSION })
  assert.equal(gate.get()?.id, THE_NEXT_SESSION)
  assert.deepEqual(gate.get()?.opened, [STAND_IN_SESSION, THE_NEXT_SESSION])
  assert.deepEqual(clear.closed(), [STAND_IN_SESSION])
  assert.deepEqual(heard.stops, [])
})

test("a next session whose row runs another mode is refused by name, and the gate stays on the predecessor (martha#1002 design point 3)", async (t) => {
  const at = aStore(t)
  const gate = theSessionsGateKept()
  const clear = aClearThenATurn(at, 'auto')
  await driven(t, { turns: [[A_CALL]] }, { at, after: clear.after, session_gate: gate })
  const opened = clear.opened()
  assert.ok(opened !== undefined && 'refusal' in opened && /the mode "auto"/.test(opened.refusal), JSON.stringify(opened))
  assert.equal(gate.get()?.id, STAND_IN_SESSION)
})

test("after the clear, a permission request naming the predecessor is rejected and stops the member, and the gate is never asked (martha#1002 design point 5; mutant: no session compare at a request)", async (t) => {
  const at = aStore(t)
  const late: AStep = { under_session: STAND_IN_SESSION, steps: [{ call: { ...A_CALL.call, id: 'call-late' } }] }
  const heard = await driven(t, { turns: [[], [late]] }, { at, after: aClearThenATurn(at).after })
  // The launch keeps the first stop only (start_an_engine_member.ts `stopMember`): rule (a)'s stop on the cancelled
  // call's failed update comes after it.
  assert.equal(heard.stops[0], theLineOfAnotherSession('a permission request', STAND_IN_SESSION, THE_NEXT_SESSION))
  assert.deepEqual(heard.called, [])
})

test("after the clear, a late result of a call the predecessor asked about stops the member and never reaches the entry (martha#1002 design point 5; mutant: no session compare at an update)", async (t) => {
  const at = aStore(t)
  const asked: AStep = { ...A_CALL, no_result: 1 }
  const result: AStep = { under_session: STAND_IN_SESSION, steps: [{ update: { sessionUpdate: UPDATE.toolCallUpdate, toolCallId: 'call-1', status: TOOL_CALL_STATUS.completed } }] }
  const heard = await driven(t, { turns: [[asked], [result]] }, { at, after: aClearThenATurn(at).after })
  assert.deepEqual(heard.stops, [theLineOfAnotherSession('the result of call call-1', STAND_IN_SESSION, THE_NEXT_SESSION)])
  assert.deepEqual(heard.results, [])
})
