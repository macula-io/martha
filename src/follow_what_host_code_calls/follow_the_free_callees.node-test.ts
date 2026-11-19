// The follower reads what a recorded text calls, and refuses what it cannot tell (martha#811 r=1).
//
// Each case builds a small bundle, records one code field's text and its callees as the recorder does, and compares two
// such recordings with differencesBetween, the comparison --check runs: a field it names there is the field --check
// prints under "differs", and --check exits 1 on it. A write the follower does not read must make the field unreadable,
// never pass with the text the binding was declared with.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { Bundle, calleesOf } from './follow_the_free_callees.ts'
import { CODE_FIELDS, calleesFieldOf, differencesBetween } from '../compare_two_host_recordings/compare_two_recordings.ts'
import { Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

/** A code field the full chase follows, read as one program: the field each case records. */
const FIELD = 'bare_mode_test'
/** The recorded text every case's bundle holds once: a guard that calls one name. */
const THE_TEXT = 'function G(){return X(1)}'

/** What the follower records for `text`, held once in `host`, to the full depth. */
function calleesIn(host: string, text: string = THE_TEXT): GuardCalls {
  const at = host.indexOf(text)
  assert.ok(at >= 0 && host.indexOf(text, at + 1) < 0, 'the bundle does not hold the recorded text exactly once')
  return calleesOf(new Bundle(host), [{ at, length: text.length }], 'full')
}

/** A recording of the one field, as the recorder writes it. */
const recordingOf = (host: string, text: string = THE_TEXT): Record<string, unknown> => ({ [FIELD]: text, [calleesFieldOf(FIELD)]: calleesIn(host, text) })

/** The fields the comparison --check runs names between two hosts' recordings of the field. */
function differing(one: string, other: string, text: string = THE_TEXT): readonly string[] {
  const { differ, unreadable } = differencesBetween(recordingOf(one, text), recordingOf(other, text), [])
  assert.deepEqual(unreadable, [])
  return differ.map(({ field }) => field)
}

test('the field the cases record is a code field the full chase follows', () => {
  assert.equal(CODE_FIELDS[FIELD]?.depth, 'full')
})

test('a member alias is followed to the binding it reads: a module swapped under it differs (martha#811 r=1; mutant: aliases read as code)', () => {
  const host = (module: string): string => `var X=Wn.join;var Wn=require("${module}");${THE_TEXT}`
  assert.deepEqual(differing(host('path'), host('path')), [])
  assert.deepEqual(differing(host('path'), host('os')), [FIELD])
})

test('a callee bound by a const arrow is recorded with its body: a changed body differs (martha#811 r=1; mutant: the declarator without its value)', () => {
  const host = (body: string): string => `const X=(a)=>${body};${THE_TEXT}`
  assert.deepEqual(differing(host('a+1'), host('a+1')), [])
  assert.deepEqual(differing(host('a+1'), host('a+2')), [FIELD])
})

test('two functions that call each other are each recorded once, and the chase ends (martha#811 r=1; mutant: a reached entry recorded again)', () => {
  const host = `function X(n){return n?Y(n-1):0}function Y(n){return n?X(n-1):1}${THE_TEXT}`
  const callees = calleesIn(host)
  assert.deepEqual(callees.functions.map(({ calls }) => calls), [{ Y: 1 }, { X: 0 }])
  assert.deepEqual(differing(host, host), [])
})

/** Each write to a recorded binding the follower does not read, after the binding is declared, and the kind it names. */
const WRITES_NOT_READ: ReadonlyArray<{ readonly write: string; readonly kind: string }> = [
  { write: 'X=b;', kind: 'plain' },
  { write: 'X??=b;', kind: 'compound' },
  { write: 'X||=b;', kind: 'compound' },
  { write: 'X+=b;', kind: 'compound' },
  { write: 'X++;', kind: 'update' },
  { write: '[X]=[b];', kind: 'destructuring' },
  { write: '({X}={X:b});', kind: 'destructuring' },
  { write: 'for(X of [b]);', kind: 'loop target' },
]

for (const { write, kind } of WRITES_NOT_READ) {
  test(`a recorded binding declared with a value and later written by \`${write}\` is unreadable, naming it (martha#811 r=1; mutant: the ${kind} write not read)`, () => {
    const host = `function a(){return 1}function b(){return 2}var X=a;${THE_TEXT}${write}`
    assert.throws(() => calleesIn(host), (error: unknown) => error instanceof Unreadable && error.message.includes(`, X, is written after it is declared (${kind}:`))
  })
}

test('a recorded function declaration written later is unreadable, naming it (martha#811 r=1; mutant: a declaration\'s writes not read)', () => {
  const host = `function b(){return 2}function X(){return 1}${THE_TEXT}X=b;`
  assert.throws(() => calleesIn(host), (error: unknown) => error instanceof Unreadable && error.message.includes(', X, is written after it is declared (plain:'))
})

test('a binding declared bare and set once by a plain write, the lazy init, is read as declared with that value', () => {
  const lazy = `function a(){return 1}var X;${THE_TEXT}X=a;`
  const eager = `function a(){return 1}var X=a;${THE_TEXT}`
  assert.equal(calleesIn(lazy).functions[0]?.function, 'var X=a')
  assert.deepEqual(differing(lazy, eager), [])
})

test('a global the bundle binds is followed like any name, and one it binds nowhere is not (martha#811 r=1; mutants: every global stopped at, none stopped at)', () => {
  const text = 'function G(){return Wn.join("a")}'
  const planted = `var require=(m)=>m;var Wn=require("path");${text}`
  assert.deepEqual(calleesIn(planted, text).functions.map((entry) => entry.function), ['var Wn=require("path")', 'var require=(m)=>m'])
  const unshadowed = `var Wn=require("path");${text}`
  assert.deepEqual(calleesIn(unshadowed, text).functions, [{ function: 'var Wn=require("path")', calls: {} }])
})

// A setter slot (martha#811 r=1, Supervisor's ruling): a binding declared with a value and written only by setters, each
// a function of one parameter whose whole body is `X=<that parameter>`, as the host's setSessionOverridesGetter is.
const aSlot = (setters: string, initial = '()=>{return}'): string => `var X=${initial};${setters}${THE_TEXT}`

test('a setter slot is recorded as its default and each setter, so a changed default or another setter differs (martha#811 r=1; mutants: no slot read, setters left out of the text)', () => {
  const one = aSlot('function S(e){X=e}')
  assert.equal(calleesIn(one).functions[0]?.function, 'var X=()=>{return};function S(e){X=e}')
  assert.equal(calleesIn(aSlot('var T=(f)=>X=f;')).functions[0]?.function, 'var X=()=>{return};(f)=>X=f')
  assert.deepEqual(differing(one, one), [])
  assert.deepEqual(differing(one, aSlot('function S(e){X=e}', '()=>{return 1}')), [FIELD])
  assert.deepEqual(differing(one, aSlot('function S(e){X=e}function T(f){X=f}')), [FIELD])
})

test('a setter whose body does more than the write is unreadable (martha#811 r=1; mutant: a body of more than one statement read as a setter)', () => {
  assert.throws(() => calleesIn(aSlot('function a(){}function S(e){X=e;a()}')), (error: unknown) => error instanceof Unreadable && error.message.includes(', X, is written after it is declared (plain:'))
})

/** Writes of a plain `X=` that are no setter: two parameters, a value that is not the parameter, a parameter with a default, a rest parameter. */
const NOT_SETTERS: readonly string[] = ['function S(e,f){X=e}', 'function a(){}function S(e){X=a}', 'function S(e=1){X=e}', 'function S(...e){X=e}']

for (const setter of NOT_SETTERS) {
  test(`a plain write from \`${setter}\`, no setter, is unreadable (martha#811 r=1; mutant: the setter's parameter not checked)`, () => {
    assert.throws(() => calleesIn(aSlot(setter)), (error: unknown) => error instanceof Unreadable && error.message.includes(', X, is written after it is declared (plain:'))
  })
}

test('a slot written by a setter and by any other write is unreadable (martha#811 r=1; mutant: one setter makes the slot)', () => {
  assert.throws(() => calleesIn(`${aSlot('function S(e){X=e}')}X=S;`), (error: unknown) => error instanceof Unreadable && error.message.includes(', X, is written after it is declared (plain:'))
})

// A value the bundle itself passes to a setter is the host's own code (martha#811 r=1, Supervisor's ruling (a2) by Raf's
// r=3 words): each call is recorded and its value followed, by the setter's own name or a name another module imports.
test('a setter the bundle calls has the call recorded and its value followed: a changed value differs (martha#811 r=1; mutant: in-bundle calls not followed)', () => {
  const host = (value: string): string => aSlot(`function S(e){X=e}function a(){return ${value}}S(()=>a());`)
  const callees = calleesIn(host('1'))
  assert.equal(callees.functions[0]?.function, 'var X=()=>{return};function S(e){X=e};S(()=>a())')
  assert.deepEqual(callees.functions.slice(1).map(({ function: text }) => text), ['function a(){return 1}'])
  assert.deepEqual(differing(host('1'), host('1')), [])
  assert.deepEqual(differing(host('1'), host('2')), [FIELD])
})

/** A bundle of two modules: the slot, its setter exported, and the guard in one; a module importing the setter and calling it in the other. */
function twoModules(value: string): string {
  const slot = `${CHUNK}\nvar X=()=>{return};function S(e){X=e}${THE_TEXT}export{S as Sx};\n`
  const caller = `${CHUNK}\nimport{Sx as T}from"/$bunfs/root/slot.js";function a(){return ${value}}T(()=>a());\n`
  return slot + caller
}

test('a setter another module imports and calls has that call recorded and its value followed (martha#811 r=1; mutant: importers not read)', () => {
  assert.equal(calleesIn(twoModules('1')).functions[0]?.function, 'var X=()=>{return};function S(e){X=e};T(()=>a())')
  assert.deepEqual(differing(twoModules('1'), twoModules('1')), [])
  assert.deepEqual(differing(twoModules('1'), twoModules('2')), [FIELD])
})

/** References to a setter that pass no one value: as a value, with two values, with none, spread. */
const NOT_A_CALL_OF_ONE: readonly string[] = ['var Y=S;', 'S(1,2);', 'S();', 'S(...[1]);']

for (const reference of NOT_A_CALL_OF_ONE) {
  test(`a setter the bundle refers to by \`${reference}\` is unreadable, naming it (martha#811 r=1; mutant: other references let through)`, () => {
    assert.throws(() => calleesIn(aSlot(`function S(e){X=e}${reference}`)), (error: unknown) => error instanceof Unreadable && error.message.includes(', S, is used other than called with one value'))
  })
}
