// The engine's session store read back (#541 package A, design r=5): the first read held to what the launch created,
// and each later read held to that snapshot. The store is one this test spells, in WAL mode with a writer kept open,
// as the engine keeps its own; the facts are spelled too, so a column list copied from the recording proves nothing.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
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
/** The sessions the launch opened: only its first. */
const OPENED: readonly string[] = [LAUNCHED.session_id]

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
  const first = theSessionsFirstRead(FACTS, store, LAUNCHED, OPENED)
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
    const first = theSessionsFirstRead(FACTS, store, LAUNCHED, OPENED)
    assert.ok('refusal' in first && named.test(first.refusal), `${column} = ${value} is refused by name: ${JSON.stringify(first)}`)
  }
})

test('a row this launch did not open, or a store without the current session, is refused at every read (#541 package A, design r=5 item 2; martha#1002 T1/T5; mutant: the opened-set check dropped)', (t) => {
  const { store, engine } = aStore(t)
  const snapshot = snapshotOf(store)
  engine.prepare('INSERT INTO the_rows (id, working_dir, extension_data) VALUES (?, ?, ?)').run('planted', '/x', '{}')
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), `the session store at ${store} holds 1 session(s) this launch did not open, and a launch's store holds only its own`)
  assert.ok('refusal' in theSessionsFirstRead(FACTS, store, LAUNCHED, OPENED))
  engine.prepare('DELETE FROM the_rows WHERE id = ?').run('planted')
  engine.prepare('DELETE FROM the_rows WHERE id = ?').run(LAUNCHED.session_id)
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), `the session store at ${store} holds no row of this launch's session ${LAUNCHED.session_id}`)
})

test("after a clear, the current session is held to its snapshot and a closed predecessor's row is not; a third id is still refused (martha#1002 design points 2-3, T2/T3; mutants: the current row not found by id, the predecessor held)", (t) => {
  const { store, engine } = aStore(t)
  const next = { ...LAUNCHED, session_id: 'a-session-2' }
  engine
    .prepare('INSERT INTO the_rows (id, working_dir, goose_mode, provider_name, model_config_json, extension_data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(next.session_id, next.working_dir, next.mode, next.provider, JSON.stringify({ model_name: next.model }), statesWith(next.extensions))
  assert.ok('refusal' in theSessionsFirstRead(FACTS, store, next, OPENED), 'a second row is refused while the launch has not opened it')
  const first = theSessionsFirstRead(FACTS, store, next, [...OPENED, next.session_id])
  assert.ok('snapshot' in first, JSON.stringify(first))
  assert.equal(first.snapshot.id, next.session_id)
  const snapshot = first.snapshot
  engine.prepare('UPDATE the_rows SET goose_mode = ? WHERE id = ?').run('auto', LAUNCHED.session_id)
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), undefined, "the closed predecessor's rewritten row does not stop the member")
  engine.prepare('UPDATE the_rows SET goose_mode = ? WHERE id = ?').run('auto', next.session_id)
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), `the session ${next.session_id}'s goose_mode was changed after it started, and the engine runs its next step with it`)
  engine.prepare('UPDATE the_rows SET goose_mode = ? WHERE id = ?').run(next.mode, next.session_id)
  engine.prepare('INSERT INTO the_rows (id, working_dir, extension_data) VALUES (?, ?, ?)').run('a-session-3', '/x', '{}')
  assert.match(theSessionStillHolds(FACTS, store, snapshot) ?? '', /1 session\(s\) this launch did not open/)
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
  const first = theSessionsFirstRead(lacking, store, LAUNCHED, OPENED)
  assert.ok('refusal' in first && first.refusal.includes('no column goose_mode'), JSON.stringify(first))
  assert.deepEqual(theColumnsTheStoreLacks(RECORDED_GOOSE_ENGINE), [])
  assert.equal(theSessionStoreOf(RECORDED_GOOSE_ENGINE, '/r'), '/r/data/sessions.db')
})

test("a read-back writes nothing the engine reads: the database and its -wal hold the same bytes after it, while the engine's writer holds the store open (#541 package A, design r=5 'The store's journal mode')", (t) => {
  const { store } = aStore(t)
  // The -shm is left out on purpose: it is SQLite's shared index of the WAL, and every reader, a read-only one too,
  // takes a read mark in it on its first read (measured on node:sqlite here). It holds no row and no text a step loads.
  const bytes = (): string[] => [store, `${store}-wal`].map((file) => createHash('sha256').update(readFileSync(file)).digest('hex'))
  const before = bytes()
  const snapshot = snapshotOf(store)
  assert.equal(theSessionStillHolds(FACTS, store, snapshot), undefined)
  assert.deepEqual(bytes(), before)
})
