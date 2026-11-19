// The engine's session store read back (#541 package A, design r=5 "The engine's session store", PASS r=7
// issuecomment-7010033523). The engine keeps one row per session in `data/sessions.db` and loads the row again at the
// top of every step, so a `shell` write to it changes what the next step runs with. None of the fields below is
// re-derived from the byte-checked config on a step: the step takes them from the row. So the launch reads them:
//   1. right after the ACP `session/new` answer: the session's row checked against what the launch created (the
//      working folder, the mode that asks, the config's provider and model, exactly the config's extensions, and no
//      recipe, prompt override, prompt extras or container). A difference refuses the start; the read is the snapshot;
//   2. after every result and at every permission request: the launch's row is the only row, every gate field equals
//      the snapshot, and `extension_data` holds no state the engine does not keep (the recorded `extension_states`).
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

/** The one row of the store, the launch's, read into its gate, or why not. */
function theOnlyRow(facts: Pick<EngineFacts, 'session_store'>, store: string, session_id: string): { readonly gate: TheSessionsGate; readonly states: readonly string[]; readonly states_value: Record<string, unknown> } | { readonly why: string } {
  const read = theRows(facts, store)
  if ('why' in read) return read
  if (read.rows.length !== 1) return { why: `the session store at ${store} holds ${read.rows.length} sessions, and a launch's store holds its own one` }
  const [row] = read.rows
  if (row === undefined || row[THE_ID_COLUMN] !== session_id) return { why: `the session store at ${store} holds a session that is not this launch's ${session_id}` }
  const fields: Partial<Record<AGateColumn, string | null>> = {}
  for (const column of THE_GATE_COLUMNS) {
    const value = textOf(row, column)
    if (value !== null && typeof value === 'object') return value
    fields[column] = value
  }
  const states = theStatesOf(row[THE_STATES_COLUMN])
  if ('why' in states) return states
  const enabled = Object.entries(states.value).filter(([key]) => theStateNamed(key) === THE_ENABLED_EXTENSIONS_STATE)
  if (enabled.length !== 1) return { why: `the session's ${THE_STATES_COLUMN} holds ${enabled.length} states of its enabled extensions, and a step reads one` }
  return { gate: { id: session_id, fields: fields as Record<AGateColumn, string | null>, enabled_extensions: JSON.stringify(enabled[0]?.[1]) }, states: Object.keys(states.value), states_value: states.value }
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
 * extensions never runs a turn.
 */
export function theSessionsFirstRead(facts: Pick<EngineFacts, 'session_store'>, store: string, launched: TheSessionLaunched): { readonly snapshot: TheSessionsGate } | { readonly refusal: string } {
  const read = theOnlyRow(facts, store, launched.session_id)
  if ('why' in read) return { refusal: read.why }
  const { fields } = read.gate
  const differs = (what: string, held: unknown, launched_with: unknown): { readonly refusal: string } => ({
    refusal: `the session ${launched.session_id} runs with ${what} ${JSON.stringify(held)}, and the launch created it with ${JSON.stringify(launched_with)}`,
  })
  if (fields.working_dir !== launched.working_dir) return differs('the working folder', fields.working_dir, launched.working_dir)
  if (fields.goose_mode !== launched.mode) return differs('the mode', fields.goose_mode, launched.mode)
  if (fields.provider_name !== launched.provider) return differs('the provider', fields.provider_name, launched.provider)
  const model = theModelNamed(fields.model_config_json)
  if (model !== launched.model) return differs('the model', model, launched.model)
  const names = theEnabledNames(read.states_value[Object.keys(read.states_value).find((key) => theStateNamed(key) === THE_ENABLED_EXTENSIONS_STATE) ?? ''])
  const wanted = [...launched.extensions].sort()
  if (names === undefined || names.length !== wanted.length || names.some((name, at) => name !== wanted[at])) return differs('the extensions', names, wanted)
  const filled = EMPTY_AT_THE_START.find((column) => fields[column] !== null)
  if (filled !== undefined) return differs(filled, fields[filled], null)
  const unkept = statesTheEngineDoesNotKeep(facts, read.states)
  if (unkept.length > 0) return differs('the extension states', unkept, facts.session_store.extension_states)
  return { snapshot: read.gate }
}

/**
 * The read after every result and at every permission request: why the member must stop, or undefined. The launch's row
 * is the only row, each gate field and the enabled extensions are as the snapshot holds them, and no state the engine
 * does not keep has appeared.
 */
export function theSessionStillHolds(facts: Pick<EngineFacts, 'session_store'>, store: string, snapshot: TheSessionsGate): string | undefined {
  const read = theOnlyRow(facts, store, snapshot.id)
  if ('why' in read) return read.why
  const changed = THE_GATE_COLUMNS.find((column) => read.gate.fields[column] !== snapshot.fields[column])
  if (changed !== undefined) return `the session ${snapshot.id}'s ${changed} was changed after it started, and the engine runs its next step with it`
  if (read.gate.enabled_extensions !== snapshot.enabled_extensions) return `the session ${snapshot.id}'s enabled extensions were changed after it started, and the engine runs its next step with them`
  const unkept = statesTheEngineDoesNotKeep(facts, read.states)
  if (unkept.length > 0) return `the session ${snapshot.id} holds the extension states ${unkept.join(', ')}, which the engine does not keep`
  return undefined
}
