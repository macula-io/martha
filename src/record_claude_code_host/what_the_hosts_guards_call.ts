// What the host's guards call, followed through the host's bundle, as the
// recorder cuts it: the markdown loader's managed-folder guard (martha#412) and
// the file-mode memory guard (martha#438).
//
// The loader skips the managed folder when a guard holds (`ije()||Ce` on
// 2.1.325, where `Ce=s||Woe()`). The recording keeps the loader whole, but the
// guard's meaning lives in the functions it calls: on 2.1.325 `ije` is
// `K()||XV()` and `XV` is `function XV(){return!1}`. A later host whose `XV`
// starts returning true leaves the loader byte-equal, so host drift could not
// see it. This cuts every function the guard reaches, and which definition each
// name it calls binds to, so --check names the field when either changes.
//
// The file-mode guard is the same case pointing the other way (martha#438).
// memory_off restates it whole (`Db` on 2.1.325), but it decides by what it
// calls: `ws(e)` holding for more values gives "forced_on", and `Nb()` turning
// false gives "unset" instead of "off". Both move toward memory on and leave
// `Db` byte-equal. The guard is found by the one function that reads the off
// switch the launch sets, so it is cut from the host, not from what was
// restated, and its callees are walked the same way.
//
// The bundle is a run of modules, each opened by the host's chunk mark. A
// minified name is looked up where the bundle binds it: a function declared in
// the caller's module, or a name that module imports from another of the
// bundle's modules, followed to the one module that exports it. A name bound any
// other way (a parameter, a variable, a platform module's import, a builtin) is
// not followed; the caller's text, which is recorded whole, holds the call. A
// name declared twice in one module, or exported by no module or by two, cannot
// be told and is refused.

