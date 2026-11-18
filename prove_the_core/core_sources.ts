// The core's sources, as every check on its code reads them.
//
// The check that the core imports nothing beyond its own slices, Node and the
// packages package.json allows reads imports from the syntax tree, in
// prove_the_core/imports_beyond_the_core.ts; it lives outside the core because it
// imports the TypeScript compiler, which the core may not.
//
// Every check that reads the core's code walks it with coreSources, which lives
// outside the core in prove_the_core/core_sources.ts (it reads the disk, which a
// slice may not), so no check walks fewer files than another.
//
// A walk reads the repository's own code and nothing installed beside it (martha#748): a
// file inside a `node_modules` directory, or inside a directory whose name starts with a
// dot, is no source of this repository, whatever tree is being walked. Only the segments
// below the root are read that way — the root may itself sit under a dot-directory, or be
// reached through a symlink, and that is the caller's business, never a reason to skip.

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { isScannedSource, type CoreSource } from '../src/host_contract/core_source.ts'

/** A directory whose contents are not this repository's own code: an installed package, or a dot-directory. */
export const isASkippedDirectory = (name: string): boolean => name === 'node_modules' || name.startsWith('.')

/**
 * Whether `path`, spelled relative to the walk's root, lies inside a skipped directory. The
 * last segment is the file itself, so only the directories above it are read: a file named
 * `.x.ts` is a source like any other.
 */
export const insideASkippedDirectory = (path: string): boolean =>
  path.split(sep).slice(0, -1).some(isASkippedDirectory)

/** Every script file under `root`, with its path relative to `root`. */
export function coreSources(root: string): CoreSource[] {
  const sources: CoreSource[] = []
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !isScannedSource(entry.name)) continue
    const path = relative(root, join(entry.parentPath, entry.name))
    if (insideASkippedDirectory(path)) continue
    sources.push({ path, text: readFileSync(join(entry.parentPath, entry.name), 'utf8') })
  }
  return sources
}
