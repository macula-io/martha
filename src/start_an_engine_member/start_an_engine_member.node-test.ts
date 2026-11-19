// An engine member started through the start table (martha#541 package A, design r=1 "Done when"): a declaration naming
// the engine, approved by the owner, started by `startMember` as an owner starts it. The engine on the path is the
// stand-in ACP agent behind a shell wrapper that keeps every line the launch sent it, so the test reads what reached the
// engine from the engine's side of the pipe. The stand-in writes its session's row the way the engine does, so the
// start's read-back reads a store an engine wrote.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { approveConfig } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, ENGINE_ENDPOINT, HOST, SOLO_MEMBERS, soloDeclaration, THE_ENGINES_HOST } from '../declare_crew/declare_crew.ts'
import { THE_EXTENSION_A_MEMBER_KEEPS, THE_MODE_THAT_ASKS_THE_CLIENT } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { openState, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { THE_CREWS_TOOL_SERVER } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_words.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { launcherPlacesOf, startMember, type MemberStartRequest } from '../start_a_member/start_a_member.ts'
import type { AnAgentScript } from '../stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'

const FACTS = RECORDED_GOOSE_ENGINE
const STAND_IN = join(import.meta.dirname, '..', 'stand_in_for_an_acp_agent', 'main.ts')
const documents = { read: (path: string) => readFile(path, 'utf8') }
const yes = { is_terminal: true, ask: () => Promise.resolve('yes') }

/** The member, its model and the variable its key is read from: this test's own names. */
const MEMBER = 'builder'
const A_MODEL = 'a-model-a-test-names'
const A_KEY_VARIABLE = 'A_KEY_VARIABLE_A_TEST_NAMES'
const THE_START_PROMPT = 'the start prompt a test names'

/** How long a test waits for the engine to hear something, at most. */
const THE_WAIT_MS = 10_000
const POLL_MS = 25

/** The state key the engine keeps its enabled extensions under, as the recording names it. */
const ENABLED_EXTENSIONS = FACTS.session_store.extension_states.find((state) => state.startsWith('enabled_extensions')) ?? ''

interface Place {
  readonly home: string
  readonly root: string
  readonly state: MarthaState
  readonly relay_root: string
  readonly started: Extract<MemberStarted, { readonly started: true }>[]
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd })
}

/** A project declaring one engine member, with the crew's endpoint; every member it starts is stopped before the home goes. */
function aPlace(t: TestContext): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-engine-start-')))
  const root = join(home, 'project')
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  git(root, 'init', '-q', '.')
  const declaration = {
    ...soloDeclaration('Ada Owner'),
    members: SOLO_MEMBERS.map((member) => (member.name === MEMBER ? { ...member, [HOST]: THE_ENGINES_HOST, model: A_MODEL } : member)),
    [ENGINE_ENDPOINT]: { host: 'http://127.0.0.1:9', key_from: A_KEY_VARIABLE },
  }
  writeFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), JSON.stringify(declaration))
  writeFileSync(join(root, 'README.md'), 'a project\n')
  git(root, 'add', '--all')
  git(root, 'commit', '-q', '-m', 'start')
  const state = openState(join(home, 'state'), root)
  assert.ok('directory' in state)
  const place: Place = { home, root, state, relay_root: shortRelayRoot(t), started: [] }
  t.after(async () => {
    try {
      for (const started of place.started) started.stop('the test is over')
      await Promise.all(place.started.map((started) => started.stopped))
    } finally {
      removeTheTree(home)
    }
  })
  return place
}

/** The stand-in engine on a path of its own, behind a wrapper that keeps every line the launch sends it. */
function anEngineOnThePath(place: Place, script: AnAgentScript): { readonly dir: string; readonly heard: string } {
  const dir = join(place.home, 'engine-on-the-path')
  mkdirSync(dir)
  const heard = join(place.home, 'what-the-engine-heard.jsonl')
  const quoted = JSON.stringify(script)
  assert.ok(!quoted.includes("'"), 'a script with a quote cannot be handed through the wrapper')
  writeFileSync(join(dir, FACTS.engine_name), ['#!/bin/sh', `tee -a '${heard}' | '${process.execPath}' '${STAND_IN}' '${quoted}'`, ''].join('\n'), { mode: 0o700 })
  return { dir, heard }
}

/** The session row the engine writes for a session the launch opened, as the launch created it. */
const THE_SESSIONS_ROW: AnAgentScript['session_row'] = {
  root_variable: FACTS.path_root_variable,
  path: [...(FACTS.engine_folders.under_root['data'] ?? []), FACTS.session_store.file],
  table: FACTS.session_store.table,
  columns: FACTS.session_store.columns,
  fields: {
    goose_mode: THE_MODE_THAT_ASKS_THE_CLIENT,
    provider_name: FACTS.openai_provider.name,
    model_config_json: JSON.stringify({ model_name: A_MODEL }),
    extension_data: JSON.stringify({ [ENABLED_EXTENSIONS]: { extensions: [THE_EXTENSION_A_MEMBER_KEEPS, THE_CREWS_TOOL_SERVER].map((name) => ({ name })) } }),
  },
}

