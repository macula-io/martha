// The engine's session store read back (#541 package A, design r=5 "The engine's session store", PASS r=7
// issuecomment-7010033523). The engine keeps one row per session in `data/sessions.db` and loads the row again at the
// top of every step, so a `shell` write to it changes what the next step runs with. None of the fields below is
// re-derived from the byte-checked config on a step: the step takes them from the row. So the launch reads them:
//   1. right after the ACP `session/new` answer: the session's row checked against what the launch created (the
//      working folder, the mode that asks, the config's provider and model, exactly the config's extensions, and no
//      recipe, prompt override, prompt extras or container). A difference refuses the start; the read is the snapshot;
//   2. after every result and at every permission request: every row is a session this launch opened, the current
//      session's row is there, every gate field of it equals the snapshot, and its `extension_data` holds no state the
//      engine does not keep (the recorded `extension_states`).
//
// The opened sessions (martha#1002, option B, design PASS r=2): a refresh's clear opens a new ACP session on the same
// engine, which adds a row; the engine's `session/close` only detaches the predecessor, so its row stays. The launch
// keeps the id of every session it opened, in its own memory, where no member process writes; a row with any other id
// is refused (T1, T5). A closed predecessor's row is not held to a snapshot (T3): the launch never prompts it again,
// and the engine refuses a load or a run on a closed id by itself (T4).
//
// The store is opened read-only (`node:sqlite`, `readOnly: true`); the engine writes it in WAL mode (the recorded
// `journal_mode`), so a read-only reader sees the last committed write without blocking the engine.
//
// The gate columns are the design table's, each one checked against the recorded `columns`, so a store that drops or
// renames one turns the build red rather than a read that finds nothing.

import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'

/** The column a row is found by, and the gate columns a step reads back (design r=5, the session store table). */
const THE_ID_COLUMN = 'id'
export const THE_GATE_COLUMNS = ['working_dir', 'goose_mode', 'provider_name', 'model_config_json', 'recipe_json', 'system_prompt_override', 'system_prompt_extras_json', 'container_id'] as const
/** The gate columns a launch's session starts with empty: the launch sends no recipe, prompt override, prompt extras or container. */
const EMPTY_AT_THE_START = ['recipe_json', 'system_prompt_override', 'system_prompt_extras_json', 'container_id'] as const
/** The column holding the extension states, and the state naming the extensions a step runs. */
const THE_STATES_COLUMN = 'extension_data'
const THE_ENABLED_EXTENSIONS_STATE = 'enabled_extensions'
/** The key of a model config naming its model. */
const THE_MODEL_NAME = 'model_name'

type AGateColumn = (typeof THE_GATE_COLUMNS)[number]

/** What the launch reads of its session's row: each gate field as stored, and the enabled extensions' state as stored. */
export interface TheSessionsGate {
  readonly id: string
  /** Every session this launch opened, the current one among them (martha#1002): the rows the store may hold. */
  readonly opened: readonly string[]
  readonly fields: Readonly<Record<AGateColumn, string | null>>
  readonly enabled_extensions: string
}

/** Where the session store of the launch whose path root is `root` is: under its data folder, by the recorded name. */
export function theSessionStoreOf(facts: Pick<EngineFacts, 'engine_folders' | 'session_store'>, root: string): string {
  return join(root, ...(facts.engine_folders.under_root['data'] ?? []), facts.session_store.file)
}

/** The gate columns and the states column the recording does not hold, by name. */
export function theColumnsTheStoreLacks(facts: Pick<EngineFacts, 'session_store'>): string[] {
  return [THE_ID_COLUMN, ...THE_GATE_COLUMNS, THE_STATES_COLUMN].filter((column) => !facts.session_store.columns.includes(column))
}

/** The rows of the store, read-only, or why they cannot be read. */
function theRows(facts: Pick<EngineFacts, 'session_store'>, store: string): { readonly rows: ReadonlyArray<Record<string, unknown>> } | { readonly why: string } {
  const lacking = theColumnsTheStoreLacks(facts)
  if (lacking.length > 0) return { why: `the recorded session store has no column ${lacking.join(', ')}` }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(store, { readOnly: true })
    const columns = [THE_ID_COLUMN, ...THE_GATE_COLUMNS, THE_STATES_COLUMN].map((column) => `"${column}"`).join(', ')
    return { rows: db.prepare(`SELECT ${columns} FROM "${facts.session_store.table}"`).all() as Record<string, unknown>[] }
  } catch (error) {
    return { why: `the session store at ${store} cannot be read (${error instanceof Error ? error.message : String(error)})` }
  } finally {
    db?.close()
  }
}

