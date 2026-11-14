// The range check before the owner says yes (martha#256, slice 1).
//
// This exists so the owner says yes to a range Martha has read and not to one a member typed. `verify_range` reads one
// clone and answers with the commits it holds, their diffstat, and one menu line — the line the owner reads. What it
// checks: that the base is the tip of the origin's default branch, that the tip descends from it, that the tip's tree
// carries no committed conflict marker, and, when the range names packages, that it is exactly one `--no-ff` merge per
// package, each at the head that package's reviewer passed and carrying no change of its own. It reads; it writes
// nothing, merges nothing, pushes nothing and registers a tool that does nothing but read.
//
// The CI runs on the tip are read from GitHub, one page of them with their jobs, and named on the line: a job that did
// not succeed, a run with no jobs, or no run at all is what the owner has to see before saying yes; a run that had to be
// read past the first page is said so too. A range that touches a workflow or an action adds "needs a by-eye read",
// because no job in this repository runs that change.
//
// A landing merge that clashed is not refused for that alone (martha#339): a landing that redid a generated file makes
// one, and the redo program's judge (`redo:generated -- --judge <merge>`) passes it only when it is what the redo makes
// and nothing more. The judge runs as a program, through npm in the clone, because a slice may not import a program; its
// rule is spelled once, there. An answer that does not open with the judge's own word is no judgement, so a clone whose
// program cannot judge yet refuses the merge rather than passing it.
//
// Every run of git carries marthasOwnGitArgs (../run_marthas_own_git) and goes through the contract's processes.run, as
// gh does. What the clone's origin says is read in one place (../read_the_origin_a_clone_has), and which work a package's
// verdict passed in another (../find_the_work_a_verdict_passed), so this slice decides neither for itself.

import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import {
  findTheWorkTheseVerdictsPassed,
  type LandedWork,
} from '../find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { SHORT_SHA, THE_REDO_SCRIPT } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { readTheOriginACloneHas } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT, GITHUB_CLI, NPM } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** The tool this slice registers. */
export const VERIFY_RANGE = 'verify_range'

/** The word the redo program's judge opens a pass with (martha#339); anything else it answers is not a pass. */
export const A_JUDGED_MERGE = 'judged'

/** GitHub answers a page of runs or jobs at a time; more than this on one tip is said on the line rather than hidden. */
const PER_PAGE = 100

/** A line that begins with one of these is a committed conflict marker, whatever the file holds it in. */
const CONFLICT_MARKER = '^(<<<<<<<|>>>>>>>) '

/** A change under one of these is not covered by any job of this repository, so the owner reads it by eye. */
const BY_EYE_PREFIXES: readonly string[] = ['.github/workflows/', '.github/actions/']

/** The range the owner is asked to say yes to: the clone it is read in, its ends, and the packages it lands. */
export interface TheRange {
  readonly path: string
  readonly base: string
  readonly tip: string
  /** The work packages the range lands, when it is a batch's integration branch; absent for a plain range. */
  readonly packages?: readonly string[]
}

/** What the check answered: the commits, their diffstat and the menu line; or why it has no line to show. */
export type CheckedRange = { readonly told: string } | { readonly refused: string }

/** What this needs of a host: its own git and gh, its clock and rows for the work a package's verdict passed. */
export type RangeCheckHost = Pick<HostContract, 'processes'> & LedgerHost

type Refusal = { readonly refused: string }
type Step<T> = { readonly ok: T } | Refusal
const no = (why: string): Refusal => ({ refused: why })

/** The range as it was read: the repository, the branch it is against, and its two ends as full shas. */
interface SettledRange {
  readonly repo: string
  readonly path: string
  readonly default_branch: string
  readonly base: string
  readonly tip: string
}

/** The commits and the diffstat the answer opens with, and the subjects that make the owner read it by eye. */
interface TheShape {
  readonly commits: string
  readonly stat: string
  readonly summary: string
  readonly by_eye: readonly string[]
}

