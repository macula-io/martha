// What the workspace's layout refuses of a git call (martha#562, port-map step 9).
//
// Three seams call this slice: the relay's tool_called for the shell line a call carries
// (../refuse_a_git_call_in_a_members_shell), the `git` a launch puts first on a member's PATH, and the clone's own
// ref-transaction hook (both ../guard_the_git_a_member_runs), all of them through
// ../ask_git_what_a_member_is_about_to_change, which is the slice those seams call for the facts git alone can say.
//
// Three rules, and no more. A clone stays on its default branch, so where the work of a branch belongs is a worktree
// (the first rule, and the second, which the first holds). And another member's worktree or branch is theirs: no member
// removes or moves one, and no role is exempt, the Supervisor included. The branch a clone starts on is one of the facts
// git hands in, so a call that puts a drifted clone back on it — the drift check's own advice — is not refused.
//
// The rule that the owner ruled on, 2026-11-17: **layout only**. This guard refuses a call that breaks where the work
// goes and a call that touches another member's worktree or branch. It never refuses a member's own push, and it never
// refuses a call that is merely sloppy: a clone off its default branch that git did not see being moved, a worktree
// outside the place the crew named, a repository cloned twice — those are tree facts, and the scan
// (../check_the_workspace_matches_its_layout) reports them.
//
// One push is refused, by the owner's ruling of 2026-11-20 on martha#601 ("Yes, list then cut (Recommended)": a push to
// main without the owner's yes is among what still stops): a push whose target is the default branch, as git names
// that branch for the origin (martha#925). Main moves through the landing tools only, whose fast-forward waits for the
// owner's yes. The rule reads the target each refspec names — `main`, `HEAD:main`, `+x:refs/heads/main`, `:main`, a
// `--delete` of it — on whatever remote the line names, since a URL is the same origin by another spelling. A target the
// line leaves to git is read too (martha#925 r=1): in a clone, which stays on its default branch and which nothing stops
// a member committing in, a push naming no refspec, or naming `HEAD` or `@`, writes that branch, so it is refused (a
// `--tags` with no refspec writes the tags alone, and passes); a
// clone a member drifted off it is refused the same, as the clone is no place a branch's work is pushed from. From a
// worktree the same words write the worktree's own branch and pass. A push of every branch (`--all`, `--branches`,
// `--mirror`) writes the default branch with the rest, and is refused from anywhere. Like the switch rule, it fails open
// when git cannot name the default branch, and Martha's own git runs, which carry its settings, pass the shim as before.
//
// The places come from the declaration's `house_rules`, and the members from its `members`; nothing here restates
// either. Everything a call is read from is the call's own words, read once by
// ../read_the_git_calls_in_a_shell_line, and the few tree facts only git can say are handed in: a rule that cannot see
// a fact does not fire. That is deliberate. A member's shell must not wait on, or be refused by, something the guard
// could not look at — failing open is recoverable, and every miss is visible in the member's row and in the scan.
//
// One limit follows from that and is stated here rather than discovered: a clone whose origin names no default branch
// (`symbolic-ref refs/remotes/origin/HEAD` answers nothing) leaves the switch rule unable to tell a way off the branch
// from a way back onto it, so the rule does not fire and the member's `checkout` of another branch is not refused. It
// is not a hole the guard can close on its own: refusing there would refuse the very call that puts the clone right.
// The drift check names such a clone until someone sets its head, which is the half of the pair that reports rather
// than refuses (Supervisor's ruling, 2026-11-18).
//
// Ownership is read the way ../open_and_finish_a_worktree writes it: every branch the crew's worktrees are on is
// `<member>/<slug>`, so the text before the first `/` is the member, compared with ../declare_crew's sameMemberName.
// One rule for both, so a branch this guard calls another member's is exactly one `worktree_finish` would not remove.

