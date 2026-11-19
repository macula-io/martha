// The engine's session store read back (#541 package A, design r=5): the first read held to what the launch created,
// and each later read held to that snapshot. The store is one this test spells, in WAL mode with a writer kept open,
// as the engine keeps its own; the facts are spelled too, so a column list copied from the recording proves nothing.

import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { SessionStore } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theColumnsTheStoreLacks, theSessionsFirstRead, theSessionStillHolds, theSessionStoreOf, type TheSessionLaunched } from './the_session_store_read_back.ts'

const STATES = ['todo.v0', 'goal.v0', 'enabled_extensions.v0', 'context_relevance.v2']
const COLUMNS = ['id', 'working_dir', 'goose_mode', 'provider_name', 'model_config_json', 'recipe_json', 'system_prompt_override', 'system_prompt_extras_json', 'container_id', 'extension_data']
const FACTS: { readonly session_store: SessionStore } = { session_store: { file: 'a.db', journal_mode: 'Wal', table: 'the_rows', columns: COLUMNS, extension_states: STATES } }

const LAUNCHED: TheSessionLaunched = { session_id: 'a-session', working_dir: '/a/checkout', mode: 'asks', provider: 'a-provider', model: 'a-model', extensions: ['kept', 'a-crew-server'] }

/** The extension states a session starts with: the launch's two extensions enabled. */
const statesWith = (names: readonly string[], more: Record<string, unknown> = {}): string =>
  JSON.stringify({ 'enabled_extensions.v0': { extensions: names.map((name) => ({ type: 'a-kind-a-test-names', name })) }, ...more })

