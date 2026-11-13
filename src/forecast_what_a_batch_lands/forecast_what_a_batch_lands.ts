// What a batch would land, said before it is built (martha#339).
//
// This exists so a member knows, before the owner is asked, which passed pull requests of a batch land together, and for
// one that clashes by hand, which paths it clashes in and with what. `land_batch` with `check: 1` comes here: every passed
// head is merged in order in memory (`git merge-tree --write-tree`), each result chained on with `git commit-tree` into a
// commit no ref names. It writes no branch, no index and no working file, pushes nothing and adds no ledger row.
//
// Each path a merge clashes in is classified by the redo program itself (`redo:generated -- --classify`), the one place
// its rule is spelled, run through npm in the clone because a slice may not import a program. Each pull request gets one
// of these answers:
// - lands;
// - lands, redone: the redo's words for what it would redo. This is a forecast: the redraw, the ceilings check, and the
//   type check and the suite before the push still run on the real landing;
// - clashes by hand: the paths, and what each clashes with: an earlier pull request of the batch, or the landing on the
//   default branch that brought it (../find_where_a_merge_clashes);
// - left out with another: its head holds the head of a pull request that clashes by hand, so landing it would land that
//   one's unreviewed resolution too.
//
// A pull request that clashes by hand is left out of the chain, as the real landing leaves it out. Told when every one
// lands; refused, naming each that does not, otherwise.

import { findTheWorkTheseVerdictsPassed, type LandedWork } from '../find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts'
import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import {
  mergedInMemory,
  whatEachPathClashesWith,
  type AFirstParent,
  type AMergeInMemory,
  type AStep,
  type TheStages,
} from '../find_where_a_merge_clashes/find_where_a_merge_clashes.ts'
import {
  THE_REDO_SCRIPT,
  theBatchMayStart,
  theCloneSaysWhoCommits,
  thePullRequestALandingNames,
  type LandingHost,
  type Landing,
  type TheBatch,
} from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { readTheOriginACloneHas } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT, NPM } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** How much of a sha an answer shows. */
const SHORT_SHA = 7

/** What a stage the classifier is handed reads when that side has no such file. */
const NO_STAGE = '-'

/** What the dry run says it did not do, at the head of every answer. */
const NOTHING_WRITTEN = 'nothing was merged, written or pushed'

/** What a forecast of a redone landing still has ahead of it. */
const STILL_AHEAD = 'a forecast: the redraw, the ceilings check, and the type check and the suite still run before the push'

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** One pull request's answer in the dry run. */
type AForecast =
  | { readonly lands: LandedWork; readonly redone: readonly string[] }
  | { readonly clashes: LandedWork; readonly with: ReadonlyMap<string, string>; readonly redone: readonly string[] }
  | { readonly left_out: LandedWork; readonly inside: LandedWork }

/** The chain as far as it has been merged: its tip, the steps a clash is traced along, and the heads left out. */
interface TheChain {
  readonly tip: string
  readonly steps: readonly AStep[]
  readonly left_out: readonly LandedWork[]
}

/** What a dry run reads in: the clone, and the branch its chain starts at. */
interface TheClone {
  readonly path: string
  readonly default_branch: string
}

/** The dry run of a batch: what each passed pull request would do, merged in order, and nothing written. */
export async function forecastWhatABatchLands(host: LandingHost, batch: TheBatch): Promise<Landing> {
  const started = await theBatchMayStart(host, batch)
  if ('refused' in started) return started
  const origin = await readTheOriginACloneHas(host, batch.path)
  if ('refused' in origin) return origin
  const identity = await theCloneSaysWhoCommits(host, batch.path)
  if ('refused' in identity) return identity
  const work = await findTheWorkTheseVerdictsPassed(host, { packages: batch.packages, repo: origin.origin.repo, cwd: batch.path })
  if ('refused' in work) return work
  const base = await gitSaid(host, batch.path, ['rev-parse', '--verify', '--quiet', origin.origin.default_branch])
  if (base === undefined) return { refused: `${batch.path} cannot read ${origin.origin.default_branch}: fetch there, then try again.` }
  const clone: TheClone = { path: batch.path, default_branch: origin.origin.default_branch }
  const forecasts = await everyForecast(host, clone, base, work.work)
  if ('refused' in forecasts) return forecasts
  return theAnswer(clone, base, forecasts.ok)
}

