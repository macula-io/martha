// The loops of value imports in the core, found in the syntax tree rather than in the text (martha#525).
//
// A loop of imports is how one module reads another's export before it has been set: the table or constant is
// `undefined` at the moment it is read, and nothing reports the loop. What CI shows instead is a scatter of failing
// tests in modules that never changed. This walk finds the loop and names it, file by file.
//
// Only a value import counts. `import type`, an `import('x')` type, a JSDoc `@import` and a `/// <reference types>`
// are erased at run time and cannot close a loop. An `export … from`, a dynamic `import()` and a `require()` do run,
// so each is an edge like an `import` is.
//
// A reference is followed only when it names a file of the core: a `node:` specifier, a package, or a `.json` beside
// the sources leaves the walk, because a loop needs two modules that load each other.
//
// A file is in a loop exactly when it can reach itself, which is what decides this walk. Files that can each reach the
// other are one group, and one loop is written for the group: a walk that stopped at the first loop it met could miss
// a second loop among the same files, and then an excused loop would hide the other.

import { posix } from 'node:path'

import type { CoreSource } from '../host_contract/core_source.ts'
import { moduleReferencesIn, parseSource, type ModuleReference } from '../../prove_the_core/read_a_source/parse_a_source.ts'

/** One loop of imports: the files of one group, and a loop that runs through all of it. */
export interface Loop {
  /** The files that load each other, sorted: what an exception names. */
  readonly files: readonly string[]
  /** A loop through them, each path naming the next, and the last naming the first again. */
  readonly through: readonly string[]
}

const isRelative = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../')

/** The path a reference from `at` names, as the core spells it, or null when it leaves the core. */
function thePathNamed(from: string, specifier: string): string | null {
  if (!isRelative(specifier)) return null
  const named = posix.normalize(posix.join(posix.dirname(from), specifier))
  return named.startsWith('../') || named.startsWith('/') ? null : named
}

/** The value references of one source: what it loads at run time, never what it only names in a type. */
export function valueReferencesOf(source: CoreSource): readonly ModuleReference[] {
  return moduleReferencesIn(parseSource(source.text, source.path).file).filter((reference) => !reference.type_only)
}

/** Every value import between the core's sources: a path mapped to the paths it loads. A path that is no source of
 * the core is written among them and followed no further, because it has no sources of its own to follow. */
export function importsBetween(sources: readonly CoreSource[]): ReadonlyMap<string, readonly string[]> {
  const loaded = new Map<string, readonly string[]>()
  for (const source of sources) {
    const named = valueReferencesOf(source)
      .flatMap((reference) => (reference.specifier === null ? [] : [reference.specifier]))
      .flatMap((specifier) => {
        const path = thePathNamed(source.path, specifier)
        return path === null ? [] : [path]
      })
    loaded.set(source.path, [...new Set(named)].sort())
  }
  return loaded
}

/**
 * Every path `from` can reach by value imports, `from` itself among them exactly when a loop runs through it: the walk
 * starts at what `from` loads, so only an edge back to it can name it.
 */
export function reachableFrom(loaded: ReadonlyMap<string, readonly string[]>, from: string): ReadonlySet<string> {
  const reached = new Set<string>()
  const waiting: string[] = []
  const take = (path: string): void => {
    if (reached.has(path)) return
    reached.add(path)
    waiting.push(...(loaded.get(path) ?? []))
  }
  for (const path of loaded.get(from) ?? []) take(path)
  while (waiting.length > 0) take(waiting.pop() ?? '')
  return reached
}

/** Whether `one` and `other` can each reach the other: one group of files, whichever way the loop runs. */
const loadEachOther = (reach: ReadonlyMap<string, ReadonlySet<string>>, one: string, other: string): boolean =>
  reach.get(one)?.has(other) === true && reach.get(other)?.has(one) === true

/** The files that load each other, each group sorted, the groups in order; only files that can reach themselves. */
export function groupsInLoops(loaded: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[] {
  const reach = new Map([...loaded.keys()].map((path) => [path, reachableFrom(loaded, path)]))
  const inALoop = (path: string): boolean => reach.get(path)?.has(path) === true
  const groupOf = (path: string): string[] =>
    [...loaded.keys()].filter((other) => inALoop(other) && loadEachOther(reach, path, other)).sort()
  const grouped = new Set<string>()
  const groups: string[][] = []
  for (const path of [...loaded.keys()].sort()) {
    if (!inALoop(path) || grouped.has(path)) continue
    const group = groupOf(path)
    for (const one of group) grouped.add(one)
    groups.push(group)
  }
  return groups
}

/** A loop from `start` back to itself by the shortest way inside `group`, or [start] when it loads itself. */
export function aLoopFrom(loaded: ReadonlyMap<string, readonly string[]>, group: readonly string[], start: string): readonly string[] {
  const inside = new Set(group)
  const cameFrom = new Map<string, string>()
  const waiting = [start]
  const seen = new Set([start])
  while (waiting.length > 0) {
    const at = waiting.shift() ?? ''
    const next = (loaded.get(at) ?? []).filter((path) => inside.has(path))
    const closed = next.find((path) => path === start)
    if (closed !== undefined) return at === start ? [start] : [start, ...backTo(start, at, cameFrom), start]
    for (const path of next.filter((one) => !seen.has(one))) {
      seen.add(path)
      cameFrom.set(path, at)
      waiting.push(path)
    }
  }
  return [start]
}

/** The paths walked from `start` down to `at`, by what each was reached from. */
function backTo(start: string, at: string, cameFrom: ReadonlyMap<string, string>): readonly string[] {
  const walked = [at]
  for (let here = at; here !== start;) {
    here = cameFrom.get(here) ?? start
    if (here !== start) walked.unshift(here)
  }
  return walked
}

/** Every loop of value imports among `sources`, one for each group of files that load each other. */
export function cyclesIn(sources: readonly CoreSource[]): readonly Loop[] {
  const loaded = importsBetween(sources)
  return groupsInLoops(loaded).map((files) => ({ files, through: aLoopFrom(loaded, files, files[0] ?? '') }))
}
