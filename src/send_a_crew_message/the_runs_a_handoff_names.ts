// The runs a HANDOFF names as its proof succeeded on its tip, and no run on that tip failed unnamed (martha#980
// package 4, a port of crew-code's prove_handoff_ci/handoff_ci_runs.ts; threat model: martha#980
// issuecomment-7049349078, rows T5, T6, T6b, T7 and T8).
//
// This exists so a reviewer is not handed a `ci=` that proves nothing: a run that failed, ran on another commit, or held
// no jobs has the shape of a run id too, and a failed run beside a green one is still a failed run on the work handed
// over. Before the message goes, the package's repository is asked for every run on the line's tip, in one read; a named
// run the tip's page does not hold is asked for by its id, and a named run that succeeded is asked for its jobs, as
// crew-code reads them (`jobs?filter=latest`, the Supervisor's ruling 3).
//
// What it comes to is a line, never a refusal (the Supervisor's ruling 4 under the owner's DECIDED 2026-11-20 "Yes,
// list then cut (Recommended)"): what failed is a notice saying exactly that, and what could not be read is
// `ci not verified (<why>): <what>`, as crew-code marks it.
//
// Every read goes through the crew's one GitHub budget (T6), so a line naming N runs costs at most 1 + N reads, and a
// budget at its floor reads nothing and marks the line. Each read is waited on as its own thing, so the reads of one
// line do not hold each other. Every `gh` is bounded at GH_MS by the spender the launch builds (T5).
//
// Run ids stay text end to end (T6b): GitHub's numeric `id` is compared as String(id), so an id past 2^53 never rounds
// onto a neighbour's. Nothing GitHub or `gh` says is carried into a line (T7): a run's name is never echoed, a
// conclusion or status only when it is one GitHub documents, and a failed `gh` only as its exit and HTTP status.
//
// Residual (T8): a failed attempt 1 under a green rerun passes; reading `attempts/1` would be a new check.