/** Each pull request's forecast, in the batch's order, each merged onto the chain the ones before it left. */
async function everyForecast(host: LandingHost, clone: TheClone, base: string, work: readonly LandedWork[]): Promise<Step<readonly AForecast[]>> {
  let chain: TheChain = { tip: base, steps: [{ commit: base, label: `${clone.default_branch} at ${short(base)}` }], left_out: [] }
  const forecasts: AForecast[] = []
  for (const one of work) {
    const next = await theForecastOf(host, clone, chain, one)
    if ('refused' in next) return next
    forecasts.push(next.ok.forecast)
    chain = next.ok.chain
  }
  return { ok: forecasts }
}

/** One pull request merged onto the chain in memory: its forecast, and the chain it leaves for the next. */
async function theForecastOf(host: LandingHost, clone: TheClone, chain: TheChain, one: LandedWork): Promise<Step<{ readonly forecast: AForecast; readonly chain: TheChain }>> {
  const inside = await theLeftOutHeadItHolds(host, clone.path, chain.left_out, one)
  if (inside !== undefined) return { ok: { forecast: { left_out: one, inside }, chain } }
  const merged = await mergedInMemory(host, clone.path, chain.tip, one.head)
  if ('refused' in merged) return merged
  const sorted = await theClashSorted(host, clone.path, merged.ok)
  if ('refused' in sorted) return sorted
  if (sorted.ok.by_hand.length === 0) return theChainGrown(host, clone.path, chain, one, merged.ok, sorted.ok.redone)
  const traced = await whatEachPathClashesWith(host, clone.path, one.head, chain.steps, sorted.ok.by_hand, nameAFirstParent)
  if ('refused' in traced) return traced
  return { ok: { forecast: { clashes: one, with: traced.ok, redone: sorted.ok.redone }, chain: { ...chain, left_out: [...chain.left_out, one] } } }
}

/** The head of a pull request left out that this one's head holds, if any: landing it would land that one too. */
async function theLeftOutHeadItHolds(host: LandingHost, path: string, left_out: readonly LandedWork[], one: LandedWork): Promise<LandedWork | undefined> {
  for (const earlier of left_out) {
    const holds = await git(host, path, ['merge-base', '--is-ancestor', earlier.head, one.head])
    if (holds.exit_code === 0) return earlier
  }
  return undefined
}

/** The paths a merge clashed in, split by the redo program: its words for each it redoes, and those it does not. */
async function theClashSorted(host: LandingHost, path: string, merged: AMergeInMemory): Promise<Step<{ readonly redone: readonly string[]; readonly by_hand: readonly string[] }>> {
  const redone: string[] = []
  const by_hand: string[] = []
  for (const [clashed, stages] of merged.clashed) {
    const classified = await classify(host, path, clashed, stages)
    if ('refused' in classified) return classified
    if (classified.ok.redone === undefined) by_hand.push(clashed)
    else redone.push(classified.ok.redone)
  }
  return { ok: { redone, by_hand } }
}

/** The redo program's answer on one clashed path: its words when it redoes it, none when the clash is by hand. */
async function classify(host: LandingHost, path: string, clashed: string, stages: TheStages): Promise<Step<{ readonly redone: string | undefined }>> {
  const blobs = [stages.base, stages.ours, stages.theirs].map((blob) => blob ?? NO_STAGE)
  const ran = await host.processes.run({ command: NPM, args: ['run', '--silent', THE_REDO_SCRIPT, '--', '--classify', clashed, ...blobs], cwd: path })
  if (ran.exit_code === 0) return { ok: { redone: ran.stdout.trim() } }
  if (ran.exit_code === 1) return { ok: { redone: undefined } }
  return { refused: `${THE_REDO_SCRIPT} could not classify ${clashed}: ${saidBy(ran)}.` }
}

