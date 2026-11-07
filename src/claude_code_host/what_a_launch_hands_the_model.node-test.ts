// What a launch hands the model by itself: an approved hook's output (A7) and a
// server's instruction block (A11), and nothing for the recorded mesh server
// alone (martha#121).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PATH_OF_SOURCE } from '../take_in_a_turn/take_in_a_turn.ts'
import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { CLAUDE_SERVERS, CLAUDE_SETTINGS } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { PLUGIN_DIRS_VARIABLE } from './hooks_and_plugins_the_owner_declares.ts'
import { sourcesALaunchHandsTheModel } from './what_a_launch_hands_the_model.ts'

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
const rowsOf = (carried: Readonly<Record<string, Uint8Array>>): readonly string[] =>
  sourcesALaunchHandsTheModel(carried).map((source) => PATH_OF_SOURCE[source]).sort()

const recorded = RECORDED_MESH_SERVERS[0]
assert.ok(recorded !== undefined)
const MESH_ONLY = { mcpServers: { macula: { command: 'npx', args: ['-y', `${MESH_SERVER_PACKAGE}@${recorded.server_version}`] } } }
const ANOTHER_SERVER = { mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } }
const BOTH = { mcpServers: { ...MESH_ONLY.mcpServers, ...ANOTHER_SERVER.mcpServers } }
const A_HOOK = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }

test('no carried config hands the model nothing', () => {
  assert.deepEqual(rowsOf({}), [])
})

test('the recorded mesh server alone hands the model nothing: its block is bound by the recorded tree', () => {
  assert.deepEqual(rowsOf({ [CLAUDE_SERVERS]: bytes(MESH_ONLY) }), [])
  assert.deepEqual(rowsOf({ [CLAUDE_SERVERS]: bytes({ mcpServers: {} }) }), [])
})

test('any server the recorded tree does not bind records A11, beside the mesh server too', () => {
  assert.deepEqual(rowsOf({ [CLAUDE_SERVERS]: bytes(ANOTHER_SERVER) }), [PATH_OF_SOURCE.server_instructions])
  assert.deepEqual(rowsOf({ [CLAUDE_SERVERS]: bytes(BOTH) }), [PATH_OF_SOURCE.server_instructions])
})

test('a server config that cannot be read as pins records A11: failing closed', () => {
  for (const config of ['not json', '[]', { mcpServers: [] }, { mcpServers: { x: { command: 'sh' } } }]) {
    assert.deepEqual(rowsOf({ [CLAUDE_SERVERS]: bytes(config) }), [PATH_OF_SOURCE.server_instructions], JSON.stringify(config))
  }
})

test('a hook in the carried settings records A7, whatever event it is on', () => {
  assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes(A_HOOK) }), [PATH_OF_SOURCE.checkout_hook])
  const onAnyEvent = { hooks: { PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'cat notes' }] }] } }
  assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes(onAnyEvent) }), [PATH_OF_SOURCE.checkout_hook])
})

test('settings with no hook record nothing: empty hooks, and settings that run nothing', () => {
  for (const settings of [{}, { hooks: {} }, { hooks: { SessionStart: [] } }, { env: { A: '1' } }, { enabledPlugins: {} }, { enabledPlugins: { a: false } }]) {
    assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes(settings) }), [], JSON.stringify(settings))
  }
})

test('an enabled plugin records A7 and A11: it brings hooks and servers of its own', () => {
  const rows = [PATH_OF_SOURCE.checkout_hook, PATH_OF_SOURCE.server_instructions].sort()
  assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes({ enabledPlugins: { 'a@market': true } }) }), rows)
})

test("a plugin folder in the carried settings' env records A7 and A11, like an enabled plugin (#121 r=5)", () => {
  const rows = [PATH_OF_SOURCE.checkout_hook, PATH_OF_SOURCE.server_instructions].sort()
  assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes({ env: { [PLUGIN_DIRS_VARIABLE]: './.martha-plugins' } }) }), rows)
  for (const blank of ['', '  ']) {
    assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes({ env: { [PLUGIN_DIRS_VARIABLE]: blank } }) }), [], JSON.stringify(blank))
  }
})

test('settings that cannot be read as an object record everything they could bring: failing closed', () => {
  const rows = [PATH_OF_SOURCE.checkout_hook, PATH_OF_SOURCE.server_instructions].sort()
  for (const settings of ['not json', '[]', '"a string"']) {
    assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: bytes(settings) }), rows, settings)
  }
  assert.deepEqual(rowsOf({ [CLAUDE_SETTINGS]: new Uint8Array([0xff, 0xfe]) }), rows, 'not UTF-8')
})

test('each source is handed once, however many files bring it', () => {
  const carried = { [CLAUDE_SETTINGS]: bytes({ ...A_HOOK, enabledPlugins: { a: true } }), [CLAUDE_SERVERS]: bytes(ANOTHER_SERVER) }
  const sources = sourcesALaunchHandsTheModel(carried)
  assert.equal(new Set(sources).size, sources.length)
})