/** A text column's value as stored, or why it is not text. */
const textOf = (row: Record<string, unknown>, column: string): string | null | { readonly why: string } => {
  const value = row[column]
  return value === null || typeof value === 'string' ? value : { why: `${column} is not text` }
}

/** The ids of the store's rows that are not sessions this launch opened. */
const theSessionsNotOpened = (rows: ReadonlyArray<Record<string, unknown>>, opened: readonly string[]): string[] =>
  rows.map((row) => row[THE_ID_COLUMN]).filter((id) => typeof id !== 'string' || !opened.includes(id)).map(String)

/** The current session's row, read into its gate, when every row is a session this launch opened; or why not. */
function theCurrentRow(facts: Pick<EngineFacts, 'session_store'>, store: string, session_id: string, opened: readonly string[]): { readonly gate: TheSessionsGate; readonly states: readonly string[]; readonly states_value: Record<string, unknown> } | { readonly why: string } {
  const read = theRows(facts, store)
  if ('why' in read) return read
  const strangers = theSessionsNotOpened(read.rows, opened)
  if (strangers.length > 0) return { why: `the session store at ${store} holds ${strangers.length} session(s) this launch did not open, and a launch's store holds only its own` }
  const row = read.rows.find((one) => one[THE_ID_COLUMN] === session_id)
  if (row === undefined) return { why: `the session store at ${store} holds no row of this launch's session ${session_id}` }
  const fields = theGateFieldsOf(row)
  if ('why' in fields) return fields
  const states = theStatesOf(row[THE_STATES_COLUMN])
  if ('why' in states) return states
  const enabled = theOneEnabledState(states.value)
  if ('why' in enabled) return enabled
  return { gate: { id: session_id, opened, fields: fields.fields, enabled_extensions: enabled.enabled_extensions }, states: Object.keys(states.value), states_value: states.value }
}

/** The row's gate columns, each as text or null, or why one is neither. */
function theGateFieldsOf(row: Record<string, unknown>): { readonly fields: Record<AGateColumn, string | null> } | { readonly why: string } {
  const fields: Partial<Record<AGateColumn, string | null>> = {}
  for (const column of THE_GATE_COLUMNS) {
    const value = textOf(row, column)
    if (value !== null && typeof value === 'object') return value
    fields[column] = value
  }
  return { fields: fields as Record<AGateColumn, string | null> }
}

/** The one state of the enabled extensions, as text the snapshot compares, or why there is not exactly one. */
function theOneEnabledState(states: Record<string, unknown>): { readonly enabled_extensions: string } | { readonly why: string } {
  const enabled = Object.entries(states).filter(([key]) => theStateNamed(key) === THE_ENABLED_EXTENSIONS_STATE)
  if (enabled.length !== 1) return { why: `the session's ${THE_STATES_COLUMN} holds ${enabled.length} states of its enabled extensions, and a step reads one` }
  return { enabled_extensions: JSON.stringify(enabled[0]?.[1]) }
}

/** The name a state key carries before its version (`<name>.<version>`). */
const theStateNamed = (key: string): string => key.slice(0, key.lastIndexOf('.') < 0 ? key.length : key.lastIndexOf('.'))

/** The extension states as stored, parsed, or why they are not an object. */
function theStatesOf(stored: unknown): { readonly value: Record<string, unknown> } | { readonly why: string } {
  if (typeof stored !== 'string') return { why: `the session's ${THE_STATES_COLUMN} is not text` }
  try {
    const value = JSON.parse(stored) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { why: `the session's ${THE_STATES_COLUMN} is not an object` }
    return { value: value as Record<string, unknown> }
  } catch {
    return { why: `the session's ${THE_STATES_COLUMN} cannot be read` }
  }
}

/** The states the session holds that the engine does not keep, by key. */
const statesTheEngineDoesNotKeep = (facts: Pick<EngineFacts, 'session_store'>, states: readonly string[]): string[] => states.filter((key) => !facts.session_store.extension_states.includes(key))

/** What the launch created its session with. */
export interface TheSessionLaunched {
  readonly session_id: string
  readonly working_dir: string
  readonly mode: string
  readonly provider: string
  readonly model: string
  /** The extensions the config names, by name: the one a member keeps and the crew's tool server. */
  readonly extensions: readonly string[]
}

