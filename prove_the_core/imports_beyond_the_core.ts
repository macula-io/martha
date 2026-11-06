// The core reaches a coding tool only through the host contract.
//
// So a file may import three kinds of thing: other code of this repository, by a
// relative path; Node's standard library, by a `node:` specifier; and a package
// package.json allows (martha.packageImports), from inside the one folder it names.
// Anything else is a package, and a package in the core is how a coding tool's API
// would creep in past the contract. Rather than keep a list of tool packages to
// refuse, which goes stale the day a tool renames its SDK, this check allows those
// kinds and names everything else, with its file and line.
//
// The imports come from the syntax tree (parse_a_source.ts), so an import written
// inside a string or a comment is text, and a real import split over lines is
// still an import. A type-only import counts: code that leans on a tool's types is
// coupled to it. A module whose name is computed cannot be checked, so it is named
// too, with specifier null: the core has no reason to load a module by a name it
// builds at runtime.

import { sep } from 'node:path'

import type { CoreSource } from '../src/host_contract/imports_beyond_the_core.ts'
import { moduleReferencesOf } from './parse_a_source.ts'

export interface ImportBeyondTheCore {
  /** Path relative to the repository. */
  readonly path: string
  readonly line: number
  /** The module as written; null when its name is computed. */
  readonly specifier: string | null
}

const NODE_MODULE = 'node:'

const isOwnOrNode = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith(NODE_MODULE)

const folderOf = (path: string): string => path.split(sep)[0] ?? ''

/**
 * Every import in these sources (paths relative to the repository) that is not
 * the repository's own code, not Node's, and not a package `packages` allows in
 * the source's folder.
 */
export function importsBeyondTheCore(
  sources: readonly CoreSource[],
  packages: Readonly<Record<string, string>>,
): ImportBeyondTheCore[] {
  return sources.flatMap((source) =>
    moduleReferencesOf(source.text, source.path)
      .filter(({ specifier }) => specifier === null || !isOwnOrNode(specifier))
      .filter(({ specifier }) => specifier === null || packages[specifier] !== folderOf(source.path))
      .map(({ specifier, line }) => ({ path: source.path, line, specifier })),
  )
}
