// A fake host bundle that holds a recording's parts and every code field's callees (martha#811), for the drift tests.
//
// The follower (follow_the_free_callees.ts) chases a recorded text's calls through the bundle's own imports, so each
// callee sits in a module of its own that imports what it calls and exports itself; a callee whose text a part already
// holds is exported from that part instead, so every recorded text is still held exactly once.

import ts from 'typescript'

import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { CODE_FIELDS, calleesFieldOf, textsOf } from '../compare_two_host_recordings/compare_two_recordings.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

/**
 * The parts held in a module of their own (martha#811): a minified name two fields call can be two bindings of two
 * modules, as `l` is for the hook set and the skills loader and `n` is for an exit of the hook set and the session-init
 * schema, so those fields sit where the real bundle keeps them, apart. Every other part shares the first module.
 */
const OWN_MODULE_PARTS: ReadonlyArray<readonly string[]> = [['hooks_switches', 'hooks_switch_calls'], ['skills_loader']]
const CALLEE_EXPORTS = 'calleeFunction'

/** One definition a code field's callees reach, as the fake bundle holds it: once, whatever field reaches it. */
interface Callee {
  readonly id: number
  readonly text: string
  readonly name: string
  readonly calls: Map<string, Callee>
  readonly home: string | undefined
}

/** The name a recorded definition binds: a function's or class's, a variable's, or an import's local name. */
export function boundNameOf(text: string): string {
  const [statement] = ts.createSourceFile('entry.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS).statements
  const bound = statement === undefined ? undefined : (declaredNameOf(statement) ?? importedNameOf(statement))
  if (bound !== undefined) return bound
  throw new Error(`A recorded callee binds no name the test can export: ${text.slice(0, 80)}`)
}

/** The name a function, class or variable statement declares, or undefined for any other statement. */
function declaredNameOf(statement: ts.Statement): string | undefined {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) return statement.name.text
  if (!ts.isVariableStatement(statement)) return undefined
  const [declaration] = statement.declarationList.declarations
  return declaration !== undefined && ts.isIdentifier(declaration.name) ? declaration.name.text : undefined
}

/** The first local name an import statement binds: its default, its namespace or its first named import. */
function importedNameOf(statement: ts.Statement): string | undefined {
  const bindings = ts.isImportDeclaration(statement) ? statement.importClause : undefined
  const named = bindings?.namedBindings
  const local = bindings?.name ?? (named === undefined ? undefined : ts.isNamespaceImport(named) ? named.name : named.elements[0]?.name)
  return local?.text
}

/** The part each code field's texts sit in, read from the parts that hold the recording as it is. */
function partsOfTheFields(recording: Readonly<Record<string, unknown>>, recordedParts: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const partOf = (field: string): string => {
    const texts = textsOf(recording[field])
    const part = Object.keys(recordedParts).find((key) => key !== 'guards' && texts.every((text) => (recordedParts[key] ?? '').includes(text)))
    // A field the recorder wrote a constant into by value is held as the bundle spells it, beside the field it is found from.
    const from = CODE_FIELDS[field]?.foundFrom
    if (part === undefined && from !== undefined) return partOf(from)
    if (part === undefined) throw new Error(`No part holds the recorded ${field}`)
    return part
  }
  return Object.fromEntries(Object.keys(CODE_FIELDS).map((field) => [field, partOf(field)]))
}

/**
 * Every callee the code fields reach, once by its text, each with what it calls; and each field's own calls. A callee
 * a recorded part holds lives in that part, as `recordedParts` hold the recording: a test that changes or drops the
 * part changes or drops the callee with it, and nothing puts the recorded text back in a module of its own.
 */
function calleesOfTheRecording(recording: Readonly<Record<string, unknown>>, parts: Readonly<Record<string, string>>): { readonly callees: readonly Callee[]; readonly fieldCalls: ReadonlyMap<string, ReadonlyMap<string, Callee>> } {
  const byText = new Map<string, Callee>()
  const calleeOf = (text: string): Callee => {
    const known = byText.get(text)
    if (known !== undefined) return known
    const home = Object.keys(parts).find((key) => key !== 'guards' && (parts[key] ?? '').includes(text))
    const made: Callee = { id: byText.size, text, name: boundNameOf(text), calls: new Map(), home }
    byText.set(text, made)
    return made
  }
  const bind = (into: Map<string, Callee>, name: string, callee: Callee): void => {
    const bound = into.get(name)
    if (bound !== undefined && bound !== callee) throw new Error(`The fake bundle would bind ${name} two ways`)
    into.set(name, callee)
  }
  const fieldCalls = new Map<string, Map<string, Callee>>()
  for (const field of Object.keys(CODE_FIELDS)) {
    const list = recording[calleesFieldOf(field)] as GuardCalls
    const entries = list.functions.map((entry) => calleeOf(entry.function))
    list.functions.forEach((entry, index) => {
      for (const [name, at] of Object.entries(entry.calls)) bind((entries[index] as Callee).calls, name, entries[at] as Callee)
    })
    const own = new Map<string, Callee>()
    for (const [name, at] of Object.entries(list.guard_calls)) bind(own, name, entries[at] as Callee)
    fieldCalls.set(field, own)
  }
  return { callees: [...byText.values()], fieldCalls }
}

