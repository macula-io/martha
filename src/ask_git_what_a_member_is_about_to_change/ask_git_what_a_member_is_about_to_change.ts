// Asking git what a member is about to change (martha#562, port-map step 9).
//
// A host adapter, not machine glue (owner ruling 2026-11-17, package 1): host glue imports only the host contract,
// node:* and its own folder, and no slice imports the glue, so a slice that runs the guard over a shared reader cannot
// sit there. A git-asking adapter that uses core slices is what the adapters are for.
//
// The workspace guard (../guard_workspace) decides from a call's own words and a few facts only git can say: the
// branches a clone has, which is what tells `checkout main` from `checkout src/app.ts`, and the worktrees a removal or
// a prune would meet, with the branch each of them is on. This slice asks for them, runs the guard, and hands back the
// refusal. All three seams of the guard end here — the relay's tool_called, the `git` first on the member's PATH, and
// the clone's own ref-transaction hook — so the facts are asked one way and the answers are the same three answers.
// The first asks about a shell line (seam a, ../refuse_a_git_call_in_a_members_shell); the other two ask from the
// launch's own guard (../guard_the_git_a_member_runs), and seam (c) needs no fact git alone can say.
//
// Every run carries Martha's own settings (../run_marthas_own_git) and reads only: `for-each-ref` lists branches,
// `symbolic-ref` names the branch a clone starts on, `worktree list` lists worktrees. Nothing here writes, fetches or
// prunes.
//
// It fails open, as the shim does. A git that cannot be run, or a line this slice cannot read, leaves the fact empty,
// and the rule that needed it does not fire: a member's shell must not be refused because Martha could not look. A miss
// the shim itself met is visible twice — the shim appends a line to the launch's misses file and the launcher folds it
// into the member's row (../guard_the_git_a_member_runs), and the scan
// (../check_the_workspace_matches_its_layout) reports what got through.
//
// Where it asks is the call's own business: the clone the call lands in for the branches, and for the worktrees the
// directory the call runs in or the worktree it names. A call with no directory it can name is asked nowhere, and its
// rules that need a fact do not fire.

