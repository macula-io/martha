// The commit that would carry what a killed run left (#693).
//
// A member that never reads its telling can still stage a mutant and commit it: `git add -A` puts the bytes in the index,
// and the commit ships them. So a commit is judged on what it would carry, not on what the worktree holds — the index is
// where those bytes already are when the commit runs — and each staged path's bytes are read back from the index itself
// (`git show :<path>`), never from the file, which the member may have edited since.
//
// It fails open, as the guard it sits behind does: no directory to ask, a git that will not answer, or a record nobody can
// read (rule 3 says such a record is said and not judged) refuses nothing. A commit is refused only on the bytes.
//
// The index is not enough on its own: `git add -A && git commit` and `git commit -am` are judged before the shell line
// runs, so at that moment the mutant is still only in the working tree. When the line stages (any `git add`, or a commit
// that carries `-a`/`--all`/`-i`/`--include`/a path), each standing leftover's bytes on disk are judged as well, read
// through the contract's file port, so the two ordinary ways to commit a mutant meet the same refusal the staged copy
// already met (martha#693 r=2).

import { join } from 'node:path'

import type { CrewStore, FileTree, Processes } from '../host_contract/host_contract.ts'
import type { AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import {
  theDigestOf,
  theRefusalOfACommit,
  type ILeftover,
  type IReleasedPath,
  type IWhatACommitWouldCarry,
  type WhatAKilledRunLeft,
} from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'
import { theLeftoverRecordOf, theReleasedPathsOf } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'

/** A commit about to run: where, the record it is judged on, and the paths a member has already released. */
export interface ACommitToJudge {
  readonly processes: Pick<Processes, 'run'>
  /** The directory the commit runs in, as the caller knows it; a call with none is asked about nowhere. */
  readonly directory: string | null
  readonly record: WhatAKilledRunLeft
  readonly released?: readonly IReleasedPath[]
  /** The files on disk, when the caller can hand them over: a commit that stages carries the working tree's own bytes. */
  readonly files?: Pick<FileTree, 'bytesOf'>
  /**
   * Whether this commit also carries the working tree's bytes (the line stages, or the commit takes `-a`, `-i` or a
   * path): what `git add -A && git commit` and `git commit -am` do, and what judging the index alone would miss.
   */
  readonly stagesTheWorkingTree?: boolean
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
export async function theRefusalOfTheCommit(commit: ACommitToJudge, note: (line: string) => void = () => {}): Promise<string | undefined> {
  if (commit.directory === null) return undefined
  const staged = await whatTheCommitWouldCarry(commit.processes, commit.directory)
  const carrying = [...staged, ...whatTheWorkingTreeCarries(commit)]
  return carrying.length === 0 ? undefined : theRefusalOfACommit(commit.record, carrying, commit.released, note)
}

/** The words a commit takes a value for: the word after one of these is not a path the commit would carry. */
const A_VALUE_FOR: ReadonlySet<string> = new Set([
  '-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message',
  '--author', '--date', '--template', '-S', '--gpg-sign', '--fixup', '--squash', '-t', '--trailer', '--cleanup',
])

/** The words that make a commit carry the working tree's own bytes, whatever the index holds. */
const STAGES: ReadonlySet<string> = new Set(['-a', '--all', '-i', '--include', '--pathspec-from-file', '--pathspec-file-nul'])

/** Whether a short cluster of switches (`-am`, `-ai`) holds the one that stages: a cluster is letters, never `--`. */
const aShortClusterThatStages = (word: string): boolean => /^-[a-zA-Z]+$/.test(word) && (word.includes('a') || word.includes('i'))

/**
 * Whether these commit arguments make the commit carry the working tree's own bytes: `-a`/`--all`, `-i`/`--include`, a
 * pathspec it names, or `--` before one. `git commit -m <word>` alone staged nothing, so the index is all it carries.
 */
export const theCommitCarriesTheWorkingTree = (args: readonly string[]): boolean => {
  let aValueComesNext = false
  for (const word of args) {
    if (aValueComesNext) { aValueComesNext = false; continue }
    if (A_VALUE_FOR.has(word)) { aValueComesNext = true; continue }
    if (STAGES.has(word) || word === '--' || aShortClusterThatStages(word)) return true
    if (!word.startsWith('-')) return true
  }
  return false
}

/** Whether this shell line stages what it commits: a call that stages anything at all, or a commit that carries the tree. */
export const theLineStagesWhatItCommits = (calls: readonly AGitCall[], commit: AGitCall): boolean =>
  calls.some((one) => one.command === 'add' || one.command === 'stage') || theCommitCarriesTheWorkingTree(commit.args)

/** The bytes the working tree holds at a leftover's path, or undefined when it holds none (deleted, or gone with the tree). */
const theWorkingBytesOf = (files: Pick<FileTree, 'bytesOf'>, directory: string, one: ILeftover): Uint8Array | undefined => {
  try {
    return files.bytesOf(join(one.worktree ?? directory, one.path))
  } catch {
    return undefined
  }
}

/**
 * What the working tree would carry of what a killed run left, when this commit stages: each leftover's bytes as they
 * are on disk now, so `git add -A && git commit` and `git commit -am` are judged on the bytes they would ship. A member
 * that edited the file itself has bytes that differ from the record, and is not refused (the content rule).
 */
const whatTheWorkingTreeCarries = (commit: ACommitToJudge): readonly IWhatACommitWouldCarry[] => {
  const { files, directory } = commit
  if (files === undefined || directory === null || commit.stagesTheWorkingTree !== true) return []
  return commit.record.leftovers.flatMap((one) => {
    const bytes = theWorkingBytesOf(files, directory, one)
    return bytes === undefined ? [] : [{ path: one.path, digest: theDigestOf(bytes), ...(one.worktree === undefined ? {} : { worktree: one.worktree }) }]
  })
}

/** The calls about to run, the host that asks git for them, the member making them, and the crew's kept record. */
export interface TheCallsToJudge {
  readonly calls: readonly AGitCall[]
  readonly processes: Pick<Processes, 'run'>
  /** The crew's own store, where what the member's last launch left is kept; absent, no commit is judged. */
  readonly leftovers?: CrewStore
  /** The files on disk, when the caller can hand them over: a commit that stages is judged on the working tree too. */
  readonly files?: Pick<FileTree, 'bytesOf'>
  readonly member: string
}

/**
 * What a commit among these calls would ship that a killed run left, or undefined when none would (martha#693): the
 * member's kept record judged against the bytes the commit would carry — the index, plus the working tree's own bytes
 * when the line stages them (`git add -A && git commit`, `git commit -am`), which the index alone does not show yet.
 */
export async function theLeftoversRefusal(incoming: TheCallsToJudge, note: (line: string) => void = () => {}): Promise<string | undefined> {
  const commit = incoming.calls.find((call) => call.command === 'commit')
  if (incoming.leftovers === undefined || commit === undefined) return undefined
  const kept = theLeftoverRecordOf(incoming.leftovers, incoming.member)
  // A record nobody can read is said and judged nothing on (rule 3), and a place that cannot be asked is not a refusal.
  if (kept === undefined || 'refusal' in kept || 'unreadable' in kept) return undefined
  return theRefusalOfTheCommit({
    processes: incoming.processes,
    directory: commit.directory,
    record: kept.record,
    released: theReleasedPathsOf(incoming.leftovers, incoming.member),
    stagesTheWorkingTree: theLineStagesWhatItCommits(incoming.calls, commit),
    ...(incoming.files === undefined ? {} : { files: incoming.files }),
  }, note)
}
