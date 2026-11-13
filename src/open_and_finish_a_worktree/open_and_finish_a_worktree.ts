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
// Finishing sends one thing over the network: the deletion of the branch on origin. That is an outward act, so it
// goes out through the ledger (../log_ledger, martha#25): its row is kept first, and when the store will not keep
// it, git is not run. The package it is kept under is named by the member, as it is on every other row.

import { join } from 'node:path'

import { type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import { ActNotSent, OutcomeNotKept, WORK_PACKAGE, sendOutwardAct, type LedgerHost } from '../log_ledger/log_ledger.ts'
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

type Refusal = { readonly refusal: string }
const refused = (why: string): Refusal => ({ refusal: why })

/** What `worktree_open` says it is for, as the launcher answers the mod's ask (martha#256). */
export const WORKTREE_OPEN_DESCRIPTION = 'Makes a worktree for one package of a repository, on a new branch of your own, and answers where it is.'

/** What `worktree_finish` says it is for (martha#256). */
export const WORKTREE_FINISH_DESCRIPTION =
  'Removes a worktree and its branch once its work has landed, and names the package the deletion is kept under. Refused while it holds work no remote has.'

/** The places one call works in, or why the crew and the arguments name none. */
function placesOf(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Places | Refusal {
  const { clones, worktrees } = request.settings.house_rules
  if (clones === null || worktrees === null) return refused(NO_LAYOUT)
  const repo = args['repo']
  const slug = args['slug']
  if (typeof repo !== 'string' || !REPO.test(repo)) return refused(`${JSON.stringify(repo)} is not a repository, as org/name.`)
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    return refused(`${JSON.stringify(slug)} is not a slug: lowercase letters, digits and hyphens, up to 64 of them.`)
  }
  if (!request.settings.members.some((member) => member.name === request.member)) {
    return refused(`${request.member} is not a member of this crew.`)
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

export async function openAWorktree(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Promise<string> {
  const places = placesOf(request, args)
  if ('refusal' in places) return places.refusal
  const { host } = request
  const fetched = await git(host, places.clone, ['fetch', '--quiet', 'origin'])
  if (fetched.exit_code !== 0) return `git fetch did not work in ${places.clone}: ${saidBy(fetched)}.`
  const from = await defaultBranchIn(host, places.clone)
  if (from === undefined) return `${places.clone} cannot say which branch its origin's default is: run git remote set-head origin -a there, then try again.`
  const added = await git(host, places.clone, ['worktree', 'add', '--quiet', '-b', places.branch, places.path, from])
  if (added.exit_code !== 0) return `${places.path} was not made: ${saidBy(added)}.`
  const base = await gitSaid(host, places.path, ['rev-parse', 'HEAD'])
  return `opened ${places.path} on ${places.branch}, from ${from} at ${base ?? 'a commit git did not name'}`
}

export async function finishAWorktree(request: WorktreesRequest, args: Readonly<Record<string, unknown>>): Promise<string> {
  const places = placesOf(request, args)
  if ('refusal' in places) return places.refusal
  const package_name = packageOf(args)
  if ('refusal' in package_name) return package_name.refusal
  const { host } = request
  const branch = await branchAt(host, places)
  if ('refusal' in branch) return branch.refusal
  const held = await workNoOtherCopyHas(host, places)
  if (held !== undefined) return held.refusal
  return removeTheWorktree(host, places, branch.name, { package: package_name.name, member: request.member })
}

/** The package a finish keeps its act's row under, or why the argument names none: an act is filed against one. */
function packageOf(args: Readonly<Record<string, unknown>>): { readonly name: string } | Refusal {
  const package_name = args['package']
  if (typeof package_name !== 'string' || !WORK_PACKAGE.test(package_name)) {
    return refused(`${JSON.stringify(package_name)} is not a work package, as owner/repo#n.`)
  }
  return { name: package_name }
}

/** The branch the worktree at `places.path` really has: the one Martha's own naming gives, or why it is not that. */
async function branchAt(host: WorktreesRequest['host'], places: Places): Promise<{ readonly name: string } | Refusal> {
  const name = await gitSaid(host, places.path, ['symbolic-ref', '--short', 'HEAD'])
  if (name === undefined) return refused(`there is no worktree at ${places.path}.`)
  if (name !== places.branch) return refused(`${places.path} is on ${name}, not ${places.branch}: Martha removes only the worktree its own naming made.`)
  return { name }
}

/** Why the worktree's work must not be removed yet, or undefined when no other copy of it exists. */
async function workNoOtherCopyHas(host: WorktreesRequest['host'], places: Places): Promise<Refusal | undefined> {
  const changes = await gitSaid(host, places.path, ['status', '--porcelain'])
  if (changes === undefined) return refused(`${places.path} could not be read: git would not say what it holds.`)
  if (changes !== '') return refused(`${places.path} has uncommitted changes (${changes.split('\n')[0] ?? ''}): commit them or remove them, then try again.`)
  const count = await gitSaid(host, places.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  if (count === undefined) return refused(`${places.path} could not be read: git would not say what it holds.`)
  if (count !== '0') return refused(`${places.path} holds ${count} commit(s) on no remote branch: push ${places.branch}, then try again.`)
  return undefined
}

async function removeTheWorktree(host: WorktreesRequest['host'], places: Places, branch: string, work: TheAct): Promise<string> {
  const tip = await gitSaid(host, places.path, ['rev-parse', 'HEAD'])
  const removed = await git(host, places.clone, ['worktree', 'remove', places.path])
  if (removed.exit_code !== 0) return `${places.path} was not removed: ${saidBy(removed)}.`
  const local = await git(host, places.clone, ['branch', '-D', branch])
  const branchWord = local.exit_code === 0 ? `removed ${branch}` : `left ${branch} (${saidBy(local)})`
  return `removed ${places.path} and ${branchWord}${await originWord(host, places.clone, tip, branch, work)}`
}

/** What became of the branch on origin: removed when the default branch already holds its tip, otherwise left. */
async function originWord(host: WorktreesRequest['host'], clone: string, tip: string | undefined, branch: string, work: TheAct): Promise<string> {
  // Read afresh, and pruned: the package may have landed since this clone last heard from origin, so a stale ref
  // would keep a branch origin no longer needs; and a branch deleted on origin by someone else would still be
  // remembered here, so the answer would read as a delete that failed instead of a branch that is already gone.
  const fetched = await git(host, clone, ['fetch', '--quiet', '--prune', 'origin'])
  if (fetched.exit_code !== 0) return `; ${branch} stays on origin, since git fetch did not work (${saidBy(fetched)})`
  const default_branch = await defaultBranchIn(host, clone)
  if (default_branch === undefined) return `; ${branch} stays on origin, since the clone cannot say which branch is the default`
  if (tip === undefined) return `; ${branch} stays on origin, since git did not name the commit removed`
  const held = await git(host, clone, ['merge-base', '--is-ancestor', tip, default_branch])
  if (held.exit_code !== 0) return `; ${branch} stays on origin, which its tip is not on yet`
  return removeTheBranch(host, clone, branch, default_branch, work)
}

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
  const held = await git(host, clone, ['merge-base', '--is-ancestor', on_origin, default_branch])
  if (held.exit_code !== 0) {
    return `; ${branch} stays on origin, where it is at ${on_origin}, which the default branch does not hold`
  }
  return deleteTheBranch(host, clone, branch, work)
}

/**
 * The deletion itself: the one outward act this slice sends. Its row is kept before git runs, and when the store
 * will not keep it, git is not run — so what a successor reads never claims an act that did not happen, and never
 * misses one that did.
 */
async function deleteTheBranch(host: WorktreesRequest['host'], clone: string, branch: string, work: TheAct): Promise<string> {
  try {
    const said = await sendOutwardAct(
      host,
      { package: work.package, member: work.member, act: { kind: 'push', what: `origin ${branch}` } },
      async () => {
        const pushed = await git(host, clone, ['push', '--quiet', 'origin', '--delete', branch])
        if (pushed.exit_code !== 0) throw new Error(saidBy(pushed))
        return `removed ${branch} on origin`
      },
    )
    return `; ${said}`
  } catch (failure) {
    return `; ${whatBecameOfTheDeletion(failure, branch)}`
  }
}

/**
 * What the answer says when the deletion did not end cleanly. The three endings are kept apart, as the ledger keeps
 * them apart, because each says what the next attempt may do: the row was not kept, so nothing was sent and sending
 * again is safe; git failed, so it was sent and its failure is the row that was kept; or it was sent and its outcome
 * was not kept, so whoever reads it next checks what happened rather than sending it again.
 */
function whatBecameOfTheDeletion(failure: unknown, branch: string): string {
  if (failure instanceof ActNotSent) return `${branch} stays on origin, since ${failure.message}`
  if (failure instanceof OutcomeNotKept) {
    const state = failure.sent.succeeded ? 'was deleted on origin' : 'may still be on origin'
    return `${branch} ${state}, and its ledger row was not concluded: ${failure.message}. Check what happened before sending anything again.`
  }
  return `${branch} stays on origin (${failure instanceof Error ? failure.message : String(failure)})`
}