import type { HostContract } from '../host_contract/host_contract.ts'
import { refuseACallInTheWorkspace, type AGuardedCall, type AListedWorktree, type TheFacts, type TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import type { AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, sep } from 'node:path'

/** A call to judge: the git calls it makes, the member making it, the crew's places, and the host that runs git. */
export interface AQuestionAboutACall {
  readonly host: Pick<HostContract, 'processes'>
  readonly calls: readonly AGitCall[]
  readonly workspace: TheWorkspace
  readonly member: string
}

/** The porcelain line git prints for a worktree its record names but whose directory no longer stands. */
const A_PRUNED_RECORD = 'prunable'

/** The porcelain line a worktree's branch is on: `branch refs/heads/<name>`. */
const A_BRANCH_LINE = 'branch '

/** The porcelain line naming the worktree itself: `worktree <path>`. */
const A_WORKTREE_LINE = 'worktree '

/** The argument git takes to list a repository's branches by their own names. */
const LIST_BRANCHES = ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']

/** The argument git takes to name the branch the clone starts on, as its origin has it: `origin/<name>`. */
const THE_DEFAULT_BRANCH = ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']

/** The argument git takes to list a repository's worktrees with the branch each is on. */
const LIST_WORKTREES = ['worktree', 'list', '--porcelain']

/** Whether a directory stands in a place or under it: the place itself, or a path past the separator that ends it. */
const isUnder = (directory: string, place: string): boolean => directory === place || directory.startsWith(`${place}${sep}`)

/**
 * The path a place really is, with every link resolved, or the path as it was given when it cannot be read (martha#79).
 *
 * Git answers with the paths it resolved, and a shell names the paths its owner typed: on a machine whose temp or work
 * place is reached through a link, such as macOS's `/var` -> `/private/var`, the two spellings of one directory are
 * different strings. Both sides are asked here for the path itself, so a call, the place it runs in and the worktree git
 * lists are compared as what they are and not as what they are called.
 */
const thePathItself = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** A call as the rules read it: its directory and every path it names, asked for the path itself. */
const theCallResolved = (call: AGitCall): AGitCall => ({
  ...call,
  directory: call.directory === null ? null : thePathItself(call.directory),
  args: call.args.map((word) => (isAbsolute(word) ? thePathItself(word) : word)),
})

/** The clone a directory lands in, as `worktree_open` lays one out: `<clones>/<org>/<repo>`, the first two words past it. */
function theCloneOf(directory: string | null, clones: string | null): string | null {
  if (directory === null || clones === null || !isUnder(directory, clones)) return null
  const [org, repo] = directory.slice(clones.length + 1).split(sep)
  return org === undefined || org === '' || repo === undefined || repo === '' ? null : join(clones, org, repo)
}

/** Where the worktrees of the repository a call touches can be listed: the worktree it names, or the place it runs in. */
function theWorktreeListedAt(call: AGitCall): string | null {
  if (call.command !== 'worktree') return call.directory
  const named = call.args.slice(1).find((word) => !word.startsWith('-'))
  return named !== undefined && isAbsolute(named) ? named : call.directory
}

/** The words git printed, one line each, or none when it could not be run or did not end well. */
async function linesGitPrinted(host: AQuestionAboutACall['host'], cwd: string, args: readonly string[]): Promise<readonly string[]> {
  const outcome = await host.processes.run({ command: 'git', args: marthasOwnGitArgs(args), cwd }).catch(() => undefined)
  return outcome === undefined || outcome.exit_code !== 0 ? [] : outcome.stdout.split('\n')
}

/** The branches a clone has, by their own names: `main` among them, since a clone that starts on it has it as a ref. */
const theBranchesOf = async (host: AQuestionAboutACall['host'], clone: string | null): Promise<readonly string[]> =>
  clone === null ? [] : (await linesGitPrinted(host, clone, LIST_BRANCHES)).map((line) => line.trim()).filter((line) => line !== '')

/** The branch a clone starts on, as its own origin names it: `main` for `origin/main`, or null when git cannot say. */
async function theDefaultBranchOf(host: AQuestionAboutACall['host'], clone: string | null): Promise<string | null> {
  if (clone === null) return null
  const named = (await linesGitPrinted(host, clone, THE_DEFAULT_BRANCH)).map((line) => line.trim()).find((line) => line !== '')
  return named === undefined ? null : named.slice(named.indexOf('/') + 1)
}

/** One worktree of a porcelain block: where it is, the branch it is on, and whether only its record is left. */
function theWorktreeOf(block: readonly string[]): AListedWorktree | null {
  const path = block.find((line) => line.startsWith(A_WORKTREE_LINE))?.slice(A_WORKTREE_LINE.length).trim()
  if (path === undefined) return null
  const branch = block.find((line) => line.startsWith(A_BRANCH_LINE))?.slice(A_BRANCH_LINE.length).trim() ?? null
  return { path, branch, prunable: block.some((line) => line.startsWith(A_PRUNED_RECORD)) }
}

/** The worktrees git lists where a call touches them, a block each, or none when it cannot be asked there. */
async function theWorktreesOf(host: AQuestionAboutACall['host'], where: string | null): Promise<readonly AListedWorktree[]> {
  if (where === null) return []
  const lines = await linesGitPrinted(host, where, LIST_WORKTREES)
  const blocks: string[][] = []
  for (const line of lines) {
    if (line.startsWith(A_WORKTREE_LINE)) blocks.push([line])
    else if (line.trim() !== '' && blocks.length > 0) blocks[blocks.length - 1]?.push(line)
  }
  return blocks.flatMap((block) => theWorktreeOf(block) ?? [])
}

/** Every fact the rules need, asked of the clone the call lands in and the place its worktrees are listed: asked together. */
async function theFactsOf(host: AQuestionAboutACall['host'], clone: string | null, where: string | null): Promise<TheFacts> {
  const [branches, defaultBranch, worktrees] = await Promise.all([theBranchesOf(host, clone), theDefaultBranchOf(host, clone), theWorktreesOf(host, where)])
  return { branches, defaultBranch, worktrees }
}

/** The refusal a call meets, asking git what it needs to know: undefined when the layout holds, or cannot be looked at. */
export async function askGitWhatAMemberIsAboutToChange(request: AQuestionAboutACall): Promise<string | undefined> {
  const { host, member } = request
  // The places and the calls are asked for the path itself before anything is compared: git answers with resolved
  // paths, and a member's shell names the path it typed (martha#79).
  const workspace: TheWorkspace = {
    ...request.workspace,
    clones: request.workspace.clones === null ? null : thePathItself(request.workspace.clones),
    worktrees: request.workspace.worktrees === null ? null : thePathItself(request.workspace.worktrees),
  }
  const calls = request.calls.map(theCallResolved)
  const clone = calls.map((call) => theCloneOf(call.directory, workspace.clones)).find((found) => found !== null) ?? null
  const where = calls.map(theWorktreeListedAt).find((found) => found !== null) ?? clone
  const guarded: AGuardedCall = { calls, workspace, member, facts: await theFactsOf(host, clone, where) }
  return refuseACallInTheWorkspace(guarded)
}
