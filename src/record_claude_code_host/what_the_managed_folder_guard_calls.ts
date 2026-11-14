// What the markdown loader's managed-folder guard calls, followed through the
// host's bundle, as the recorder cuts it (martha#412).
//
// The loader skips the managed folder when a guard holds (`ije()||Ce` on
// 2.1.325, where `Ce=s||Woe()`). The recording keeps the loader whole, but the
// guard's meaning lives in the functions it calls: on 2.1.325 `ije` is
// `K()||XV()` and `XV` is `function XV(){return!1}`. A later host whose `XV`
// starts returning true leaves the loader byte-equal, so host drift could not
// see it. This cuts every function the guard reaches, and which definition each
// name it calls binds to, so --check names the field when either changes.
//
// The bundle is a run of modules, each opened by the host's chunk mark. A
// minified name is looked up where the bundle binds it: a function declared in
// the caller's module, or a name that module imports from another of the
// bundle's modules, followed to the one module that exports it. A name bound any
// other way (a parameter, a variable, a platform module's import, a builtin) is
// not followed; the caller's text, which is recorded whole, holds the call. A
// name declared twice in one module, or exported by no module or by two, cannot
// be told and is refused.

import { closingBrace } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { loaderIn } from '../claude_code_host/markdown_the_host_loads.ts'
import { MANAGED_MARKDOWN_FOLDER } from '../claude_code_host/hooks_and_plugins_the_owner_declares.ts'
import { CHUNK } from '../claude_code_host/protected_config_places.ts'

/** One function the guard reaches, whole, and the entry each name it calls binds to. */
export interface GuardFunction {
  readonly function: string
  readonly calls: Readonly<Record<string, number>>
}

/** The guard's own calls, by the entry each binds to, and every function they reach, in the order first reached. */
export interface ManagedFolderGuardCalls {
  readonly guard_calls: Readonly<Record<string, number>>
  readonly functions: readonly GuardFunction[]
}

