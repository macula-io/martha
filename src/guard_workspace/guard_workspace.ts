// What the workspace's layout refuses of a git call (martha#562, port-map step 9).
//
// NOT ENFORCED YET. No seam calls this slice: package 1 lands the rules, their tests and the facts they need, and
// package 2 wires the three seams (the relay's tool_called, the `git` shim on the member's PATH, and the clone's
// ref-transaction hook) through ../ask_git_what_a_member_is_about_to_change, which is the slice those seams call.
//
// Three rules, and no more. A clone stays on its default branch, so where the work of a branch belongs is a worktree
// (the first rule, and the second, which the first holds). And another member's worktree or branch is theirs: no member
// removes or moves one, and no role is exempt, the Supervisor included.
//
// The rule that the owner ruled on, 2026-11-17: **layout only**. This guard refuses a call that breaks where the work
// goes and a call that touches another member's worktree or branch. It never refuses a member's own push, and it never
// refuses a call that is merely sloppy: a clone off its default branch that git did not see being moved, a worktree
// outside the place the crew named, a repository cloned twice — those are tree facts, and the scan
// (../check_the_workspace_matches_its_layout) reports them.
//
// The places come from the declaration's `house_rules`, and the members from its `members`; nothing here restates
// either. Everything a call is read from is the call's own words, read once by
// ../read_the_git_calls_in_a_shell_line, and the few tree facts only git can say are handed in: a rule that cannot see
// a fact does not fire. That is deliberate. A member's shell must not wait on, or be refused by, something the guard
// could not look at — failing open is recoverable, and every miss is visible in the member's row and in the scan.
//
// Ownership is read the way ../open_and_finish_a_worktree writes it: every branch the crew's worktrees are on is
// `<member>/<slug>`, so the text before the first `/` is the member, compared with ../declare_crew's sameMemberName.
// One rule for both, so a branch this guard calls another member's is exactly one `worktree_finish` would not remove.