import { SECOND_MS } from '../declare_crew/the_crews_thresholds.ts'
import type { ProcessOutcome } from '../host_contract/host_contract.ts'
import { VALUE_SHAPES } from '../read_a_crew_line/crew_lines.ts'
import type { CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'
import { A_PAGE, AT_ITS_FLOOR, BACKING_OFF, spendTheGithubBudget, type TheGithubSpender } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { theRangeOf, type TheRange } from './the_commits_a_handoff_names.ts'

/** How long one `gh` may take, as crew-code bounds it. */
export const GH_MS = 20 * SECOND_MS

/** What `ci=` says when the line names no run on purpose: the tip's other runs are still read. */
const NO_RUN = 'none:'

/** The one conclusion that proves a named run, and those a run left out may end in without saying anything against the tip. */
const PROOF = 'success'
const QUIET: ReadonlySet<string> = new Set([PROOF, 'skipped', 'neutral'])

/** A run left out that stopped without testing the work, and one waiting for someone to approve it: each says what to do. */
const RERUN: ReadonlySet<string> = new Set(['cancelled', 'startup_failure'])
const APPROVE: ReadonlySet<string> = new Set(['action_required'])

/** The conclusions and statuses GitHub documents for a workflow run: the only ones a line may echo (T7). */
const CONCLUSIONS: ReadonlySet<string> = new Set([PROOF, 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale', 'startup_failure'])
const DONE = 'completed'
const STATUSES: ReadonlySet<string> = new Set([DONE, 'queued', 'in_progress', 'waiting', 'requested', 'pending'])

/** Why the runs could not be read: the words of a mark, each a fixed phrase. */
const DID_NOT_ANSWER = `${GITHUB_CLI} did not answer`
const COULD_NOT_RUN = `${GITHUB_CLI} could not run`
const UNREADABLE = 'GitHub answered with something this cannot read'
const MORE_THAN_A_PAGE = 'more runs than one page'
const THE_BUDGET = "the crew's GitHub budget could not be read"
const NOT_FOUND = /HTTP 404\b/
const A_SHA = /^[0-9a-f]{40}$/
const HTTP_STATUS = /\bHTTP ([0-9]{3})\b/

/** What a line asks of a fix, as crew-code says it. */
const FIX = 'Name only runs that succeeded on this exact tip, fix what failed, and send the line again.'

/** The mark a read nobody could make carries. */
const notVerified = (why: string, what: string): string => `ci not verified (${why}): ${what}`

/** One run as this reads it: its id as text, its full head sha, and GitHub's own status and conclusion. */
interface ARun {
  readonly id: string
  readonly head_sha: string
  readonly status: string
  readonly conclusion: string
}

/** A HANDOFF line with a `ci=`: its range, and the run ids it names, as text. */
interface TheLine {
  readonly range: TheRange
  readonly ids: readonly string[]
}

function theLineOf(line: CrewLineRead): TheLine | undefined {
  const range = theRangeOf(line)
  const ci = line.keys['ci']
  if (range === undefined || ci === undefined || !VALUE_SHAPES.ids.matches.test(ci)) return undefined
  return { range, ids: ci.startsWith(NO_RUN) ? [] : ci.split(',') }
}

/** What one read came to: the answer, or why there is none, in fixed words. */
type Read = { readonly said: ProcessOutcome } | { readonly why: string }

/** Why the budget held a read, in its own fixed words; a store it could not read is said as that, nothing more. */
function whyTheBudgetHeld(refusal: string): string {
  if (refusal.startsWith(AT_ITS_FLOOR)) return AT_ITS_FLOOR
  if (refusal.startsWith(BACKING_OFF)) return BACKING_OFF
  return THE_BUDGET
}

/** Why a `gh` that ran gave no answer: late, absent, or an exit with the HTTP status its stderr reports. */
function whyOf(said: ProcessOutcome): string {
  if (said.timed_out === true) return DID_NOT_ANSWER
  if (said.exit_code === null) return COULD_NOT_RUN
  const status = HTTP_STATUS.exec(said.stderr)?.[1]
  return `${GITHUB_CLI} exited ${String(said.exit_code)}${status === undefined ? '' : ` (HTTP ${status})`}`
}

/** One read of a GitHub path through the crew's budget, waited on as `of`. */
async function ask(spender: TheGithubSpender, path: string, of: string): Promise<Read> {
  const spent = await spendTheGithubBudget(spender, ['api', path], of).catch(() => undefined)
  if (spent === undefined) return { why: COULD_NOT_RUN }
  if ('refusal' in spent) return { why: whyTheBudgetHeld(spent.refusal) }
  return { said: spent.said }
}

/** Parsed JSON as an object with named members, or undefined. */
function anObject(text: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** One run as GitHub writes it, or undefined when it is not one. The id is kept as the text GitHub's number reads as. */
function aRunOf(raw: unknown): ARun | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const held = raw as Readonly<Record<string, unknown>>
  const id = held['id']
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || typeof held['head_sha'] !== 'string') return undefined
  const conclusion = typeof held['conclusion'] === 'string' ? held['conclusion'] : ''
  return { id: String(id), head_sha: held['head_sha'].toLowerCase(), status: String(held['status'] ?? ''), conclusion }
}

/** A page of runs, whole; or why it is not one: not a page, or more runs than it lists. */
function theRunsIn(text: string): { readonly runs: readonly ARun[] } | { readonly why: string } {
  const page = anObject(text)
  const listed = page?.['workflow_runs']
  if (!Array.isArray(listed)) return { why: UNREADABLE }
  if (Number(page?.['total_count'] ?? listed.length) > listed.length) return { why: MORE_THAN_A_PAGE }
  const runs = listed.map(aRunOf)
  return runs.every((run) => run !== undefined) ? { runs } : { why: UNREADABLE }
}

/** The runs on the tip, or why they could not be read. */
function theRunsRead(page: Read): { readonly runs: readonly ARun[] } | { readonly why: string } {
  if ('why' in page) return page
  if (page.said.exit_code !== 0 || page.said.timed_out === true) return { why: whyOf(page.said) }
  return theRunsIn(page.said.stdout)
}

/** A run's conclusion or status, as a line may say it: GitHub's documented word, or that it is not one. */
const saidAs = (word: string, known: ReadonlySet<string>, what: string): string => (known.has(word) ? word : `an unknown ${what}`)

const todoOf = (run: ARun): string => {
  if (RERUN.has(run.conclusion)) return ': rerun it'
  return APPROVE.has(run.conclusion) ? ': approve it on its run page' : ''
}

/** The lines a HANDOFF line's `ci=` comes to: a notice for what failed, a mark for what could not be read. */
export async function theRunsAHandoffNames(spender: TheGithubSpender, line: CrewLineRead): Promise<readonly string[]> {
  const read = theLineOf(line)
  if (read === undefined) return []
  const { range, ids } = read
  const page = await ask(spender, `repos/${range.repo}/actions/runs?head_sha=${range.tip}&per_page=${String(A_PAGE)}`, `handoff:${range.repo}@${range.tip}`)
  const onTheTip = theRunsRead(page)
  if ('why' in onTheTip) return [notVerified(onTheTip.why, `the runs on ${range.tip}`)]
  const runs = onTheTip.runs.filter((run) => run.head_sha === range.tip)
  const found: string[] = []
  for (const id of ids) found.push(...(await aNamedRun(spender, range, runs, id)))
  const loud = runs.filter((run) => !ids.includes(run.id) && run.status === DONE && !QUIET.has(run.conclusion))
  if (loud.length > 0) {
    const each = loud.map((run) => `run ${run.id}, which concluded ${saidAs(run.conclusion, CONCLUSIONS, 'conclusion')}${todoOf(run)}`)
    found.push(`HANDOFF ${range.package_name} leaves out ${each.join(' and ')}, on its tip ${range.tip} in ${range.repo}. ${FIX}`)
  }
  return found
}

/** What one named run comes to: nothing when it succeeded on the tip with jobs, a notice or a mark otherwise. */
async function aNamedRun(spender: TheGithubSpender, range: TheRange, runs: readonly ARun[], id: string): Promise<readonly string[]> {
  const by = `HANDOFF ${range.package_name} names run ${id}`
  const run = runs.find((seen) => seen.id === id)
  if (run === undefined) return await offTheTip(spender, range, id, by)
  if (run.status !== DONE) return [`${by}, which has not finished (${saidAs(run.status, STATUSES, 'status')}). ${FIX}`]
  if (run.conclusion !== PROOF) return [`${by}, which concluded ${saidAs(run.conclusion, CONCLUSIONS, 'conclusion')}, not ${PROOF}. ${FIX}`]
  return await withJobs(spender, range, id, by)
}

/** A named run that succeeded on the tip still has to have tested something. */
async function withJobs(spender: TheGithubSpender, range: TheRange, id: string, by: string): Promise<readonly string[]> {
  const jobs = await ask(spender, `repos/${range.repo}/actions/runs/${id}/jobs?filter=latest&per_page=1`, `handoff:${range.repo}#run-${id}`)
  if ('why' in jobs) return [notVerified(jobs.why, `the jobs of run ${id}`)]
  if (jobs.said.exit_code !== 0 || jobs.said.timed_out === true) return [notVerified(whyOf(jobs.said), `the jobs of run ${id}`)]
  const total = anObject(jobs.said.stdout)?.['total_count']
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return [notVerified(UNREADABLE, `the jobs of run ${id}`)]
  return total === 0 ? [`${by}, which holds no jobs: nothing was tested in it. ${FIX}`] : []
}

/** A named run the tip's page does not hold: on another commit, or no run at all. */
async function offTheTip(spender: TheGithubSpender, range: TheRange, id: string, by: string): Promise<readonly string[]> {
  const asked = await ask(spender, `repos/${range.repo}/actions/runs/${id}`, `handoff:${range.repo}#run-${id}`)
  if ('why' in asked) return [notVerified(asked.why, `run ${id}`)]
  if (asked.said.exit_code !== 0 && asked.said.timed_out !== true && NOT_FOUND.test(asked.said.stderr)) {
    return [`${by}, which ${range.repo} does not hold. ${FIX}`]
  }
  if (asked.said.exit_code !== 0 || asked.said.timed_out === true) return [notVerified(whyOf(asked.said), `run ${id}`)]
  const run = aRunOf(anObject(asked.said.stdout))
  // A head sha is echoed only in a sha's own shape (T7).
  if (run === undefined || !A_SHA.test(run.head_sha)) return [notVerified(UNREADABLE, `run ${id}`)]
  return [`${by}, which ran on ${run.head_sha}, not on its tip ${range.tip}. ${FIX}`]
}
