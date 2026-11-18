// The files a merge of two passed heads may clash in without a builder settling it (martha#381, martha#627).
//
// One file is left: package.json's host ceilings, which a landing merges as each side's raise over its base
// (martha#410), decided on the three stages' text and never by the file's name. The C4 pictures were redone here too
// until martha#627 gave them to the release: no change carries a picture now, so a clash in one is a change nobody
// expected, and a builder settles it by hand rather than a landing choosing a rendering.

import { relative } from 'node:path'

import { manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'

/** What stands between the words for each redone path on the one line the redo prints. */
export const THE_WORDS_BETWEEN = '; '

/** Where a clone keeps package.json: the path a merge writes it at. */
export const theManifestIn = (repository: string): string => manifestPathOf(repository)

/** package.json as a git command in the clone names it: relative to the repository's top. */
export const theManifestAsGitNamesIt = (repository: string): string => relative(repository, manifestPathOf(repository))

/** Why a clash in these paths stops a landing: none of them is a file a landing redoes. */
export const aClashNotRedone = (paths: readonly string[]): string => `the merge clashes in ${paths.join(', ')}, which a landing does not redo`

/** Why a manifest a side added or removed is not redone: it has no base, ours and theirs to merge the map from. */
export const noThreeStages = (the_manifest: string): string =>
  `${the_manifest} has no three stages here: a side added or removed it, which is a change to the file and not to the map`
