// Run:   node src/redo_the_generated_files_of_a_merge/main.ts --repository <path>
//
// Redoes the files a merge of two passed heads clashed in, when those are the ones nobody wrote by hand (martha#381): the
// C4 picture is drawn again by the program that draws it, and package.json's host ceilings are merged — each at its base
// plus what each review added — instead of taken from one side. Any other path in the clash is left as it is and named.
//
// Prints, on one line, the words a landing's commit records of the redo, such as
// `assets/c4-context.svg (picture); package.json martha.hostCeilings (measured)`.
// Exit 0 the clash was redone and nothing is unsettled; 1 it was not, in the words a landing prints when it stops; 2 it
// could not be done. It never settles a path it does not name.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { thePackageJsonOfAMerge, type ThePackageJsonAMergeBrings } from './the_ceilings_a_merge_brings.ts'
import { aPictureRedone, isAPictureRedrawn, THE_PICTURES_REDRAWN_AS, theManifestAsGitNamesIt, theManifestIn } from './the_generated_files.ts'

const NAME = 'redo_the_generated_files_of_a_merge'

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** The `--name value` a run was given, when it gave one. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** What a run said, as one line: its own words, or the status it ended with when it said none. */
function saidBy(program: string, ran: { readonly status: number | null; readonly stdout: string; readonly stderr: string }): string {
  const first = (ran.stderr.trim() === '' ? ran.stdout.trim() : ran.stderr.trim()).split('\n')[0] ?? ''
  return first === '' ? `${program} ended with ${String(ran.status)}` : first
}

/** What git in this clone says, when it ends well. */
function gitSaid(repository: string, args: readonly string[]): string | undefined {
  const ran = spawnSync(GIT, [...marthasOwnGitArgs(args)], { cwd: repository, encoding: 'utf8' })
  return ran.status === 0 ? ran.stdout.trim() : undefined
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
    return { refused: `${the_manifest} has no three stages here: a side added or removed it, which is a change to the file and not to the map` }
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
  if (others.length > 0) return { refused: `the merge clashes in ${others.join(', ')}, which a landing does not redo` }
  return { ok: { manifest: settled.ok.includes(the_manifest) ? the_manifest : undefined, pictures: settled.ok.filter(isAPictureRedrawn) } }
}

/** The redone paths marked settled in the index, so git no longer counts them unmerged. */
function thePathsSettled(repository: string, paths: readonly string[]): Step<true> {
  const ran = spawnSync(GIT, [...marthasOwnGitArgs(['add', '--', ...paths])], { cwd: repository, encoding: 'utf8' })
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

function main(): number {
  const repository = option('--repository') ?? '.'
  const redone = redo(repository)
  if ('refused' in redone) {
    console.error(`${NAME}: ${redone.refused}`)
    return 1
  }
  console.log(redone.ok.join('; '))
  return 0
}

process.exitCode = main()
