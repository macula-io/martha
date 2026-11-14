// git's own merge of three texts (martha#410).
//
// The redo asks what two passed heads' package.json comes to: each ceiling is summed from the three stages, and
// everything outside the map is whatever merging the two sides writes there. Two texts compared whole can only answer
// "differ", and a part one head changed while the other left it alone differs without clashing — which is why such a
// clash used to stop a batch as one a builder settles (martha#339). So the three stages are handed to `git merge-file`,
// the program git merges a file's content with, and its answer is the merge: the text it writes, or that the sides
// clash.
//
// The stages are written into a directory of their own under the system's temporary directory, removed when the run
// ends, so a merge writes nothing in the repository it reads.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { saidBy } from './git_in_the_repository.ts'

/** What merging three texts came to: what it wrote, that the two sides clash, or why git could not merge them. */
export type AMergedText = { readonly ok: string } | { readonly clashed: true } | { readonly refused: string }

/** The three texts a merge is given, in the order git takes them: the side merged onto, the base both were cut from, and the side merged in. */
export type TheStagesOfAMerge = readonly [ours: string, base: string, theirs: string]

/** The last exit status that is a clash: git answers how many hunks it could not settle, cut off at this one. */
const THE_MOST_CLASHES = 127

/** The prefix of the directory one merge writes its stages in, under the system's temporary directory. */
const A_DIRECTORY_OF_ITS_OWN = 'martha-a-merge-of-'

/** The three stages written into `directory`, as the files git merges, in the order git takes them. */
function theStageFiles(directory: string, [ours, base, theirs]: TheStagesOfAMerge): readonly [string, string, string] {
  const written = (stage: string, text: string): string => {
    const file = join(directory, stage)
    writeFileSync(file, text)
    return file
  }
  return [written('ours', ours), written('base', base), written('theirs', theirs)]
}

/** The text merging the three stages writes, or which of the two ways it did not. */
export function theMergeOfThreeTexts(stages: TheStagesOfAMerge): AMergedText {
  const directory = mkdtempSync(join(tmpdir(), A_DIRECTORY_OF_ITS_OWN))
  try {
    const files = theStageFiles(directory, stages)
    const ran = spawnSync(GIT, [...marthasOwnGitArgs(['merge-file', '-p', ...files])], { cwd: directory, encoding: 'utf8' })
    if (ran.status === 0) return { ok: ran.stdout }
    if (ran.status !== null && ran.status <= THE_MOST_CLASHES) return { clashed: true }
    return { refused: `git could not merge the three: ${saidBy(GIT, ran)}` }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
