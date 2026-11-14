// Run:   node src/redo_the_generated_files_of_a_merge/main.ts --repository <path>
//        node src/redo_the_generated_files_of_a_merge/main.ts --repository <path> --classify <path> <base> <ours> <theirs>
//        node src/redo_the_generated_files_of_a_merge/main.ts --repository <path> --judge <merge-sha>
//
// Redoes the files a merge of two passed heads clashed in, when those are the ones nobody wrote by hand (martha#381): the
// C4 picture is drawn again by the program that draws it, and package.json's host ceilings are merged — each at its base
// plus what each review added — instead of taken from one side, while everything outside the map is what git's own merge
// of the two sides writes there (martha#410). Any other path in the clash is left as it is and named.
//
// Prints, on one line, the words a landing's commit records of the redo, such as
// `assets/c4-context.svg (picture); package.json martha.hostCeilings (measured)`.
// Exit 0 the clash was redone and nothing is unsettled; 1 it was not, in the words a landing prints when it stops; 2 it
// could not be done. It never settles a path it does not name.
//
// Two more modes answer for the rule without merging anything (martha#339), so a slice that may not import this program
// still reads its one rule by running it:
// - `--classify` takes one path a merge clashed in and its three stage blobs (`-` for a side that has none), and prints
//   the words the redo would record of it, exit 0, or why it is a clash by hand, exit 1. A batch's dry run asks it.
// - `--judge` takes one landing merge that clashed, and passes it, exit 0, only when it is what the redo makes and
//   nothing more (./judge_a_landing_merge.ts); refused, exit 1, by name. The range gate asks it.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { classifyAClashedPath } from './classify_a_clashed_path.ts'
import { gitRan, gitSaid, saidBy } from './git_in_the_repository.ts'
import { judgeALandingMerge } from './judge_a_landing_merge.ts'
import { thePackageJsonOfAMerge, type ThePackageJsonAMergeBrings } from './the_ceilings_a_merge_brings.ts'
import {
  aClashNotRedone,
  aPictureRedone,
  isAPictureRedrawn,
  noThreeStages,
  THE_PICTURES_REDRAWN_AS,
  THE_WORDS_BETWEEN,
  theManifestAsGitNamesIt,
  theManifestIn,
} from './the_generated_files.ts'

const NAME = 'redo_the_generated_files_of_a_merge'

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** The `--name value` a run was given, when it gave one. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** The paths the merge could not settle, as git names them; undefined when git would not say. */
function unsettledIn(repository: string): Step<readonly string[]> {
  const said = gitSaid(repository, ['diff', '--name-only', '--diff-filter=U'])
  if (said === undefined) return { refused: 'git would not say which paths the merge could not settle' }
  return { ok: said.split('\n').filter((clashed) => clashed !== '') }
}

/** The pictures redrawn over the merged tree, or why they would not be. */
function redrawThePictures(repository: string): Step<true> {
  const [command, program] = THE_PICTURES_REDRAWN_AS
  const ran = spawnSync(command, [program], { cwd: repository, encoding: 'utf8' })
  if (ran.status !== 0) return { refused: `the picture would not be redrawn: ${saidBy(program, ran)}` }
  return { ok: true }
}

/** package.json as the merge brings it: each ceiling at its base plus both raises, or why not. */
function theManifestMerged(repository: string, the_manifest: string): Step<ThePackageJsonAMergeBrings> {
  const stages = [1, 2, 3].map((at) => gitSaid(repository, ['show', `:${String(at)}:${the_manifest}`]))
  const [base, ours, theirs] = stages
  if (base === undefined || ours === undefined || theirs === undefined) {
    return { refused: noThreeStages(the_manifest) }
  }
  return thePackageJsonOfAMerge(repository, base, ours, theirs)
}

/** Every path the clash left that the landing does not redo, in the order git named them. */
function thePathsNotRedone(settled: readonly string[], the_manifest: string): readonly string[] {
  return settled.filter((clashed) => clashed !== the_manifest && !isAPictureRedrawn(clashed))
}

/** A clash a landing redoes: the manifest among the paths, when it is one of them, and the pictures. */
interface TheClash {
  readonly manifest: string | undefined
  readonly pictures: readonly string[]
}

