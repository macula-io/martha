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
// Each name a guard calls is followed through the bundle to its definition, and every name that definition calls in
// turn, until a global ends the chase (follow_the_free_callees.ts, martha#811 R6): a function, a variable's
// initializer, or an import. A name the bundle binds nowhere, or two ways in one scope, cannot be told and is refused.

import { closingBrace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'
import { bundleOf, calleesOf, calleesOfNames } from '../follow_what_host_code_calls/follow_the_free_callees.ts'
import { loaderIn } from '../load_the_hosts_markdown/markdown_the_host_loads.ts'
import { CHUNK } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { CLAUDE_MEMORY_OFF } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** A call of a bare name: not a method, not a private member. */
const BARE_CALL = /(?<![\w$.#])([A-Za-z_$][\w$]*)\(/g
const escaped = (name: string): string => name.replaceAll('$', '\\$')

/** The function declared at `at`, whole: past its parameters, which may hold braces of their own, to its body's end. */
function declarationAt(text: string, at: number): string {
  const body = text.indexOf('{', closingBrace(text, text.indexOf('(', at)))
  return text.slice(at, closingBrace(text, body))
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


/** What the markdown loader's managed-folder guard calls, followed through the bundle (martha#412). */
export function managedFolderGuardCallsIn(text: string, managed: string): GuardCalls {
  const loader = loaderIn(text, managed).source
  const expressions = guardExpressionsIn(loader, managed)
  const names = [...new Set(expressions.flatMap(callsIn))]
  return calleesOfNames(bundleOf(text), text.indexOf(loader) + loader.indexOf(expressions[0] ?? ''), names, 'full')
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
export function fileModeGuardIn(text: string): { readonly at: number; readonly source: string } {
  const reads = OFF_SWITCH_READ.flatMap((read) => [...text.matchAll(new RegExp(`${escaped(read).replaceAll('.', '\\.')}(?![\\w$])`, 'g'))].map((match) => match.index))
  if (reads.length !== 1) throw new Error(`The host reads the memory off switch ${String(reads.length)} times, not once, so its ${FILE_MODE_GUARD} cannot be told.`)
  const [read = 0] = reads
  const at = declarationHolding(text, read)
  if (at === undefined) throw new Error(`The host reads the memory off switch outside a function declaration, so its ${FILE_MODE_GUARD} cannot be told.`)
  return { at, source: declarationAt(text, at) }
}

/** What the host's file-mode memory guard calls, followed through the bundle (martha#438). */
export function fileModeGuardCallsIn(text: string): GuardCalls {
  const { at, source } = fileModeGuardIn(text)
  return calleesOf(bundleOf(text), [{ at, length: source.length }], 'full')
}