/** Where the bundle imports from one of its own modules, as Bun writes it. */
const BUNDLE_IMPORT = /import\{([^}]*)\}from"\/\$bunfs\/[^"]+"/g
const EXPORT = /export\{([^}]*)\}/g
/** A call of a bare name: not a method, not a private member. */
const BARE_CALL = /(?<![\w$.#])([A-Za-z_$][\w$]*)\(/g
const escaped = (name: string): string => name.replaceAll('$', '\\$')

interface Module {
  readonly start: number
  readonly text: string
}

/** Each `local as exported` pair of an import or export list; a bare name is both. */
const pairsOf = (list: string): Array<readonly [string, string]> =>
  list.split(',').map((entry) => entry.trim().split(' as ')).filter((pair) => pair[0] !== '').map((pair) => [pair[0] ?? '', pair.at(-1) ?? ''] as const)

/** The bundle's modules, and which module exports each name under which local name. */
function bundleOf(text: string): { readonly modules: readonly Module[]; readonly exporters: ReadonlyMap<string, ReadonlyArray<{ module: Module; local: string }>> } {
  const starts = [0, ...[...text.matchAll(new RegExp(escaped(CHUNK), 'g'))].map((match) => match.index)]
  const modules = starts.map((start, index) => ({ start, text: text.slice(start, starts[index + 1] ?? text.length) }))
  const exporters = new Map<string, Array<{ module: Module; local: string }>>()
  for (const module of modules) {
    const pairs = [...module.text.matchAll(EXPORT)].flatMap((match) => pairsOf(match[1] ?? ''))
    for (const [local, exported] of pairs) exporters.set(exported, [...(exporters.get(exported) ?? []), { module, local }])
  }
  return { modules, exporters }
}

type Bundle = ReturnType<typeof bundleOf>

/** The function declared at `at`, whole: past its parameters, which may hold braces of their own, to its body's end. */
function declarationAt(text: string, at: number): string {
  const body = text.indexOf('{', closingBrace(text, text.indexOf('(', at)))
  return text.slice(at, closingBrace(text, body))
}

/** Where `name` is bound for code in `module`: its declaration, whole, and the module that holds it; undefined when not a bundle function. */
function bindingOf(bundle: Bundle, module: Module, name: string): { readonly module: Module; readonly source: string } | undefined {
  const declared = new Set(
    [...module.text.matchAll(new RegExp(`(?<![\\w$.#])function\\*? ?${escaped(name)}\\(`, 'g'))].map((match) => declarationAt(module.text, match.index)),
  )
  if (declared.size > 1) throw new Error(`A module of the host declares ${name} ${String(declared.size)} ways, so what the managed-folder guard calls cannot be told.`)
  const [source] = declared
  if (source !== undefined) return { module, source }
  const imported = [...module.text.matchAll(BUNDLE_IMPORT)].flatMap((match) => pairsOf(match[1] ?? '')).find(([, local]) => local === name)?.[0]
  if (imported === undefined) return undefined
  const from = bundle.exporters.get(imported) ?? []
  if (from.length !== 1) throw new Error(`${String(from.length)} modules of the host export ${imported}, not one, so what the managed-folder guard calls cannot be told.`)
  const [only] = from
  return only === undefined ? undefined : bindingOf(bundle, only.module, only.local)
}

/** The one expression the loader assigns `name`; none for a name it does not assign, a refusal for two that differ. */
function assignmentIn(loader: string, name: string): string[] {
  const found = new Set([...loader.matchAll(new RegExp(`[,{;(]${escaped(name)}=(?![=>])([^,;]+)`, 'g'))].map((match) => match[1] ?? ''))
  if (found.size > 1) throw new Error(`The markdown loader assigns ${name} ${String(found.size)} ways, so what its managed-folder guard reads cannot be told.`)
  return [...found]
}

/** The guard's expression in the loader, and each name it reads that the loader assigns, their expressions too. */
function guardExpressionsIn(loader: string, managed: string): string[] {
  const folder = new RegExp(`([\\w$]+)=[\\w$]+\\(${escaped(managed)}\\(\\),${escaped(JSON.stringify(MANAGED_MARKDOWN_FOLDER))},`).exec(loader)?.[1]
  const guards = folder === undefined ? [] : [...loader.matchAll(new RegExp(`\\[\\(([^?]+)\\?Promise\\.resolve\\(\\[\\]\\):[\\w$]+\\(${escaped(folder)},`, 'g'))]
  if (guards.length !== 1) throw new Error(`The markdown loader holds ${String(guards.length)} guards on the managed folder, not one.`)
  const expressions = [guards[0]?.[1] ?? '']
  for (const expression of expressions) {
    const read = [...expression.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$(])/g)].map((match) => match[1] ?? '')
    const assigned = read.flatMap((name) => assignmentIn(loader, name))
    expressions.push(...assigned.filter((assignment) => !expressions.includes(assignment)))
  }
  return expressions
}

const callsIn = (source: string): string[] => [...new Set([...source.matchAll(BARE_CALL)].map((match) => match[1] ?? ''))]

/** What the markdown loader's managed-folder guard calls, followed through the bundle (martha#412). */
export function managedFolderGuardCallsIn(text: string, managed: string): ManagedFolderGuardCalls {
  const bundle = bundleOf(text)
  const loader = loaderIn(text, managed).source
  const at = text.indexOf(loader)
  const home = bundle.modules.findLast((module) => module.start <= at) ?? bundle.modules[0]
  const reached: Array<{ key: string; module: Module; source: string; calls: Record<string, number> }> = []
  /** The entry `name` binds to from `module`, reached now if it was not before; undefined when not followed. */
  const entryOf = (module: Module, name: string): number | undefined => {
    const binding = bindingOf(bundle, module, name)
    if (binding === undefined) return undefined
    const key = `${String(binding.module.start)}:${binding.source}`
    const known = reached.findIndex((entry) => entry.key === key)
    if (known >= 0) return known
    return reached.push({ key, module: binding.module, source: binding.source, calls: {} }) - 1
  }
  const bound = (module: Module, names: readonly string[]): Record<string, number> =>
    Object.fromEntries(names.flatMap((name) => {
      const entry = entryOf(module, name)
      return entry === undefined ? [] : [[name, entry]]
    }))
  if (home === undefined) throw new Error('The host text holds no module, so what the managed-folder guard calls cannot be told.')
  const guard_calls = bound(home, guardExpressionsIn(loader, managed).flatMap(callsIn))
  for (const entry of reached) entry.calls = bound(entry.module, callsIn(entry.source.slice(entry.source.indexOf('('))))
  return { guard_calls, functions: reached.map(({ source, calls }) => ({ function: source, calls })) }
}
