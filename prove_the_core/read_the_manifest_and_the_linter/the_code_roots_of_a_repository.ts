// The repository's code roots, and every source under them (martha#748).
//
// Two checks read the whole repository and have to read the same trees: the import-cycle check,
// which judges every tree for a loop of value imports, and the ceiling check, which walks a
// top-level directory's folders. The set is read from the tree at judge time and stored nowhere,
// so a tree is judged the day it appears and no list can drift from the repository it describes.
//
// A top-level directory is a code root when a script sits under it at any depth — never because a
// list names it, and never because the linter happens to count a file there: a directory the
// linter ignores measures no code and passes any ceiling either way. `node_modules` and
// dot-directories are not the repository's own code, so neither is a root, and the walk inside a
// root skips them at every depth by the same rule coreSources keeps.
//
// This folder is outside src/, the core, on purpose: it reads the disk, which a slice may not.

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { isScannedSource, type CoreSource } from '../../src/host_contract/core_source.ts'
import { coreSources, insideASkippedDirectory, isASkippedDirectory } from './core_sources.ts'

/** Whether a script sits under `directory` at any depth, skipping the directories coreSources skips. */
const holdsAScript = (directory: string): boolean =>
  readdirSync(directory, { recursive: true, withFileTypes: true }).some(
    (entry) =>
      entry.isFile() &&
      isScannedSource(entry.name) &&
      !insideASkippedDirectory(relative(directory, join(entry.parentPath, entry.name))),
  )

/** The repository's code roots: the top-level directories that hold a script, sorted. */
export function theCodeRootsOf(repository: string): string[] {
  return readdirSync(repository, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isASkippedDirectory(entry.name))
    .map((entry) => entry.name)
    .filter((name) => holdsAScript(join(repository, name)))
    .sort()
}

/**
 * Every source of the repository's own code, spelled relative to the repository: the files of
 * every code root, and the files that sit directly in the repository root, which belong to no
 * tree and would otherwise be judged by nothing.
 */
export function theCodeSourcesOf(repository: string): CoreSource[] {
  const underTheRoots = theCodeRootsOf(repository).flatMap((tree) =>
    coreSources(join(repository, tree)).map((source) => ({ path: `${tree}/${source.path}`, text: source.text })),
  )
  const inTheRepositoryRoot = readdirSync(repository, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isScannedSource(entry.name))
    .map((entry) => ({ path: entry.name, text: readFileSync(join(repository, entry.name), 'utf8') }))
  return [...inTheRepositoryRoot, ...underTheRoots]
}
