// The generated files a landing redoes itself when two passed heads clash only in them (martha#381).
//
// This exists so a batch lands every PR that passed instead of one PR per batch: two passed heads that both redrew the
// C4 picture or both moved a host ceiling clash in a file nobody wrote by hand, and a merge a builder has to do costs
// the review the batch was meant to save. So the clash is taken as generated only when it is one of these files, and
// each one is redone here rather than resolved from a side: the pictures by running the program that draws them, and the
// ceilings by ../../src/check_a_host_directory_stays_under_its_ceiling/the_ceilings_a_merge_brings, which sums what each
// review passed. Any other path in the clash stops the batch, naming it.
//
// A picture's name is not written here: ../../architecture/c4_diagrams says what it draws, and a picture added or renamed
// there reaches this without an edit.

import { relative } from 'node:path'
import process from 'node:process'

import { THE_C4_DIAGRAMS_PROGRAM, THE_PICTURES_THE_C4_DRAWS } from '../../architecture/c4_diagrams.ts'
import { manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'

/** How the pictures are redrawn: the node that runs martha, and the program that draws them. */
export const THE_PICTURES_REDRAWN_AS: readonly [string, string] = [process.execPath, THE_C4_DIAGRAMS_PROGRAM]

/** Whether a path a merge could not settle is one the landing redraws, rather than one it stops for. */
export const isAPictureTheLandingRedraws = (path: string): boolean => THE_PICTURES_THE_C4_DRAWS.includes(path)

/** What a redone picture is recorded as, in the commit that lands it and in the batch's answer. */
export const aPictureRedone = (path: string): string => `${path} (picture)`

/** The manifest's path as a git command in the clone names it: relative to the repository's top, which is no spelling here. */
export const theManifestAsGitNamesIt = (repository: string): string => relative(repository, manifestPathOf(repository))
