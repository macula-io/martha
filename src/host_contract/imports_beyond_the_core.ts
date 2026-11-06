// The core reaches a coding tool only through the host contract.
//
// So a file in the core may import two kinds of thing: another slice, by a
// relative path, and Node's standard library, by a `node:` specifier. Anything
// else is a package, and a package in the core is how a coding tool's API would
// creep in past the contract. Rather than keep a list of tool packages to refuse,
// which goes stale the day a tool renames its SDK, this check allows the two
// kinds and names everything else, with the file it is in.
//
// A dynamic import whose specifier is computed cannot be checked, so it is named
// too: the core has no reason to load a module by a name it builds at runtime.
//
// Every check that reads the core's code reads it through coreSources and
// specifiersOf here, so no check walks fewer files or parses imports another way.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface CoreSource {
  readonly path: string
  readonly text: string
}

export interface ImportBeyondTheCore {
  readonly path: string
  readonly specifier: string
}

/** Every kind of file that can hold script, and so can import. */
export const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const

export const isScannedSource = (path: string): boolean =>
  SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension))

// Every way a module names another: an import or export with a from clause, a
// bare import of a module for its effects, a dynamic import call with a quoted
// or template specifier, and a require call. (Written in words: the check reads
// comments too.)
const QUOTED = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
]

/** The prefix of every specifier the scan reports for a computed import. */
export const COMPUTED_SPECIFIER = '(computed: '

// A dynamic import or require whose argument starts with no quote at all.
const COMPUTED = /\b(?:import|require)\s*\(\s*([^'"`\s)][^)]*)\)/g

const isWithinTheCore = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('node:')

/** Every module a source names: quoted ones as written, computed ones as (computed: …). */
export const specifiersOf = (text: string): string[] => [
  ...QUOTED.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? '')),
  ...[...text.matchAll(COMPUTED)].map((match) => `${COMPUTED_SPECIFIER}${(match[1] ?? '').trim()})`),
]

/** Every script file under `root`, with its path relative to `root`. */
export function coreSources(root: string): CoreSource[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isScannedSource(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }))
}

/** Every import in these sources that is neither another slice nor Node's own. */
export function importsBeyondTheCore(sources: readonly CoreSource[]): ImportBeyondTheCore[] {
  return sources.flatMap((source) =>
    specifiersOf(source.text)
      .filter((specifier) => !isWithinTheCore(specifier))
      .map((specifier) => ({ path: source.path, specifier })),
  )
}
