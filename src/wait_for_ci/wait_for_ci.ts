// Waiting on CI, through the crew's one GitHub budget (martha#320, package B).
//
// A member's turn is not held for the half hour a CI run can take, so a wait is asked for and answered as it stands
// now: green, red, still running, or the wait has spent its reads. Reading again is the member asking again, and the
// budget decides whether that read may be spent and when the next one may be: a minute, then two, then four, to five,
// measured on this sha's own wait, so a wait on another sha or a package's head does not hold it.
//
// Two things this gives the crew that one member's script cannot. A green on a sha is kept in the crew's store, so a
// second member's wait on the same sha costs no call at all. And a green is never asked for twice: what is green on a
// sha stays green, so the answer the second member reads is as good as the first's.
//
// This slice decides; ../spend_the_github_budget is the one place that asks. Nothing here names `gh`.
//
// The instances are crew-code's: a 20 second poll cost the whole crew 18 minutes of refusals, and two members waiting
// on one tip asked GitHub the same question twice.

import {
  CALLS_PER_WAIT,
  afterAReadOf,
  keepTheBudget,
  keepTheGreen,
  readTheRunsOn,
  theBudgetIn,
  theEndOfTheWait,
  theGreenRecorded,
  theReadsOn,
  theWaitOn,
  type ARun,
  type TheBudget,
  type TheGithubSpender,
} from '../spend_the_github_budget/spend_the_github_budget.ts'
import { clockOf } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import type { CrewPlace } from '../host_contract/host_contract.ts'

/** The tool a member calls to read the CI on a sha. */
export const WAIT_FOR_CI = 'wait_for_ci'

/** A commit, as a wait names one: the forty hex digits of a sha. */
export const A_COMMIT = /^[0-9a-f]{40}$/

/** What `wait_for_ci` says it is for, as the launcher answers the mod's ask. */
export const WAIT_FOR_CI_DESCRIPTION =
  'Reads the CI runs on one sha of a repository, through the crew’s own GitHub budget. Answers green (with the runs' +
  ' seen, and whether the answer was already kept for this crew), red, still running with the moment another read may' +
  ' be spent, or that this wait has spent its reads. It never holds the turn for the length of a run.'

/** What a wait was asked for: the repository, and the sha whose runs count. */
export interface TheCiWait {
  readonly repo: string
  readonly sha: string
}

/** What one read of the CI came to. */
export type CiOutcome =
  | { readonly kind: 'green'; readonly run_ids: readonly number[]; readonly reused: boolean }
  | { readonly kind: 'red'; readonly ended: readonly ARun[] }
  | { readonly kind: 'still_running'; readonly ended: readonly ARun[]; readonly read_again_at: number }
  | { readonly kind: 'cannot_tell'; readonly refusal: string }
  | { readonly kind: 'over_its_reads'; readonly refusal: string }
  | { readonly kind: 'out_of_budget'; readonly refusal: string }

/**
 * Reads the CI on one sha through the crew's budget, and answers as it stands. A green already kept for that sha is
 * answered without a call; a wait that has spent its reads answers so, naming the count; and every other read is
 * spent and spaced by the budget under that sha's own wait, so a member's read waits its turn but does not take another
 * reader's.
 *
 * A read the budget refuses makes no call, so it costs this wait none of its reads: the wait is spent only by the reads
 * GitHub was actually asked for. Counting it before the call would spend the wait's reads on the crew's spacing, and a
 * member calling again — which is what a wait is — would be told its wait was over without one call being made.
 */
export async function waitForCi(spender: TheGithubSpender, wait: TheCiWait): Promise<CiOutcome> {
  const place = spender.place
  if ('refusal' in place) return { kind: 'out_of_budget', refusal: place.refusal }
  const held = theBudgetIn(place)
  if ('refusal' in held) return { kind: 'out_of_budget', refusal: held.refusal }
  const green = theGreenRecorded(held, wait.sha)
  if (green !== undefined) return { kind: 'green', run_ids: green.run_ids, reused: true }
  if (theReadsOn(held, wait.sha) >= CALLS_PER_WAIT) return { kind: 'over_its_reads', refusal: overItsReads(wait.sha) }
  const read = await readTheRunsOn(spender, { repo: wait.repo, sha: wait.sha })
  if (read.kind === 'out_of_budget') return read
  const made = theBudgetIn(place)
  const counted = afterAReadOf('refusal' in made ? held : made, wait.sha)
  keepTheBudget(place, counted)
  return read.kind === 'cannot_tell' ? read : theAnswerTo(place, counted, wait.sha, read.runs, spender.clock.now())
}

/** The answer one read leaves: green kept for the crew, the wait over in either case, or the moment to read again. */
function theAnswerTo(
  place: CrewPlace,
  budget: TheBudget,
  sha: string,
  runs: readonly ARun[],
  now: number,
): CiOutcome {
  const notEnded = runs.filter((run) => run.status !== 'completed')
  if (runs.length === 0 || notEnded.length > 0) {
    const wait = theWaitOn(budget, sha)
    return { kind: 'still_running', ended: runs, read_again_at: wait.last_at + wait.wait_ms }
  }
  const notGreen = runs.filter((run) => run.conclusion !== 'success')
  if (notGreen.length > 0) {
    keepTheBudget(place, theEndOfTheWait(budget, sha))
    return { kind: 'red', ended: notGreen }
  }
  const run_ids = runs.map((run) => run.id)
  keepTheBudget(place, keepTheGreen(budget, sha, run_ids, now))
  return { kind: 'green', run_ids, reused: false }
}

/** Why a wait may not read again: it has spent the reads one wait is given, and something else must change first. */
const overItsReads = (sha: string): string =>
  `this wait on ${sha.slice(0, 7)} has spent the ${String(CALLS_PER_WAIT)} reads one wait is given; ask again once the branch or the run has changed.`

/**
 * What a wait answers, in the words a member reads. A green names how many runs it saw and whether the crew already
 * knew it; a red names the runs that did not pass; a wait still running names the moment its next read may be spent.
 */
export function theAnswerOf(outcome: CiOutcome, sha: string): string {
  if (outcome.kind === 'green') {
    const known = outcome.reused ? ' (already kept for this crew, so no call was made)' : ''
    return `green: ${String(outcome.run_ids.length)} run(s) on ${sha.slice(0, 7)} all succeeded${known}.`
  }
  if (outcome.kind === 'red') return `red: ${outcome.ended.map(theRunEnd).join('; ')}.`
  if (outcome.kind === 'still_running') {
    const ends = outcome.ended.map(theRunEnd).join('; ')
    const waiting = ends === '' ? 'no run answers to it yet' : ends
    return `still running: ${waiting}. Another read may be spent at ${clockOf(outcome.read_again_at)}.`
  }
  return outcome.refusal
}

/** One run, as a wait's answer names it: what it is called and how it ended, or that it has not. */
const theRunEnd = (run: ARun): string =>
  `${run.name} ${run.status === 'completed' ? (run.conclusion ?? 'ended with no conclusion') : 'has not finished'}`
