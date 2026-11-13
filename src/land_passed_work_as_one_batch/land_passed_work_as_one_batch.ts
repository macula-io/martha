// Landing passed work as one batch (martha#256, slice 2).
//
// This exists so what lands on a default branch is exactly the heads its reviewers passed, and lands as one batch
// instead of N landings: `land_batch` takes the packages, finds each one's passed head and open pull request
// (../find_the_work_a_verdict_passed), cuts one integration branch from the origin's default branch, merges each passed
// head `--no-ff` so that very sha lands and GitHub marks its pull request merged, and pushes the branch — which is not a
// default branch. It answers with the range the owner's yes is asked about, for ../check_a_range_before_the_owner_says_yes
// to read.
//
// The fast-forward of the default branch is a separate act, `fast_forward_after_the_owners_yes`, and it runs only after
// that yes: it pushes the passed tip onto the default branch, and is refused when the default branch moved after the
// range was checked, by comparing the expected base sha. Both pushes are outward acts and go through the ledger
// (../log_ledger): every package the act lands holds the announcement before it runs, and its outcome after, so a
// member refreshed mid-push leaves a package whose ledger says a push was sent and what became of it is not recorded.
//
// A package that cannot be landed stops the whole batch before anything is merged, and a merge that does not go cleanly
// stops it there, naming the pull request and listing the packages not tried. The clone is left where it stood — on the
// branch it was on, its HEAD unmoved and clean, the integration branch removed here and kept on origin — whether the
// batch landed or stopped, so the clone a workspace keeps on its default branch does not leave it. Every run of git carries
// marthasOwnGitArgs (../run_marthas_own_git) and goes through the contract's processes.run, and the repository and
// default branch are read from the clone's own origin (../read_the_origin_a_clone_has), never from an argument.

import { writeFileSync } from 'node:fs'