/**
 * The chain grown by a pull request that lands: a commit no ref names, over the merged tree. When the redo would redo
 * something, the chain takes the earlier side of each redone path (`-X ours`), which is what the next merge is classified
 * against: a picture is redrawn whatever it holds, and package.json outside its ceilings is the same on both sides.
 */
async function theChainGrown(host: LandingHost, path: string, chain: TheChain, one: LandedWork, merged: AMergeInMemory, redone: readonly string[]): Promise<Step<{ readonly forecast: AForecast; readonly chain: TheChain }>> {
  const settled = redone.length === 0 ? { ok: merged } : await mergedInMemory(host, path, chain.tip, one.head, ['-X', 'ours'])
  if ('refused' in settled) return settled
  const made = await git(host, path, ['commit-tree', settled.ok.tree, '-p', chain.tip, '-p', one.head, '-m', `the dry run of PR ${String(one.pr)}`])
  if (made.exit_code !== 0) return { refused: `the dry run could not chain PR ${String(one.pr)}: ${saidBy(made)}.` }
  const tip = made.stdout.trim()
  return { ok: { forecast: { lands: one, redone }, chain: { ...chain, tip, steps: [...chain.steps, { commit: tip, label: `PR ${String(one.pr)}` }] } } }
}

/** A first-parent commit of the default branch, as a clash names it: the pull request its landing merged, or its sha. */
function nameAFirstParent(commit: AFirstParent): string {
  const pr = thePullRequestALandingNames(commit.subject)
  return pr === undefined ? `the commit ${short(commit.commit)}` : `PR ${String(pr)}`
}

/** The dry run's answer: one line per pull request, told when every one lands and refused when one does not. */
function theAnswer(clone: TheClone, base: string, forecasts: readonly AForecast[]): Landing {
  const head = `The dry run of ${String(forecasts.length)} package(s) onto ${clone.default_branch} at ${short(base)} (${NOTHING_WRITTEN}):`
  const lines = [head, ...forecasts.map(aLine)].join('\n')
  const not_landing = forecasts.filter((forecast) => !('lands' in forecast))
  return not_landing.length === 0 ? { told: lines } : { refused: lines }
}

/** One pull request's line. */
function aLine(forecast: AForecast): string {
  if ('lands' in forecast) {
    const named = theWork(forecast.lands)
    return forecast.redone.length === 0 ? `- lands: ${named}` : `- lands, redone: ${named}: ${forecast.redone.join('; ')} (${STILL_AHEAD})`
  }
  if ('clashes' in forecast) {
    const redone = forecast.redone.length === 0 ? '' : ` (it would redo ${forecast.redone.join('; ')})`
    return `- clashes by hand: ${theWork(forecast.clashes)}: ${theClashesSaid(forecast.with)}${redone}`
  }
  return `- left out with PR ${String(forecast.inside.pr)}: ${theWork(forecast.left_out)} holds its head, so it would land that one's clash too`
}

/** Each path a pull request clashes in, grouped by what it clashes with, in the order they were found. */
function theClashesSaid(clashes: ReadonlyMap<string, string>): string {
  const by_whom = new Map<string, string[]>()
  for (const [path, whom] of clashes) by_whom.set(whom, [...(by_whom.get(whom) ?? []), path])
  return [...by_whom].map(([whom, paths]) => `${paths.join(', ')} with ${whom}`).join('; ')
}

/** A pull request as an answer names it. */
const theWork = (one: LandedWork): string => `${one.package} (PR ${String(one.pr)})`

/** The first seven characters of a sha. */
const short = (sha: string): string => sha.slice(0, SHORT_SHA)

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: GIT, args: marthasOwnGitArgs(args), cwd })
}

/** What git said, when it ended well. */
async function gitSaid(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout.trim() : undefined
}

/** What a process said, as one line. */
function saidBy(outcome: ProcessOutcome): string {
  const words = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
  return words === '' ? `it ended with ${String(outcome.exit_code)}` : (words.split('\n')[0] ?? words)
}
