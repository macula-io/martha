// Which facts of two recordings of the Claude Code host differ, once the minifier's names are taken out (martha#811).
//
// Every field of the recording is on exactly one closed list: kept as written, a code field read as text, or a guard
// field read as the functions it reaches. A field on none of them is not compared at all, so the compare refuses it
// rather than letting it pass unseen. A code field's callees (`<field>_callees`, follow_the_free_callees.ts) are read
// with it: each text under the renaming, and the entries its calls bind to, in the order it calls them. The follower
// records a text's calls in the order the text first names them, and the renaming numbers names in that same order, so
// a callee swapped for another changes the list of entries though no text changed.
//
// What a difference reports is the field and the first place it differs after renaming: a path into the field and, in
// a text, the character. Never the text itself, since the drift job's log is public.

import { normalized, Renaming, Unreadable, type Shape } from './compare_under_renaming.ts'
import type { Depth } from './what_a_recorded_text_calls.ts'
import type { GuardCalls } from './what_a_recorded_text_calls.ts'

/** The suffix of the field that holds what a code field's texts call. */
const CALLEES = '_callees'

/** The field that holds what `field`'s texts call. */
export const calleesFieldOf = (field: string): string => `${field}${CALLEES}`

/** A recorded code field: how each of its texts is read, and how far its callees are followed. */
export interface CodeField {
  /** One shape for every text, or one per text in order. */
  readonly shapes: Shape | readonly Shape[]
  readonly depth: Depth
  /**
   * The field whose text these texts are found from, by the function names they declare, when a reader wrote them other
   * than the bundle spells them (a constant put in by value): the hook set's exits' functions are found from the hook set.
   */
  readonly foundFrom?: string
}

const FULL: Depth = 'full'
const ONE_LEVEL: Depth = 'one level'

/**
 * The code fields. The depth is Raf's ruling on martha#811 (DECIDED 2026-11-19 "A: full on guards, 1 level on loaders
 * (Recommended)"): the full chase on the guards and the small fields, one level on the four loaders.
 */
export const CODE_FIELDS: Readonly<Record<string, CodeField>> = {
  session_start_schema: { shapes: 'members', depth: FULL },
  prompt_origin_mapper: { shapes: 'program', depth: FULL },
  prompt_origin_fallback: { shapes: 'program', depth: FULL },
  prompt_origin_subkinds: { shapes: 'program', depth: FULL },
  frontmatter_reader: { shapes: ['opening', 'program'], depth: FULL },
  output_style_schema: { shapes: 'expression', depth: FULL },
  user_output_styles_dir: { shapes: 'members', depth: FULL },
  bare_mode_test: { shapes: 'program', depth: FULL },
  host_skill_catalog: { shapes: 'program', depth: FULL },
  file_permission_rules: { shapes: 'program', depth: FULL },
  hooks_switches: { shapes: 'program', depth: ONE_LEVEL },
  hooks_switch_calls: { shapes: 'program', depth: ONE_LEVEL, foundFrom: 'hooks_switches' },
  markdown_loader: { shapes: 'program', depth: ONE_LEVEL },
  skills_loader: { shapes: 'program', depth: ONE_LEVEL },
}

/** The guard fields: the functions a guard reaches, each followed in full (martha#412, martha#438, R6). */
export const GUARD_FIELDS: readonly string[] = ['managed_folder_guard_calls', 'file_mode_guard_calls']

/** The fields that hold the host's own words or values, not code: compared as written. */
export const KEPT_FIELDS: readonly string[] = [
  'classic_hook_events', 'notification_types', 'managed_settings', 'frontmatter_pattern', 'markdown_kinds', 'protected_config_names',
  'config_code_places', 'legacy_global_config_names', 'sign_in_store_variable', 'cloud_provider_variables', 'failed_agents_report',
]

/** Every text a code field's value holds, in order: the value itself, each element of a list, or each value of an object. */
export function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  const values = Array.isArray(value) ? (value as unknown[]) : value !== null && typeof value === 'object' ? Object.values(value) : []
  if (values.length === 0 || values.some((each) => typeof each !== 'string')) throw new Unreadable('a code field holds something other than its texts')
  return values as string[]
}

/** The shape the code field reads its text at `index` in. */
function shapeAt(field: CodeField, index: number): Shape {
  const shape = typeof field.shapes === 'string' ? field.shapes : field.shapes[index]
  if (shape === undefined) throw new Unreadable('a code field holds more texts than it has shapes for')
  return shape
}

/** A guard's calls, renamed: the entries they bind to, in the order the text calls them. */
const renamedCalls = (calls: Readonly<Record<string, number>>): number[] => Object.values(calls)

/**
 * What a guard reaches, renamed: each entry's text under a renaming of that entry's own, since a name of one entry need
 * not be the same binding in another, and the entries it calls.
 */
