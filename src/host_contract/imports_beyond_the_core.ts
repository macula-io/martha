// The core reaches a coding tool only through the host contract.
//
// So a file in the core may import two kinds of thing: another slice, by a
// relative path, and Node's standard library, by a `node:` specifier. Anything
// else is a package, and a package in the core is how a coding tool's API would
// creep in past the contract. Rather than keep a list of tool packages to refuse,
// which goes stale the day a tool renames its SDK, this check allows the two
// kinds and names everything else, with the file it is in.

export interface CoreSource {
  readonly path: string
  readonly text: string
}

export interface ImportBeyondTheCore {
  readonly path: string
  readonly specifier: string
}

// Every way a TypeScript module names another: an import or export with a from
// clause, a bare import of a module for its effects, a dynamic import call and a
// require call. (Written in words: the check reads comments too.)
const SPECIFIERS = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const isWithinTheCore = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('node:')

const specifiersOf = (text: string): string[] =>
  SPECIFIERS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? ''))

/** Every import in these sources that is neither another slice nor Node's own. */
export function importsBeyondTheCore(sources: readonly CoreSource[]): ImportBeyondTheCore[] {
  return sources.flatMap((source) =>
    specifiersOf(source.text)
      .filter((specifier) => !isWithinTheCore(specifier))
      .map((specifier) => ({ path: source.path, specifier })),
  )
}