/** One run of GitHub's, and the jobs under it, as far as this slice reads them. */
interface ACIRun {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

interface ACIJob {
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

/** Every run GitHub answered for on the tip, with each run's jobs. */
interface TheRuns {
  readonly runs: readonly ACIRun[]
  readonly jobs: ReadonlyMap<number, readonly ACIJob[]>
  readonly more_than_a_page: boolean
}

/** One commit of the range, as `git log` names it: its sha and its parents. */
interface ACommit {
  readonly sha: string
  readonly parents: readonly string[]
}

/**
 * Checks one range and answers with the commits, their diffstat and the menu line. Nothing is written: a refusal is
 * the whole answer, and it names what failed and why.
 */
export async function verifyRange(host: RangeCheckHost, range: TheRange): Promise<CheckedRange> {
  const settled = await theRangeSettled(host, range)
  if ('refused' in settled) return settled
  const work = await thePackagesInTheRange(host, settled.ok, range.packages)
  if ('refused' in work) return work
  const shape = await theShapeOf(host, settled.ok)
  if ('refused' in shape) return shape
  const ci = await theRunsAtTip(host, settled.ok)
  if ('refused' in ci) return ci
  return { told: [shape.ok.commits, shape.ok.stat, '', theLine(settled.ok, shape.ok, work.ok, ci.ok)].join('\n') }
}

/** What `verify_range` says it is for, as the launcher answers the mod's ask (martha#256). */
export const VERIFY_RANGE_DESCRIPTION =
  'Checks a range before the owner says yes: the base is the origin default branch tip, the tip descends from it, no conflict marker is committed, and, with packages, one --no-ff merge per package at the head its reviewer passed. Reads the CI runs on the tip and answers one menu line.'

/** The range a call of `verify_range` names, or why it names none: a path, two ends and, when it was given, the packages. */
export function theRangeACallNames(args: Readonly<Record<string, unknown>>): Step<TheRange> {
  const path = args['path']
  const base = args['base']
  const tip = args['tip']
  if (typeof path !== 'string' || path === '') return no('a range names the clone it is checked in, as path.')
  if (typeof base !== 'string' || base === '') return no('a range names its base, as base.')
  if (typeof tip !== 'string' || tip === '') return no('a range names its tip, as tip.')
  const packages = thePackagesAsked(args['packages'])
  if ('refused' in packages) return packages
  return { ok: packages.ok === undefined ? { path, base, tip } : { path, base, tip, packages: packages.ok } }
}

/** The packages a range lands, or why the list is not one; absent is a plain range, not an empty batch. */
function thePackagesAsked(value: unknown): Step<readonly string[] | undefined> {
  if (value === undefined) return { ok: undefined }
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    return no('packages is the list of work packages the range lands, each as owner/repo#n.')
  }
  return { ok: value as readonly string[] }
}

/** The range read against the origin: what the clone is of, and its two ends once they have been checked. */
async function theRangeSettled(host: RangeCheckHost, range: TheRange): Promise<Step<SettledRange>> {
  const fetched = await git(host, range.path, ['fetch', '--quiet', 'origin'])
  if (fetched.exit_code !== 0) return no(`git fetch did not work in ${range.path}: ${saidBy(fetched)}.`)
  const origin = await readTheOriginACloneHas(host, range.path)
  if ('refused' in origin) return origin
  const ends = await theEndsOfTheRange(host, range, origin.origin.default_branch)
  if ('refused' in ends) return ends
  const marked = await theTreeCarriesNoConflictMarker(host, range.path, ends.ok.tip)
  if ('refused' in marked) return marked
  return { ok: { repo: origin.origin.repo, path: range.path, default_branch: origin.origin.default_branch, ...ends.ok } }
}

/** The two ends of the range, once the base is the origin's default tip and the tip descends from it. */
async function theEndsOfTheRange(host: RangeCheckHost, range: TheRange, default_branch: string): Promise<Step<{ readonly base: string; readonly tip: string }>> {
  const at_the_head = await gitSaid(host, range.path, ['rev-parse', '--verify', '--quiet', default_branch])
  if (at_the_head === undefined) return no(`${range.path} cannot read ${default_branch}: fetch there, then try again.`)
  const base = await fullShaOf(host, range.path, range.base)
  if (base === undefined) return no(`${range.base} is not a commit in ${range.path}.`)
  if (base !== at_the_head) return no(`the base ${base} is not the tip of ${default_branch}, which is ${at_the_head}.`)
  const tip = await fullShaOf(host, range.path, range.tip)
  if (tip === undefined) return no(`${range.tip} is not a commit in ${range.path}.`)
  const descends = await git(host, range.path, ['merge-base', '--is-ancestor', base, tip])
  if (descends.exit_code !== 0) return no(`${tip} does not descend from ${base}: the range is not one line of work.`)
  return { ok: { base, tip } }
}

/** Nothing at the tip's tree begins as a conflict marker, or the files that do. */
async function theTreeCarriesNoConflictMarker(host: RangeCheckHost, path: string, tip: string): Promise<Step<true>> {
  const found = await git(host, path, ['grep', '-I', '-l', '-E', CONFLICT_MARKER, tip])
  if (found.exit_code === 1) return { ok: true }
  if (found.exit_code !== 0) return no(`${path} could not be searched for a conflict marker at ${tip}: ${saidBy(found)}.`)
  return no(`the tree at ${tip} holds a committed conflict marker: ${theFilesIn(found.stdout, tip).join(', ')}.`)
}

/** The files a `git grep -l` answer names, with the tree it searched taken off each line. */
function theFilesIn(said: string, tip: string): readonly string[] {
  return said
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => (line.startsWith(`${tip}:`) ? line.slice(tip.length + 1) : line))
}