/** The import a module needs for `calls`, leaving out what it declares itself and what `taken` already binds. */
function importsFor(calls: ReadonlyMap<string, Callee>, home: string | undefined, taken: ReadonlySet<string> = new Set()): string {
  const names = [...calls].filter(([name, callee]) => !taken.has(name) && !(callee.home !== undefined && callee.home === home && callee.name === name))
  return names.length === 0 ? '' : `import{${names.map(([name, callee]) => `${CALLEE_EXPORTS}${String(callee.id)} as ${name}`).join(',')}}from"/$bunfs/root/a-module.js";`
}

/** What one module of parts imports and exports: its fields' calls, and the callees whose text it holds. */
function partModule(keys: readonly string[], graph: ReturnType<typeof calleesOfTheRecording>, partOf: Readonly<Record<string, string>>, taken: ReadonlySet<string>): { readonly head: string; readonly tail: string } {
  const home = (callee: Callee): boolean => callee.home !== undefined && keys.includes(callee.home)
  const calls = new Map<string, Callee>()
  const add = (name: string, callee: Callee): void => {
    if (calls.get(name) !== undefined && calls.get(name) !== callee) throw new Error(`One module of the fake bundle would bind ${name} two ways`)
    calls.set(name, callee)
  }
  for (const [field, own] of graph.fieldCalls) if (keys.includes(partOf[field] ?? '')) own.forEach((callee, name) => add(name, callee))
  for (const callee of graph.callees.filter(home)) callee.calls.forEach((target, name) => add(name, target))
  const local = new Map([...calls].filter(([name, callee]) => !(home(callee) && callee.name === name)))
  const exported = graph.callees.filter(home).map((callee) => `${callee.name} as ${CALLEE_EXPORTS}${String(callee.id)}`)
  return { head: importsFor(local, undefined, taken), tail: exported.length === 0 ? '' : `;export{${exported.join(',')}};` }
}


/**
 * A bundle holding `parts` and the callees `recording` says each code field reaches. `recordedParts` are the parts
 * as they hold the committed recording, which say where each field sits however a test changes `parts`. The managed-
 * folder guard's import, which the guards part opens with, lands in the first module beside the loader that reads it.
 */
export function bundleHolding(parts: Readonly<Record<string, string>>, recording: Readonly<Record<string, unknown>>, recordedParts: Readonly<Record<string, string>>): string {
  const graph = calleesOfTheRecording(recording, recordedParts)
  const partOf = partsOfTheFields(recording, recordedParts)
  const apart = OWN_MODULE_PARTS.flat()
  const firstKeys = Object.keys(parts).filter((key) => key !== 'guards' && !apart.includes(key))
  const guardNames = new Set(Object.keys((recording['managed_folder_guard_calls'] as GuardCalls).guard_calls))
  const first = partModule(firstKeys, graph, partOf, guardNames)
  const firstModule = `${first.head}${firstKeys.map((key) => parts[key]).join(';other code;')}${first.tail};other code;${parts['guards'] ?? ''}`
  const ownModules = OWN_MODULE_PARTS.map((keys) => {
    const { head, tail } = partModule(keys, graph, partOf, new Set())
    return `\n${CHUNK}\n${head}${keys.map((key) => parts[key]).join(';other code;')}${tail}`
  })
  const calleeModules = graph.callees
    .filter((callee) => callee.home === undefined)
    .map((callee) => `\n${CHUNK}\n${importsFor(callee.calls, undefined, new Set([callee.name]))}${callee.text};export{${callee.name} as ${CALLEE_EXPORTS}${String(callee.id)}};`)
  return [firstModule, ...ownModules, ...calleeModules].join('')
}
