// One path a merge clashed in, classified the way the redo would treat it (martha#339).
//
// A batch's dry run asks this before anything is merged, and the range gate's judge asks it of every path a landing
// merge clashed in, so the two read one rule, the one the redo itself applies: a picture the C4 program draws is redone;
// package.json is redone only when its two sides are the same file outside martha.hostCeilings, which is decided on the
// three stages' text and never by its name; any other path is a clash a builder settles by hand.
//
// A stage is a blob id the repository holds, and is absent when one side added or removed the file, so it has none.

import type { TheStages } from '../find_where_a_merge_clashes/find_where_a_merge_clashes.ts'
import { thePackageJsonOfAMerge } from './the_ceilings_a_merge_brings.ts'
import { gitSaid } from './git_in_the_repository.ts'
import { aClashNotRedone, aPictureRedone, isAPictureRedrawn, noThreeStages, theManifestAsGitNamesIt } from './the_generated_files.ts'

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** The text a blob holds, or undefined when the repository will not show it. */
const theTextOf = (repository: string, blob: string): string | undefined => {
  const said = gitSaid(repository, ['cat-file', '-p', blob])
  return said === undefined ? undefined : `${said}\n`
}

/** package.json's three stages, read as text, or why they cannot all be. */
function theManifestStages(repository: string, the_manifest: string, stages: TheStages): Step<readonly [string, string, string]> {
  const { base, ours, theirs } = stages
  if (base === undefined || ours === undefined || theirs === undefined) return { refused: noThreeStages(the_manifest) }
  const texts = [base, ours, theirs].map((blob) => theTextOf(repository, blob))
  const [base_text, ours_text, theirs_text] = texts
  if (base_text === undefined || ours_text === undefined || theirs_text === undefined) {
    return { refused: `${the_manifest} has a stage this repository does not hold` }
  }
  return { ok: [base_text, ours_text, theirs_text] }
}

/**
 * What the redo records of one clashed path, when it redoes it: `<path> (picture)`, or package.json's own recorded words.
 * Refused, in the words a landing prints when it stops, when the path is one a builder settles.
 */
export function classifyAClashedPath(repository: string, path: string, stages: TheStages): Step<string> {
  if (isAPictureRedrawn(path)) return { ok: aPictureRedone(path) }
  const the_manifest = theManifestAsGitNamesIt(repository)
  if (path !== the_manifest) return { refused: aClashNotRedone([path]) }
  const texts = theManifestStages(repository, the_manifest, stages)
  if ('refused' in texts) return texts
  const merged = thePackageJsonOfAMerge(repository, ...texts.ok)
  return 'refused' in merged ? merged : { ok: merged.ok.recorded }
}