/** The work the range's packages passed, once the range is exactly one `--no-ff` merge per package. */
async function thePackagesInTheRange(host: RangeCheckHost, settled: SettledRange, packages: readonly string[] | undefined): Promise<Step<readonly LandedWork[] | undefined>> {
  if (packages === undefined) return { ok: undefined }
  if (packages.length === 0) return no('the range names no package to check its merges against.')
  const work = await findTheWorkTheseVerdictsPassed(host, { packages, repo: settled.repo, cwd: settled.path })
  if ('refused' in work) return work
  const merges = await theMergesIn(host, settled.path, settled.base, settled.tip)
  if ('refused' in merges) return merges
  const matched = await theMergesMatch(host, settled.path, work.work, merges.ok)
  return 'refused' in matched ? matched : { ok: work.work }
}

/** The commits the range adds on its first parents, each of which has to be a merge. */
async function theMergesIn(host: RangeCheckHost, path: string, base: string, tip: string): Promise<Step<readonly ACommit[]>> {
  const said = await gitSaid(host, path, ['log', '--first-parent', '--format=%H %P', '--reverse', `${base}..${tip}`])
  if (said === undefined) return no(`${path} could not read the commits in ${base}..${tip}.`)
  const commits = said === '' ? [] : said.split('\n').map(aCommit)
  const plain = commits.find((commit) => commit.parents.length !== 2)
  if (plain !== undefined) {
    return no(`the commit ${short(plain.sha)} in the range is not a merge: a batch is one --no-ff merge per package.`)
  }
  return { ok: commits }
}

/** One line of `git log --format=%H %P` as the commit it names. */
function aCommit(line: string): ACommit {
  const [sha, ...parents] = line.trim().split(/\s+/)
  return { sha: sha ?? '', parents }
}

/** Each merge lands the head one package's verdict passed, exactly once, and carries no change of its own. */
async function theMergesMatch(host: RangeCheckHost, path: string, work: readonly LandedWork[], merges: readonly ACommit[]): Promise<Step<true>> {
  const passed = new Map(work.map((one) => [one.head, one]))
  const seen = new Set<string>()
  for (const merge of merges) {
    const landed = merge.parents[1] ?? ''
    const one = passed.get(landed)
    if (one === undefined) return no(`the merge ${short(merge.sha)} lands ${landed === '' ? 'no commit at all' : landed}, which no package here passed.`)
    if (seen.has(one.package)) return no(`${one.package} is merged twice: a batch is one merge per package.`)
    seen.add(one.package)
    const own = await carriesAChangeOfItsOwn(host, path, merge)
    if ('refused' in own) return no(`the merge ${short(merge.sha)} of ${one.package} (PR ${one.pr}): ${own.refused}`)
  }
  const missing = work.filter((one) => !seen.has(one.package))
  if (missing.length > 0) return no(`no merge lands ${missing.map((one) => `${one.package} (PR ${one.pr})`).join(', ')}.`)
  return { ok: true }
}

/**
 * Whether the merge's tree is the one merging its two parents writes: when it is not, the merge carries a change nobody
 * reviewed — an evil merge — and what would land is not what the reviewer passed.
 */
async function carriesAChangeOfItsOwn(host: RangeCheckHost, path: string, merge: ACommit): Promise<Step<true>> {
  const into = merge.parents[0] ?? ''
  const landed = merge.parents[1] ?? ''
  const tree = await gitSaid(host, path, ['rev-parse', `${merge.sha}^{tree}`])
  if (tree === undefined) return no('its tree could not be read.')
  const merging = await git(host, path, ['merge-tree', '--write-tree', into, landed])
  if (merging.exit_code === 1) return theJudgeOfARedoneMerge(host, path, merge, into, landed)
  if (merging.exit_code !== 0) return no(`merging ${short(into)} and ${short(landed)} does not go cleanly (${saidBy(merging)}).`)
  const written = merging.stdout.split('\n')[0]?.trim()
  return written === tree ? { ok: true } : no('it carries a change of its own, so what would land is not what passed.')
}

