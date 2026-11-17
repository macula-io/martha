// What the workspace's places look like now, against the layout the crew declared (martha#562, port-map step 9).
//
// This is the other half of the guard. A guard sees a call; the tree is what a call left behind — a clone someone moved
// off its default branch by an alias or a hook, a clone holding work, a worktree outside the place the crew named, a
// repository cloned twice, a worktree whose directory is gone while its record stands. None of that is a call this
// repository can refuse, and all of it is drift the crew should see, so this is a check: read-only, one line per drift,
// and exit 1 when there is one, so it stands as a check that fails by name.
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
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { join, sep } from 'node:path'

/**
 * What the check reads with: the tree's names and a git to ask, and the crew's own places and members.
 *
 * A place here is the path itself, every link resolved (martha#79): git answers with the paths it resolved, so a place
 * reached through a link, such as macOS's `/var` -> `/private/var`, is handed in resolved by the caller that reads the
 * declaration. A place given as its link's spelling is another string to this check, and every worktree under it reads
 * as drift.
 */
export interface AnInspectionOfTheWorkspace {
  readonly files: Pick<FileTree, 'childrenOf'>
  readonly processes: Pick<Processes, 'run'>
  readonly workspace: TheWorkspace
}

/** A clone as git answers for it: where it is, what it is on, whether it is clean, where it came from, its worktrees. */
interface ACloneInspected {
  readonly path: string
  readonly branch: string | null
  readonly dirty: boolean
  readonly origin: string | null
  readonly worktrees: readonly AListedWorktree[]
}

/** The argument git takes to name the branch a checkout is on. */
const THE_BRANCH = ['rev-parse', '--abbrev-ref', 'HEAD']

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

/** What git says of one clone: its branch, its work, where it came from, and every worktree it records. */
async function inspected(places: AnInspectionOfTheWorkspace, clone: string): Promise<ACloneInspected> {
  const { processes } = places
  return {
    path: clone,
    branch: await theAnswerOf(processes, clone, THE_BRANCH),
    dirty: (await saidByGit(processes, clone, THE_DIRTY_WORK)).some((line) => line !== ''),
    origin: await theAnswerOf(processes, clone, THE_ORIGIN),
    worktrees: await theWorktreesOf(processes, clone),
  }
}

/** The line a clone off its default branch is, when it is off one: the origin's default is the one it should be on. */
function offItsDefault(clone: ACloneInspected, defaultBranch: string | null): string | undefined {
  return defaultBranch === null || clone.branch === null || clone.branch === defaultBranch
    ? undefined
    : `${clone.path} is on ${clone.branch}, and a clone stays on ${defaultBranch}: a branch's work belongs in a worktree.`
}

/** The lines one clone's own state is: off its default branch, and holding work nothing has committed. */
function driftOfAClone(clone: ACloneInspected, defaultBranch: string | null): readonly string[] {
  const off = offItsDefault(clone, defaultBranch)
  const dirty = clone.dirty ? `${clone.path} holds work nothing has committed: a clone is nobody's desk.` : undefined
  return [off, dirty].filter((line): line is string => line !== undefined)
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

/** The lines a repository cloned more than once is, one clone named with the others it doubles. */
function driftOfADoubleClone(clones: readonly ACloneInspected[]): readonly string[] {
  const byOrigin = new Map<string, string[]>()
  for (const clone of clones) if (clone.origin !== null) byOrigin.set(clone.origin, [...(byOrigin.get(clone.origin) ?? []), clone.path])
  return [...byOrigin.entries()].flatMap(([origin, paths]) => (paths.length < 2 ? [] : [`${origin} is cloned ${String(paths.length)} times (${paths.join(', ')}): one clone per repository.`]))
}

/** The default branch a clone starts on, as its origin names it: `main` for `origin/main`, or null when it cannot say. */
const defaultBranchOf = async (processes: AnInspectionOfTheWorkspace['processes'], clone: string): Promise<string | null> => {
  const named = await theAnswerOf(processes, clone, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  return named === null ? null : named.slice(named.indexOf('/') + 1)
}

/** Every line the workspace drifts by, in the order a reader fixes them: the clones, then their worktrees, then doubles. */
export async function theDriftInTheWorkspace(places: AnInspectionOfTheWorkspace): Promise<readonly string[]> {
  const named = theClonesIn(places)
  const clones = await Promise.all(named.map((clone) => inspected(places, clone)))
  const defaults = await Promise.all(named.map((clone) => defaultBranchOf(places.processes, clone)))
  const place = places.workspace.worktrees
  const own = clones.flatMap((clone, at) => driftOfAClone(clone, defaults[at] ?? null))
  const worktrees = place === null ? [] : clones.flatMap((clone) => driftOfAWorktrees(clone, place))
  return [...own, ...worktrees, ...driftOfADoubleClone(clones)]
}