import { closingBrace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { loaderIn } from '../load_the_hosts_markdown/markdown_the_host_loads.ts'
import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { CLAUDE_MEMORY_OFF } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** One function the guard reaches, whole, and the entry each name it calls binds to. */
export interface GuardFunction {
  readonly function: string
  readonly calls: Readonly<Record<string, number>>
}

/** A guard's own calls, by the entry each binds to, and every function they reach, in the order first reached. */
export interface GuardCalls {
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
function bindingOf(bundle: Bundle, module: Module, name: string, guard: string): { readonly module: Module; readonly source: string } | undefined {
  const declared = new Set(
    [...module.text.matchAll(new RegExp(`(?<![\\w$.#])function\\*? ?${escaped(name)}\\(`, 'g'))].map((match) => declarationAt(module.text, match.index)),
  )
  if (declared.size > 1) throw new Error(`A module of the host declares ${name} ${String(declared.size)} ways, so what the ${guard} calls cannot be told.`)
  const [source] = declared
  if (source !== undefined) return { module, source }
  const imported = [...module.text.matchAll(BUNDLE_IMPORT)].flatMap((match) => pairsOf(match[1] ?? '')).find(([, local]) => local === name)?.[0]
  if (imported === undefined) return undefined
  const from = bundle.exporters.get(imported) ?? []
  if (from.length !== 1) throw new Error(`${String(from.length)} modules of the host export ${imported}, not one, so what the ${guard} calls cannot be told.`)
  const [only] = from
  return only === undefined ? undefined : bindingOf(bundle, only.module, only.local, guard)
}

/** The one expression the loader assigns `name`; none for a name it does not assign, a refusal for two that differ. */
function assignmentIn(loader: string, name: string): string[] {
  const found = new Set([...loader.matchAll(new RegExp(`[,{;(]${escaped(name)}=(?![=>])([^,;]+)`, 'g'))].map((match) => match[1] ?? ''))
  if (found.size > 1) throw new Error(`The markdown loader assigns ${name} ${String(found.size)} ways, so what its managed-folder guard reads cannot be told.`)
  return [...found]
}

/** The guard's expression in the loader, and each name it reads that the loader assigns, their expressions too. */
function guardExpressionsIn(loader: string, managed: string): string[] {
  const folder = new RegExp(`([\\w$]+)=[\\w$]+\\(${escaped(managed)}\\(\\),${escaped(JSON.stringify(CLAUDE_FOLDER))},`).exec(loader)?.[1]
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

/** The module of `bundle` that holds the text at `at`. */
function moduleAt(bundle: Bundle, at: number, guard: string): Module {
  const home = bundle.modules.findLast((module) => module.start <= at) ?? bundle.modules[0]
  if (home === undefined) throw new Error(`The host text holds no module, so what the ${guard} calls cannot be told.`)
  return home
}

/** Every function the calls `names` make from `home` reach, followed through the bundle, and the entry each name binds to. */
function callsReachedFrom(bundle: Bundle, home: Module, names: readonly string[], guard: string): GuardCalls {
  const reached: Array<{ key: string; module: Module; source: string; calls: Record<string, number> }> = []
  /** The entry `name` binds to from `module`, reached now if it was not before; undefined when not followed. */
  const entryOf = (module: Module, name: string): number | undefined => {
    const binding = bindingOf(bundle, module, name, guard)
    if (binding === undefined) return undefined
    const key = `${String(binding.module.start)}:${binding.source}`
    const known = reached.findIndex((entry) => entry.key === key)
    if (known >= 0) return known
    return reached.push({ key, module: binding.module, source: binding.source, calls: {} }) - 1
  }
  const bound = (module: Module, called: readonly string[]): Record<string, number> =>
    Object.fromEntries(called.flatMap((name) => {
      const entry = entryOf(module, name)
      return entry === undefined ? [] : [[name, entry]]
    }))
  const guard_calls = bound(home, names)
  for (const entry of reached) entry.calls = bound(entry.module, callsIn(entry.source.slice(entry.source.indexOf('('))))
  return { guard_calls, functions: reached.map(({ source, calls }) => ({ function: source, calls })) }
}

const MANAGED_FOLDER_GUARD = 'managed-folder guard'

/** What the markdown loader's managed-folder guard calls, followed through the bundle (martha#412). */
export function managedFolderGuardCallsIn(text: string, managed: string): GuardCalls {
  const bundle = bundleOf(text)
  const loader = loaderIn(text, managed).source
  const home = moduleAt(bundle, text.indexOf(loader), MANAGED_FOLDER_GUARD)
  return callsReachedFrom(bundle, home, guardExpressionsIn(loader, managed).flatMap(callsIn), MANAGED_FOLDER_GUARD)
}

const FILE_MODE_GUARD = 'file-mode memory guard'
/** The off switch the launch sets, as the host reads it. */
const OFF_SWITCH_READ = Object.keys(CLAUDE_MEMORY_OFF).map((name) => `process.env.${name}`)

/** A function declaration's start, at `at` alone. */
const DECLARATION = /(?<![\w$.#])function\*? ?[A-Za-z_$][\w$]*\(/y

/** Where the module that holds `read` starts: the bundle's chunk marker at or before it, the boundary bundleOf splits on. */
const moduleStartAt = (text: string, read: number): number => Math.max(0, text.lastIndexOf(CHUNK, read))

/**
 * Where the function declaration that holds `read` starts: the guard itself, not a helper declared before the read
 * (martha#564). Every declaration whose span ends before the read is walked past, and one that begins where a
 * declaration ends does not hold it either. Of the declarations that do hold it, the outermost is the guard: a read
 * inside a function nested in the guard belongs to the guard, whose callees decide. The walk ends at the start of the
 * read's module, so a declaration in another module is never the guard even when its braces run past the boundary.
 * Undefined when no declaration of that module holds the read, which is a read at module level.
 */
function declarationHolding(text: string, read: number): number | undefined {
  let holding: number | undefined
  for (let at = text.lastIndexOf('function', read); at >= moduleStartAt(text, read); at = at === 0 ? -1 : text.lastIndexOf('function', at - 1)) {
    DECLARATION.lastIndex = at
    if (!DECLARATION.test(text)) continue
    if (at + declarationAt(text, at).length > read) holding = at
  }
  return holding
}

/**
 * The host's file-mode memory guard, whole, and where it starts: the one function declaration that reads the off switch
 * the launch sets (martha#438). A host that reads it in no function, or in more than one place, cannot be told.
 */
function fileModeGuardIn(text: string): { readonly at: number; readonly source: string } {
  const reads = OFF_SWITCH_READ.flatMap((read) => [...text.matchAll(new RegExp(`${escaped(read).replaceAll('.', '\\.')}(?![\\w$])`, 'g'))].map((match) => match.index))
  if (reads.length !== 1) throw new Error(`The host reads the memory off switch ${String(reads.length)} times, not once, so its ${FILE_MODE_GUARD} cannot be told.`)
  const [read = 0] = reads
  const at = declarationHolding(text, read)
  if (at === undefined) throw new Error(`The host reads the memory off switch outside a function declaration, so its ${FILE_MODE_GUARD} cannot be told.`)
  return { at, source: declarationAt(text, at) }
}

/** What the host's file-mode memory guard calls, followed through the bundle (martha#438). */
export function fileModeGuardCallsIn(text: string): GuardCalls {
  const bundle = bundleOf(text)
  const { at, source } = fileModeGuardIn(text)
  return callsReachedFrom(bundle, moduleAt(bundle, at, FILE_MODE_GUARD), callsIn(source.slice(source.indexOf('('))), FILE_MODE_GUARD)
}