import { sameMemberName } from '../declare_crew/declare_crew.ts'
import type { AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { sep } from 'node:path'

/** The places a crew declared, and the member names it declares: the declaration's own `house_rules` and `members`. */
export interface TheWorkspace {
  readonly clones: string | null
  readonly worktrees: string | null
  readonly members: readonly string[]
}

/** A worktree as git lists it: where it is, the branch it is on, and whether only its record is left. */
export interface AListedWorktree {
  readonly path: string
  readonly branch: string | null
  /** Whether a prune would drop it: its directory is gone and only the record stands. */
  readonly prunable: boolean
}

/** What only git can say about the places a call touches, asked by ../ask_git_what_a_member_is_about_to_change. */
export interface TheFacts {
  /** The branches the clone the call lands in has: what tells `checkout main` from `checkout src/`. */
  readonly branches: readonly string[]
  /** The worktrees git lists for the crew's worktree place, and for the clone a prune would sweep. */
  readonly worktrees: readonly AListedWorktree[]
}

/** The git calls one tool call makes, the crew's places and members, the member acting, and what git said. */
export interface AGuardedCall {
  readonly calls: readonly AGitCall[]
  readonly workspace: TheWorkspace
  readonly member: string
  readonly facts: TheFacts
}

/** The prefix a branch ref carries, which a call may write or leave off: `refs/heads/hygiea/562` and `hygiea/562`. */
const A_BRANCH_REF = 'refs/heads/'

/** The words a call writes its options with, and the ones a rule reads by name: a branch made, a branch removed or moved. */
const MAKE_A_BRANCH = new Set(['-b', '-B', '--orphan'])
const SWITCH_TO_A_NEW_BRANCH = new Set(['-c', '-C'])
const DELETE_A_BRANCH = new Set(['-d', '-D', '--delete'])
const MOVE_A_BRANCH = new Set(['-m', '-M', '--move'])
const DELETE_A_REMOTE_REF = new Set(['-d', '--delete'])
const PRUNE = '--prune'

/** The refspec a push deletes a remote ref with: an empty source, `git push origin :gone`, and nothing before the colon. */
const A_DELETED_REFSPEC = ':'

/** The commands whose words this guard reads, each named here rather than spelled at every use. */
const CHECKOUT = 'checkout'
const SWITCH = 'switch'
const BRANCH = 'branch'
const WORKTREE = 'worktree'
const PUSH = 'push'
const UPDATE_REF = 'update-ref'
const ADD = 'add'
const REMOVE = 'remove'
const WORKTREE_PRUNE = 'prune'

/** What a call is told when it would make a clone stop being a clone of its default branch. */
const A_CLONE_IS_NO_PLACE_TO_BRANCH =
  'this is a clone, and a clone stays on its default branch. Open a worktree with worktree_open and do the branch work there.'

/** What a call is told when it would put a worktree inside a clone, where the next fetch would sweep it. */
const A_WORKTREE_IS_NOT_MADE_IN_A_CLONE =
  'a worktree is not made inside a clone: open one with worktree_open, which puts it in the place this crew declared.'

/** Whether a word is an option rather than git's argument: `-d`, `--prune`, `--` alone included. */
const isAnOption = (word: string): boolean => word.startsWith('-')

/** The words that are not options: the branches, paths and refspecs git is given. */
const theWordsNotOptions = (words: readonly string[]): readonly string[] => words.filter((word) => !isAnOption(word))

/** Whether a directory is a place or stands under it: the place itself, or a path past the separator that ends it. */
const isUnder = (directory: string, place: string): boolean => directory === place || directory.startsWith(`${place}${sep}`)

/** Where a word points from a directory: itself when absolute, past the directory when one is known. */
const thePlaceOf = (word: string, from: string | null): string | null => (word.startsWith(sep) ? word : from === null ? null : `${from}${sep}${word}`)

/** A branch's own name, without the ref prefix a call may write in front of it. */
const theBranchOf = (ref: string): string => (ref.startsWith(A_BRANCH_REF) ? ref.slice(A_BRANCH_REF.length) : ref)

/** The member a branch belongs to: the text before its first `/`, which is what worktree_open puts there. */
const theMemberOf = (branch: string): string | null => {
  const plain = theBranchOf(branch)
  const slash = plain.indexOf('/')
  return slash === -1 ? null : plain.slice(0, slash)
}

/** Whether a branch is a member of this crew's: a `main`, or a `feature/x`, belongs to no member here. */
const isAMembersBranch = (branch: string, members: readonly string[]): boolean => {
  const member = theMemberOf(branch)
  return member !== null && members.some((name) => sameMemberName(name, member))
}

/** Whether a branch is another member's than the one acting: the crew's rule that a branch's owner is its first word. */
const isAnotherMembers = (branch: string, workspace: TheWorkspace, member: string): boolean => {
  if (!isAMembersBranch(branch, workspace.members)) return false
  const owner = theMemberOf(branch)
  return owner !== null && !sameMemberName(owner, member)
}

/** The refusal a call of another member's branch is, named for the branch: what the caller is told, or undefined. */
const refusalOfAnothersBranch = (branch: string, workspace: TheWorkspace, member: string): string | undefined =>
  isAnotherMembers(branch, workspace, member)
    ? `${theBranchOf(branch)} is another member's branch, and it is theirs: only ${theMemberOf(branch)} removes or moves it.`
    : undefined

/** The first refusal among the branches a call names, each read as a branch of a member rather than of nobody. */
const refusalOfTheBranches = (branches: readonly string[], workspace: TheWorkspace, member: string): string | undefined => {
  const refusals = branches.map((branch) => refusalOfAnothersBranch(branch, workspace, member))
  return refusals.find((refusal) => refusal !== undefined)
}

/** A call that makes a branch where the work of a branch does not belong: a clone, whose place is no place to branch. */
function refusalOfASwitchInAClone(command: string, args: readonly string[], facts: TheFacts, where: string): string | undefined {
  const makes = command === CHECKOUT ? MAKE_A_BRANCH : SWITCH_TO_A_NEW_BRANCH
  const switching = theWordsNotOptions(args).find((word) => facts.branches.includes(word))
  const made = args.find((word) => makes.has(word))
  return switching === undefined && made === undefined ? undefined : `${where}: ${A_CLONE_IS_NO_PLACE_TO_BRANCH}`
}

/** The refusal a `branch` call in a clone is, when it makes a branch rather than reading one: `-a`, `--list` read. */
const refusalOfABranchInAClone = (args: readonly string[], where: string): string | undefined => {
  const reading = args.every((word) => isAnOption(word)) || args[0]?.startsWith('--') === true
  const deletesOrMoves = args.some((word) => DELETE_A_BRANCH.has(word) || MOVE_A_BRANCH.has(word))
  return reading || deletesOrMoves ? undefined : `${where}: ${A_CLONE_IS_NO_PLACE_TO_BRANCH}`
}

/** The refusal a `worktree add` is, when the path it names stands inside a clone. */
function refusalOfAWorktreeInAClone(args: readonly string[], call: AGitCall, workspace: TheWorkspace): string | undefined {
  const path = args.find((word) => !isAnOption(word) && word !== ADD)
  const place = path === undefined ? null : thePlaceOf(path, call.directory)
  const inside = place !== null && workspace.clones !== null && isUnder(place, workspace.clones)
  return inside ? A_WORKTREE_IS_NOT_MADE_IN_A_CLONE : undefined
}

/** What one call does inside a clone, by its command word: the place a branch's work belongs read as the only place. */
function refusalInsideAClone(call: AGitCall, facts: TheFacts, where: string): string | undefined {
  if (call.command === CHECKOUT || call.command === SWITCH) return refusalOfASwitchInAClone(call.command, call.args, facts, where)
  if (call.command === BRANCH) return refusalOfABranchInAClone(call.args, where)
  return undefined
}

/** The refusal a `worktree remove` is, when the branch the worktree is on belongs to another member. */
function refusalOfAWorktreeRemoval(args: readonly string[], call: AGitCall, request: AGuardedCall): string | undefined {
  const path = args.find((word) => !isAnOption(word) && word !== REMOVE)
  if (path === undefined) return undefined
  const place = thePlaceOf(path, call.directory)
  const listed = request.facts.worktrees.find((worktree) => worktree.path === place || worktree.path === path)
  return listed?.branch == null ? undefined : refusalOfAnothersBranch(listed.branch, request.workspace, request.member)
}

/** The refusal a `worktree prune` is, when a worktree it would drop is on another member's branch. */
function refusalOfAWorktreePrune(request: AGuardedCall): string | undefined {
  const branches = request.facts.worktrees.filter((worktree) => worktree.prunable).flatMap((worktree) => (worktree.branch === null ? [] : [worktree.branch]))
  return refusalOfTheBranches(branches, request.workspace, request.member)
}

/** The refs a push deletes: every word past the remote when the call asks for a delete, written plainly or as `:ref`. */
function theRefsAPushDeletes(args: readonly string[]): readonly string[] {
  const words = theWordsNotOptions(args)
  const deletes = args.some((word) => DELETE_A_REMOTE_REF.has(word)) || words.some((word) => word.startsWith(A_DELETED_REFSPEC))
  if (!deletes) return []
  return words.slice(1).map((word) => (word.startsWith(A_DELETED_REFSPEC) ? word.slice(A_DELETED_REFSPEC.length) : word)).filter((ref) => ref !== '')
}

/**
 * The refusal a push is, when it prunes a remote's refs nobody named, or deletes another member's branch there. A prune
 * takes every remote branch the push does not name, and the line names none of them, so it is refused outright.
 */
function refusalOfAPush(args: readonly string[], request: AGuardedCall): string | undefined {
  if (args.includes(PRUNE)) return `a push that prunes takes every remote branch it does not name, another member's among them: push the one ref you mean, or delete your own by name.`
  return refusalOfTheBranches(theRefsAPushDeletes(args), request.workspace, request.member)
}

/** The refusal a `branch` call is when it deletes or moves a branch: none when it only reads or makes one. */
function refusalOfABranchDeleteOrMove(args: readonly string[], request: AGuardedCall): string | undefined {
  const touches = args.some((word) => DELETE_A_BRANCH.has(word) || MOVE_A_BRANCH.has(word))
  return touches ? refusalOfTheBranches(theWordsNotOptions(args), request.workspace, request.member) : undefined
}

/** What a `worktree` call does to another member's worktree: a removal named by path, or a prune that takes stale ones. */
function refusalOfAWorktreeCall(call: AGitCall, request: AGuardedCall): string | undefined {
  if (call.args[0] === REMOVE) return refusalOfAWorktreeRemoval(call.args, call, request)
  return call.args[0] === WORKTREE_PRUNE ? refusalOfAWorktreePrune(request) : undefined
}

/** What one call does to another member's worktree or branch, by its command word: none for anything else. */
function refusalOfAnotherMembers(call: AGitCall, request: AGuardedCall): string | undefined {
  if (call.command === BRANCH) return refusalOfABranchDeleteOrMove(call.args, request)
  if (call.command === UPDATE_REF) return call.args.includes('-d') ? refusalOfTheBranches(theWordsNotOptions(call.args), request.workspace, request.member) : undefined
  if (call.command === WORKTREE) return refusalOfAWorktreeCall(call, request)
  return call.command === PUSH ? refusalOfAPush(call.args, request) : undefined
}

/** The first refusal one call meets: where it makes a branch, then whose worktree or branch it touches. */
function refusalOfACall(call: AGitCall, request: AGuardedCall): string | undefined {
  const inAClone = call.directory !== null && request.workspace.clones !== null && isUnder(call.directory, request.workspace.clones)
  const addsAWorktree = call.command === WORKTREE && call.args[0] === ADD
  const inside = addsAWorktree ? refusalOfAWorktreeInAClone(call.args, call, request.workspace) : inAClone ? refusalInsideAClone(call, request.facts, `a call in ${call.directory}`) : undefined
  return inside ?? refusalOfAnotherMembers(call, request)
}

/** The refusal this call meets, or undefined when the workspace's layout says nothing against it. */
export function refuseACallInTheWorkspace(request: AGuardedCall): string | undefined {
  const refusals = request.calls.map((call) => refusalOfACall(call, request))
  return refusals.find((refusal) => refusal !== undefined)
}

/**
 * The refusal one ref update meets as the clone's own hook sees it (seam (c)): a delete of a branch another member owns,
 * which reached git by an alias, a hook or git's absolute path, past the shell the shim guards.
 */
export function refuseARefUpdate(update: { readonly ref: string; readonly deletes: boolean }, workspace: TheWorkspace, member: string): string | undefined {
  if (!update.deletes || !update.ref.startsWith(A_BRANCH_REF)) return undefined
  return refusalOfAnothersBranch(update.ref, workspace, member)
}