/**
 * A merge whose parents clash, judged by the redo program in the clone: passed only when the judge passes it in its own
 * word, and refused with the judge's words otherwise (martha#339).
 */
async function theJudgeOfARedoneMerge(host: RangeCheckHost, path: string, merge: ACommit, into: string, landed: string): Promise<Step<true>> {
  const judged = await host.processes.run({ command: NPM, args: ['run', '--silent', THE_REDO_SCRIPT, '--', '--judge', merge.sha], cwd: path })
  const clashes = `merging ${short(into)} and ${short(landed)} clashes`
  if (judged.exit_code !== 0) return no(`${clashes}, and it is not what a landing's redo makes: ${saidBy(judged)}.`)
  if (!judged.stdout.trim().startsWith(`${A_JUDGED_MERGE}: `)) return no(`${clashes}, and ${THE_REDO_SCRIPT} did not judge it (it answered ${JSON.stringify(judged.stdout.trim())}).`)
  return { ok: true }
}

/** The commits and the diffstat the answer opens with, and which subjects ask the owner to read by eye. */
async function theShapeOf(host: RangeCheckHost, settled: SettledRange): Promise<Step<TheShape>> {
  const range = [settled.base, settled.tip]
  const commits = await gitSaid(host, settled.path, ['log', '--format=%h %s', '--reverse', `${settled.base}..${settled.tip}`])
  const stat = await gitSaid(host, settled.path, ['diff', '--stat', ...range])
  const summary = await gitSaid(host, settled.path, ['diff', '--shortstat', ...range])
  const changed = await gitSaid(host, settled.path, ['diff', '--name-only', ...range])
  if (commits === undefined || stat === undefined || summary === undefined || changed === undefined) {
    return no(`${settled.path} could not read ${settled.base}..${settled.tip}.`)
  }
  return { ok: { commits, stat, summary: summary.trim(), by_eye: thePrefixesTouched(changed) } }
}

/** Which of the prefixes no job of this repository covers the range touches. */
function thePrefixesTouched(changed: string): readonly string[] {
  const paths = changed.split('\n').filter((one) => one !== '')
  return BY_EYE_PREFIXES.filter((prefix) => paths.some((one) => one.startsWith(prefix)))
}

/** Every run GitHub holds on the tip, with the jobs of each. */
async function theRunsAtTip(host: RangeCheckHost, settled: SettledRange): Promise<Step<TheRuns>> {
  const answer = await gh(host, settled.path, ['api', `repos/${settled.repo}/actions/runs?head_sha=${settled.tip}&per_page=${PER_PAGE}`])
  if (answer.exit_code !== 0) return no(`gh could not read the runs on ${settled.tip}: ${saidBy(answer)}.`)
  const page = runsIn(answer.stdout)
  if (page === undefined) return no(`gh answered for the runs on ${settled.tip} with something that is not a list of runs.`)
  const jobs = new Map<number, readonly ACIJob[]>()
  for (const run of page.runs) {
    const read = await theJobsOf(host, settled, run)
    if ('refused' in read) return read
    jobs.set(run.id, read.ok)
  }
  return { ok: { ...page, jobs } }
}

/** The jobs of one run, as GitHub holds them. */
async function theJobsOf(host: RangeCheckHost, settled: SettledRange, run: ACIRun): Promise<Step<readonly ACIJob[]>> {
  const answer = await gh(host, settled.path, ['api', `repos/${settled.repo}/actions/runs/${String(run.id)}/jobs?per_page=${PER_PAGE}`])
  if (answer.exit_code !== 0) return no(`gh could not read the jobs of run ${String(run.id)} on ${settled.tip}: ${saidBy(answer)}.`)
  const jobs = jobsIn(answer.stdout)
  if (jobs === undefined) return no(`gh answered for the jobs of run ${String(run.id)} with something that is not a list of jobs.`)
  return { ok: jobs }
}

/** GitHub's answer as the runs it holds, and whether it held more than one page of them. */
function runsIn(text: string): { readonly runs: readonly ACIRun[]; readonly more_than_a_page: boolean } | undefined {
  const parsed = asAnObject(text)
  const listed = parsed?.['workflow_runs']
  if (!Array.isArray(listed)) return undefined
  const runs = listed.filter(isARun)
  const total = parsed?.['total_count']
  return { runs, more_than_a_page: typeof total === 'number' && total > runs.length }
}