/** The clash, split into the manifest and the pictures, or why it is not one a landing redoes. */
function theClashIn(repository: string): Step<TheClash> {
  const settled = unsettledIn(repository)
  if ('refused' in settled) return settled
  const the_manifest = theManifestAsGitNamesIt(repository)
  const others = thePathsNotRedone(settled.ok, the_manifest)
  if (others.length > 0) return { refused: aClashNotRedone(others) }
  return { ok: { manifest: settled.ok.includes(the_manifest) ? the_manifest : undefined, pictures: settled.ok.filter(isAPictureRedrawn) } }
}

/** The redone paths marked settled in the index, so git no longer counts them unmerged. */
function thePathsSettled(repository: string, paths: readonly string[]): Step<true> {
  const ran = gitRan(repository, ['add', '--', ...paths])
  if (ran.status !== 0) return { refused: `the redone paths would not be marked settled: ${saidBy(GIT, ran)}` }
  return { ok: true }
}

/** The paths redone over the merged tree, with the words a landing's commit records of them. */
function theClashRedone(repository: string, clash: TheClash): Step<readonly string[]> {
  const drawn = clash.pictures.length === 0 ? { ok: true as const } : redrawThePictures(repository)
  if ('refused' in drawn) return drawn
  const merged = clash.manifest === undefined ? { ok: undefined } : theManifestMerged(repository, clash.manifest)
  if ('refused' in merged) return merged
  if (merged.ok !== undefined) writeFileSync(theManifestIn(repository), merged.ok.text)
  const settled = thePathsSettled(repository, [...clash.pictures, ...(clash.manifest === undefined ? [] : [clash.manifest])])
  if ('refused' in settled) return settled
  const recorded = merged.ok === undefined ? [] : [merged.ok.recorded]
  return { ok: [...clash.pictures.map(aPictureRedone), ...recorded] }
}

/** Nothing the redo does not name is left unsettled: every path still in the clash is one it redid. */
function nothingIsLeftUnsettled(repository: string): Step<true> {
  const left = unsettledIn(repository)
  if ('refused' in left) return left
  if (left.ok.length === 0) return { ok: true }
  return { refused: `${left.ok.join(', ')} is still unsettled after the redo` }
}

/** The clash redone, with the words a landing's commit records of it, or why it was not. */
function redo(repository: string): Step<readonly string[]> {
  const clash = theClashIn(repository)
  if ('refused' in clash) return clash
  const redone = theClashRedone(repository, clash.ok)
  if ('refused' in redone) return redone
  const left = nothingIsLeftUnsettled(repository)
  return 'refused' in left ? left : redone
}

/** A stage blob as `--classify` takes it: `-` is a side that has none. */
const aStage = (given: string | undefined): string | undefined => (given === undefined || given === '-' ? undefined : given)

/** The one answer a mode gives: its words on stdout and exit 0, or its refusal on stderr and exit 1. */
function answered(step: Step<string>): number {
  if ('refused' in step) {
    console.error(`${NAME}: ${step.refused}`)
    return 1
  }
  console.log(step.ok)
  return 0
}

/** `--classify <path> <base> <ours> <theirs>`: what the redo would record of one clashed path, or why it would not. */
function classify(repository: string, at: number): Step<string> {
  const [path, base, ours, theirs] = process.argv.slice(at + 1, at + 5)
  if (path === undefined || path === '') return { refused: '--classify takes a path and its three stage blobs' }
  return classifyAClashedPath(repository, path, { base: aStage(base), ours: aStage(ours), theirs: aStage(theirs) })
}

/** `--judge <merge>`: whether one landing merge that clashed is what the redo makes and nothing more. */
function judge(repository: string, merge: string | undefined): Step<string> {
  if (merge === undefined || merge === '') return { refused: '--judge takes the merge it judges' }
  return judgeALandingMerge(repository, merge)
}

function main(): number {
  const repository = option('--repository') ?? '.'
  const classifying = process.argv.indexOf('--classify')
  if (classifying !== -1) return answered(classify(repository, classifying))
  if (process.argv.includes('--judge')) return answered(judge(repository, option('--judge')))
  const redone = redo(repository)
  return answered('refused' in redone ? redone : { ok: redone.ok.join(THE_WORDS_BETWEEN) })
}

process.exitCode = main()