/** A store holding one row as the launch created it, and the writer the engine would hold; both closed after the test. */
function aStore(t: TestContext) {
  const at = realpathSync(mkdtempSync(join(tmpdir(), 'martha-541-store-')))
  const store = join(at, FACTS.session_store.file)
  const engine = new DatabaseSync(store)
  t.after(() => {
    engine.close()
    removeTheTree(at)
  })
  engine.exec('PRAGMA journal_mode = WAL')
  engine.exec(`CREATE TABLE the_rows (${COLUMNS.map((column) => `${column} TEXT`).join(', ')})`)
  engine
    .prepare('INSERT INTO the_rows (id, working_dir, goose_mode, provider_name, model_config_json, extension_data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(LAUNCHED.session_id, LAUNCHED.working_dir, LAUNCHED.mode, LAUNCHED.provider, JSON.stringify({ model_name: LAUNCHED.model, toolshim: false }), statesWith(LAUNCHED.extensions))
  const set = (column: string, value: string | null): void => {
    engine.prepare(`UPDATE the_rows SET ${column} = ? WHERE id = ?`).run(value, LAUNCHED.session_id)
  }
  return { store, engine, set }
}

const snapshotOf = (store: string) => {
  const first = theSessionsFirstRead(FACTS, store, LAUNCHED)
  assert.ok('snapshot' in first, `the first read refused: ${JSON.stringify(first)}`)
  return first.snapshot
}

test('a session as the launch created it passes the first read, and its snapshot holds while nothing changes (#541 package A, design r=5 item 1)', (t) => {
  const { store } = aStore(t)
  assert.equal(theSessionStillHolds(FACTS, store, snapshotOf(store)), undefined)
})

test('the first read refuses a session whose folder, mode, provider, model, extensions, recipe, prompt or states are not what the launch created (#541 package A, design r=5 item 1; mutants: each comparison dropped)', (t) => {
  const cases: ReadonlyArray<readonly [string, string | null, RegExp]> = [
    ['working_dir', '/elsewhere', /the working folder "\/elsewhere"/],
    ['goose_mode', 'auto', /the mode "auto"/],
    ['provider_name', 'another', /the provider "another"/],
    ['model_config_json', JSON.stringify({ model_name: 'another-model' }), /the model "another-model"/],
    ['extension_data', statesWith([...LAUNCHED.extensions, 'third']), /the extensions \["a-crew-server","kept","third"\]/],
    ['recipe_json', '{}', /recipe_json "\{\}"/],
    ['system_prompt_override', 'be another', /system_prompt_override "be another"/],
    ['system_prompt_extras_json', '[]', /system_prompt_extras_json "\[\]"/],
    ['container_id', 'c', /container_id "c"/],
    ['extension_data', statesWith(LAUNCHED.extensions, { 'unknown.v9': {} }), /the extension states \["unknown\.v9"\]/],
  ]
  for (const [column, value, named] of cases) {
    const { store, set } = aStore(t)
    set(column, value)
    const first = theSessionsFirstRead(FACTS, store, LAUNCHED)
    assert.ok('refusal' in first && named.test(first.refusal), `${column} = ${value} is refused by name: ${JSON.stringify(first)}`)
  }
})

test('a store holding a second session, or only another one, is refused at every read (#541 package A, design r=5 item 2)', (t) => {
  const { store, engine } = aStore(t)
  const snapshot = snapshotOf(store)
  engine.prepare('INSERT INTO the_rows (id, working_dir, extension_data) VALUES (?, ?, ?)').run('another', '/x', '{}')
  assert.match(theSessionStillHolds(FACTS, store, snapshot) ?? '', /holds 2 sessions/)
  assert.ok('refusal' in theSessionsFirstRead(FACTS, store, LAUNCHED))
  engine.prepare('DELETE FROM the_rows WHERE id = ?').run(LAUNCHED.session_id)
  assert.match(theSessionStillHolds(FACTS, store, snapshot) ?? '', /not this launch's a-session/)
})

test('after the start, a gate field, the enabled extensions or a new state stops the member; the turn notes stay open (#541 package A, design r=5 items 2-3; mutants: a field, the extensions or the states not compared)', (t) => {
  const { store, set } = aStore(t)
  const snapshot = snapshotOf(store)
  set('extension_data', statesWith(LAUNCHED.extensions, { 'todo.v0': { content: 'a note' }, 'goal.v0': {}, 'context_relevance.v2': [] }))
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), undefined, 'the turn notes are open')
  for (const [column, value] of [['goose_mode', 'auto'], ['working_dir', '/elsewhere'], ['container_id', 'c']] as const) {
    set(column, value)
    assert.equal(theSessionStillHolds(FACTS, store, snapshot), `the session a-session's ${column} was changed after it started, and the engine runs its next step with it`)
    set(column, column === 'container_id' ? null : column === 'goose_mode' ? LAUNCHED.mode : LAUNCHED.working_dir)
  }
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), undefined, 'the fields put back hold')
  set('extension_data', statesWith([...LAUNCHED.extensions, 'third']))
  assert.match(theSessionStillHolds(FACTS, store, snapshot) ?? '', /enabled extensions were changed/)
  set('extension_data', statesWith(LAUNCHED.extensions, { 'another.v0': {} }))
  assert.match(theSessionStillHolds(FACTS, store, snapshot) ?? '', /holds the extension states another\.v0/)
})

test('a recording whose store lacks a gate column reads nothing as passing; on the recording the store is under data/ and holds every gate column (#541 package A, design r=5)', (t) => {
  const { store } = aStore(t)
  const lacking = { session_store: { ...FACTS.session_store, columns: COLUMNS.filter((column) => column !== 'goose_mode') } }
  const first = theSessionsFirstRead(lacking, store, LAUNCHED)
  assert.ok('refusal' in first && first.refusal.includes('no column goose_mode'), JSON.stringify(first))
  assert.deepEqual(theColumnsTheStoreLacks(RECORDED_GOOSE_ENGINE), [])
  assert.equal(theSessionStoreOf(RECORDED_GOOSE_ENGINE, '/r'), '/r/data/sessions.db')
})