import { sameMemberName, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { isAbsolute, join, resolve, sep } from 'node:path'

/** The places a crew declared, and the member names it declares: the declaration's own `house_rules` and `members`. */
export interface TheWorkspace {
  readonly clones: string | null
  readonly worktrees: string | null
  readonly members: readonly string[]
}

/**
 * The places the crew declared for its clones and worktrees, with its members' names; undefined when it turned no
 * workspace layout on. A crew that declared none is guarded by nothing: the guard refuses breaks of a layout, and
 * there is none to break.
 */
export function theWorkspaceTheCrewDeclared(settings: CrewSettings): TheWorkspace | undefined {
  const { workspace_layout: on, clones, worktrees } = settings.house_rules
  if (on !== true || clones === null || worktrees === null) return undefined
  return { clones, worktrees, members: settings.members.map((member) => member.name) }
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
  /** The branch the clone starts on as its origin names it, which a call may put it back on; null when git cannot say. */
  readonly defaultBranch: string | null
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

/** The mark a refspec forces its update with, `+HEAD:main`, which names the same target as the plain one. */
const A_FORCED_REFSPEC = '+'

/** The refspecs that name what is checked out, and so leave the target to the branch the call runs on. */
const THE_CHECKED_OUT = new Set(['HEAD', '@'])

/** The option a push writes the tags with, and with no refspec beside it nothing else: no branch at all. */
const PUSH_THE_TAGS = '--tags'

/** The options a push writes every local branch with, the default branch among them. */
const PUSH_EVERY_BRANCH = new Set(['--all', '--branches', '--mirror'])

/** The commands whose words this guard reads, each named here rather than spelled at every use. */
const CHECKOUT = 'checkout'
const SWITCH = 'switch'
const BRANCH = 'branch'
const WORKTREE = 'worktree'
const PUSH = 'push'
const UPDATE_REF = 'update-ref'
const ADD = 'add'
const REMOVE = 'remove'
const MOVE = 'move'
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
/** Whether `directory` is `place` or under it: the one test of a place both the guard and the stale-clone note use. */
export const isUnder = (directory: string, place: string): boolean => directory === place || directory.startsWith(`${place}${sep}`)

/** The clone a directory lands in, as `worktree_open` lays one out: `<clones>/<org>/<repo>`, the first two words past it. */
export function theCloneOf(directory: string | null, clones: string | null): string | null {
  if (directory === null || clones === null || !isUnder(directory, clones)) return null
  const [org, repo] = directory.slice(clones.length + 1).split(sep)
  return org === undefined || org === '' || repo === undefined || repo === '' ? null : join(clones, org, repo)
}

/** Where the worktrees of the repository a call touches can be listed: the worktree it names, or the place it runs in. */
export function theWorktreeListedAt(call: AGitCall): string | null {
  if (call.command !== 'worktree') return call.directory
  const named = call.args.slice(1).find((word) => !word.startsWith('-'))
  return named !== undefined && isAbsolute(named) ? named : call.directory
}

/**
 * The line the member's row is told for the misses just read, in the guard's own words: how many calls it could not
 * judge, why, and the last one of them. The shim leaves them and the launcher folds them in
 * (../guard_the_git_a_member_runs), so a miss is visible where the owner reads the member.
 */
export function theMissesLine(misses: readonly string[]): string {
  const last = whatAMissSays(misses[misses.length - 1] ?? '')
  const calls = misses.length === 1 ? 'one git call' : `${String(misses.length)} git calls`
  const them = misses.length === 1 ? 'it' : 'them'
  const which = misses.length === 1 && last.what !== '' ? `: ${last.what}` : ''
  const why = last.why === '' ? '' : ` (${last.why})`
  return `the workspace guard could not judge ${calls}${why} and let ${them} run${which}`
}

/** What one line of the misses file says, as the judge wrote it; a line that cannot be read is its own reason. */
function whatAMissSays(line: string): { readonly what: string; readonly why: string } {
  const said = theMissTheLineHolds(line)
  // A whole line that is not what the judge writes is still a miss, and its own text is the reason it is one.
  return said ?? { what: '', why: line.trim() }
}

/** The miss a line holds, or undefined when the line is not one the judge wrote. */
function theMissTheLineHolds(line: string): { readonly what: string; readonly why: string } | undefined {
  try {
    const said: unknown = JSON.parse(line)
    if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined
    const { what, why } = said as Record<string, unknown>
    return typeof what === 'string' && typeof why === 'string' ? { what, why } : undefined
  } catch {
    return undefined
  }
}

/**
 * Where a word points from a directory: itself when absolute, past the directory when one is known.
 *
 * The answer is the path itself, normalised — `..` folded, a trailing separator dropped — because the words a call is
 * written with spell a place many ways and only one of them is the string git lists. A rule that compared the spellings
 * would let a worktree go by `worktree remove ../martha-ceres-1`, past the place it really names. `resolve` is what
 * drops the separator: `normalize` and `join` both keep a trailing one.
 */
const thePlaceOf = (word: string, from: string | null): string | null => (isAbsolute(word) ? resolve(word) : from === null ? null : resolve(from, word))

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

/**
 * Whether a branch is `member`'s own: a branch of this crew, owned by `member`. The trees a launch end reads for what a
 * killed run left are the worktrees this branch is on (#693), by this one rule rather than a second copy of it.
 */
export const isTheMembersBranch = (branch: string, workspace: TheWorkspace, member: string): boolean =>
  isAMembersBranch(branch, workspace.members) && !isAnotherMembers(branch, workspace, member)

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
  if (args.some((word) => (command === CHECKOUT ? MAKE_A_BRANCH : SWITCH_TO_A_NEW_BRANCH).has(word))) return `${where}: ${A_CLONE_IS_NO_PLACE_TO_BRANCH}`
  // A switch back to the branch the clone starts on is the call that puts a drifted clone right, and is what the drift
  // check asks for: it is not the rule's. One the rule cannot read the default branch for fires nothing, as it cannot
  // tell a way off from a way back.
  const switching = theWordsNotOptions(args).find((word) => facts.branches.includes(word))
  const leavesTheDefault = facts.defaultBranch !== null && switching !== undefined && switching !== facts.defaultBranch
  return leavesTheDefault ? `${where}: ${A_CLONE_IS_NO_PLACE_TO_BRANCH}` : undefined
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

/** The refusal a `worktree remove` or `worktree move` is, when the worktree it names is on another member's branch. */
function refusalOfAWorktreeTaken(words: readonly string[], call: AGitCall, request: AGuardedCall): string | undefined {
  const path = words.find((word) => !isAnOption(word))
  if (path === undefined) return undefined
  const place = thePlaceOf(path, call.directory)
  const listed = request.facts.worktrees.find((worktree) => thePlaceOf(worktree.path, null) === place)
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

/** The branch one refspec of a push writes on the remote: the part past its colon, or the whole when it has none. */
function theTargetOfARefspec(refspec: string): string {
  const plain = refspec.startsWith(A_FORCED_REFSPEC) ? refspec.slice(A_FORCED_REFSPEC.length) : refspec
  const colon = plain.indexOf(A_DELETED_REFSPEC)
  return theBranchOf(colon === -1 ? plain : plain.slice(colon + A_DELETED_REFSPEC.length))
}

/**
 * Whether a push leaves its target to the branch checked out where it runs: no refspec past the remote, or one naming
 * `HEAD` or `@` without a colon (martha#925 r=1). A push of the tags with no refspec writes the tags alone.
 */
function leavesTheTargetToGit(refspecs: readonly string[], args: readonly string[]): boolean {
  if (refspecs.length === 0) return !args.includes(PUSH_THE_TAGS)
  return refspecs.some((refspec) => THE_CHECKED_OUT.has(refspec.startsWith(A_FORCED_REFSPEC) ? refspec.slice(A_FORCED_REFSPEC.length) : refspec))
}

/**
 * The refusal a push onto the default branch is (martha#925): undefined when git names none, or the push writes it
 * neither by name, nor as the clone's own branch, nor among every branch.
 */
function refusalOfAPushOntoTheDefault(args: readonly string[], facts: TheFacts, inAClone: boolean): string | undefined {
  const theDefault = facts.defaultBranch
  if (theDefault === null) return undefined
  const refspecs = theWordsNotOptions(args).slice(1)
  const writesIt = refspecs.map(theTargetOfARefspec).includes(theDefault) || args.some((word) => PUSH_EVERY_BRANCH.has(word)) || (inAClone && leavesTheTargetToGit(refspecs, args))
  return writesIt
    ? `${theDefault} is the default branch, and a push onto it waits for the owner's yes: land the work with ${LAND_BATCH}, then ${FAST_FORWARD_AFTER_THE_OWNERS_YES} once the owner said yes. Nothing was pushed.`
    : undefined
}

/**
 * The refusal a push is, when it prunes a remote's refs nobody named, deletes another member's branch there, or
 * targets the default branch. A prune takes every remote branch the push does not name, and the line names none of
 * them, so it is refused outright.
 */
function refusalOfAPush(call: AGitCall, request: AGuardedCall): string | undefined {
  const args = call.args
  if (args.includes(PRUNE)) return `a push that prunes takes every remote branch it does not name, another member's among them: push the one ref you mean, or delete your own by name.`
  return refusalOfTheBranches(theRefsAPushDeletes(args), request.workspace, request.member) ?? refusalOfAPushOntoTheDefault(args, request.facts, isInAClone(call, request.workspace))
}

/** The refusal a `branch` call is when it deletes or moves a branch: none when it only reads or makes one. */
function refusalOfABranchDeleteOrMove(args: readonly string[], request: AGuardedCall): string | undefined {
  const touches = args.some((word) => DELETE_A_BRANCH.has(word) || MOVE_A_BRANCH.has(word))
  return touches ? refusalOfTheBranches(theWordsNotOptions(args), request.workspace, request.member) : undefined
}

/** What a `worktree` call does to another member's worktree: a removal or a move named by path, or a prune of stale ones. */
function refusalOfAWorktreeCall(call: AGitCall, request: AGuardedCall): string | undefined {
  const [takes, ...words] = call.args
  if (takes === REMOVE || takes === MOVE) return refusalOfAWorktreeTaken(words, call, request)
  return takes === WORKTREE_PRUNE ? refusalOfAWorktreePrune(request) : undefined
}

/** What one call does to another member's worktree or branch, by its command word: none for anything else. */
function refusalOfAnotherMembers(call: AGitCall, request: AGuardedCall): string | undefined {
  if (call.command === BRANCH) return refusalOfABranchDeleteOrMove(call.args, request)
  if (call.command === UPDATE_REF) return call.args.includes('-d') ? refusalOfTheBranches(theWordsNotOptions(call.args), request.workspace, request.member) : undefined
  if (call.command === WORKTREE) return refusalOfAWorktreeCall(call, request)
  return call.command === PUSH ? refusalOfAPush(call, request) : undefined
}

/** Whether a call runs inside the crew's clone place. */
const isInAClone = (call: AGitCall, workspace: TheWorkspace): boolean => call.directory !== null && workspace.clones !== null && isUnder(call.directory, workspace.clones)

/** The first refusal one call meets: where it makes a branch, then whose worktree or branch it touches. */
function refusalOfACall(call: AGitCall, request: AGuardedCall): string | undefined {
  const inAClone = isInAClone(call, request.workspace)
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
