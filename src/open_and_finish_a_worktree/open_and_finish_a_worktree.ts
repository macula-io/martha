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

import { type CrewSettings } from '../declare_crew/declare_crew.ts'
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

/** What `worktree_finish` says it is for (martha#256). */
export const WORKTREE_FINISH_DESCRIPTION =
  'Removes a worktree and its branch once its work has landed, and names the package the deletion is kept under. Refused while it holds work no remote has, or an ignored entry the call did not name in discard_ignored.'

/** The places one call works in, or why the crew and the arguments name none. */
function placesOf(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Places | Refused {
  const { clones, worktrees } = request.settings.house_rules
  if (clones === null || worktrees === null) return no(NO_LAYOUT)
  const repo = args['repo']
  const slug = args['slug']
  if (typeof repo !== 'string' || !REPO.test(repo)) return no(`${JSON.stringify(repo)} is not a repository, as org/name.`)
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    return no(`${JSON.stringify(slug)} is not a slug: lowercase letters, digits and hyphens, up to 64 of them.`)
  }
  if (!request.settings.members.some((member) => member.name === request.member)) {
    return no(`${request.member} is not a member of this crew.`)
  }
  return { clone: join(clones, repo), path: join(worktrees, `${repo.slice(repo.indexOf('/') + 1)}-${slug}`), branch: `${request.member}/${slug}` }
}

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: WorktreesRequest['host'], cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: 'git', args: marthasOwnGitArgs(args), cwd })
}

/** What git said, when it ended well; undefined when it did not. */
async function gitSaid(host: WorktreesRequest['host'], cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout.trim() : undefined
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
  const places = placesOf(request, args)
  if ('refused' in places) return places
  const package_name = packageOf(args)
  if ('refused' in package_name) return package_name
  const discard_ignored = theDiscardList(args)
  if ('refused' in discard_ignored) return discard_ignored
  const { host } = request
  const branch = await branchAt(host, places)
  if ('refused' in branch) return branch
  const held = await workNoOtherCopyHas(host, places, discard_ignored.names)
  if ('refused' in held) return held
  return removeTheWorktree(host, places, branch.name, { package: package_name.name, member: request.member }, held.discarded)
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

/** The branch the worktree at `places.path` really has: the one Martha's own naming gives, or why it is not that. */
async function branchAt(host: WorktreesRequest['host'], places: Places): Promise<{ readonly name: string } | Refused> {
  const name = await gitSaid(host, places.path, ['symbolic-ref', '--short', 'HEAD'])
  if (name === undefined) return no(`there is no worktree at ${places.path}.`)
  if (name !== places.branch) return no(`${places.path} is on ${name}, not ${places.branch}: Martha removes only the worktree its own naming made.`)
  return { name }
}

/** Why the worktree's work must not be removed yet, or what the call named it may throw away when nothing stops it. */
async function workNoOtherCopyHas(
  host: WorktreesRequest['host'],
  places: Places,
  discard_ignored: readonly string[],
): Promise<{ readonly discarded: readonly string[] } | Refused> {
  // Read with the ignored entries in: plain `status --porcelain` leaves them out, so a build output or a private
  // recording stood unseen and went with the worktree, named by nothing (martha#915). Traditional shape, so an ignored
  // directory is one entry rather than every file under it.
  const status = await gitSaid(host, places.path, ['status', '--porcelain', '--ignored=traditional'])
  if (status === undefined) return no(`${places.path} could not be read: git would not say what it holds.`)
  const lines = status === '' ? [] : status.split('\n')
  const ignored = lines.filter((line) => line.startsWith(IGNORED_ENTRY)).map((line) => line.slice(IGNORED_ENTRY.length).trim())
  const changed = lines.filter((line) => !line.startsWith(IGNORED_ENTRY)).map((line) => line.slice(STATUS_PREFIX).trim())
  if (changed.length > 0) {
    return no(`${places.path} has uncommitted changes (${changed.join(', ')}): commit them or remove them, then try again.`)
  }
  const unnamed = ignored.filter((one) => !discard_ignored.includes(one))
  if (unnamed.length > 0) {
    return no(
      `${places.path} holds ignored entries Martha will not throw away unnamed (${unnamed.join(', ')}): name each in discard_ignored, then try again.`,
    )
  }
  const absent = discard_ignored.filter((one) => !ignored.includes(one))
  if (absent.length > 0) {
    return no(`${places.path} holds no ignored entry ${absent.join(', ')}: discard_ignored names what is not there, so nothing was removed.`)
  }
  const count = await gitSaid(host, places.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  if (count === undefined) return no(`${places.path} could not be read: git would not say what it holds.`)
  if (count !== '0') return no(`${places.path} holds ${count} commit(s) on no remote branch: push ${places.branch}, then try again.`)
  return { discarded: ignored }
}

/** How a `git status --porcelain` line starts when it names an ignored entry. */
const IGNORED_ENTRY = '!! '
/** The two status characters and their space, in front of the path a porcelain line names. */
const STATUS_PREFIX = IGNORED_ENTRY.length

async function removeTheWorktree(
  host: WorktreesRequest['host'],
  places: Places,
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
  // is not taken as holding the old one gone; `-z` hands each path unquoted, so a name git would quote still matches
  // itself below rather than matching nothing (review r=1).
  const changed = await gitSaid(host, clone, ['diff', '--no-renames', '-z', '--name-only', base, commit])
  if (changed === undefined) return { holds: false, differs: [] }
  const files = changed.split('\0').filter((file) => file !== '')
  // A commit that changed no file of its own has nothing left to prove, and nothing that could be lost with it.
  if (files.length === 0) return { holds: true, differs: [] }
  const same = await git(host, clone, ['diff', '--quiet', default_branch, commit, '--', ...files])
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
