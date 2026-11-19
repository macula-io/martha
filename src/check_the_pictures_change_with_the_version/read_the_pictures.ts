// What the picture rule reads: a tree's pictures, and the change a range makes (martha#627).
//
// The pictures come from the tree the run was pointed at, and the drawn bytes come from the generator itself, so
// nothing here restates a picture or a path: both are ../../architecture/c4_diagrams.ts's to name. A range's paths and
// its two versions come from its merge base in git, and a git that cannot answer is a run that could not look, never
// a clean one.

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { DIAGRAMS, THE_PICTURES_THE_C4_DRAWS } from '../../architecture/c4_diagrams.ts'
import { manifestPathOf } from '../../prove_the_core/read_the_manifest_and_the_linter/declared_in_package_json.ts'
import { gitSaid } from '../redo_the_generated_files_of_a_merge/git_in_the_repository.ts'
import type { AChange, APicture } from './check_the_pictures_change_with_the_version.ts'

/** The picture as the tree holds it, or undefined when the tree does not hold it at all. */
const thePictureIn = (repository: string, file: string): string | undefined => {
  try {
    return readFileSync(join(repository, file), 'utf8')
  } catch {
    return undefined
  }
}

/** Every picture the generator draws, what this tree holds of it, and what the generator draws. */
export const thePicturesAt = (repository: string): readonly APicture[] => {
  const drawn = DIAGRAMS.map((make) => make().svg())
  return THE_PICTURES_THE_C4_DRAWS.map((file, at) => ({ file, committed: thePictureIn(repository, file), drawn: drawn[at] ?? '' }))
}

/** package.json as git names it in this repository: never spelled here, because the declaration names it. */
const theManifestAsGitNamesIt = (repository: string): string => relative(repository, manifestPathOf(repository))

/**
 * Where a change begins: the commit the two ends last shared, never the base tip's own tree. A branch cut before a
 * release bump would otherwise read main's bump as its own, in reverse, and a downgrade counts as a bump too — so a
 * change that touches no picture would be held to pictures it never touched (martha#627 r=2).
 */
const theMergeBaseOf = (repository: string, base: string, head: string): string | undefined => gitSaid(repository, ['merge-base', base, head])

/** What a range states of itself, read from its merge base: its paths, and its two versions; undefined when git would not say. */
export const theChangeFrom = (repository: string, base: string, head: string): AChange | undefined => {
  const from = theMergeBaseOf(repository, base, head)
  if (from === undefined) return undefined
  const paths = gitSaid(repository, ['diff', '--name-only', from, head])
  if (paths === undefined) return undefined
  const the_manifest = theManifestAsGitNamesIt(repository)
  return {
    paths: paths.split('\n').filter((path) => path !== ''),
    versionAtBase: theVersionAt(repository, the_manifest, from),
    versionAtHead: theVersionAt(repository, the_manifest, head),
  }
}

/** The text of one path at one commit, or undefined when that commit does not hold it. */
const theTextAt = (repository: string, path: string, commit: string): string | undefined =>
  gitSaid(repository, ['show', `${commit}:${path}`])

/**
 * The version one commit states, as a string, or undefined: git's answer trimmed of the trailing newline that `show`
 * adds, so a stated version is read as the manifest states it and never as a spelling with whitespace on it.
 */
function theVersionAt(repository: string, the_manifest: string, commit: string): string | undefined {
  const text = theTextAt(repository, the_manifest, commit)
  if (text === undefined) return undefined
  try {
    const stated = (JSON.parse(text) as Record<string, unknown>)['version']
    return typeof stated === 'string' ? stated : undefined
  } catch {
    return undefined
  }
}
