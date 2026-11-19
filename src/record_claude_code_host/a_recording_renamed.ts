// A recording of the Claude Code host with every name the minifier gives replaced, consistently, by another: what a
// release that moved no fact looks like to the compare (martha#811). Test support only.
//
// It is written apart from compare_under_renaming.ts, so a role the compare reads wrongly is not read wrongly here too:
// it renames every identifier the parser reads that is not a key, a member's name, an import's name or a global on the
// compare's committed list, under ONE map for the whole recording, and the keys of every `calls` and `guard_calls` map
// by the same map. A shorthand key keeps its key: `{a}` becomes `{a:<new>}`, in a literal and in a destructuring.
// The new names are fresh: none of them is spelt anywhere in the recording before.

import ts from 'typescript'

import { CODE_FIELDS, GUARD_FIELDS, calleesFieldOf } from '../compare_two_host_recordings/compare_two_recordings.ts'
import { GLOBALS, type Shape } from '../compare_two_host_recordings/compare_under_renaming.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

/** How a text of each shape is made a program for the parse, and where the text starts in it. */
const WRAP: Readonly<Record<Shape, readonly [string, string]>> = {
  program: ['', ''],
  members: ['({', '})'],
  expression: ['(', ')'],
  opening: ['', '}'],
}

/** Whether the identifier is a key, a member's name or an import's name: spelt as written by the host, never renamed. */
function isAKey(node: ts.Identifier): boolean {
  const { parent } = node
  if (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) return parent.name === node
  if (ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertyDeclaration(parent)) return parent.name === node
  if (ts.isBindingElement(parent) || ts.isImportSpecifier(parent)) return parent.propertyName === node
  return ts.isMetaProperty(parent)
}

/** Whether the identifier stands for its own key too: `{a}` in an object literal or an object destructuring. */
function isAShorthandKey(node: ts.Identifier): boolean {
  const { parent } = node
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === node
  return ts.isBindingElement(parent) && parent.name === node && parent.propertyName === undefined && parent.dotDotDotToken === undefined && ts.isObjectBindingPattern(parent.parent)
}

/** Every identifier of a program, in source order. */
function identifiersOf(file: ts.SourceFile): ts.Identifier[] {
  const found: ts.Identifier[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** One map from a minified name to a fresh one, shared by every text and every calls map of the recording. */
export class ANameMap {
  readonly #names = new Map<string, string>()
  readonly #taken: ReadonlySet<string>

  /** `taken`: every name spelt in the recording, which no new name may be. */
  constructor(taken: ReadonlySet<string>) {
    this.#taken = taken
  }

  /** The new name of `name`, given on first sight. */
  of(name: string): string {
    const known = this.#names.get(name)
    if (known !== undefined) return known
    let fresh = `$r${String(this.#names.size)}`
    while (this.#taken.has(fresh)) fresh = `${fresh}_`
    this.#names.set(name, fresh)
    return fresh
  }

  /** How many names the map has renamed. */
  get size(): number {
    return this.#names.size
  }
}

/** A text of `shape` with every renamable name renamed by `names`. */
export function renamedText(text: string, shape: Shape, names: ANameMap): string {
  const [before, after] = WRAP[shape]
  const program = `${before}${text}${after}`
  const file = ts.createSourceFile('renamed.js', program, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let out = ''
  let at = 0
  for (const node of identifiersOf(file)) {
    if (isAKey(node) || GLOBALS.has(node.text)) continue
    const start = node.getStart(file)
    const fresh = names.of(node.text)
    out += program.slice(at, start) + (isAShorthandKey(node) ? `${node.text}:${fresh}` : fresh)
    at = node.end
  }
  out += program.slice(at)
  return out.slice(before.length, out.length - after.length)
}

/** Every identifier spelt in a text of `shape`, renamable or not. */
function namesIn(text: string, shape: Shape): string[] {
  const [before, after] = WRAP[shape]
  return identifiersOf(ts.createSourceFile('names.js', `${before}${text}${after}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)).map((node) => node.text)
}

/** A calls map with its keys renamed and its indices kept, in its order. */
const renamedCalls = (calls: Readonly<Record<string, number>>, names: ANameMap): Record<string, number> =>
  Object.fromEntries(Object.entries(calls).map(([name, index]) => [names.of(name), index]))

/** A guard's calls renamed: its own calls, and each function it reaches with that function's calls. */
const renamedGuard = (guard: GuardCalls, names: ANameMap): GuardCalls => ({
  guard_calls: renamedCalls(guard.guard_calls, names),
  functions: guard.functions.map((entry) => ({ function: renamedText(entry.function, 'program', names), calls: renamedCalls(entry.calls, names) })),
})

/** The shape a code field reads its text at `index` in. */
function shapeOf(field: string, index: number): Shape {
  const { shapes } = CODE_FIELDS[field] ?? { shapes: 'program' }
  return typeof shapes === 'string' ? shapes : (shapes[index] ?? 'program')
}

/** A code field's value with each of its texts renamed, kept as a string, a list or an object as it was. */
function renamedCode(field: string, value: unknown, names: ANameMap): unknown {
  if (typeof value === 'string') return renamedText(value, shapeOf(field, 0), names)
  if (Array.isArray(value)) return value.map((text: string, index) => renamedText(text, shapeOf(field, index), names))
  return Object.fromEntries(Object.entries(value as Record<string, string>).map(([key, text], index) => [key, renamedText(text, shapeOf(field, index), names)]))
}

/** Every text of a recording with the shape it is read in: the code fields', their callees' and the guards' functions. */
function textsOfTheRecording(recording: Readonly<Record<string, unknown>>): Array<readonly [string, Shape]> {
  const texts: Array<readonly [string, Shape]> = []
  const guards = [...GUARD_FIELDS, ...Object.keys(CODE_FIELDS).map(calleesFieldOf)]
  for (const field of guards) for (const entry of (recording[field] as GuardCalls).functions) texts.push([entry.function, 'program'])
  for (const field of Object.keys(CODE_FIELDS)) {
    const value = recording[field]
    const values = typeof value === 'string' ? [value] : Object.values(value as Record<string, string>)
    values.forEach((text, index) => texts.push([text, shapeOf(field, index)]))
  }
  return texts
}

/** The recording with every name the minifier gives renamed under one map, and the map, to show the renaming happened. */
export function aRecordingRenamed(recording: Readonly<Record<string, unknown>>): { readonly renamed: Record<string, unknown>; readonly names: ANameMap } {
  const taken = new Set(textsOfTheRecording(recording).flatMap(([text, shape]) => namesIn(text, shape)))
  const names = new ANameMap(taken)
  const renamed: Record<string, unknown> = { ...recording }
  for (const field of Object.keys(CODE_FIELDS)) {
    renamed[field] = renamedCode(field, recording[field], names)
    renamed[calleesFieldOf(field)] = renamedGuard(recording[calleesFieldOf(field)] as GuardCalls, names)
  }
  for (const field of GUARD_FIELDS) renamed[field] = renamedGuard(recording[field] as GuardCalls, names)
  return { renamed, names }
}

/** A whole program, such as a host's bundle, with every name the minifier gives renamed under one fresh map. */
export function aProgramRenamed(text: string): { readonly renamed: string; readonly names: ANameMap } {
  const names = new ANameMap(new Set(namesIn(text, 'program')))
  return { renamed: renamedText(text, 'program', names), names }
}
