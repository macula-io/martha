// Asking git what a member is about to change (martha#562, port-map step 9).
//
// The workspace guard (../guard_workspace) decides from a call's own words and a few facts only git can say: the
// branches a clone has, which is what tells `checkout main` from `checkout src/app.ts`, and the worktrees a removal or
// a prune would meet, with the branch each of them is on. This slice asks for them, runs the guard, and hands back the
// refusal. All three seams of the guard end here — the relay's tool_called, the `git` shim on the member's PATH, and
// the clone's own ref-transaction hook — so the facts are asked one way and the answers are the same three answers.
//
// Every run carries Martha's own settings (../run_marthas_own_git) and reads only: `for-each-ref` lists branches,
// `worktree list` lists worktrees. Nothing here writes, fetches or prunes.
//
// It fails open, as the shim does. A git that cannot be run, or a line this slice cannot read, leaves the fact empty,
// and the rule that needed it does not fire: a member's shell must not be refused because Martha could not look. Each
// miss is visible twice — the shim writes its timeout to the member's row, and the scan
// (../check_the_workspace_matches_its_layout) reports what got through.
//
// Where it asks is the call's own business: the clone the call lands in for the branches, and for the worktrees the
// directory the call runs in or the worktree it names. A call with no directory it can name is asked nowhere, and its
// rules that need a fact do not fire.

import type { HostContract } from '../host_contract/host_contract.ts'
import { refuseACallInTheWorkspace, type AGuardedCall, type AListedWorktree, type TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import type { AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
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

/** The argument git takes to list a repository's worktrees with the branch each is on. */
const LIST_WORKTREES = ['worktree', 'list', '--porcelain']

/** Whether a directory stands in a place or under it: the place itself, or a path past the separator that ends it. */
const isUnder = (directory: string, place: string): boolean => directory === place || directory.startsWith(`${place}${sep}`)

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

/** The refusal a call meets, asking git what it needs to know: undefined when the layout holds, or cannot be looked at. */
export async function askGitWhatAMemberIsAboutToChange(request: AQuestionAboutACall): Promise<string | undefined> {
  const { host, workspace, member, calls } = request
  const clone = calls.map((call) => theCloneOf(call.directory, workspace.clones)).find((found) => found !== null) ?? null
  const where = calls.map(theWorktreeListedAt).find((found) => found !== null) ?? clone
  const [branches, worktrees] = await Promise.all([theBranchesOf(host, clone), theWorktreesOf(host, where)])
  const guarded: AGuardedCall = { calls, workspace, member, facts: { branches, worktrees } }
  return refuseACallInTheWorkspace(guarded)
}
