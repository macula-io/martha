// Open and finish a branch worktree (martha#256, slice 4).
//
// This exists so a member works in a checkout of its own without making one by hand: `worktree_open` puts
// `<worktrees>/<repo>-<slug>` on a new branch `<member>/<slug>` from the origin's default branch, beside the
// clone at `<clones>/<org>/<repo>`, and `worktree_finish` takes it away again once the package closes.
//
// Both are a convenience and nothing enforces them: under the owner's reset of 2026-11-11 the safety is review
// plus the owner's yes on every push and tag, not a shim in front of git (the design on martha#256 says so). The
// refusals that stay are the ones that keep work from being lost, and they are not a guard: a worktree on a branch
// Martha's own naming did not make is refused, because removing it would delete a branch that belongs to someone
// else; and a worktree with uncommitted changes, or with a commit that is on no remote branch, is not removed,
// because its branch is deleted right after and the work would go with it.
//
// Every path is built from a validated name — a repo is `org/name`, a slug is lowercase letters, digits and
// hyphens, and the member is one the declaration names — so no argument can steer a worktree out of the places
// the crew declared. git runs carry marthasOwnGitArgs (../run_marthas_own_git) and go through the contract's
// processes.run, as every other run of Martha's own git does.
//
// Two refusals were added for what a finish used to lose or could not read (martha#915). An ignored entry — a build
// output, a recording, a node_modules — is read with `status --ignored`, and is thrown away only when the call names
// it in discard_ignored; anything ignored and unnamed refuses the finish by name, so nothing goes silently. And the
// branch on origin is removed when the default branch holds its WORK, not only its tip: an ancestor counts, and so does
// every file the branch changed being on the default branch exactly as the branch left it, which is what a squash or a
// rebase landing leaves behind.
//
// Finishing sends one thing over the network: the deletion of the branch on origin. That is an outward act, so it
// goes out through the ledger (../log_ledger, martha#25): its row is kept first, and when the store will not keep
// it, git is not run. The package it is kept under is named by the member, as it is on every other row.

import { join } from 'node:path'

import { FINISH_A_MEMBERS_WORKTREE, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import { WORK_PACKAGE, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { PackagePaused, RecoveryDecided, sendAnActAndRecover, type AnInspection } from '../recover_a_failed_act/recover_a_failed_act.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'

/** The tools this slice registers. */
export const WORKTREE_OPEN = 'worktree_open'
export const WORKTREE_FINISH = 'worktree_finish'

/** A repository as it is cloned under `clones`: `org/name`, neither part able to be a dot or to climb out. */
export const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/** The end of a worktree's path and of its branch: lowercase, so one slug names one directory on any machine. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/

/** What a crew that declared no workspace layout is told, instead of a worktree in a place nobody named. */
export const NO_LAYOUT =
  'this crew declares no workspace layout: put "workspace_layout": true with "clones" and "worktrees" in its house rules, then start the member again.'

/** What the two tools need: the host's own git, the ledger's store, the crew's declaration, and the member they answer for. */
export interface WorktreesRequest {
  readonly host: Pick<HostContract, 'processes'> & LedgerHost
  readonly settings: CrewSettings
  /** The member whose branches these are: the launcher starts it, so the model never supplies this. */
  readonly member: string
}

/** Whoever an act is sent as: the package it is kept under, and the member sending it. */
interface TheAct {
  readonly package: string
  readonly member: string
}

/** The three places one call works in, once every name it was given has been read. */
interface Places {
  readonly clone: string
  readonly path: string
  readonly branch: string
}

/**
 * What the two tools answer: what was done, or why nothing was (martha#256 r=3). The split is the one every acting
 * slice keeps, and it has to survive the seam: a refusal decided here and handed on as a string would reach the
 * member as a success, so a member (and anything that counts refusals) could not tell "removed" from "not removed,
 * because it still holds 3 unpushed commits".
 */
export type WorktreeAnswer = { readonly told: string } | { readonly refused: string }
/** The refusal on its own: what an inner step answers when it names why nothing is done. */
type Refused = { readonly refused: string }
const no = (why: string): Refused => ({ refused: why })

/** What `worktree_open` says it is for, as the launcher answers the mod's ask (martha#256). */
export const WORKTREE_OPEN_DESCRIPTION = 'Makes a worktree for one package of a repository, on a new branch of your own, and answers where it is.'

/** What `worktree_finish` says it is for (martha#256, martha#915, martha#962). */
export const WORKTREE_FINISH_DESCRIPTION =
  'Removes a worktree and its branch once its work has landed, and names the package the deletion is kept under. Refused while it holds work no remote has, or an ignored entry the call did not name in discard_ignored. ' +
  'It takes a live worktree (repo and slug) or a branch whose worktree is already gone (repo and branch), and a member finishes its own without more; ' +
  "another member's is closed on that member's word, by a session whose role the crew's table grants finish_a_members_worktree, with owner_ok=1."

/** The repository a call names, as org/name, or why it names none. */
function theRepoNamed(args: Readonly<Record<string, unknown>>): { readonly repo: string } | Refused {
  const repo = args['repo']
  if (typeof repo !== 'string' || !REPO.test(repo)) return no(`${JSON.stringify(repo)} is not a repository, as org/name.`)
  return { repo }
}

/** The slug a call names, lowercase so one slug names one directory, or why it names none. */
function theSlugNamed(args: Readonly<Record<string, unknown>>): { readonly slug: string } | Refused {
  const slug = args['slug']
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    return no(`${JSON.stringify(slug)} is not a slug: lowercase letters, digits and hyphens, up to 64 of them.`)
  }
  return { slug }
}

/** The places one call works in, or why the crew and the arguments name none. */
function placesOf(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Places | Refused {
  const { clones, worktrees } = request.settings.house_rules
  if (clones === null || worktrees === null) return no(NO_LAYOUT)
  const repo = theRepoNamed(args)
  if ('refused' in repo) return repo
  const slug = theSlugNamed(args)
  if ('refused' in slug) return slug
  if (!request.settings.members.some((member) => member.name === request.member)) {
    return no(`${request.member} is not a member of this crew.`)
  }
  return { clone: join(clones, repo.repo), path: worktreePathIn(worktrees, repo.repo, slug.slug), branch: `${request.member}/${slug.slug}` }
}

/** A worktree's directory: the repository's own name and the slug, under the crew's worktrees place. */
const worktreePathIn = (worktrees: string, repo: string, slug: string): string => join(worktrees, `${repo.slice(repo.indexOf('/') + 1)}-${slug}`)

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: WorktreesRequest['host'], cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: 'git', args: marthasOwnGitArgs(args), cwd })
}