function normalizedGuard(guard: GuardCalls | undefined): { readonly guard_calls: number[]; readonly functions: unknown[] } {
  if (guard === undefined || typeof guard !== 'object' || !Array.isArray(guard.functions)) throw new Unreadable('a guard field holds no functions')
  return {
    guard_calls: renamedCalls(guard.guard_calls),
    functions: guard.functions.map((entry) => ({ function: normalized(entry.function, 'program', new Renaming()), calls: renamedCalls(entry.calls) })),
  }
}

/** One field of a recording as the compare reads it: its texts under one renaming of its own, and what they call. */
export function normalizedField(field: string, recording: Readonly<Record<string, unknown>>): unknown {
  const value = recording[field]
  if (KEPT_FIELDS.includes(field)) return value
  if (GUARD_FIELDS.includes(field)) return normalizedGuard(value as GuardCalls | undefined)
  const code = CODE_FIELDS[field]
  if (code === undefined) throw new Unreadable(`the field ${field} is on none of the compare's lists`)
  const callees = recording[calleesFieldOf(field)] as GuardCalls | undefined
  const normalizedCallees = normalizedGuard(callees)
  const outside = new Renaming()
  const texts = textsOf(value).map((text, index) => normalized(text, shapeAt(code, index), outside))
  return { texts, callees: normalizedCallees }
}

/** The first character at which two texts differ. */
function firstDifferingCharacter(left: string, right: string): number {
  let at = 0
  while (at < left.length && left[at] === right[at]) at += 1
  return at
}

/** The path to one key of a value: an index into an array, a name into anything else. */
function pathTo(path: string, key: string, inAnArray: boolean): string {
  if (inAnArray) return `${path}[${key}]`
  return path === '' ? key : `${path}.${key}`
}

/** Whether two values are both objects, read key by key. */
const areObjects = (left: unknown, right: unknown): boolean => left !== null && right !== null && typeof left === 'object' && typeof right === 'object'

/** Where two objects first differ, under the first key they differ at; undefined when no key does. */
function firstDifferingKey(left: object, right: object, path: string): string | undefined {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
  const valueAt = (value: object, key: string): unknown => (value as Record<string, unknown>)[key]
  const key = keys.find((each) => JSON.stringify(valueAt(left, each)) !== JSON.stringify(valueAt(right, each)))
  return key === undefined ? undefined : firstDifference(valueAt(left, key), valueAt(right, key), pathTo(path, key, Array.isArray(left)))
}

/** Where two values first differ: a path into them, and in a text the character. */
function firstDifference(left: unknown, right: unknown, path = ''): string {
  if (typeof left === 'string' && typeof right === 'string') return `${path || 'the value'}, character ${String(firstDifferingCharacter(left, right))}`
  const inAKey = areObjects(left, right) ? firstDifferingKey(left as object, right as object, path) : undefined
  return inAKey ?? (path || 'the value')
}

/** One field that differs, and where. */
export interface Difference {
  readonly field: string
  readonly at: string
}

/** The fields compared: every field of either recording, but the version, the carried ones and the callee fields read with their own. */
function comparedFields(committed: Readonly<Record<string, unknown>>, derived: Readonly<Record<string, unknown>>, carried: readonly string[]): string[] {
  const all = [...new Set([...Object.keys(committed), ...Object.keys(derived)])]
  return all.filter((field) => field !== 'host_version' && !carried.includes(field) && !(field.endsWith(CALLEES) && CODE_FIELDS[field.slice(0, -CALLEES.length)] !== undefined)).sort()
}

/**
 * The fields whose facts differ between two recordings once renamed, and the fields neither side can be read for. A
 * field one side cannot be read for never compares equal.
 */
export function differencesBetween(
  committed: Readonly<Record<string, unknown>>,
  derived: Readonly<Record<string, unknown>>,
  carried: readonly string[],
): { readonly differ: readonly Difference[]; readonly unreadable: readonly string[] } {
  const differ: Difference[] = []
  const unreadable: string[] = []
  for (const field of comparedFields(committed, derived, carried)) {
    const compared = comparedField(field, committed, derived)
    if (compared instanceof Unreadable) unreadable.push(field)
    else if (compared !== undefined) differ.push(compared)
  }
  return { differ, unreadable }
}

/** One field compared: where it differs, undefined when it agrees, or the error when a side cannot be read. */
function comparedField(field: string, committed: Readonly<Record<string, unknown>>, derived: Readonly<Record<string, unknown>>): Difference | Unreadable | undefined {
  try {
    const [left, right] = [normalizedField(field, committed), normalizedField(field, derived)]
    return JSON.stringify(left) !== JSON.stringify(right) ? { field, at: firstDifference(left, right) } : undefined
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error
    return error
  }
}
