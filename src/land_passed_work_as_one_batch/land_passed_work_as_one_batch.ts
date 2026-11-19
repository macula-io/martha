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
// A package that cannot be landed stops the whole batch before anything is merged. A merge that clashes by hand does not
// stop it (martha#339): that pull request is left out, named with why and what it
// clashes with, and the rest land; a head that holds a left-out head is left out with it. The left-out pull request's
// builder fixes it on its own branch after the batch lands, never here. `check: 1` asks the same before anything is
// built (../forecast_what_a_batch_lands). The clone is left where it stood — on the
// branch it was on, its HEAD unmoved and clean, the integration branch removed here and kept on origin — whether the
// batch landed or stopped, so the clone a workspace keeps on its default branch does not leave it. Every run of git carries
// marthasOwnGitArgs (../run_marthas_own_git) and goes through the contract's processes.run, and the repository and
// default branch are read from the clone's own origin (../read_the_origin_a_clone_has), never from an argument.
//
// A package the Supervisor holds stops both acts before anything runs (martha#364, ../hold_a_package_back_from_a_batch):
// the batch before its fetch, and the fast-forward before its push is announced.

import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import {
  findTheWorkTheseVerdictsPassed,
  type LandedWork,
} from '../find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts'
import { A_HOLD_REFUSES, noneOfTheseIsHeld } from '../hold_a_package_back_from_a_batch/hold_a_package_back_from_a_batch.ts'
import { PackagePaused, RecoveryDecided, noneOfTheseIsPaused, sendAnActOnEveryPackageAndRecover, type AnInspection } from '../recover_a_failed_act/recover_a_failed_act.ts'
import { noteMilestone, readLedger, type LedgerHost, type LedgerRow } from '../log_ledger/log_ledger.ts'
import { readTheOriginACloneHas, type TheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { mergedInMemory, whatEachPathClashesWith, type AFirstParent, type AStep } from '../find_where_a_merge_clashes/find_where_a_merge_clashes.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { OWNER_YES, branchOf, theLandingNamesOneThingEach, theYesALandingStandsOn, type TheApprovingDeclaration, type ALandingAskedAbout } from './the_owners_yes_to_a_landing.ts'

/** The two tools this slice registers: the batch, and the fast-forward the owner's yes unlocks. */
export const LAND_BATCH = 'land_batch'
export const FAST_FORWARD_AFTER_THE_OWNERS_YES = 'fast_forward_after_the_owners_yes'

/** The prefix every integration branch's name carries; the refs under it are how a day's landings are counted. */
export const LAND = 'land'

/** How much of a sha an answer shows: the landing's, its dry run's and the range gate's (martha#423). */
export const SHORT_SHA = 7

/** What a refusal says was not done: the batch merged nothing, the fast-forward pushed nothing. */
const NOTHING_LANDED = 'nothing was landed'

/** Why a head that clashes is left out: a landing settles no clash, so its builder settles it on its own branch. */
export const A_CLASH = "the merge clashes, and a clash is its builder's to settle on its own branch"
const NOTHING_PUSHED = 'nothing was pushed'


/** The batch the Supervisor lands: the clone it is landed in, and the work packages it holds. */
export interface TheBatch {
  readonly path: string
  readonly packages: readonly string[]
}

/** The range the owner said yes to, as the fast-forward finds it again: its ends, the packages it lands, and the ask the
 *  owner said yes to, when the call names one (martha#605). */
export interface TheFastForward {
  readonly path: string
  readonly base: string
  readonly tip: string
  readonly packages: readonly string[]
  readonly owner_yes?: number
}

/** What a landing answered: what it did, with the range for the check; or why it did nothing. */
export type Landing = { readonly told: string } | { readonly refused: string }

/** A package the ledger says landed, and the moment it did: the fact a package's waits end on (martha#320). */
export interface LandedPackage {
  readonly package: string
  /** Milliseconds since the epoch, from the clock the landing was recorded at. */
  readonly at: number
}

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

/**
 * Lands a batch of passed work: one integration branch, one `--no-ff` merge per package at the head its reviewer
 * passed, and one push. Answers with the range for `verify_range`, or why nothing was landed.
 */
export async function landPassedWorkAsOneBatch(host: LandingHost, member: string, batch: TheBatch): Promise<Landing> {
  const started = await theBatchMayStart(host, batch)
  if ('refused' in started) return started
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
 * Fast-forwards the default branch onto the tip the owner said yes to. Refused, before any ledger is written, when the
 * landing has no yes from someone the declaration lets approve it (martha#605, ./the_owners_yes_to_a_landing); refused
 * when the default branch moved after the range was checked, and when git will not push. The push itself is an outward
 * act, announced in every package's ledger before it runs.
 */
export async function fastForwardAfterTheOwnersYes(
  host: LandingHost,
  member: string,
  forward: TheFastForward,
  declaration: TheApprovingDeclaration,
): Promise<Landing> {
  if (forward.packages.length === 0) return no('the fast-forward names no package it lands.')
  const not_one_thing = theLandingNamesOneThingEach(forward)
  if (not_one_thing !== undefined) return no(`${not_one_thing} Nothing was pushed.`)
  const yes = await theYesALandingStandsOn(host, { member, declaration, owner_yes: forward.owner_yes, landing: () => theLandingOf(host, forward) })
  if ('refused' in yes) return yes
  const held = await noneOfTheseIsHeld(host, forward.packages, NOTHING_PUSHED)
  if ('refused' in held) return held
  // A package that stands paused is refused by the recovery itself, before any ledger is written or git runs.
  const what = `the default branch of ${forward.path} fast-forwarded to ${forward.tip}`
  const sent = await pushForEveryPackage(host, member, forward.packages, { what, send: () => fastForward(host, forward), look: () => theDefaultBranchHoldsTheTip(host, forward) })
  if ('refused' in sent) return sent
  // The packages are on the default branch: that is the fact a package's waits end on (martha#320), so each package's
  // ledger is told, by the act that landed it, with the range that landed. Nothing is written before the push is sent or
  // when its outcome is not kept — a push left awaiting is one the member checks, and the wait stays open until then.
  // The integration branch's own push is no landing: the default branch has not moved and the owner has not said yes.
  const not_told = await noteTheLanding(host, member, forward, yes.stood_on)
  const told = `${sent.sent}; ${forward.packages.join(', ')} are on it.`
  return { told: not_told === undefined ? told : `${told} The ledger was not told they landed (${not_told}), so a review wait on them ends only when someone reads the branch.` }
}

/** The landing a fast-forward asks the owner about: what its clone's origin says, its tip and its packages. */
async function theLandingOf(host: LandingHost, forward: TheFastForward): Promise<Step<ALandingAskedAbout>> {
  const origin = await readTheOriginACloneHas(host, forward.path)
  if ('refused' in origin) return origin
  return { ok: { repo: origin.origin.repo, default_branch: origin.origin.default_branch, tip: forward.tip, packages: forward.packages } }
}

/** Records that each package landed, with the range that landed and the yes it stood on (martha#605); answers why one could
 * not be recorded, or undefined when they all were. One package the store will not take is named and does not stop the rest. */
async function noteTheLanding(host: LandingHost, member: string, forward: TheFastForward, stood_on: string): Promise<string | undefined> {
  let first_not_kept: string | undefined
  for (const package_name of forward.packages) {
    try {
      await noteMilestone(host, { package: package_name, member, milestone: 'package_landed', note: `${forward.base}..${forward.tip} on ${stood_on}` })
    } catch (error) {
      first_not_kept ??= detailOf(error)
    }
  }
  return first_not_kept
}

/**
 * The packages, of those asked about, whose ledger says they landed (martha#320): the fact a package's waits end on, each
 * with the moment it landed, because a landing ends only the waits that began before it. A package whose ledger holds no
 * such row is not landed — a package dropped without landing keeps its waits — which is not the same as a ledger that
 * could not be read: a read that fails rejects, so a caller cannot take an unreadable ledger for a package that never
 * landed.
 */
export async function landingsOf(host: LedgerHost, packages: readonly string[]): Promise<readonly LandedPackage[]> {
  const landings: LandedPackage[] = []
  for (const package_name of packages) {
    landings.push(...theLandingsIn(package_name, await readLedger(host, package_name)))
  }
  return landings
}

/** The landings one package's ledger keeps, in the order it keeps them. */
const theLandingsIn = (package_name: string, rows: readonly LedgerRow[]): readonly LandedPackage[] =>
  rows.filter((row) => row.kind === 'package_landed').map((row) => ({ package: package_name, at: row.at }))

/** A batch starts when it names a package, none of its packages is held, and the clone fetches. */
export async function theBatchMayStart(host: LandingHost, batch: TheBatch): Promise<Step<true>> {
  if (batch.packages.length === 0) return no('a batch names no package to land.')
  const held = await noneOfTheseIsHeld(host, batch.packages, NOTHING_LANDED)
  if ('refused' in held) return held
  const paused = await noneOfTheseIsPaused(host, batch.packages, NOTHING_LANDED)
  if ('refused' in paused) return paused
  const fetched = await git(host, batch.path, ['fetch', '--quiet', '--prune', 'origin'])
  if (fetched.exit_code !== 0) return no(`git fetch did not work in ${batch.path}: ${saidBy(fetched)}.`)
  return { ok: true }
}

/** What `land_batch` says it is for, as the launcher answers the mod's ask (martha#256). */
export const LAND_BATCH_DESCRIPTION =
  `Lands a batch of packages whose reviews passed, as one integration branch: one --no-ff merge per package at the head its reviewer passed, then the branch pushed. A package whose merge clashes by hand is left out and named, and the rest land. Answers with the range to check before the owner says yes. With check 1 it is a dry run: it merges in memory only, writes and pushes nothing, and says which packages land and which clash by hand, in which paths and with what. ${A_HOLD_REFUSES}`

/** The argument that makes a call of `land_batch` a dry run (martha#339). */
export const A_DRY_RUN = 'check'

/** Whether a call of `land_batch` asks for its dry run: `check` 1, left out or 0 for the landing itself. */
export function aDryRunIsAsked(args: Readonly<Record<string, unknown>>): Step<boolean> {
  const check = args[A_DRY_RUN]
  if (check === undefined || check === 0) return { ok: false }
  if (check === 1) return { ok: true }
  return no(`${A_DRY_RUN} is 1 for a dry run that writes nothing, or 0 (or left out) for the landing.`)
}

/** What a call of `land_batch` names: the batch, and whether the call is its dry run (martha#339). */
export interface TheLanding {
  readonly batch: TheBatch
  readonly dry: boolean
}

/** Everything a call of `land_batch` names, read in one go, or the first thing it names wrong (martha#339, #443 part 5
 *  r=2): the tools slice reads a call's every argument before it asks this launch for the processes it acts with. */
export function theLandingACallNames(args: Readonly<Record<string, unknown>>): Step<TheLanding> {
  const batch = theBatchACallNames(args)
  if ('refused' in batch) return batch
  const dry = aDryRunIsAsked(args)
  return 'refused' in dry ? dry : { ok: { batch: batch.ok, dry: dry.ok } }
}

/** What `fast_forward_after_the_owners_yes` says it is for (martha#256). */
export const FAST_FORWARD_DESCRIPTION =
  `Fast-forwards the default branch onto the tip the owner said yes to. When the declaration grants approve_landing to the owner, name as ${OWNER_YES} the id of the ask they said yes to: its question must be, word for word, the one verify_range gave for this landing. Refused when there is no such yes, and when the default branch moved after the range was checked. ${A_HOLD_REFUSES}`

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
  const owner_yes = theAskACallNames(args[OWNER_YES])
  if (typeof owner_yes === 'string') return no(owner_yes)
  const forward = { path: batch.ok.path, packages: batch.ok.packages, base, tip }
  return { ok: owner_yes === undefined ? forward : { ...forward, owner_yes } }
}

/** The ask a fast-forward names as the owner's yes (martha#605): its id, none when the call names none, or why it is not one. */
function theAskACallNames(value: unknown): number | undefined | string {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  return `${OWNER_YES} is the id of the ask the owner said yes to, a whole number.`
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
export async function theCloneSaysWhoCommits(host: LandingHost, path: string): Promise<Step<true>> {
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
 * Merges every passed head `--no-ff`, in the batch's order. A head that will not merge is left out and named, and the
 * rest land (martha#339). A batch that leaves every head out pushes nothing.
 */
async function mergeEveryHeadAndPush(host: LandingHost, member: string, cut: TheCutBatch): Promise<Landing> {
  const merged = await mergeEveryHead(host, cut, cut.work)
  if ('refused' in merged) return merged
  const left_out = theLeftOutSaid(merged.ok.left_out)
  if (merged.ok.landed.length === 0) return no(`${NOTHING_LANDED}: every package was left out.${left_out}`)
  const pushed = await pushTheBatch(host, member, cut, merged.ok)
  return 'told' in pushed ? { told: `${pushed.told}${left_out}` } : pushed
}

/** A head the landing left out, and why, in the words the owner's menu carries. */
interface LeftOut {
  readonly one: LandedWork
  readonly why: string
}

/** What the merges came to: the heads that landed, in order, and the heads left out. */
interface TheMerges {
  readonly landed: readonly LandedWork[]
  readonly left_out: readonly LeftOut[]
  /** The commits a clash is traced along: the default branch's tip, then each landing merge made so far. */
  readonly steps: readonly AStep[]
}

/**
 * Merges every passed head `--no-ff`, in the batch's order. A head that clashes, or that holds the head of one left
 * out, is left out and the next head is tried: a clash is its builder's to settle on its own branch, never the landing's.
 */
async function mergeEveryHead(host: LandingHost, cut: TheCutBatch, work: readonly LandedWork[]): Promise<Step<TheMerges>> {
  let merges: TheMerges = { landed: [], left_out: [], steps: [{ commit: cut.base, label: `${cut.origin.default_branch} at ${cut.base.slice(0, SHORT_SHA)}` }] }
  for (const one of work) {
    const next = await mergeOneHeadOrLeaveItOut(host, cut.batch.path, merges, one)
    if ('refused' in next) return next
    merges = next.ok
  }
  return { ok: merges }
}

/** One head merged, or left out with why; refused only when the branch could not be put back after a head left out. */
async function mergeOneHeadOrLeaveItOut(host: LandingHost, path: string, merges: TheMerges, one: LandedWork): Promise<Step<TheMerges>> {
  const inside = await theLeftOutHeadItHolds(host, path, merges.left_out.map((out) => out.one), one)
  if (inside !== undefined) return { ok: leftOut(merges, one, `its head holds the head of PR ${String(inside.pr)}, which was left out, so landing it would land that one's clash too`) }
  const before = await gitSaid(host, path, ['rev-parse', 'HEAD'])
  if (before === undefined) return no('the integration branch holds no commit git will name.')
  const merged = await mergeOneHead(host, path, one)
  if ('refused' in merged) return { ok: leftOut(merges, one, `${merged.refused}${await theClashTraced(host, path, before, merges, one)}`) }
  const tip = await gitSaid(host, path, ['rev-parse', 'HEAD'])
  if (tip === undefined) return no(`the merge of ${one.package} holds no commit git will name.`)
  return { ok: { ...merges, landed: [...merges.landed, one], steps: [...merges.steps, { commit: tip, label: `PR ${String(one.pr)}` }] } }
}

/** The merges with one more head left out. */
const leftOut = (merges: TheMerges, one: LandedWork, why: string): TheMerges => ({ ...merges, left_out: [...merges.left_out, { one, why }] })

/**
 * The head of a package left out that this head holds, if any: landing it would land that one's clash too. The landing
 * and its dry run (../forecast_what_a_batch_lands) both leave a head out by this one rule (martha#423).
 */
export async function theLeftOutHeadItHolds(host: LandingHost, path: string, left_out: readonly LandedWork[], one: LandedWork): Promise<LandedWork | undefined> {
  for (const earlier of left_out) {
    const holds = await git(host, path, ['merge-base', '--is-ancestor', earlier.head, one.head])
    if (holds.exit_code === 0) return earlier
  }
  return undefined
}

/** What each path a left-out head clashes in clashes with, said after the reason: earlier heads, or the default branch's landings. */
async function theClashTraced(host: LandingHost, path: string, before: string, merges: TheMerges, one: LandedWork): Promise<string> {
  const merged = await mergedInMemory(host, path, before, one.head)
  if ('refused' in merged || merged.ok.clashed.size === 0) return ''
  const traced = await whatEachPathClashesWith(host, path, one.head, merges.steps, [...merged.ok.clashed.keys()], aFirstParentNamed)
  if ('refused' in traced) return ''
  return `; it clashes in ${theClashesSaid(traced.ok)}`
}

/** Each path a head clashes in, grouped by what it clashes with, in the order they were found: the landing's words and its dry run's. */
export function theClashesSaid(clashes: ReadonlyMap<string, string>): string {
  const by_whom = new Map<string, string[]>()
  for (const [clashed, whom] of clashes) by_whom.set(whom, [...(by_whom.get(whom) ?? []), clashed])
  return [...by_whom].map(([whom, paths]) => `${paths.join(', ')} with ${whom}`).join('; ')
}

/** A first-parent commit of the default branch, named by the pull request its landing merged, or by its sha. */
export function aFirstParentNamed(commit: AFirstParent): string {
  const pr = thePullRequestALandingNames(commit.subject)
  return pr === undefined ? `the commit ${commit.commit.slice(0, SHORT_SHA)}` : `PR ${String(pr)}`
}

/** The heads left out, as the answer and the owner's menu say them: `Left out: PR n (package), why.` */
function theLeftOutSaid(left_out: readonly LeftOut[]): string {
  return left_out.map((out) => ` Left out: PR ${String(out.one.pr)} (${out.one.package}), ${out.why}.`).join('')
}

/** One head merged `--no-ff`, or why not: a clash is aborted and left to the head's builder. */
async function mergeOneHead(host: LandingHost, path: string, one: LandedWork): Promise<Step<true>> {
  const merged = await git(host, path, ['merge', '--no-ff', '--no-edit', '-m', theMergeMessage(one), one.head])
  if (merged.exit_code === 0) return { ok: true }
  await git(host, path, ['merge', '--abort'])
  return no(A_CLASH)
}

/** What a landing merge's subject opens with, before the pull request's number. */
const A_LANDING = 'Land #'

/** The message the merge carries: which pull request landed, which package it is, and that its verdict passed. */
const theMergeMessage = (one: LandedWork): string => `${A_LANDING}${String(one.pr)} (${one.package}, PASS)`

/** The pull request a landing merge's subject names, or undefined when the subject is not a landing's (martha#339). */
export function thePullRequestALandingNames(subject: string): number | undefined {
  if (!subject.startsWith(A_LANDING)) return undefined
  const number = Number.parseInt(subject.slice(A_LANDING.length), 10)
  return Number.isInteger(number) ? number : undefined
}

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

/** Pushes the integration branch, announced in the ledger of every package it lands before it runs. */
async function pushTheBatch(host: LandingHost, member: string, cut: TheCutBatch, merged: TheMerges): Promise<Landing> {
  const tip = await gitSaid(host, cut.batch.path, ['rev-parse', 'HEAD'])
  if (tip === undefined) return no(`${cut.branch} holds no commit git will name.`)
  const landed = merged.landed.map((one) => `${one.package} (PR ${String(one.pr)})`).join(', ')
  const what = `the batch ${cut.branch} of ${landed}`
  const packages = merged.landed.map((one) => one.package)
  const sent = await pushForEveryPackage(host, member, packages, {
    what,
    send: () => pushTheBranch(host, cut.batch.path, cut.branch, tip),
    look: () => theBranchOnOriginIsAt(host, cut.batch.path, cut.branch, tip),
  })
  if ('refused' in sent) return sent
  return { told: `${sent.sent}. The range the owner says yes to is ${cut.base}..${tip}, over ${landed}.` }
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


/**
 * Runs one outward act that lands several packages, through the recovery (martha#512 slice 2): every package's ledger
 * announces it before it runs and gets its outcome afterwards, a failure is read on origin through `look` before
 * anything is sent again, and the act is sent once more at most. A decision not to send it again is answered in the
 * recovery's own words.
 */
async function pushForEveryPackage(
  host: LandingHost,
  member: string,
  packages: readonly string[],
  push: { readonly what: string; readonly send: () => Promise<string>; readonly look: () => Promise<AnInspection> },
): Promise<{ readonly sent: string } | Refusal> {
  try {
    return { sent: await sendAnActOnEveryPackageAndRecover(host, { packages, member, act: { kind: 'push', what: push.what } }, push.send, push.look) }
  } catch (failure) {
    if (failure instanceof RecoveryDecided || failure instanceof PackagePaused) return no(failure.told)
    return no(`${push.what} was not sent: ${detailOf(failure)}.`)
  }
}

/** What origin holds of one branch: it is at the tip, it is not, or git could not say (thrown, so the look cannot tell). */
async function theBranchOnOriginIsAt(host: LandingHost, path: string, branch: string, tip: string): Promise<AnInspection> {
  const listed = await git(host, path, ['ls-remote', 'origin', `refs/heads/${branch}`])
  if (listed.exit_code !== 0) throw new Error(`git ls-remote did not work in ${path}: ${saidBy(listed)}`)
  const at = listed.stdout.trim().split(/\s+/)[0] ?? ''
  const read = `origin's ${branch}`
  if (at === tip) return { state: 'it_happened', read, found: `${branch} at ${tip}` }
  return { state: 'it_did_not_happen', read, found: at === '' ? `no ${branch}` : `${branch} at ${at}, not ${tip}` }
}

/**
 * Whether origin's default branch holds the tip: it does once the fast-forward happened, and still does after the branch
 * moved on past it, so a landing that went through is never pushed again (Mercurius, slice 2's ruling).
 */
async function theDefaultBranchHoldsTheTip(host: LandingHost, forward: TheFastForward): Promise<AnInspection> {
  const fetched = await git(host, forward.path, ['fetch', '--quiet', 'origin'])
  if (fetched.exit_code !== 0) throw new Error(`git fetch did not work in ${forward.path}: ${saidBy(fetched)}`)
  const origin = await readTheOriginACloneHas(host, forward.path)
  if ('refused' in origin) throw new Error(origin.refused)
  const branch = origin.origin.default_branch
  const holds = await git(host, forward.path, ['merge-base', '--is-ancestor', forward.tip, branch])
  const read = `origin's ${branchOf(branch)}`
  if (holds.exit_code === 0) return { state: 'it_happened', read, found: `${branchOf(branch)} holds ${forward.tip}` }
  if (holds.exit_code === 1) return { state: 'it_did_not_happen', read, found: `${branchOf(branch)} does not hold ${forward.tip}` }
  throw new Error(`git merge-base did not work in ${forward.path}: ${saidBy(holds)}`)
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