/** GitHub's answer as the jobs it holds, or undefined when it is not a list of them. */
function jobsIn(text: string): readonly ACIJob[] | undefined {
  const listed = asAnObject(text)?.['jobs']
  return Array.isArray(listed) ? listed.filter(isAJob) : undefined
}

/** Parsed JSON as an object with named members, or undefined when the text is not one. */
function asAnObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** Whether one entry of GitHub's answer carries the four fields this slice reads about a run. */
function isARun(value: unknown): value is ACIRun {
  const run = asARecord(value)
  return run !== undefined && typeof run['id'] === 'number' && typeof run['name'] === 'string' && typeof run['status'] === 'string' && isAConclusion(run['conclusion'])
}

/** Whether one entry carries the three fields this slice reads about a job. */
function isAJob(value: unknown): value is ACIJob {
  const job = asARecord(value)
  return job !== undefined && typeof job['name'] === 'string' && typeof job['status'] === 'string' && isAConclusion(job['conclusion'])
}

/** JSON's null, as GitHub writes a run that has not ended, or a conclusion as a word. */
const isAConclusion = (value: unknown): boolean => value === null || typeof value === 'string'

/** One entry of an answer as a record, or undefined when it is not one. */
const asARecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** The one menu line the owner reads: the range, how much of it there is, the CI on its tip and what needs an eye. */
function theLine(settled: SettledRange, shape: TheShape, work: readonly LandedWork[] | undefined, ci: TheRuns): string {
  const size = shape.summary === '' ? 'no file changed' : shape.summary
  const eye = shape.by_eye.length === 0 ? '' : `; needs a by-eye read (the range touches ${shape.by_eye.join(' and ')})`
  const packages = work === undefined ? '' : `; packages: ${work.map(landedWord).join(', ')}`
  return `${settled.repo} ${short(settled.base)}..${short(settled.tip)}: ${size}; ${theCILine(settled.tip, ci)}${eye}${packages}`
}

/** One package of a batch, as the line names it: which package, which pull request, and that its verdict passed. */
const landedWord = (one: LandedWork): string => `${one.package} (PR ${String(one.pr)}, PASS)`

/** What GitHub holds on the tip, said in one clause: no run at all, every job green, or each job that is not. */
function theCILine(tip: string, ci: TheRuns): string {
  if (ci.runs.length === 0) return `CI on ${short(tip)}: no run found`
  const jobs = [...ci.jobs.values()].reduce((count, listed) => count + listed.length, 0)
  const more = ci.more_than_a_page ? ` (more than the ${String(PER_PAGE)} read here)` : ''
  const head = `CI on ${short(tip)}: ${String(ci.runs.length)} runs, ${String(jobs)} jobs${more}`
  const problems = ci.runs.flatMap((run) => theProblemsOf(run, ci.jobs.get(run.id) ?? []))
  return problems.length === 0 ? `${head}, all green` : `${head}; ${problems.join('; ')}`
}

/** Every job of one run that is not a success, and a run that holds no job at all. */
function theProblemsOf(run: ACIRun, jobs: readonly ACIJob[]): readonly string[] {
  if (jobs.length === 0) return [`run ${String(run.id)} (${run.name}) has no jobs`]
  return jobs.flatMap((job) => (job.conclusion === 'success' ? [] : [`${run.name} job ${JSON.stringify(job.name)} ${howItEnded(job)}`]))
}

/** How a job that is not a success ended, in the words the run itself used. */
function howItEnded(job: ACIJob): string {
  if (job.status !== 'completed') return 'has not finished'
  return job.conclusion === null ? 'has no conclusion' : job.conclusion
}

/** The first seven characters of a sha, as the menu line shows it. */
const short = (sha: string): string => sha.slice(0, SHORT_SHA)

/** The commit a ref names, as its full sha; undefined when the clone does not hold it. */
const fullShaOf = (host: RangeCheckHost, cwd: string, ref: string): Promise<string | undefined> =>
  gitSaid(host, cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: GIT, args: marthasOwnGitArgs(args), cwd })
}

/** gh run in `cwd`. */
function gh(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: GITHUB_CLI, args, cwd })
}

/** What git or gh said, when it ended well; undefined when it did not. */
async function gitSaid(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout.trim() : undefined
}

/** What a process said it could not do, as one line: its own words, or the status it ended with when it said none. */
function saidBy(outcome: ProcessOutcome): string {
  const words = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
  return words === '' ? `it ended with ${String(outcome.exit_code)}` : (words.split('\n')[0] ?? words)
}
