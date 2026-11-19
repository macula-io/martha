// The compare reads a renaming as no change and every other change as one (martha#811).
//
// The pass path is the 2.1.328 recording with every minified name renamed by a renamer written apart from the compare
// (a_recording_renamed.ts). The real pair is 2.1.327 against 2.1.328, both recorded by this recorder and committed
// beside it: the release moved five facts, checked entry by entry on martha#811, and the compare names those five.
// Each change the compare must see has a twin that differs only by a renaming and must read the same, so a compare
// that reads everything as different fails as surely as one that reads everything the same.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { aRecordingRenamed } from './a_recording_renamed.ts'
import { CARRIED } from './carry_over_what_is_restated_by_hand.ts'
import { CODE_FIELDS, calleesFieldOf, differencesBetween } from '../compare_two_host_recordings/compare_two_recordings.ts'
import { normalized, Renaming, Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

type Recording = Record<string, unknown>

const fixture = (version: string): Recording =>
  JSON.parse(readFileSync(new URL(`./the_real_pair_${version}.json`, import.meta.url), 'utf8')) as Recording
const OLDER = fixture('2.1.327')
const NEWER = fixture('2.1.328')

/** The fields the compare names between `committed` and `derived`, and those it cannot read. */
function compared(committed: Recording, derived: Recording): { readonly differ: string[]; readonly unreadable: readonly string[] } {
  const { differ, unreadable } = differencesBetween(committed, derived, CARRIED)
  return { differ: differ.map((difference) => difference.field), unreadable }
}

/** Two texts read the same once renamed. */
const readTheSame = (one: string, other: string): boolean => normalized(one, 'program', new Renaming()) === normalized(other, 'program', new Renaming())

/** The first code field whose callees call two or more entries with different indices, and those callees. */
function aFieldCallingTwoEntries(recording: Recording): { readonly field: string; readonly callees: GuardCalls } {
  for (const field of Object.keys(CODE_FIELDS)) {
    const callees = recording[calleesFieldOf(field)] as GuardCalls
    if (new Set(Object.values(callees.guard_calls)).size >= 2) return { field, callees }
  }
  throw new Error('no code field of the fixture calls two entries')
}

/** `recording` with one code field's callees replaced by what `change` makes of a copy of them. */
function withCallees(recording: Recording, field: string, change: (calls: Record<string, number>) => Record<string, number>): Recording {
  const callees = structuredClone(recording[calleesFieldOf(field)]) as GuardCalls
  return { ...recording, [calleesFieldOf(field)]: { ...callees, guard_calls: change({ ...callees.guard_calls }) } }
}

test('the real pair, 2.1.327 against 2.1.328, differs in exactly the five fields the release changed', () => {
  assert.deepEqual(compared(OLDER, NEWER), {
    differ: ['hooks_switch_calls', 'host_skill_catalog', 'managed_folder_guard_calls', 'markdown_loader', 'skills_loader'],
    unreadable: [],
  })
})

test('a recording with every minified name renamed reads the same, and the renaming did rename every code field', () => {
  const { renamed, names } = aRecordingRenamed(NEWER)
  assert.ok(names.size > 0, 'the renamer renamed no name')
  for (const field of Object.keys(CODE_FIELDS)) assert.notEqual(JSON.stringify(renamed[field]), JSON.stringify(NEWER[field]), `${field} was not renamed`)
  assert.deepEqual(compared(NEWER, renamed), { differ: [], unreadable: [] })
})

/** A field's texts read under one renaming, as the compare reads a code field's texts. */
const fieldReads = (texts: readonly string[]): string[] => {
  const renaming = new Renaming()
  return texts.map((text) => normalized(text, 'program', renaming))
}

// The minifier reuses its short names across functions: in 2.1.327 a parameter can share its name with a function
// another text of the same field calls, and in 2.1.328 not. A local is renamed per binding, so that reads the same.
test('a local that shares its name with a name another text of the field calls reads the same as one that does not', () => {
  assert.deepEqual(fieldReads(['function f(a){return a}', 'g(a)']), fieldReads(['function f(b){return b}', 'g(a)']))
  assert.notDeepEqual(fieldReads(['function f(a){return a}', 'g(a)']), fieldReads(['function f(b){return b}', 'g(f)']))
})

test('a property name that changed differs; the same text under other names does not', () => {
  assert.ok(readTheSame('function f(a){return a.size+g(a)}', 'function q(z){return z.size+h(z)}'))
  assert.ok(!readTheSame('function f(a){return a.size+g(a)}', 'function f(a){return a.length+g(a)}'))
})

test('a key destructured by its own name is kept: {foo} and {bar} differ, {foo} and {foo:y} do not', () => {
  assert.ok(readTheSame('const {foo}=x;g(foo)', 'const {foo:y}=z;h(y)'))
  assert.ok(!readTheSame('const {foo}=x;g(foo)', 'const {bar}=x;g(bar)'))
})

test('a global the minifier never renames, read as a minified name, differs; two minified names do not', () => {
  assert.ok(readTheSame('qZ.env.HOME', 'rY.env.HOME'))
  assert.ok(!readTheSame('process.env.HOME', 'qZ.env.HOME'))
})

test('a character of a template literal, a literal inside ${} and a character of a regex each differ', () => {
  assert.ok(readTheSame('f(`a${x}b`)', 'g(`a${y}b`)'))
  assert.ok(!readTheSame('f(`a${x}b`)', 'f(`a${x}c`)'))
  assert.ok(!readTheSame('f(`a${"k"}b`)', 'f(`a${"j"}b`)'))
  assert.ok(readTheSame('a=/x[y]/', 'b=/x[y]/'))
  assert.ok(!readTheSame('a=/x[y]/', 'a=/x[z]/'))
})

test('a text the parser reports a diagnostic for is unreadable, and its field is named unreadable, never equal', () => {
  assert.throws(() => normalized('a=(', 'program', new Renaming()), Unreadable)
  const broken = { ...NEWER, bare_mode_test: 'a=(' }
  assert.deepEqual(compared(NEWER, broken), { differ: [], unreadable: ['bare_mode_test'] })
})

test('a field on none of the compare lists is unreadable, never passed unseen', () => {
  assert.deepEqual(compared(NEWER, { ...NEWER, a_new_fact: 'x' }), { differ: [], unreadable: ['a_new_fact'] })
})

test('a global read as a minified name in a real recorded text makes that field, and only it, differ', () => {
  const field = Object.keys(CODE_FIELDS).find((name) => typeof NEWER[name] === 'string' && (NEWER[name] as string).includes('process.'))
  assert.ok(field !== undefined, 'no recorded text reads process')
  const changed = { ...NEWER, [field]: (NEWER[field] as string).replace('process.', 'qZ9.') }
  assert.deepEqual(compared(NEWER, changed), { differ: [field], unreadable: [] })
})

test('callees swapped for one another, a call added, and two calls reordered each make the calling field differ', () => {
  const { field, callees } = aFieldCallingTwoEntries(NEWER)
  const [first, second] = Object.keys(callees.guard_calls).filter((name, at, all) => all.findIndex((other) => callees.guard_calls[other] === callees.guard_calls[name]) === at)
  assert.ok(first !== undefined && second !== undefined)
  const swapped = withCallees(NEWER, field, (calls) => ({ ...calls, [first]: calls[second] as number, [second]: calls[first] as number }))
  const added = withCallees(NEWER, field, (calls) => ({ ...calls, aNewCallee: calls[first] as number }))
  const reordered = withCallees(NEWER, field, (calls) => Object.fromEntries(Object.entries(calls).reverse()))
  for (const changed of [swapped, added, reordered]) assert.deepEqual(compared(NEWER, changed), { differ: [field], unreadable: [] })
})
