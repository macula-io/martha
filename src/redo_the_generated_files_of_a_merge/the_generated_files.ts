// The files a merge of two passed heads may clash in without a builder settling it (martha#381).
//
// Two passed heads that both redrew the C4 picture, or both moved a host directory's ceiling, clash in a file nobody
// wrote by hand. Those are the paths this names, so a landing can tell such a clash from a real one: a picture is
// whatever ../../architecture/c4_diagrams draws, and a picture added or renamed there reaches this without an edit here,
// while its own list is pinned to that program by ./the_generated_files.node-test.ts.

import { relative } from 'node:path'

import { THE_C4_DIAGRAMS_PROGRAM, THE_PICTURES_THE_C4_DRAWS } from '../../architecture/c4_diagrams.ts'
import { manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'

/** The program that draws the pictures, run again over the tree being merged. */
export const THE_PICTURES_REDRAWN_AS: readonly [string, string] = ['node', THE_C4_DIAGRAMS_PROGRAM]

/** Whether a path the merge could not settle is one a landing redraws, rather than one it stops for. */
export const isAPictureRedrawn = (path: string): boolean => THE_PICTURES_THE_C4_DRAWS.includes(path)

/** What stands between the words for each redone path on the one line the redo prints. */
export const THE_WORDS_BETWEEN = '; '

/** What a redone picture is recorded as, in the commit that lands it and in the batch's answer. */
export const aPictureRedone = (path: string): string => `${path} (picture)`

/** Where a clone keeps package.json: the path a merge writes it at. */
export const theManifestIn = (repository: string): string => manifestPathOf(repository)

/** package.json as a git command in the clone names it: relative to the repository's top. */
export const theManifestAsGitNamesIt = (repository: string): string => relative(repository, manifestPathOf(repository))

/** Why a clash in these paths stops a landing: none of them is a file a landing redoes. */
export const aClashNotRedone = (paths: readonly string[]): string => `the merge clashes in ${paths.join(', ')}, which a landing does not redo`

/** Why a manifest a side added or removed is not redone: it has no base, ours and theirs to merge the map from. */
export const noThreeStages = (the_manifest: string): string =>
  `${the_manifest} has no three stages here: a side added or removed it, which is a change to the file and not to the map`
