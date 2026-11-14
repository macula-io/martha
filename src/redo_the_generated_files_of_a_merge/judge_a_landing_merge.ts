// The judge of one landing merge that clashed (martha#339).
//
// The range gate refuses a merge whose tree is not the one merging its two parents writes: that merge carries a change
// nobody reviewed. A landing that redid a generated file makes exactly such a merge, so the gate asks this program before
// refusing one, and this passes it only when it is what the redo makes and nothing more:
//
// 1. every path merging the parents clashes in is one the redo redoes, read from git and never from the message;
// 2. the merge's Redone-generated line names exactly those, in the redo's own words;
// 3. outside those paths, the merge's tree is the one merging its parents writes;
// 4. package.json, when it is one of them, is outside martha.hostCeilings what merging the two reviewed heads writes
//    there (martha#410), which is the same three-way rule the redo applies and the dry run forecasts.
//
// What the redone files hold is judged where it already is: the C4 test pins the picture to its generator, and CI's
// exact check:host-ceilings pins the map's numbers. A merge resolved by hand, a redo line that names a source path, or a
// merge with no redo line is refused by name.

import { A_JUDGED_MERGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { whatAMergeTreeWrote, type AMergeInMemory } from '../find_where_a_merge_clashes/find_where_a_merge_clashes.ts'
import { REDONE_GENERATED } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { classifyAClashedPath, theManifestStages } from './classify_a_clashed_path.ts'
import { gitRan, gitSaid, saidBy } from './git_in_the_repository.ts'
import { THE_SUMMED_NAMES, thePackageJsonOfAMerge, theSameOutsideTheCeilings } from './the_ceilings_a_merge_brings.ts'
import { THE_WORDS_BETWEEN, theManifestAsGitNamesIt } from './the_generated_files.ts'

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** The two parents of a landing merge: the branch it was made on, and the head it landed. */
interface TheParents {
  readonly into: string
  readonly landed: string
}

/** The merge's two parents, or why it is not a merge of two. */
function theParentsOf(repository: string, merge: string): Step<TheParents> {
  const said = gitSaid(repository, ['rev-list', '--parents', '-n', '1', merge])
  const [, into, landed, ...more] = (said ?? '').split(' ')
  if (into === undefined || landed === undefined || more.length > 0) return { refused: `${merge} is not a merge of two parents` }
  return { ok: { into, landed } }
}

/** What merging the parents writes, when they clash; refused when they merge cleanly or git cannot merge them. */
function theClashOfTheParents(repository: string, parents: TheParents): Step<AMergeInMemory> {
  const ran = gitRan(repository, ['merge-tree', '--write-tree', parents.into, parents.landed])
  if (ran.status === 0) return { refused: `merging ${parents.into} and ${parents.landed} goes cleanly, so the landing redid nothing in it` }
  if (ran.status !== 1) return { refused: `git merge-tree could not merge ${parents.into} and ${parents.landed}: ${saidBy('git merge-tree', ran)}` }
  return { ok: whatAMergeTreeWrote(ran.stdout) }
}

/** Check 1: the redo's words for every path the parents clash in, or the first path it does not redo. */
function theWordsOfTheClash(repository: string, clash: AMergeInMemory): Step<readonly string[]> {
  const words: string[] = []
  for (const [path, stages] of clash.clashed) {
    const classified = classifyAClashedPath(repository, path, stages)
    if ('refused' in classified) return classified
    words.push(classified.ok)
  }
  return { ok: words }
}

/** Check 2: the merge's message names exactly the words the redo records of this clash. */
function theTrailerNamesTheClash(repository: string, merge: string, words: readonly string[]): Step<true> {
  const message = gitSaid(repository, ['log', '-1', '--format=%B', merge]) ?? ''
  const line = message.split('\n').find((one) => one.startsWith(`${REDONE_GENERATED} `))
  if (line === undefined) return { refused: `it carries no ${REDONE_GENERATED} line, so no landing redid it` }
  const named = line.slice(REDONE_GENERATED.length + 1).trim().split(THE_WORDS_BETWEEN)
  const same = named.length === words.length && [...named].sort().join('\n') === [...words].sort().join('\n')
  if (same) return { ok: true }
  return { refused: `its ${REDONE_GENERATED} line names ${named.join(THE_WORDS_BETWEEN)}, and merging its parents clashes in ${words.join(THE_WORDS_BETWEEN)}` }
}

/** Check 3: outside the paths the redo redid, the merge's tree is the one merging its parents writes. */
function nothingElseDiffers(repository: string, merge: string, clash: AMergeInMemory): Step<true> {
  const said = gitSaid(repository, ['diff', '--name-only', clash.tree, `${merge}^{tree}`])
  if (said === undefined) return { refused: 'its tree could not be compared with what merging its parents writes' }
  const others = said.split('\n').filter((path) => path !== '' && !clash.clashed.has(path))
  if (others.length === 0) return { ok: true }
  return { refused: `it changes ${others.join(', ')}, which merging its parents does not, so what would land is not what passed` }
}

/**
 * Check 4: the landed package.json, outside the ceilings, is what merging the two reviewed heads writes there. The
 * three stages are the ones the clash kept, so this reads the same rule the redo and the dry run read.
 */
function theManifestIsTheOneTheMergeWrites(repository: string, merge: string, clash: AMergeInMemory): Step<true> {
  const the_manifest = theManifestAsGitNamesIt(repository)
  const stages = clash.clashed.get(the_manifest)
  if (stages === undefined) return { ok: true }
  const texts = theManifestStages(repository, the_manifest, stages)
  if ('refused' in texts) return texts
  const written = thePackageJsonOfAMerge(repository, ...texts.ok)
  if ('refused' in written) return written
  const landed = gitSaid(repository, ['show', `${merge}:${the_manifest}`])
  if (landed === undefined) return { refused: `${the_manifest} could not be read on the merge` }
  const same = theSameOutsideTheCeilings(landed, written.ok.text)
  if ('refused' in same) return same
  if (same.ok) return { ok: true }
  return { refused: `${the_manifest}, outside ${THE_SUMMED_NAMES}, is not what merging the two reviewed heads writes` }
}

/**
 * The judge's answer on one landing merge: its pass word and the redo's words for what it redid, or the first check it
 * fails, by name. The range gate takes no other answer for a pass.
 */
export function judgeALandingMerge(repository: string, merge: string): Step<string> {
  const parents = theParentsOf(repository, merge)
  if ('refused' in parents) return parents
  const clash = theClashOfTheParents(repository, parents.ok)
  if ('refused' in clash) return clash
  const words = theWordsOfTheClash(repository, clash.ok)
  if ('refused' in words) return words
  const named = theTrailerNamesTheClash(repository, merge, words.ok)
  if ('refused' in named) return named
  const alone = nothingElseDiffers(repository, merge, clash.ok)
  if ('refused' in alone) return alone
  const manifest = theManifestIsTheOneTheMergeWrites(repository, merge, clash.ok)
  return 'refused' in manifest ? manifest : { ok: `${A_JUDGED_MERGE}: ${words.ok.join(THE_WORDS_BETWEEN)}` }
}
