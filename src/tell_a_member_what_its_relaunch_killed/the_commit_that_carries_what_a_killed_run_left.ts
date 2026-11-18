// The commit that would carry what a killed run left (#693).
//
// A member that never reads its telling can still stage a mutant and commit it: `git add -A` puts the bytes in the index,
// and the commit ships them. So a commit is judged on what it would carry, not on what the worktree holds — the index is
// where those bytes already are when the commit runs — and each staged path's bytes are read back from the index itself
// (`git show :<path>`), never from the file, which the member may have edited since.
//
// It fails open, as the guard it sits behind does: no directory to ask, a git that will not answer, or a record nobody can
// read (rule 3 says such a record is said and not judged) refuses nothing. A commit is refused only on the bytes.

import type { Processes } from '../host_contract/host_contract.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import {
  theDigestOf,
  theRefusalOfACommit,
  type IReleasedPath,
  type IWhatACommitWouldCarry,
  type WhatAKilledRunLeft,
} from './tell_a_member_what_its_relaunch_killed.ts'

/** A commit about to run: where, the record it is judged on, and the paths a member has already released. */
export interface ACommitToJudge {
  readonly processes: Pick<Processes, 'run'>
  /** The directory the commit runs in, as the caller knows it; a call with none is asked about nowhere. */
  readonly directory: string | null
  readonly record: WhatAKilledRunLeft
  readonly released?: readonly IReleasedPath[]
}

/** The paths the commit's index holds against HEAD, spelled as git spells them, or undefined when git will not say. */
async function theStagedPathsOf(processes: ACommitToJudge['processes'], directory: string): Promise<readonly string[] | undefined> {
  const asked = await processes.run({ command: 'git', args: marthasOwnGitArgs(['diff', '--cached', '--name-only', '-z']), cwd: directory }).catch(() => undefined)
  if (asked === undefined || asked.exit_code !== 0) return undefined
  return asked.stdout.split('\u0000').filter((path) => path !== '')
}

/** The bytes the index holds for one staged path, or undefined when it holds none (a deletion has nothing to digest). */
async function theIndexBytesOf(processes: ACommitToJudge['processes'], directory: string, path: string): Promise<Uint8Array | undefined> {
  const asked = await processes.run({ command: 'git', args: marthasOwnGitArgs(['show', `:${path}`]), cwd: directory }).catch(() => undefined)
  return asked === undefined || asked.exit_code !== 0 ? undefined : new TextEncoder().encode(asked.stdout)
}

/** What the commit would carry, path by path, as the refusal judges it: each path's index bytes, and their digest. */
async function whatTheCommitWouldCarry(processes: ACommitToJudge['processes'], directory: string): Promise<readonly IWhatACommitWouldCarry[]> {
  const paths = (await theStagedPathsOf(processes, directory)) ?? []
  const carrying: IWhatACommitWouldCarry[] = []
  for (const path of paths) {
    const bytes = await theIndexBytesOf(processes, directory, path)
    if (bytes !== undefined) carrying.push({ path, digest: theDigestOf(bytes) })
  }
  return carrying
}

/**
 * Why the commit would ship what a killed run left, or undefined when it would not: the standing leftovers against the
 * bytes the index holds now. A commit whose path was staged before the member edited it is still refused, and one whose
 * edited bytes were staged over the leftover passes, which is what the content rule means.
 */
export async function theRefusalOfTheCommit(commit: ACommitToJudge): Promise<string | undefined> {
  if (commit.directory === null) return undefined
  const carrying = await whatTheCommitWouldCarry(commit.processes, commit.directory)
  return carrying.length === 0 ? undefined : theRefusalOfACommit(commit.record, carrying, commit.released)
}
