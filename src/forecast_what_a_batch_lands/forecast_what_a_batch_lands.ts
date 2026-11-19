// What a batch would land, said before it is built (martha#339).
//
// This exists so a member knows, before the owner is asked, which passed pull requests of a batch land together, and for
// one that clashes by hand, which paths it clashes in and with what. `land_batch` with `check: 1` comes here: every passed
// head is merged in order in memory (`git merge-tree --write-tree`), each result chained on with `git commit-tree` into a
// commit no ref names. It writes no branch, no index and no working file, pushes nothing and adds no ledger row.
//
// A landing settles no clash: every path a merge clashes in is its builder's to settle. Each pull request gets one of
// these answers:
// - lands: it merges cleanly;
// - clashes by hand: the paths, and what each clashes with: an earlier pull request of the batch, or the landing on the
//   default branch that brought it (../find_where_a_merge_clashes);
// - left out with another: its head holds the head of a pull request that clashes by hand, so landing it would land that
//   one's unreviewed resolution too.
//
// A pull request that clashes by hand is left out of the chain, as the real landing leaves it out. The rule that leaves a
// head out with another, the words that name a clash and the length of a sha are the landing's own, imported, never
// spelled again here (martha#423). Told when every one lands; refused, naming each that does not, otherwise.

import { findTheWorkTheseVerdictsPassed, type LandedWork } from '../find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts'
import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import {
  mergedInMemory,
  whatEachPathClashesWith,
  type AStep,
} from '../find_where_a_merge_clashes/find_where_a_merge_clashes.ts'
import {
  SHORT_SHA,
  aFirstParentNamed,
  theBatchMayStart,
  theCloneSaysWhoCommits,
  theClashesSaid,
  theLeftOutHeadItHolds,
  type LandingHost,
  type Landing,
  type TheBatch,
} from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { readTheOriginACloneHas } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** What the dry run says it did not do, at the head of every answer. */
const NOTHING_WRITTEN = 'nothing was merged, written or pushed'

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** One pull request's answer in the dry run. */
type AForecast =
  | { readonly lands: LandedWork }
  | { readonly clashes: LandedWork; readonly with: ReadonlyMap<string, string> }
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
  if (merged.ok.clashed.size === 0) return theChainGrown(host, clone.path, chain, one, merged.ok.tree)
  const traced = await whatEachPathClashesWith(host, clone.path, one.head, chain.steps, [...merged.ok.clashed.keys()], aFirstParentNamed)
  if ('refused' in traced) return traced
  return { ok: { forecast: { clashes: one, with: traced.ok }, chain: { ...chain, left_out: [...chain.left_out, one] } } }
}

/** The chain grown by a pull request that lands: a commit no ref names, over the merged tree. */
async function theChainGrown(host: LandingHost, path: string, chain: TheChain, one: LandedWork, tree: string): Promise<Step<{ readonly forecast: AForecast; readonly chain: TheChain }>> {
  const made = await git(host, path, ['commit-tree', tree, '-p', chain.tip, '-p', one.head, '-m', `the dry run of PR ${String(one.pr)}`])
  if (made.exit_code !== 0) return { refused: `the dry run could not chain PR ${String(one.pr)}: ${saidBy(made)}.` }
  const tip = made.stdout.trim()
  return { ok: { forecast: { lands: one }, chain: { ...chain, tip, steps: [...chain.steps, { commit: tip, label: `PR ${String(one.pr)}` }] } } }
}

/** The dry run's answer: one line per pull request, told when every one lands and refused when one does not. */
function theAnswer(clone: TheClone, base: string, forecasts: readonly AForecast[]): Landing {
  const head = `The dry run of ${String(forecasts.length)} package(s) onto ${clone.default_branch} at ${short(base)} (${NOTHING_WRITTEN}):`
  const lines = [head, ...forecasts.map((forecast) => aLine(forecast))].join('\n')
  const not_landing = forecasts.filter((forecast) => !('lands' in forecast))
  return not_landing.length === 0 ? { told: lines } : { refused: lines }
}

/** One pull request's line. */
function aLine(forecast: AForecast): string {
  if ('lands' in forecast) return `- lands: ${theWork(forecast.lands)}`
  if ('clashes' in forecast) return `- clashes by hand: ${theWork(forecast.clashes)}: ${theClashesSaid(forecast.with)}`
  return `- left out with PR ${String(forecast.inside.pr)}: ${theWork(forecast.left_out)} holds its head, so it would land that one's clash too`
}

/** A pull request as an answer names it. */
const theWork = (one: LandedWork): string => `${one.package} (PR ${String(one.pr)})`

/** A sha as an answer shows it. */
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
