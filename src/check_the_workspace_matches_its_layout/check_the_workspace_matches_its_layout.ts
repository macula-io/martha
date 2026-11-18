// What the workspace's places look like now, against the layout the crew declared (martha#562, port-map step 9).
//
// This is the other half of the guard. A guard sees a call; the tree is what a call left behind — a clone someone moved
// off its default branch by an alias or a hook, a clone whose origin names no default branch to be held to, a clone
// holding work, a worktree outside the place the crew named, a repository cloned twice, a worktree whose directory is
// gone while its record stands. None of that is a call this repository can refuse, and all of it is drift the crew
// should see, so this is a check: read-only, one line per drift, and exit 1 when there is one, so it stands as a check
// that fails by name.
//
// A clone with no default branch is the line that makes the guard's failing open safe: ../guard_workspace's switch rule
// cannot tell a way off that branch from a way back onto it, so it does not fire, and this check names the clone and the
// `git remote set-head origin --auto` that sets one. A miss the guard lets through is drift here, or it is nothing.
//
// It runs where the guard cannot see — after a member's shell, at a launch, or by hand — and it asks git only, with
// Martha's own settings (../run_marthas_own_git). A place the crew did not declare is not checked, and a git that cannot
// answer a question leaves that question unasked rather than inventing an answer. Nothing runs it yet: package 2 wires
// it to the launch and to the crew's hygiene command, and until then it is called by a test and by nothing else.
//
// What it cannot see: a worktree made outside the crew's places, once its clone no longer records it; and a repository
// cloned twice under two organisations the crew did not put in one place.