/** What git said, when it ended well; undefined when it did not. */
async function gitSaid(host: WorktreesRequest['host'], cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout.trim() : undefined
}

/**
 * What git said byte for byte, when it ended well; undefined when it did not. A NUL-separated name list is read
 * through this: `trim()` would take a space off the first or last name, and a name that does not match itself passes
 * as held (review r=1).
 */
async function gitSaidAsIs(host: WorktreesRequest['host'], cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout : undefined
}

/** What git said it could not do, as one line: its own words, or the status it ended with when it said none. */
function saidBy(outcome: ProcessOutcome): string {
  const words = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
  return words === '' ? `git ended with ${String(outcome.exit_code)}` : (words.split('\n')[0] ?? words)
}

/** The origin's default branch as git names it locally, `origin/main`; undefined when the clone cannot say. */
const defaultBranchIn = (host: WorktreesRequest['host'], clone: string): Promise<string | undefined> =>
  gitSaid(host, clone, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])

export async function openAWorktree(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Promise<WorktreeAnswer> {
  const places = placesOf(request, args)
  if ('refused' in places) return places
  const { host } = request
  const fetched = await git(host, places.clone, ['fetch', '--quiet', 'origin'])
  if (fetched.exit_code !== 0) return no(`git fetch did not work in ${places.clone}: ${saidBy(fetched)}.`)
  const from = await defaultBranchIn(host, places.clone)
  if (from === undefined) return no(`${places.clone} cannot say which branch its origin's default is: run git remote set-head origin -a there, then try again.`)
  const added = await git(host, places.clone, ['worktree', 'add', '--quiet', '-b', places.branch, places.path, from])
  if (added.exit_code !== 0) return no(`${places.path} was not made: ${saidBy(added)}.`)
  const base = await gitSaid(host, places.path, ['rev-parse', 'HEAD'])
  return { told: `opened ${places.path} on ${places.branch}, from ${from} at ${base ?? 'a commit git did not name'}` }
}

export async function finishAWorktree(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Promise<WorktreeAnswer> {
  if (!request.settings.members.some((member) => member.name === request.member)) {
    return no(`${request.member} is not a member of this crew.`)
  }
  const form = theFinishForm(request, args)
  if ('refused' in form) return form
  const package_name = packageOf(args)
  if ('refused' in package_name) return package_name
  const discard_ignored = theDiscardList(args)
  if ('refused' in discard_ignored) return discard_ignored
  const work = { package: package_name.name, member: request.member }
  return form.form === 'worktree'
    ? finishTheWorktree(request, form, work, discard_ignored.names, args)
    : finishTheBranch(request, form, work, args)
}

/**
 * The two shapes one finish takes (martha#962): a live worktree, named by its repository and slug, or a branch whose
 * worktree is already gone, named by its repository and its own name. crew-code's tool takes a path or a branch
 * (`hooks/register.tsx:7103-7107`); Martha's path is derived from the slug, so the slug is what the first shape names.
 * Naming both, and naming neither, are each refused rather than guessed.
 */
type FinishForm =
  | { readonly form: 'worktree'; readonly repo: string; readonly clone: string; readonly slug: string; readonly path: string }
  | { readonly form: 'branch'; readonly repo: string; readonly clone: string; readonly branch: string }

function theFinishForm(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): FinishForm | Refused {
  const { clones, worktrees } = request.settings.house_rules
  if (clones === null || worktrees === null) return no(NO_LAYOUT)
  const repo = theRepoNamed(args)
  if ('refused' in repo) return repo
  const named = theNamedForm(args)
  if ('refused' in named) return named
  const clone = join(clones, repo.repo)
  return named.form === 'worktree'
    ? { form: 'worktree', repo: repo.repo, clone, slug: named.slug, path: worktreePathIn(worktrees, repo.repo, named.slug) }
    : { form: 'branch', repo: repo.repo, clone, branch: named.branch }
}

/** Which of the two shapes a call names, read before the crew's places: a slug, or a branch, and never both or neither. */
type ANamedForm = { readonly form: 'worktree'; readonly slug: string } | { readonly form: 'branch'; readonly branch: string }

/** The one sentence both refusals open with, and the two ways a call can be wrong about it. */
const NAME_A_FORM = 'name either a slug, for a live worktree, or a branch whose worktree is already gone'

function theNamedForm(args: Readonly<Record<string, unknown>>): ANamedForm | Refused {
  const namedSlug = typeof args['slug'] === 'string' && args['slug'] !== ''
  const namedBranch = typeof args['branch'] === 'string' && args['branch'] !== ''
  if (namedSlug === namedBranch) return no(namedSlug ? `${NAME_A_FORM}, not both.` : `${NAME_A_FORM}.`)
  if (!namedSlug) {
    const read = theBranchNamed(args)
    return 'refused' in read ? read : { form: 'branch', branch: read.name }
  }
  const read = theSlugNamed(args)
  return 'refused' in read ? read : { form: 'worktree', slug: read.slug }
}

/** What a branch name may be, given to the branch form: no white space, no `..`, nothing that walks out of a ref name. */
const A_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/

/** The branch a branch-form call names, or why it names none: a member's branch, `<member>/<slug>` (martha#962). */
function theBranchNamed(args: Readonly<Record<string, unknown>>): { readonly name: string } | Refused {
  const branch = args['branch']
  if (typeof branch !== 'string' || !A_BRANCH.test(branch) || branch.includes('..')) {
    return no(`${JSON.stringify(branch)} is not a branch name of a member, like hygiea/183: no path, no rev expression.`)
  }
  return { name: branch }
}

/** The member a branch belongs to, by the name before its first `/`, or undefined when this crew names no such member. */
function theOwnerOfBranch(branch: string, members: CrewSettings['members']): string | undefined {
  const at = branch.indexOf('/')
  if (at <= 0) return undefined
  return members.find((member) => member.name === branch.slice(0, at))?.name
}

/** Whether this crew's table lets `member` close another member's worktree or branch: its own role is granted the act. */
function mayCloseAnothersWorktree(settings: CrewSettings, member: string): boolean {
  const role = settings.members.find((one) => one.name === member)?.role
  return role !== undefined && settings.mode.may[FINISH_A_MEMBERS_WORKTREE].includes(role)
}

/**
 * Whether this caller may close `branch`, whose owner is `owner` (martha#962): its own branch always, and another
 * member's only with `owner_ok=1` from a session whose role the crew's table grants finish_a_members_worktree. That
 * table is read as the team table reads every act: the owner alone is no member's role, so a crew that grants it to the
 * owner and nobody else lets no member close another's — the reading offer_owner_asks gets, where every member acts as
 * the owner's own session, would make the word meaningless here.
 */
function whoseItIs(request: WorktreesRequest, owner: string, branch: string, args: Readonly<Record<string, unknown>>): Refused | undefined {
  if (owner === request.member) return undefined
  if (args['owner_ok'] === 1 && mayCloseAnothersWorktree(request.settings, request.member)) return undefined
  const granted = request.settings.mode.may[FINISH_A_MEMBERS_WORKTREE]
  return no(
    `${request.member} may not close branch "${branch}": it is ${owner}'s, and ${owner} closes it when the package is closed. ` +
      `If ${owner} has said so, a member whose role this crew's table grants ${FINISH_A_MEMBERS_WORKTREE} (${granted.join(', ') || 'nobody'}) passes owner_ok=1; nothing else does.`,
  )
}

/**
 * What the call named it may throw away: the ignored entries standing in the worktree, by the name git gives them. An
 * entry is discarded only when it is named, so nothing ignored goes unnamed (martha#915).
 */
function theDiscardList(args: Readonly<Record<string, unknown>>): { readonly names: readonly string[] } | Refused {
  const named = args['discard_ignored']
  if (named === undefined) return { names: [] }
  if (!Array.isArray(named) || named.some((one) => typeof one !== 'string' || one.trim() === '')) {
    return no(`discard_ignored must be a list of the ignored entries to throw away, as git names them; ${JSON.stringify(named)} is not.`)
  }
  return { names: named as readonly string[] }
}

/** The package a finish keeps its act's row under, or why the argument names none: an act is filed against one. */
function packageOf(args: Readonly<Record<string, unknown>>): { readonly name: string } | Refused {
  const package_name = args['package']
  if (typeof package_name !== 'string' || !WORK_PACKAGE.test(package_name)) {
    return no(`${JSON.stringify(package_name)} is not a work package, as owner/repo#n.`)
  }
  return { name: package_name }
}

/** The branch the worktree at `path` really has, or why it has none. */
async function branchAt(host: WorktreesRequest['host'], path: string): Promise<{ readonly name: string } | Refused> {
  const name = await gitSaid(host, path, ['symbolic-ref', '--short', 'HEAD'])
  if (name === undefined) return no(`there is no worktree at ${path}.`)
  return { name }
}

/**
 * The live worktree of this call: the branch it holds must be a member's branch of this slug, so the Supervisor passes
 * the same slug the member did, and the worktree is still one Martha's naming made (martha#962). What the call named it
 * may throw away is read and refused by `workNoOtherCopyHas`, so nothing ignored goes unnamed (martha#915).
 */
async function finishTheWorktree(
  request: WorktreesRequest,
  form: Extract<FinishForm, { readonly form: 'worktree' }>,
  work: TheAct,
  discard_ignored: readonly string[],
  args: Readonly<Record<string, unknown>>,
): Promise<WorktreeAnswer> {
  const { host } = request
  const path = form.path
  const branch = await branchAt(host, path)
  if ('refused' in branch) return branch
  const owner = theOwnerOfBranch(branch.name, request.settings.members)
  const theirs = `${owner ?? request.member}/${form.slug}`
  if (owner === undefined || branch.name !== theirs) {
    return no(`${path} is on ${branch.name}, not ${theirs}: Martha removes only the worktree its own naming made.`)
  }
  const allowed = whoseItIs(request, owner, branch.name, args)
  if (allowed !== undefined) return allowed
  const held = await workNoOtherCopyHas(host, path, branch.name, discard_ignored)
  if ('refused' in held) return held
  return removeTheWorktree(host, { clone: form.clone, path }, branch.name, work, held.discarded)
}

/** Why the worktree's work must not be removed yet, or what the call named it may throw away when nothing stops it. */
async function workNoOtherCopyHas(
  host: WorktreesRequest['host'],
  path: string,
  branch: string,
  discard_ignored: readonly string[],
): Promise<{ readonly discarded: readonly string[] } | Refused> {
  // Read with the ignored entries in: plain `status --porcelain` leaves them out, so a build output or a private
  // recording stood unseen and went with the worktree, named by nothing (martha#915). Traditional shape, so an ignored
  // directory is one entry rather than every file under it.
  const status = await gitSaid(host, path, ['status', '--porcelain', '--ignored=traditional'])
  if (status === undefined) return no(`${path} could not be read: git would not say what it holds.`)
  const lines = status === '' ? [] : status.split('\n')
  const ignored = lines.filter((line) => line.startsWith(IGNORED_ENTRY)).map((line) => line.slice(IGNORED_ENTRY.length).trim())
  const changed = lines.filter((line) => !line.startsWith(IGNORED_ENTRY)).map((line) => line.slice(STATUS_PREFIX).trim())
  if (changed.length > 0) {
    return no(`${path} has uncommitted changes (${changed.join(', ')}): commit them or remove them, then try again.`)
  }
  const unnamed = ignored.filter((one) => !discard_ignored.includes(one))
  if (unnamed.length > 0) {
    return no(`${path} holds ignored entries Martha will not throw away unnamed (${unnamed.join(', ')}): name each in discard_ignored, then try again.`)
  }
  const absent = discard_ignored.filter((one) => !ignored.includes(one))
  if (absent.length > 0) {
    return no(`${path} holds no ignored entry ${absent.join(', ')}: discard_ignored names what is not there, so nothing was removed.`)
  }
  const count = await gitSaid(host, path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  if (count === undefined) return no(`${path} could not be read: git would not say what it holds.`)
  if (count !== '0') return no(`${path} holds ${count} commit(s) on no remote branch: push ${branch}, then try again.`)
  return { discarded: ignored }
}

/** How a `git status --porcelain` line starts when it names an ignored entry. */
const IGNORED_ENTRY = '!! '
/** The two status characters and their space, in front of the path a porcelain line names. */
const STATUS_PREFIX = IGNORED_ENTRY.length

async function removeTheWorktree(
  host: WorktreesRequest['host'],
  places: { readonly clone: string; readonly path: string },
  branch: string,
  work: TheAct,
  discarded: readonly string[],
): Promise<WorktreeAnswer> {
  const tip = await gitSaid(host, places.path, ['rev-parse', 'HEAD'])
  // No `--force`: git removes a worktree that holds ignored entries without one, which is how they went silently before
  // the check above; what keeps them is that the check refuses before this runs unless each was named (martha#915).
  const removed = await git(host, places.clone, ['worktree', 'remove', places.path])
  if (removed.exit_code !== 0) return no(`${places.path} was not removed: ${saidBy(removed)}.`)
  const local = await git(host, places.clone, ['branch', '-D', branch])
  const branchWord = local.exit_code === 0 ? `removed ${branch}` : `left ${branch} (${saidBy(local)})`
  const discardedWord = discarded.length === 0 ? '' : `, discarding ${discarded.join(', ')}`
  return { told: `removed ${places.path} and ${branchWord}${discardedWord}${await originWord(host, places.clone, tip, branch, work)}` }
}

/**
 * Whether `default_branch` already holds the work at `commit`: the commit is an ancestor of it, or every file the
 * commit changed is on the default branch exactly as the commit left it — which is what a squash or a rebase landing
 * leaves behind, where the tip is an ancestor of nothing (martha#915). `differs` names the files that stop it.
 */
async function theDefaultBranchHolds(
  host: WorktreesRequest['host'],
  clone: string,
  commit: string,
  default_branch: string,
): Promise<{ readonly holds: boolean; readonly differs: readonly string[] }> {
  const ancestor = await git(host, clone, ['merge-base', '--is-ancestor', commit, default_branch])
  if (ancestor.exit_code === 0) return { holds: true, differs: [] }
  const base = await gitSaid(host, clone, ['merge-base', commit, default_branch])
  if (base === undefined) return { holds: false, differs: [] }
  // Every path, as git holds it: `--no-renames` names both sides of a rename, so a default that took only the new name
  // is not taken as holding the old one gone; `-z` hands each path unquoted and untrimmed, so a name git would quote,
  // or one with a space at its edge, still matches itself below rather than matching nothing (review r=1).
  const changed = await gitSaidAsIs(host, clone, ['diff', '--no-renames', '-z', '--name-only', base, commit])
  if (changed === undefined) return { holds: false, differs: [] }
  const files = changed.split('\0').filter((file) => file !== '')
  // A commit that changed no file of its own has nothing left to prove, and nothing that could be lost with it.
  if (files.length === 0) return { holds: true, differs: [] }
  // Each name is a literal path, never a pattern: git reads a name that starts with a colon as pathspec magic, which
  // names another path, so a file that differs would match nothing and pass as held (review r=2).
  const same = await git(host, clone, ['--literal-pathspecs', 'diff', '--quiet', default_branch, commit, '--', ...files])
  return same.exit_code === 0 ? { holds: true, differs: [] } : { holds: false, differs: files }
}

/** What became of the branch on origin: removed when the default branch already holds its work, otherwise left. */
async function originWord(host: WorktreesRequest['host'], clone: string, tip: string | undefined, branch: string, work: TheAct): Promise<string> {
  // Read afresh, and pruned: the package may have landed since this clone last heard from origin, so a stale ref
  // would keep a branch origin no longer needs; and a branch deleted on origin by someone else would still be
  // remembered here, so the answer would read as a delete that failed instead of a branch that is already gone.
  const fetched = await git(host, clone, ['fetch', '--quiet', '--prune', 'origin'])
  if (fetched.exit_code !== 0) return `; ${branch} stays on origin, since git fetch did not work (${saidBy(fetched)})`
  const default_branch = await defaultBranchIn(host, clone)
  if (default_branch === undefined) return `; ${branch} stays on origin, since the clone cannot say which branch is the default`
  if (tip === undefined) return `; ${branch} stays on origin, since git did not name the commit removed`
  const held = await theDefaultBranchHolds(host, clone, tip, default_branch)
  if (!held.holds) return `; ${branch} stays on origin, which its tip is not on yet${notWhatTheDefaultHolds(held.differs, default_branch)}`
  return removeTheBranch(host, clone, branch, default_branch, work)
}

/** The rest of a "not merged" answer when files stop the proof: which, and that they are what the default does not hold. */
const notWhatTheDefaultHolds = (differs: readonly string[], default_branch: string): string =>
  differs.length === 0 ? '' : ` (${differs.join(', ')} is not what ${default_branch} holds)`

/**
 * Removes the branch on origin, or says why it stays. Its head on origin has to be a commit the default branch
 * already holds: another checkout may have pushed onto it after this worktree's tip landed, and deleting a head the
 * default branch does not hold would leave that commit on no branch at all.
 */
async function removeTheBranch(
  host: WorktreesRequest['host'],
  clone: string,
  branch: string,
  default_branch: string,
  work: TheAct,
): Promise<string> {
  const on_origin = await gitSaid(host, clone, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
  if (on_origin === undefined) return `; ${branch} is no longer on origin`
  const held = await theDefaultBranchHolds(host, clone, on_origin, default_branch)
  if (!held.holds) {
    return `; ${branch} stays on origin, where it is at ${on_origin}, which the default branch does not hold${notWhatTheDefaultHolds(held.differs, default_branch)}`
  }
  return deleteTheBranch(host, clone, branch, work)
}

/**
 * The deletion itself: the one outward act this slice sends. Its row is kept before git runs, and when the store
 * will not keep it, git is not run — so what a successor reads never claims an act that did not happen, and never
 * misses one that did. A deletion that fails is not sent again on its own: ../recover_a_failed_act names the failure,
 * reads what origin really holds, and decides, one attempt at most (martha#512).
 */
async function deleteTheBranch(host: WorktreesRequest['host'], clone: string, branch: string, work: TheAct): Promise<string> {
  try {
    const said = await sendAnActAndRecover(
      host,
      { package: work.package, member: work.member, act: { kind: 'push', what: `origin ${branch}` } },
      async () => {
        const pushed = await git(host, clone, ['push', '--quiet', 'origin', '--delete', branch])
        if (pushed.exit_code !== 0) throw new Error(saidBy(pushed))
        return `removed ${branch} on origin`
      },
      async () => theBranchOnOrigin(host, clone, branch),
    )
    return `; ${said}`
  } catch (failure) {
    return `; ${whatBecameOfTheDeletion(failure, branch)}`
  }
}

/**
 * Whether the branch is on origin, read from origin itself with `git ls-remote` and never from this clone's
 * remote-tracking ref, which is behind the remote as soon as anyone pushes. The deletion happened when nothing answers
 * for the branch; a remote that cannot be asked at all is a state nothing can be said about, so it is not one.
 */
async function theBranchOnOrigin(host: WorktreesRequest['host'], clone: string, branch: string): Promise<AnInspection> {
  const read = `origin's refs for ${branch}`
  const asked = await git(host, clone, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`])
  if (asked.exit_code !== 0) return { state: 'cannot_tell', read, found: saidBy(asked) }
  const on_origin = asked.stdout.trim()
  if (on_origin === '') return { state: 'it_happened', read, found: `${branch} is no longer on origin` }
  return { state: 'it_did_not_happen', read, found: `${branch} is still on origin at ${on_origin.split('\t')[0] ?? on_origin}` }
}

/**
 * What the answer says when the deletion did not end cleanly. A failure this slice recovered from carries its own words:
 * the class, what origin was found to hold, and what the package does now; so does a deletion a paused package held back
 * (martha#512). Anything else says the branch stays.
 */
function whatBecameOfTheDeletion(failure: unknown, branch: string): string {
  if (failure instanceof RecoveryDecided || failure instanceof PackagePaused) return failure.told
  return `${branch} stays on origin (${failure instanceof Error ? failure.message : String(failure)})`
}

/** What became of one side of a finished branch: gone, never there, or kept with the clause that says why (martha#962). */
type ASideOfABranch = { readonly state: 'gone' | 'absent' } | { readonly state: 'kept'; readonly why: string }

/**
 * The live worktree of this clone that has `branch` checked out, by its path; `{ path: '' }` when none does. A record
 * git calls prunable is not one: its directory is gone, which is the whole of the branch form (martha#962).
 */
async function theLiveWorktreeHolding(host: WorktreesRequest['host'], clone: string, branch: string): Promise<{ readonly path: string } | Refused> {
  const listed = await gitSaid(host, clone, ['worktree', 'list', '--porcelain'])
  if (listed === undefined) return no(`${clone} could not be read: git would not list its worktrees.`)
  for (const block of listed.split('\n\n')) {
    const lines = block.split('\n')
    const at = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length) ?? ''
    const held = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length) ?? ''
    if (held === `refs/heads/${branch}` && !lines.some((line) => line.startsWith('prunable'))) return { path: at }
  }
  return { path: '' }
}

/**
 * A branch whose worktree is already gone (martha#962, crew-code's branch form): the guards are the live form's, and the
 * origin's copy and the clone's each go only when the origin's default branch holds what they hold. A branch kept on one
 * side is never deleted from the other, because half a finish is not what the caller asked for.
 */
async function finishTheBranch(request: WorktreesRequest, form: Extract<FinishForm, { readonly form: 'branch' }>, work: TheAct, args: Readonly<Record<string, unknown>>): Promise<WorktreeAnswer> {
  const guarded = await theBranchGuards(request, form, args)
  if ('refused' in guarded) return guarded
  const { host } = request
  const { clone, branch } = form
  // Read afresh, and pruned, before either side is judged: the package may have landed since this clone last heard from
  // origin, and a branch deleted on origin by someone else would still be remembered here.
  const fetched = await git(host, clone, ['fetch', '--quiet', '--prune', 'origin'])
  if (fetched.exit_code !== 0) return no(`origin could not be read (${saidBy(fetched)}), so nothing of ${branch} was removed.`)
  const on_origin = await bothSidesJudged(host, clone, branch, guarded.default_branch)
  if ('refused' in on_origin) return on_origin
  const remote = on_origin.state === 'held' ? await theOriginSide(host, clone, branch, on_origin.tip, work) : on_origin
  if (remote.state === 'kept') return no(`the origin still holds origin/${branch}, ${remote.why}; the clone's copy is untouched.`)
  const local = await theCloneSide(host, clone, branch, guarded.default_branch)
  return { told: branchFinishLine(branch, remote, local) }
}

/**
 * The branch form's guards, the live form's own: who may call, judged before anything is read as crew-code's finish does
 * (a member's branch is closed by that member, or on their word by a role the table grants), then never the default
 * branch, never a branch no member owns, and never one a live worktree still holds (martha#962).
 */
async function theBranchGuards(request: WorktreesRequest, form: Extract<FinishForm, { readonly form: 'branch' }>, args: Readonly<Record<string, unknown>>): Promise<{ readonly default_branch: string } | Refused> {
  const { host } = request
  const { clone, branch } = form
  const owner = theOwnerOfBranch(branch, request.settings.members)
  const allowed = owner === undefined ? undefined : whoseItIs(request, owner, branch, args)
  if (allowed !== undefined) return allowed
  const default_branch = await defaultBranchIn(host, clone)
  if (default_branch === undefined) return no(`${clone} cannot say which branch its origin's default is: run git remote set-head origin -a there, then try again.`)
  if (branch === default_branch.replace(/^origin\//, '')) return no(`${branch} is the origin's default branch, and that is never removed.`)
  if (owner === undefined) return no(`branch ${JSON.stringify(branch)} names no member of this crew, so it is not this tool's to remove.`)
  const holding = await theLiveWorktreeHolding(host, clone, branch)
  if ('refused' in holding) return holding
  if (holding.path !== '') {
    return no(`the worktree at ${holding.path} holds branch "${branch}"; finish it with its repo, its slug and the package, so its directory goes with the branch.`)
  }
  return { default_branch }
}

/**
 * Both sides judged before either is touched: a copy the default branch does not hold keeps the other one too, since a
 * branch kept on one side is never deleted from the other (martha#962 review r=1). Answers the origin's copy, absent or
 * held, or why nothing is removed.
 */
async function bothSidesJudged(host: WorktreesRequest['host'], clone: string, branch: string, default_branch: string): Promise<{ readonly state: 'absent' } | { readonly state: 'held'; readonly tip: string } | Refused> {
  const on_origin = await theOriginCopy(host, clone, branch, default_branch)
  if (on_origin.state === 'kept') return no(`the origin still holds origin/${branch}, ${on_origin.why}; the clone's copy is untouched.`)
  const unheld = await whatTheDefaultLacksIn(host, clone, branch, default_branch)
  if (unheld !== undefined) return no(`the clone still holds ${branch}, ${unheld}; origin/${branch} is untouched.`)
  return on_origin
}

/** Why the clone's copy of `branch` must stay (its tip, which the default branch does not hold), or undefined. */
async function whatTheDefaultLacksIn(host: WorktreesRequest['host'], clone: string, branch: string, default_branch: string): Promise<string | undefined> {
  const tip = await gitSaid(host, clone, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  if (tip === undefined) return undefined
  const held = await git(host, clone, ['merge-base', '--is-ancestor', tip, default_branch])
  return held.exit_code === 0 ? undefined : `where it is at ${tip}, which the default branch does not hold`
}

/** The origin's copy of `branch` as the fetch left it: absent, held by the default branch at its tip, or kept with why. */
async function theOriginCopy(
  host: WorktreesRequest['host'],
  clone: string,
  branch: string,
  default_branch: string,
): Promise<{ readonly state: 'absent' } | { readonly state: 'held'; readonly tip: string } | { readonly state: 'kept'; readonly why: string }> {
  const on_origin = await gitSaid(host, clone, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
  if (on_origin === undefined) return { state: 'absent' }
  const held = await git(host, clone, ['merge-base', '--is-ancestor', on_origin, default_branch])
  return held.exit_code === 0 ? { state: 'held', tip: on_origin } : { state: 'kept', why: `where it is at ${on_origin}, which the default branch does not hold` }
}

/** Deletes the origin's copy, held by the default branch at `on_origin`: gone, or kept with why. */
async function theOriginSide(host: WorktreesRequest['host'], clone: string, branch: string, on_origin: string, work: TheAct): Promise<ASideOfABranch> {
  try {
    await sendAnActAndRecover(
      host,
      { package: work.package, member: work.member, act: { kind: 'push', what: `origin ${branch}` } },
      async () => {
        // Leased on the tip the default branch was found to hold: a push that lands on origin after that check makes
        // the delete fail rather than take commits nothing holds (martha#962 review r=1).
        const pushed = await git(host, clone, ['push', '--quiet', `--force-with-lease=refs/heads/${branch}:${on_origin}`, 'origin', '--delete', branch])
        if (pushed.exit_code !== 0) throw new Error(saidBy(pushed))
        return `removed ${branch} on origin`
      },
      async () => theBranchOnOrigin(host, clone, branch),
    )
    return { state: 'gone' }
  } catch (failure) {
    if (failure instanceof RecoveryDecided && failure.inspection.state === 'it_happened') return { state: 'gone' }
    return { state: 'kept', why: whatBecameOfTheDeletion(failure, branch).replace(/^; /, '') }
  }
}

/** The clone's own copy: gone only when the default branch holds its tip, since a copy that moved on is the only one it has. */
async function theCloneSide(host: WorktreesRequest['host'], clone: string, branch: string, default_branch: string): Promise<ASideOfABranch> {
  const tip = await gitSaid(host, clone, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  if (tip === undefined) return { state: 'absent' }
  const held = await git(host, clone, ['merge-base', '--is-ancestor', tip, default_branch])
  if (held.exit_code !== 0) return { state: 'kept', why: `where it is at ${tip}, which the default branch does not hold` }
  const deleted = await git(host, clone, ['branch', '-D', branch])
  if (deleted.exit_code === 0) return { state: 'gone' }
  // `branch -D` refuses a branch a worktree record still names, and a record outlives its directory: dropping the ref is
  // what `branch -D` would have done, and no `worktree prune` runs, since one would drop every other member's records.
  const listed = (await gitSaid(host, clone, ['worktree', 'list', '--porcelain'])) ?? ''
  const records = listed.split('\n\n').filter((block) => block.includes(`branch refs/heads/${branch}`))
  if (records.length === 0 || records.some((block) => !block.split('\n').some((line) => line.startsWith('prunable')))) {
    return { state: 'kept', why: `which git refused to delete (${saidBy(deleted)})` }
  }
  const dropped = await git(host, clone, ['update-ref', '-d', `refs/heads/${branch}`])
  return dropped.exit_code === 0 ? { state: 'gone' } : { state: 'kept', why: `which git refused to delete (${saidBy(dropped)})` }
}

/** What finishing a branch says once the guards passed: each side named as it went, or as it stayed (martha#962). */
function branchFinishLine(branch: string, remote: ASideOfABranch, local: ASideOfABranch): string {
  if (remote.state === 'absent' && local.state === 'absent') return `Nothing to remove: neither the origin nor this clone holds ${branch}.`
  const where = remote.state === 'gone' ? `Removed origin/${branch}` : `The origin holds no origin/${branch}`
  if (local.state === 'absent') return remote.state === 'gone' ? `${where}; the clone held none.` : `${where}.`
  if (local.state === 'kept') return `${where}; the clone still holds ${branch}, ${local.why}.`
  return `${where}; the clone's copy went too.`
}
