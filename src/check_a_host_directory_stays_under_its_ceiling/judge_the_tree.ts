// What a repository's host directories measure, and what that fails on.
//
// One path through the check, used by the command CI runs and by the tests that
// plant trees: the manifest's two lists, each directory's code lines, and the
// findings; and every core slice under src, its code lines, and what those fail
// on against the cap (martha#415). A test that judged by another path would prove
// nothing about the run that gates a change.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { CORE, keysDeclaredTwice, manifestTextOf, type Manifest } from '../../prove_the_core/read_the_manifest_and_the_linter/declared_in_package_json.ts'
import { ceilingsOf, sliceCapOf, sliceCeilingsOf } from '../../prove_the_core/read_the_manifest_and_the_linter/the_host_ceilings.ts'
import { theLinterLints } from '../../prove_the_core/read_the_manifest_and_the_linter/the_linter_lints_it.ts'
import { codeLinesOfDirectory } from './a_host_directorys_code_lines.ts'
import { findingsOf, type Finding } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { declaredDirectoriesOf, type DeclaredDirectory } from './declared_host_directories.ts'
import { coreSlicesAmong, sliceFindingsOf, type SliceFinding } from './the_core_slices_under_the_cap.ts'

/** A tree, measured, and what it fails on. */
export interface Judged {
  readonly manifest: Manifest
  readonly declared: readonly DeclaredDirectory[]
  readonly code: Readonly<Record<string, number>>
  readonly findings: readonly Finding[]
  /** Each core slice's code lines, by directory (martha#415). */
  readonly slices: Readonly<Record<string, number>>
  readonly slice_findings: readonly SliceFinding[]
}

/** Every directory directly under the tree's src, named as package.json names a directory: `src/<name>`. A tree with no
 * src holds no core slice, and the cap is still required of it. */
function theDirectoriesUnderTheCore(repository: string): string[] {
  if (!existsSync(join(repository, CORE))) return []
  return readdirSync(join(repository, CORE), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${CORE}/${entry.name}`)
    .sort()
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
  // The text is read once and judged twice: parsed, and as written, where a key declared twice still shows (martha#753).
  const text = manifestTextOf(repository)
  const manifest = JSON.parse(text) as Manifest
  const twice: Finding[] = keysDeclaredTwice(text).map((found) => ({ kind: 'duplicate_key', ...found }))
  const declared = declaredDirectoriesOf(manifest)
  const code = await countsOnDisk(
    repository,
    declared.map((entry) => entry.directory),
  )
  const slices = await countsOnDisk(repository, coreSlicesAmong(theDirectoriesUnderTheCore(repository), manifest))
  return {
    manifest,
    declared,
    code,
    findings: [...twice, ...findingsOf(declared, ceilingsOf(manifest), code)],
    slices,
    slice_findings: sliceFindingsOf(sliceCapOf(manifest), sliceCeilingsOf(manifest), slices),
  }
}