import type { FileTree, Processes } from '../host_contract/host_contract.ts'
import type { AListedWorktree, TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { repoOfTheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { join, sep } from 'node:path'

/**
 * What the check reads with: the tree's names and a git to ask, and the crew's own places and members.
 *
 * A place is compared as the path itself, every link resolved (martha#79), the way
 * ../ask_git_what_a_member_is_about_to_change compares one for the guard: git answers with the paths it resolved, so a
 * place reached through a link, such as macOS's `/var` -> `/private/var`, would put every worktree under it outside the
 * place and read as drift. The tree resolves it, through the host contract, because a slice may not reach the disk
 * itself: `realPathOf` is the contract's own way of asking, and the guard's adapter, which may use `node:fs`, asks the
 * same question there.
 */
export interface AnInspectionOfTheWorkspace {
  readonly files: Pick<FileTree, 'childrenOf' | 'realPathOf'>
  readonly processes: Pick<Processes, 'run'>
  readonly workspace: TheWorkspace
}

/** The path a place really is, or the path as it was given when the tree cannot resolve it: a place that does not stand
 * yet is still the place the crew declared, and an unresolvable one is not a reason to check nothing. */
const thePathItself = (files: AnInspectionOfTheWorkspace['files'], path: string | null): string | null =>
  path === null ? null : (files.realPathOf(path) ?? path)

/** A clone as git answers for it: where it is, what it is on, the branch it starts on, its work, its origin, its worktrees. */
interface ACloneInspected {
  readonly path: string
  readonly branch: string | null
  readonly start: TheStartOfAClone
  readonly dirty: boolean
  readonly origin: string | null
  readonly worktrees: readonly AListedWorktree[]
}

/** What git says of the branch a clone starts on: its name, that its origin names none, or that git could not be asked. */
type TheStartOfAClone =
  | { readonly kind: 'named'; readonly branch: string }
  | { readonly kind: 'unnamed' }
  | { readonly kind: 'unasked' }

/** The argument git takes to name the branch a checkout is on. */
const THE_BRANCH = ['rev-parse', '--abbrev-ref', 'HEAD']

/** The argument git takes to name the branch a clone starts on, as its origin has it: `origin/<name>`. */
const THE_DEFAULT_BRANCH = ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']

/** The argument git takes to say whether the tree holds work nothing has committed. */
const THE_DIRTY_WORK = ['status', '--porcelain']

/** The argument git takes to name the place a clone came from, which is what tells one repository from another. */
const THE_ORIGIN = ['remote', 'get-url', 'origin']

/** The argument git takes to list a clone's worktrees, the branch of each and whether only its record is left. */
const THE_WORKTREES = ['worktree', 'list', '--porcelain']

/** The line a porcelain block carries for a worktree: `worktree <path>`. */
const A_WORKTREE_LINE = 'worktree '

/** The line a porcelain block carries for the branch a worktree is on: `branch refs/heads/<name>`. */
const A_BRANCH_LINE = 'branch '

/** The line a porcelain block carries for a worktree only its record knows: `prunable <why>`. */
const A_PRUNED_LINE = 'prunable'

/** Whether a directory stands in a place or under it: the place itself, or a path past the separator that ends it. */
const isUnder = (directory: string, place: string): boolean => directory === place || directory.startsWith(`${place}${sep}`)

/** What git printed, one line each, or none when it could not be run or did not end well. */
async function saidByGit(processes: AnInspectionOfTheWorkspace['processes'], cwd: string, args: readonly string[]): Promise<readonly string[]> {
  const ended = await processes.run({ command: 'git', args: marthasOwnGitArgs(args), cwd }).catch(() => undefined)
  return ended === undefined || ended.exit_code !== 0 ? [] : ended.stdout.split('\n').map((line) => line.trim())
}

/** The one line git printed for a question with one answer, or null when it printed none. */
async function theAnswerOf(processes: AnInspectionOfTheWorkspace['processes'], cwd: string, args: readonly string[]): Promise<string | null> {
  const lines = (await saidByGit(processes, cwd, args)).filter((line) => line !== '')
  return lines[0] ?? null
}

/** The worktrees git lists for a clone, a block each: where each one is, its branch, and whether only its record stands. */
async function theWorktreesOf(processes: AnInspectionOfTheWorkspace['processes'], clone: string): Promise<readonly AListedWorktree[]> {
  const blocks: string[][] = []
  for (const line of await saidByGit(processes, clone, THE_WORKTREES)) {
    if (line.startsWith(A_WORKTREE_LINE)) blocks.push([line])
    else if (line !== '') blocks[blocks.length - 1]?.push(line)
  }
  return blocks.flatMap((block) => {
    const path = block.find((line) => line.startsWith(A_WORKTREE_LINE))?.slice(A_WORKTREE_LINE.length).trim()
    if (path === undefined) return []
    const branch = block.find((line) => line.startsWith(A_BRANCH_LINE))?.slice(A_BRANCH_LINE.length).trim() ?? null
    return [{ path, branch, prunable: block.some((line) => line.startsWith(A_PRUNED_LINE)) }]
  })
}

/** Every clone the crew's clone place holds, as `worktree_open` lays them out: `<clones>/<org>/<repo>`, two words deep. */
function theClonesIn(places: AnInspectionOfTheWorkspace): readonly string[] {
  const clones = places.workspace.clones
  if (clones === null) return []
  return places.files.childrenOf(clones).flatMap((org) => places.files.childrenOf(join(clones, org)).map((repo) => join(clones, org, repo)))
}

/** What git says of one clone: its branch, the branch it starts on, its work, where it came from, every worktree it records. */
async function inspected(places: AnInspectionOfTheWorkspace, clone: string): Promise<ACloneInspected> {
  const { processes } = places
  return {
    path: clone,
    branch: await theAnswerOf(processes, clone, THE_BRANCH),
    start: await theStartOf(processes, clone),
    dirty: (await saidByGit(processes, clone, THE_DIRTY_WORK)).some((line) => line !== ''),
    origin: await theAnswerOf(processes, clone, THE_ORIGIN),
    worktrees: await theWorktreesOf(processes, clone),
  }
}

/** The branch a clone starts on, as its origin names it, and whether git named none or could not be asked at all. */
async function theStartOf(processes: AnInspectionOfTheWorkspace['processes'], clone: string): Promise<TheStartOfAClone> {
  const ended = await processes.run({ command: 'git', args: marthasOwnGitArgs(THE_DEFAULT_BRANCH), cwd: clone }).catch(() => undefined)
  if (ended === undefined || ended.exit_code === null) return { kind: 'unasked' }
  const named = ended.exit_code === 0 ? ended.stdout.split('\n').map((line) => line.trim()).find((line) => line !== '') : undefined
  return named === undefined ? { kind: 'unnamed' } : { kind: 'named', branch: named.slice(named.indexOf('/') + 1) }
}

/** The line a clone whose origin names no default branch is, when it is a repository and git was asked: the guard's rule
 * cannot fire there — it cannot tell a way off the branch from a way back onto it — so this is where that miss is seen. */
function noStartBranch(clone: ACloneInspected): string | undefined {
  return clone.branch === null || clone.start.kind !== 'unnamed'
    ? undefined
    : `${clone.path} names no default branch for its origin, so a clone off its branch cannot be told from one on it and the guard does not fire there: git remote set-head origin --auto in ${clone.path}.`
}

/** The line a clone off its default branch is, when it is off one: the origin's default is the one it should be on. */
function offItsDefault(clone: ACloneInspected): string | undefined {
  const start = clone.start
  return start.kind !== 'named' || clone.branch === null || clone.branch === start.branch
    ? undefined
    : `${clone.path} is on ${clone.branch}, and a clone stays on ${start.branch}: a branch's work belongs in a worktree.`
}

/** The lines one clone's own state is: no default branch to hold it to, off its default branch, and holding work. */
function driftOfAClone(clone: ACloneInspected): readonly string[] {
  const start = noStartBranch(clone)
  const off = offItsDefault(clone)
  const dirty = clone.dirty ? `${clone.path} holds work nothing has committed: a clone is nobody's desk.` : undefined
  return [start, off, dirty].filter((line): line is string => line !== undefined)
}

/** The lines one clone's worktrees are: one outside the crew's worktree place, and one whose directory is gone. */
function driftOfAWorktrees(clone: ACloneInspected, place: string): readonly string[] {
  return clone.worktrees
    .filter((worktree) => worktree.path !== clone.path)
    .flatMap((worktree) => [
      !isUnder(worktree.path, place) ? `${worktree.path}${worktree.branch === null ? '' : ` (${worktree.branch})`} is not in ${place}, the place this crew declared for worktrees.` : undefined,
      worktree.prunable ? `${worktree.path} is recorded as a worktree and its directory is gone: git worktree prune in ${clone.path}.` : undefined,
    ])
    .filter((line): line is string => line !== undefined)
}

/**
 * The lines a repository cloned more than once is, one clone named with the others it doubles. The clones are grouped by
 * the origin git gives, so the grouping is exact; what is printed is the repository's `org/name`, never that URL
 * (martha#670): it can carry a token in its userinfo, and these lines are read by the owner.
 */
function driftOfADoubleClone(clones: readonly ACloneInspected[]): readonly string[] {
  const byOrigin = new Map<string, string[]>()
  for (const clone of clones) if (clone.origin !== null) byOrigin.set(clone.origin, [...(byOrigin.get(clone.origin) ?? []), clone.path])
  return [...byOrigin.entries()].flatMap(([origin, paths]) => {
    if (paths.length < 2) return []
    const named = repoOfTheOrigin(origin) ?? `the origin of ${paths[0] ?? ''}`
    return [`${named} is cloned ${String(paths.length)} times (${paths.join(', ')}): one clone per repository.`]
  })
}

/** Every line the workspace drifts by, in the order a reader fixes them: the clones, then their worktrees, then doubles. */
export async function theDriftInTheWorkspace(places: AnInspectionOfTheWorkspace): Promise<readonly string[]> {
  // Both places are asked for the path itself before anything is compared: the clones are found through the clone
  // place, so a link in front of it would name every clone and every worktree as a spelling git never prints.
  const workspace = {
    ...places.workspace,
    clones: thePathItself(places.files, places.workspace.clones),
    worktrees: thePathItself(places.files, places.workspace.worktrees),
  }
  const resolved: AnInspectionOfTheWorkspace = { ...places, workspace }
  const named = theClonesIn(resolved)
  const clones = await Promise.all(named.map((clone) => inspected(resolved, clone)))
  const place = workspace.worktrees
  const own = clones.flatMap(driftOfAClone)
  const worktrees = place === null ? [] : clones.flatMap((clone) => driftOfAWorktrees(clone, place))
  return [...own, ...worktrees, ...driftOfADoubleClone(clones)]
}
