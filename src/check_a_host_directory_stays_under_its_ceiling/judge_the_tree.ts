// What a repository's host directories measure, and what that fails on.
//
// One path through the check, used by the command CI runs and by the tests that
// plant trees: the manifest's two lists, each directory's code lines, and the
// findings. A test that judged by another path would prove nothing about the run
// that gates a change.

import { manifestOf, type Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import { ceilingsOf } from '../../prove_the_core/the_host_ceilings.ts'
import { theLinterLints } from '../../prove_the_core/the_linter_lints_it.ts'
import { codeLinesOfDirectory } from './a_host_directorys_code_lines.ts'
import { findingsOf, type Finding } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { declaredDirectoriesOf, type DeclaredDirectory } from './declared_host_directories.ts'

/** A tree, measured, and what it fails on. */
export interface Judged {
  readonly manifest: Manifest
  readonly declared: readonly DeclaredDirectory[]
  readonly code: Readonly<Record<string, number>>
  readonly findings: readonly Finding[]
}

/** Each declared directory's code lines, by directory, as the linter and the compiler read them. */
export async function countsOnDisk(repository: string, directories: readonly string[]): Promise<Record<string, number>> {
  const lints = theLinterLints(repository)
  const code: Record<string, number> = {}
  for (const directory of directories) code[directory] = await codeLinesOfDirectory(repository, directory, lints)
  return code
}

/** The tree under `repository`, measured and judged. */
export async function judgeTheTree(repository: string): Promise<Judged> {
  const manifest = manifestOf(repository)
  const declared = declaredDirectoriesOf(manifest)
  const code = await countsOnDisk(
    repository,
    declared.map((entry) => entry.directory),
  )
  return { manifest, declared, code, findings: findingsOf(declared, ceilingsOf(manifest), code) }
}