/** The names of the enabled extensions in the stored state, sorted, or undefined when the state has no list of them. */
function theEnabledNames(state: unknown): string[] | undefined {
  const extensions = state !== null && typeof state === 'object' ? (state as Record<string, unknown>)['extensions'] : undefined
  if (!Array.isArray(extensions)) return undefined
  const names = extensions.map((extension) => (extension !== null && typeof extension === 'object' ? (extension as Record<string, unknown>)['name'] : undefined))
  return names.every((name): name is string => typeof name === 'string') ? names.sort() : undefined
}

/** The model a stored model config names, or undefined. */
function theModelNamed(stored: string | null): unknown {
  if (stored === null) return undefined
  try {
    const config = JSON.parse(stored) as unknown
    return config !== null && typeof config === 'object' ? (config as Record<string, unknown>)[THE_MODEL_NAME] : undefined
  } catch {
    return undefined
  }
}

/**
 * The first read, right after the `session/new` answer: the snapshot, or why the start is refused. Each value is held to
 * what the launch created, by name, so a session the engine opened on another folder, mode, provider, model or set of
 * extensions never runs a turn. `opened` is every session the launch opened, this one among them.
 */
export function theSessionsFirstRead(facts: Pick<EngineFacts, 'session_store'>, store: string, launched: TheSessionLaunched, opened: readonly string[]): { readonly snapshot: TheSessionsGate } | { readonly refusal: string } {
  const read = theCurrentRow(facts, store, launched.session_id, opened)
  if ('why' in read) return { refusal: read.why }
  const unkept = statesTheEngineDoesNotKeep(facts, read.states)
  const differing = [...theValuesCompared(read, launched), { what: 'the extension states', held: unkept, launched_with: facts.session_store.extension_states, same: unkept.length === 0 }].find(
    (compared) => !compared.same,
  )
  if (differing === undefined) return { snapshot: read.gate }
  return { refusal: `the session ${launched.session_id} runs with ${differing.what} ${JSON.stringify(differing.held)}, and the launch created it with ${JSON.stringify(differing.launched_with)}` }
}

/** One value of the session held against the one the launch created it with. */
interface AValueCompared {
  readonly what: string
  readonly held: unknown
  readonly launched_with: unknown
  readonly same: boolean
}

/** The session's values held against the launch's, in the order the first read judges them. */
function theValuesCompared(read: { readonly gate: TheSessionsGate; readonly states_value: Record<string, unknown> }, launched: TheSessionLaunched): readonly AValueCompared[] {
  const { fields } = read.gate
  const one = (what: string, held: unknown, launched_with: unknown): AValueCompared => ({ what, held, launched_with, same: held === launched_with })
  const names = theEnabledNames(read.states_value[Object.keys(read.states_value).find((key) => theStateNamed(key) === THE_ENABLED_EXTENSIONS_STATE) ?? ''])
  const wanted = [...launched.extensions].sort()
  const filled = EMPTY_AT_THE_START.find((column) => fields[column] !== null)
  return [
    one('the working folder', fields.working_dir, launched.working_dir),
    one('the mode', fields.goose_mode, launched.mode),
    one('the provider', fields.provider_name, launched.provider),
    one('the model', theModelNamed(fields.model_config_json), launched.model),
    { what: 'the extensions', held: names, launched_with: wanted, same: names !== undefined && names.length === wanted.length && names.every((name, at) => name === wanted[at]) },
    ...(filled === undefined ? [] : [one(filled, fields[filled], null)]),
  ]
}

/**
 * The read after every result and at every permission request: why the member must stop, or undefined. Every row is a
 * session the launch opened, the current session's gate fields and enabled extensions are as the snapshot holds them,
 * and no state the engine does not keep has appeared in it.
 */
export function theSessionStillHolds(facts: Pick<EngineFacts, 'session_store'>, store: string, snapshot: TheSessionsGate): string | undefined {
  const read = theCurrentRow(facts, store, snapshot.id, snapshot.opened)
  if ('why' in read) return read.why
  const changed = THE_GATE_COLUMNS.find((column) => read.gate.fields[column] !== snapshot.fields[column])
  if (changed !== undefined) return `the session ${snapshot.id}'s ${changed} was changed after it started, and the engine runs its next step with it`
  if (read.gate.enabled_extensions !== snapshot.enabled_extensions) return `the session ${snapshot.id}'s enabled extensions were changed after it started, and the engine runs its next step with them`
  const unkept = statesTheEngineDoesNotKeep(facts, read.states)
  if (unkept.length > 0) return `the session ${snapshot.id} holds the extension states ${unkept.join(', ')}, which the engine does not keep`
  return undefined
}