/** The owner's start of the member, with the engine's path first and the key in the environment. */
async function started(place: Place, engine: { readonly dir: string }, lines: string[]): Promise<MemberStarted> {
  await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
  const places = launcherPlacesOf(place.state, place.relay_root, place.root)
  assert.ok('rows' in places, 'refusal' in places ? places.refusal : '')
  const request: MemberStartRequest = {
    root: place.root,
    home: place.home,
    member: MEMBER,
    args: [],
    is_terminal: true,
    state: place.state,
    places,
    inherited: { PATH: `${engine.dir}:${process.env['PATH'] ?? ''}`, HOME: place.home, [A_KEY_VARIABLE]: 'a-key-a-test-names' },
    stdio: 'ignore',
    documents,
    initial_prompt: THE_START_PROMPT,
    tellOwner: (line) => void lines.push(line),
  }
  const start = await startMember(request)
  if (start.started) place.started.push(start)
  return start
}

/** Every request the launch sent the engine, by method, in order. */
function theRequests(heard: string): ReadonlyArray<{ readonly method: string; readonly params: Record<string, unknown> }> {
  if (!existsSync(heard)) return []
  return readFileSync(heard, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> })
    .filter((message) => message.method !== undefined)
    .map((message) => ({ method: message.method ?? '', params: message.params ?? {} }))
}

/** Waits, bounded, until the engine heard a request of `method`. */
async function untilTheEngineHeard(heard: string, method: string): Promise<void> {
  const deadline = Date.now() + THE_WAIT_MS
  while (!theRequests(heard).some((request) => request.method === method)) {
    assert.ok(Date.now() < deadline, `the engine heard no ${method} within ${THE_WAIT_MS} ms: ${theRequests(heard).map((request) => request.method).join(', ')}`)
    await new Promise((settle) => setTimeout(settle, POLL_MS))
  }
}

/** The text of a `session/prompt` request. */
const theTextOf = (params: Record<string, unknown>): string => ((params['prompt'] as readonly { text?: string }[] | undefined) ?? []).map((block) => block.text ?? '').join('')

test('#541 package A: a declaration naming the engine starts through the table; the session opens with no servers, and the start prompt is the first prompt', async (t) => {
  const place = aPlace(t)
  const engine = anEngineOnThePath(place, { currentModeId: THE_MODE_THAT_ASKS_THE_CLIENT, turns: [[{ echo: 1 }]], session_row: THE_SESSIONS_ROW })
  const lines: string[] = []
  const start = await started(place, engine, lines)
  assert.ok(start.started, start.started ? '' : `${start.refusal}\n${lines.join('\n')}`)
  await untilTheEngineHeard(engine.heard, 'session/prompt')
  const requests = theRequests(engine.heard)
  assert.deepEqual(requests.map((request) => request.method).slice(0, 3), ['initialize', 'session/new', 'session/prompt'])
  assert.deepEqual(requests[1]?.params['mcpServers'], [], 'the session was opened with servers of its own')
  const prompts = requests.filter((request) => request.method === 'session/prompt')
  assert.equal(prompts.length, 1)
  assert.ok(theTextOf(prompts[0]?.params ?? {}).endsWith(THE_START_PROMPT), theTextOf(prompts[0]?.params ?? {}))
})

for (const [mode, says] of [['auto', 'auto'], [undefined, 'undefined']] as const) {
  test(`#541 package A: an engine that reports mode ${says} for its session is refused by name, and no prompt is ever sent (mutant: the mode check dropped)`, async (t) => {
    const place = aPlace(t)
    const engine = anEngineOnThePath(place, { ...(mode === undefined ? {} : { currentModeId: mode }), turns: [[{ echo: 1 }]], session_row: THE_SESSIONS_ROW })
    const lines: string[] = []
    const start = await started(place, engine, lines)
    assert.equal(start.started, false, 'an engine whose session does not ask the client was started')
    const refusal = start.started ? '' : start.refusal
    assert.ok(refusal.includes(`mode ${says}`) && refusal.includes(THE_MODE_THAT_ASKS_THE_CLIENT), refusal)
    assert.deepEqual(theRequests(engine.heard).filter((request) => request.method === 'session/prompt'), [])
  })
}

test('#541 package A: a member with no model is refused by name before anything starts', async (t) => {
  const place = aPlace(t)
  const path = join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const declared = JSON.parse(readFileSync(path, 'utf8')) as { members: Record<string, unknown>[] }
  declared.members = declared.members.map(({ model: _model, ...member }) => member)
  writeFileSync(path, JSON.stringify(declared))
  git(place.root, 'commit', '-q', '-am', 'no model')
  const engine = anEngineOnThePath(place, { currentModeId: THE_MODE_THAT_ASKS_THE_CLIENT, turns: [], session_row: THE_SESSIONS_ROW })
  const start = await started(place, engine, [])
  assert.equal(start.started, false)
  assert.match(start.started ? '' : start.refusal, /names no model/)
  assert.equal(existsSync(engine.heard), false, 'an engine was started for a member that names no model')
})