import { manifestPathOf, NPM } from '../../prove_the_core/declared_in_package_json.ts'
import { HOST_CEILINGS_SCRIPT } from '../check_a_host_directory_stays_under_its_ceiling/check_a_host_directory_stays_under_its_ceiling.ts'
import { thePackageJsonOfAMerge, type ThePackageJsonAMergeBrings } from '../check_a_host_directory_stays_under_its_ceiling/the_ceilings_a_merge_brings.ts'
import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import {
  findTheWorkTheseVerdictsPassed,
  type LandedWork,
} from '../find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts'
import { announceAct, concludeAct, type Outcome } from '../log_ledger/log_ledger.ts'
import { readTheOriginACloneHas, type TheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import {
  aPictureRedone,
  isAPictureTheLandingRedraws,
  THE_PICTURES_REDRAWN_AS,
  theManifestAsGitNamesIt,
} from './the_generated_files_a_landing_redoes.ts'

/** The two tools this slice registers: the batch, and the fast-forward the owner's yes unlocks. */
export const LAND_BATCH = 'land_batch'
export const FAST_FORWARD_AFTER_THE_OWNERS_YES = 'fast_forward_after_the_owners_yes'

/** The prefix every integration branch's name carries; the refs under it are how a day's landings are counted. */
export const LAND = 'land'

/** The ref an origin's default branch has in the clone, before it is asked for the branch's own name. */
const THE_ORIGIN_PREFIX = 'origin/'

/** The batch the Supervisor lands: the clone it is landed in, and the work packages it holds. */
export interface TheBatch {
  readonly path: string
  readonly packages: readonly string[]
}

/** The range the owner said yes to, as the fast-forward finds it again: its ends, and the packages it lands. */
export interface TheFastForward {
  readonly path: string
  readonly base: string
  readonly tip: string
  readonly packages: readonly string[]
}

/** What a landing answered: what it did, with the range for the check; or why it did nothing. */
export type Landing = { readonly told: string } | { readonly refused: string }

/** What this needs of a host: its own git, its clock and the packages' ledgers, and the tools it registers into. */
export type LandingHost = Pick<HostContract, 'processes' | 'clock'> & {
  readonly stores: { readonly rows: HostContract['stores']['rows'] }
}

/** What a landing answers for: the host, and the member whose acts the ledgers record. */
export interface LandingRequest {
  readonly host: LandingHost & Pick<HostContract, 'tools'>
  /** The member landing: the launcher starts it, so the model never supplies this. */
  readonly member: string
}

type Refusal = { readonly refused: string }
type Step<T> = { readonly ok: T } | Refusal
const no = (why: string): Refusal => ({ refused: why })

/** The batch once its packages have been found and its branch has been cut. */
interface TheCutBatch {
  readonly batch: TheBatch
  readonly origin: TheOrigin
  readonly work: readonly LandedWork[]
  readonly branch: string
  /** The default branch's tip when the integration branch was cut: the base the check reads the range against. */
  readonly base: string
}

/** An announcement kept in one package's ledger, waiting for the outcome of the act it announces. */
interface Announcement {
  readonly package: string
  readonly at: number
}

/**
 * Lands a batch of passed work: one integration branch, one `--no-ff` merge per package at the head its reviewer
 * passed, and one push. Answers with the range for `verify_range`, or why nothing was landed.
 */
export async function landPassedWorkAsOneBatch(host: LandingHost, member: string, batch: TheBatch): Promise<Landing> {
  if (batch.packages.length === 0) return no('a batch names no package to land.')
  const fetched = await git(host, batch.path, ['fetch', '--quiet', '--prune', 'origin'])
  if (fetched.exit_code !== 0) return no(`git fetch did not work in ${batch.path}: ${saidBy(fetched)}.`)
  const origin = await readTheOriginACloneHas(host, batch.path)
  if ('refused' in origin) return origin
  const clean = await theCloneHoldsNoChange(host, batch.path)
  if ('refused' in clean) return clean
  const identity = await theCloneSaysWhoCommits(host, batch.path)
  if ('refused' in identity) return identity
  const work = await findTheWorkTheseVerdictsPassed(host, { packages: batch.packages, repo: origin.origin.repo, cwd: batch.path })
  if ('refused' in work) return work
  const stood = await theBranchTheCloneStandsOn(host, batch.path)
  if ('refused' in stood) return stood
  const cut = await cutTheBatchBranch(host, batch.path, batch, origin.origin)
  if ('refused' in cut) return cut
  const the_cut: TheCutBatch = { batch, origin: origin.origin, work: work.work, ...cut.ok }
  const landing = await mergeEveryHeadAndPush(host, member, the_cut)
  const back = await theCloneBackWhereItStood(host, batch.path, the_cut.branch, stood.ok)
  return withTheCloneBack(landing, back)
}

/**
 * Fast-forwards the default branch onto the tip the owner said yes to. Refused when the default branch moved after the
 * range was checked, and when git will not push; the push itself is an outward act, announced in every package's ledger
 * before it runs.
 */
export async function fastForwardAfterTheOwnersYes(host: LandingHost, member: string, forward: TheFastForward): Promise<Landing> {
  if (forward.packages.length === 0) return no('the fast-forward names no package it lands.')
  const what = `the default branch of ${forward.path} fast-forwarded to ${forward.tip}`
  const sent = await pushForEveryPackage(host, member, forward.packages, what, () => fastForward(host, forward))
  return 'refused' in sent ? sent : { told: `${sent.sent}; ${forward.packages.join(', ')} are on it.` }
}

/** What `land_batch` says it is for, as the launcher answers the mod's ask (martha#256). */
export const LAND_BATCH_DESCRIPTION =
  'Lands a batch of packages whose reviews passed, as one integration branch: one --no-ff merge per package at the head its reviewer passed, then the branch pushed. Answers with the range to check before the owner says yes.'

/** What `fast_forward_after_the_owners_yes` says it is for (martha#256). */
export const FAST_FORWARD_DESCRIPTION =
  'Fast-forwards the default branch onto the tip the owner said yes to. Refused when the default branch moved after the range was checked.'

/** The batch a call of `land_batch` names, or why it names none. */
export function theBatchACallNames(args: Readonly<Record<string, unknown>>): Step<TheBatch> {
  const path = args['path']
  if (typeof path !== 'string' || path === '') return no('a batch names the clone it is landed in, as path.')
  const packages = args['packages']
  if (!Array.isArray(packages) || packages.some((one) => typeof one !== 'string')) {
    return no('a batch names the work packages it lands, as packages: a list of owner/repo#n.')
  }
  return { ok: { path, packages: packages as readonly string[] } }
}

/** The fast-forward a call of `fast_forward_after_the_owners_yes` names, or why it names none. */
export function theFastForwardACallNames(args: Readonly<Record<string, unknown>>): Step<TheFastForward> {
  const batch = theBatchACallNames(args)
  if ('refused' in batch) return batch
  const base = args['base']
  const tip = args['tip']
  if (typeof base !== 'string' || base === '') return no('a fast-forward names the base the range was checked against, as base.')
  if (typeof tip !== 'string' || tip === '') return no('a fast-forward names the tip the owner said yes to, as tip.')
  return { ok: { path: batch.ok.path, packages: batch.ok.packages, base, tip } }
}

/** A landing lands in a clone with nothing of its own in it, or the merges would carry that change too. */
async function theCloneHoldsNoChange(host: LandingHost, path: string): Promise<Step<true>> {
  const changes = await gitSaid(host, path, ['status', '--porcelain'])
  if (changes === undefined) return no(`${path} could not be read: git would not say what it holds.`)
  if (changes !== '') return no(`${path} has uncommitted changes (${changes.split('\n')[0] ?? ''}): commit them or remove them, then land again.`)
  return { ok: true }
}

/**
 * A merge commit carries a committer, and git refuses the merge when the clone cannot name one. It is checked before a
 * branch is cut, so a clone that would fail on its first merge is told what to set instead of being left half landed.
 */
async function theCloneSaysWhoCommits(host: LandingHost, path: string): Promise<Step<true>> {
  const identity = await git(host, path, ['var', 'GIT_COMMITTER_IDENT'])
  if (identity.exit_code === 0) return { ok: true }
  return no(
    `${path} does not say who commits, so its merges would be refused: set user.name and user.email there (git config user.name "..." and git config user.email "..."), then land again.`,
  )
}

/**
 * The branch the clone stood on. A clone on no branch has none to go back to, so it is refused here, before anything is
 * cut: the landing's own branch is where the merges happen, and this is where the clone has to end up again.
 */
async function theBranchTheCloneStandsOn(host: LandingHost, path: string): Promise<Step<string>> {
  const branch = await gitSaid(host, path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch === undefined || branch === '') {
    return no(`${path} is on no branch, so a landing would have none to put it back on: go to its default branch there, then land again.`)
  }
  return { ok: branch }
}

/** Cuts `land/<date>-<n>` from the origin's default branch, and answers it with the base it started from. */
async function cutTheBatchBranch(host: LandingHost, path: string, batch: TheBatch, origin: TheOrigin): Promise<Step<Omit<TheCutBatch, 'batch' | 'origin' | 'work'>>> {
  const base = await gitSaid(host, path, ['rev-parse', '--verify', '--quiet', origin.default_branch])
  if (base === undefined) return no(`${path} cannot read ${origin.default_branch}: fetch there, then try again.`)
  const branch = await theBatchBranchName(host, path, host.clock.now())
  const cut = await git(host, path, ['checkout', '--quiet', '-b', branch, origin.default_branch])
  if (cut.exit_code !== 0) return no(`${batch.packages.length} package(s) were not landed: ${branch} was not cut from ${origin.default_branch} (${saidBy(cut)}).`)
  return { ok: { branch, base } }
}

/** `land/<the day>-<n>`, with n the next number that day's landings have not taken, here or on origin. */
async function theBatchBranchName(host: LandingHost, path: string, now: number): Promise<string> {
  const date = new Date(now).toISOString().split('T')[0] ?? ''
  const taken = await landingsOn(host, path, date)
  return `${LAND}/${date}-${String(taken + 1)}`
}

/** How many integration branches this clone knows of for one day, here and on origin; 0 when it knows none. */
async function landingsOn(host: LandingHost, path: string, date: string): Promise<number> {
  const refs = [`refs/heads/${LAND}/${date}-*`, `refs/remotes/origin/${LAND}/${date}-*`]
  const said = await gitSaid(host, path, ['for-each-ref', '--format=%(refname)', ...refs])
  if (said === undefined || said === '') return 0
  const numbers = said
    .split('\n')
    .map((ref) => Number(ref.slice(ref.lastIndexOf('-') + 1)))
    .filter((number) => Number.isInteger(number))
  return numbers.length === 0 ? 0 : Math.max(...numbers)
}

/**
 * Merges every passed head `--no-ff`, in the batch's order; the first that will not merge aborts its merge and stops the
 * batch there, leaving the branch cut with the merges that did go through and nothing pushed.
 */
async function mergeEveryHeadAndPush(host: LandingHost, member: string, cut: TheCutBatch): Promise<Landing> {
  const merged = await mergeEveryHead(host, cut.batch.path, cut.work)
  if ('refused' in merged) return merged
  const passed = await theGateBeforeThePush(host, cut.batch.path, merged.ok)
  if ('refused' in passed) return passed
  return pushTheBatch(host, member, cut, merged.ok)
}

/** A merge the landing redid for: which pull request it was, and what was redone. */
interface RedoneByTheLanding {
  readonly package: string
  readonly pr: number
  readonly what: readonly string[]
}

/**
 * Merges every passed head `--no-ff`, in the batch's order; the first that will not merge stops the batch there. A clash
 * only in generated files is redone and the batch goes on (../the_generated_files_a_landing_redoes); every merge, redone
 * or not, is then held to the ceilings it brought, because a clash the landing did not redo is still one the tree fails.
 */
async function mergeEveryHead(host: LandingHost, path: string, work: readonly LandedWork[]): Promise<Step<readonly RedoneByTheLanding[]>> {
  const redone: RedoneByTheLanding[] = []
  for (const [at, one] of work.entries()) {
    const settled = await mergeOneHead(host, path, one)
    if ('refused' in settled) return theBatchStopsAt(one, settled.refused, work.slice(at + 1))
    const holds = await theCeilingsHold(host, path)
    if ('refused' in holds) return theBatchStopsAt(one, holds.refused, work.slice(at + 1))
    if (settled.ok.length > 0) redone.push({ package: one.package, pr: one.pr, what: settled.ok })
  }
  return { ok: redone }
}

/** Where a batch stopped: the pull request it stopped at, why, and the packages it never tried. */
function theBatchStopsAt(one: LandedWork, why: string, untried: readonly LandedWork[]): Refusal {
  const rest = untried.length === 0 ? '' : ` Untried: ${untried.map((next) => next.package).join(', ')}.`
  return no(`stopped at ${one.package} (PR ${String(one.pr)}): ${why}.${rest}`)
}

/** One head merged `--no-ff`: what the landing redid if it clashed only in generated files, or why it stopped. */
async function mergeOneHead(host: LandingHost, path: string, one: LandedWork): Promise<Step<readonly string[]>> {
  const merged = await git(host, path, ['merge', '--no-ff', '--no-edit', '-m', theMergeMessage(one), one.head])
  if (merged.exit_code === 0) return { ok: [] }
  const redone = await redoTheClash(host, path, one)
  if ('refused' in redone) await git(host, path, ['merge', '--abort'])
  return redone
}

/**
 * The redone merge: every path the merge could not settle is one the landing redraws, each is redone on the merged tree
 * rather than taken from a side, the ceilings are recorded, and the merge is committed saying so. A path outside those
 * is a clash a builder has to settle, and stops the batch by name.
 */
async function redoTheClash(host: LandingHost, path: string, one: LandedWork): Promise<Step<readonly string[]>> {
  const settled = await thePathsTheMergeCouldNotSettle(host, path)
  if ('refused' in settled) return settled
  const not_redone = thePathsTheLandingDoesNotRedo(path, settled.ok)
  if ('refused' in not_redone) return not_redone
  const redone = await theGeneratedFilesRedone(host, path, settled.ok)
  if ('refused' in redone) return redone
  const committed = await theMergeCommitted(host, path, one, redone.ok)
  return 'refused' in committed ? committed : redone
}

/** The paths the merge could not settle, as git names them. */
async function thePathsTheMergeCouldNotSettle(host: LandingHost, path: string): Promise<Step<readonly string[]>> {
  const holding = await gitSaid(host, path, ['diff', '--name-only', '--diff-filter=U'])
  if (holding === undefined) return no('git would not say which paths the merge could not settle')
  return { ok: holding.split('\n').filter((clashed) => clashed !== '') }
}

/** The clash is the landing's only when every path in it is one it redoes; any other path stops the batch by name. */
function thePathsTheLandingDoesNotRedo(path: string, settled: readonly string[]): Step<true> {
  const the_manifest = theManifestAsGitNamesIt(path)
  const others = settled.filter((clashed) => clashed !== the_manifest && !isAPictureTheLandingRedraws(clashed))
  if (others.length === 0) return { ok: true }
  return no(`the merge clashes in ${others.join(', ')}, which the landing does not redo`)
}

/** Each generated path redone on the merged tree, with the words the merge's commit records of it. */
async function theGeneratedFilesRedone(host: LandingHost, path: string, settled: readonly string[]): Promise<Step<readonly string[]>> {
  const the_manifest = theManifestAsGitNamesIt(path)
  const redone: string[] = []
  const pictures = settled.filter(isAPictureTheLandingRedraws)
  if (pictures.length > 0) {
    const drawn = await redrawThePictures(host, path)
    if ('refused' in drawn) return drawn
    redone.push(...pictures.map(aPictureRedone))
  }
  if (settled.includes(the_manifest)) {
    const merged = await theManifestMerged(host, path, the_manifest)
    if ('refused' in merged) return merged
    writeFileSync(manifestPathOf(path), merged.ok.text)
    redone.push(merged.ok.recorded)
  }
  await git(host, path, ['add', '--', ...settled])
  const recorded = await theCeilingsRecorded(host, path)
  if ('refused' in recorded) return recorded
  await git(host, path, ['add', '--', the_manifest])
  return { ok: redone }
}

/** The merge committed, saying which generated files the landing redid; refused while any path is still unsettled. */
async function theMergeCommitted(host: LandingHost, path: string, one: LandedWork, redone: readonly string[]): Promise<Step<true>> {
  const left = await gitSaid(host, path, ['diff', '--name-only', '--diff-filter=U'])
  if (left === undefined) return no('git would not say what the redo left unsettled')
  if (left !== '') return no(`${left} is still unsettled after the redo`)
  const said = `Redone-generated: ${redone.join('; ')}`
  const committed = await git(host, path, ['commit', '--quiet', '-m', theMergeMessage(one), '-m', said])
  if (committed.exit_code !== 0) return no(`the merge was redone and would not commit: ${saidBy(committed)}`)
  return { ok: true }
}

/** The C4 picture redrawn over the merged tree, by the program that draws it. */
async function redrawThePictures(host: LandingHost, path: string): Promise<Step<true>> {
  const [command, ...args] = THE_PICTURES_REDRAWN_AS
  const drawn = await host.processes.run({ command, args, cwd: path })
  if (drawn.exit_code !== 0) return no(`the picture would not be redrawn: ${whatItSaid(THE_PICTURES_REDRAWN_AS[0], drawn)}`)
  return { ok: true }
}

/** package.json as the merge of the two sides brings it: each ceiling at its base plus both raises, or why not. */
async function theManifestMerged(host: LandingHost, path: string, the_manifest: string): Promise<Step<ThePackageJsonAMergeBrings>> {
  const stages = await Promise.all([1, 2, 3].map((at) => gitSaid(host, path, ['show', `:${String(at)}:${the_manifest}`])))
  const [base, ours, theirs] = stages
  if (base === undefined || ours === undefined || theirs === undefined) {
    return no(`${the_manifest} has no three stages here: a side added or removed it, which is a change to the file and not to the map`)
  }
  return thePackageJsonOfAMerge(path, base, ours, theirs)
}

/** The ceilings brought down to the merged tree's counts: the map's only writer, and it never raises one. */
async function theCeilingsRecorded(host: LandingHost, path: string): Promise<Step<true>> {
  const ran = await host.processes.run({ command: NPM, args: ['run', '--silent', HOST_CEILINGS_SCRIPT, '--', '--record'], cwd: path })
  if (ran.exit_code !== 0) return no(`the ceilings would not be recorded: ${whatItSaid(NPM, ran)}`)
  return { ok: true }
}

/** Every merge is held to its ceilings, redone or not: a directory over its ceiling is where a decision hid. */
async function theCeilingsHold(host: LandingHost, path: string): Promise<Step<true>> {
  const ran = await host.processes.run({ command: NPM, args: ['run', '--silent', HOST_CEILINGS_SCRIPT], cwd: path })
  if (ran.exit_code === 0) return { ok: true }
  return no(`the merged tree does not hold its ceilings: ${whatItSaid(NPM, ran)}`)
}

/** What a landing runs over a tree it redid something in, before it pushes: npm's arguments, and what a failure calls it. */
const THE_RUNS_BEFORE_A_PUSH: readonly { readonly args: readonly string[]; readonly name: string }[] = [
  { args: ['run', '--silent', 'typecheck'], name: 'the type check' },
  { args: ['test'], name: 'the suite' },
]

/**
 * A landing that redid something pushes nothing until the tree it made passes the type check and the suite: the merge
 * that resolved a generated file is one no reviewer read, so it is held to what a builder's change is held to.
 */
async function theGateBeforeThePush(host: LandingHost, path: string, redone: readonly RedoneByTheLanding[]): Promise<Step<true>> {
  if (redone.length === 0) return { ok: true }
  const named = redone.map((one) => `${one.package} (PR ${String(one.pr)})`).join(', ')
  for (const run of THE_RUNS_BEFORE_A_PUSH) {
    const ran = await host.processes.run({ command: NPM, args: run.args, cwd: path })
    if (ran.exit_code !== 0) return no(`the tree the landing redid for ${named} does not pass ${run.name}: ${whatItSaid(run.name, ran)}. Nothing was pushed`)
  }
  return { ok: true }
}

/** The message the merge carries: which pull request landed, which package it is, and that its verdict passed. */
const theMergeMessage = (one: LandedWork): string => `Land #${String(one.pr)} (${one.package}, PASS)`

/**
 * Puts the clone back on the branch it stood on and removes the integration branch it cut here. It runs after the
 * landing's own answer, so a stop and a landing both come back; the branch the batch pushed stays on the origin.
 */
async function theCloneBackWhereItStood(host: LandingHost, path: string, branch: string, stood: string): Promise<Step<true>> {
  const back = await git(host, path, ['checkout', '--quiet', stood])
  if (back.exit_code !== 0) {
    return no(
      `${path} was left on ${branch} (${saidBy(back)}): go back to ${stood} there with git checkout ${stood}, and remove the branch with git branch -D ${branch}.`,
    )
  }
  const removed = await git(host, path, ['branch', '--quiet', '-D', branch])
  if (removed.exit_code !== 0) {
    return no(`the branch ${branch} was left in ${path} (${saidBy(removed)}): remove it there with git branch -D ${branch}.`)
  }
  return { ok: true }
}

/** What the landing says, with what became of the clone: a batch that landed is still told, and says the clone is not back. */
function withTheCloneBack(landing: Landing, back: Step<true>): Landing {
  if (!('refused' in back)) return landing
  const why = back.refused
  return 'told' in landing ? { told: `${landing.told} ${why}` } : no(`${landing.refused} ${why}`)
}

/** Pushes the integration branch, announced in every package's ledger before it runs. */
async function pushTheBatch(host: LandingHost, member: string, cut: TheCutBatch, redone: readonly RedoneByTheLanding[]): Promise<Landing> {
  const tip = await gitSaid(host, cut.batch.path, ['rev-parse', 'HEAD'])
  if (tip === undefined) return no(`${cut.branch} holds no commit git will name.`)
  const landed = cut.work.map((one) => `${one.package} (PR ${String(one.pr)})`).join(', ')
  const what = `the batch ${cut.branch} of ${landed}`
  const sent = await pushForEveryPackage(host, member, cut.batch.packages, what, () => pushTheBranch(host, cut.batch.path, cut.branch, tip))
  if ('refused' in sent) return sent
  const redone_said =
    redone.length === 0
      ? ''
      : ` Generated files were redone for ${redone.map((one) => `${one.package} (PR ${String(one.pr)}): ${one.what.join(', ')}`).join('; ')}.`
  return { told: `${sent.sent}. The range the owner says yes to is ${cut.base}..${tip}, over ${landed}.${redone_said}` }
}

/** Pushes one branch to the origin's same name; throws what git said when it will not. */
async function pushTheBranch(host: LandingHost, path: string, branch: string, tip: string): Promise<string> {
  const pushed = await git(host, path, ['push', '--quiet', 'origin', `${tip}:refs/heads/${branch}`])
  if (pushed.exit_code !== 0) throw new Error(saidBy(pushed))
  return `${branch} is on origin at ${tip}`
}

/** Fast-forwards the default branch onto the tip, and refuses when it moved after the range was checked. */
async function fastForward(host: LandingHost, forward: TheFastForward): Promise<string> {
  const fetched = await git(host, forward.path, ['fetch', '--quiet', 'origin'])
  if (fetched.exit_code !== 0) throw new Error(`git fetch did not work in ${forward.path}: ${saidBy(fetched)}`)
  const origin = await readTheOriginACloneHas(host, forward.path)
  if ('refused' in origin) throw new Error(origin.refused)
  const at_the_head = await gitSaid(host, forward.path, ['rev-parse', '--verify', '--quiet', origin.origin.default_branch])
  if (at_the_head === undefined) throw new Error(`${forward.path} cannot read ${origin.origin.default_branch}`)
  if (at_the_head !== forward.base) {
    throw new Error(
      `${origin.origin.default_branch} moved after the range was checked: it is at ${at_the_head}, and the check named ${forward.base}. Check the range again, then say yes to it`,
    )
  }
  const branch = branchOf(origin.origin.default_branch)
  const pushed = await git(host, forward.path, ['push', '--quiet', 'origin', `${forward.tip}:refs/heads/${branch}`])
  if (pushed.exit_code !== 0) throw new Error(saidBy(pushed))
  return `${branch} fast-forwarded from ${at_the_head} to ${forward.tip}`
}

/** A branch's own name, with the origin's ref taken off: `origin/main` is `main`. */
const branchOf = (default_branch: string): string =>
  default_branch.startsWith(THE_ORIGIN_PREFIX) ? default_branch.slice(THE_ORIGIN_PREFIX.length) : default_branch

/**
 * Runs one outward act that lands several packages: every package's ledger announces it before it runs, and every
 * announcement gets the outcome afterwards. A package whose row cannot be kept stops the act before it runs, so no
 * package is told afterwards that something was sent.
 */
async function pushForEveryPackage(
  host: LandingHost,
  member: string,
  packages: readonly string[],
  what: string,
  send: () => Promise<string>,
): Promise<{ readonly sent: string } | Refusal> {
  const announced = await announceForEvery(host, member, packages, what)
  if ('refused' in announced) return announced
  let sent: string
  try {
    sent = await send()
  } catch (error) {
    return notSentTheWayItEnded(host, member, announced.ok, what, error)
  }
  const not_kept = await concludeEvery(host, member, announced.ok, { succeeded: true, detail: sent })
  if (not_kept === undefined) return { sent }
  return no(`${what} was sent (${sent}), and its outcome was not recorded (${not_kept}): check what happened before sending it again.`)
}

/** Every package's ledger announces the act, or the act does not run; the packages already announced are told so. */
async function announceForEvery(host: LandingHost, member: string, packages: readonly string[], what: string): Promise<Step<readonly Announcement[]>> {
  const announced: Announcement[] = []
  for (const work_package of packages) {
    try {
      announced.push({ package: work_package, at: await announceAct(host, { package: work_package, member, act: { kind: 'push', what } }) })
    } catch (error) {
      const not_kept = await concludeEvery(host, member, announced, {
        succeeded: false,
        detail: `it was not sent: the row for ${work_package} was not kept`,
      })
      const recorded = not_kept === undefined ? '' : ` What was kept of the others could not be concluded either (${not_kept}).`
      return no(`${what} was not sent: its row was not kept for ${work_package} (${detailOf(error)}).${recorded}`)
    }
  }
  return { ok: announced }
}

/** The act failed: its outcome is kept as a failure, and the answer says what git said and whether that was recorded. */
async function notSentTheWayItEnded(
  host: LandingHost,
  member: string,
  announced: readonly Announcement[],
  what: string,
  error: unknown,
): Promise<Refusal> {
  const not_kept = await concludeEvery(host, member, announced, { succeeded: false, detail: detailOf(error) })
  const recorded = not_kept === undefined ? '' : ` What became of it was not recorded either (${not_kept}).`
  return no(`${what} was refused: ${detailOf(error)}.${recorded}`)
}

/** The outcome of the act, kept in every package's ledger; the first failure, when one was not kept. */
async function concludeEvery(host: LandingHost, member: string, announced: readonly Announcement[], outcome: Outcome): Promise<string | undefined> {
  let first_not_kept: string | undefined
  for (const one of announced) {
    try {
      await concludeAct(host, { package: one.package, member, announced_at: one.at, outcome })
    } catch (error) {
      first_not_kept ??= detailOf(error)
    }
  }
  return first_not_kept
}

/** What a failure says, as one line. */
const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: GIT, args: marthasOwnGitArgs(args), cwd })
}

/** What git said, when it ended well; undefined when it did not. */
async function gitSaid(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout.trim() : undefined
}

/** What git said it could not do, as one line: its own words, or the status it ended with when it said none. */
const saidBy = (outcome: ProcessOutcome): string => whatItSaid(GIT, outcome)

/** What a program said it could not do, as one line: its own words, or the status it ended with when it said none. */
function whatItSaid(program: string, outcome: ProcessOutcome): string {
  const words = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
  const first = words.split('\n')[0] ?? ''
  return first === '' ? `${program} ended with ${String(outcome.exit_code)}` : first
}
