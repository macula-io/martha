// Which units outside src a repository holds, and how many lines of code each one holds (martha#736).
//
// The top-level folders come from theCodeRootsOf, the one derived list the import-cycle check walks too (martha#748),
// so no second readdir of the repository root can drift from it. src is left to the core slices. The repository root
// is one more folder: the files that sit directly in it, such as the linter's own config, belong to no code root and
// would otherwise be counted by nothing.
//
// Inside a folder, each folder directly under it is a unit counted at any depth, as a core slice is, and the files
// directly in it are one more. A folder the coreSources walk skips (node_modules, a dot-directory) is no unit, by the
// same rule the code roots keep.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { CORE } from '../../prove_the_core/declared_in_package_json.ts'
import { isASkippedDirectory } from '../../prove_the_core/core_sources.ts'
import { theCodeRootsOf } from '../../prove_the_core/the_code_roots_of_a_repository.ts'
import type { Lints } from '../../prove_the_core/the_linter_lints_it.ts'
import { codeLinesDirectlyIn, codeLinesOfDirectory } from './a_host_directorys_code_lines.ts'

/** The repository root, named as a folder the check judges. */
export const THE_REPOSITORY_ROOT = '.'

/** The name a red run prints for the files that sit directly in `folder`. */
export const itsOwnFiles = (folder: string): string => `${folder} (its own files)`

/** The folders the check judges outside src, before any exclusion: the repository root, then every other code root. */
export const theTopLevelFolders = (repository: string): string[] => [
  THE_REPOSITORY_ROOT,
  ...theCodeRootsOf(repository).filter((root) => root !== CORE),
]

/** The folders directly under `folder` that are units: every one the walk does not skip. */
const theUnitsUnder = (repository: string, folder: string): string[] =>
  readdirSync(join(repository, folder), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isASkippedDirectory(entry.name))
    .map((entry) => `${folder}/${entry.name}`)
    .sort()

/** Each unit of `folders` with its code lines: a folder's own files, then each folder under it. The repository root's
 * folders are the code roots themselves, so only its own files are its unit. */
export async function theTopLevelUnits(repository: string, folders: readonly string[], lints: Lints): Promise<Record<string, number>> {
  const units: Record<string, number> = {}
  for (const folder of folders) {
    units[itsOwnFiles(folder)] = await codeLinesDirectlyIn(repository, folder, lints)
    if (folder === THE_REPOSITORY_ROOT) continue
    for (const unit of theUnitsUnder(repository, folder)) units[unit] = await codeLinesOfDirectory(repository, unit, lints)
  }
  return units
}
