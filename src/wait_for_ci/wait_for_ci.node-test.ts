// Waiting on CI through the crew's one GitHub budget (martha#320, package B).
//
// What is pinned here: that a read of the runs on a sha answers green, red or still running as they stand; that a green
// the crew already holds is answered without a call at all, which is the whole point of one result kept for the crew;
// that a wait which will not end stops at its reads; and that a crew at its GitHub floor is told so rather than read
// into the floor.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, ProcessOutcome } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import {
  A_FRESH_BUDGET,
  BACKOFF_MIN_MS,
  CALLS_PER_WAIT,
  GITHUB_BUDGET_PLACE,
  THE_BUDGET_FILE,
  THE_FLOOR,
  theBudgetIn,
  theTextOf,
  type TheGithubSpender,
} from '../spend_the_github_budget/spend_the_github_budget.ts'
import { waitForCi } from './wait_for_ci.ts'

const A_SHA = 'e'.repeat(40)
const A_REPO = 'macula-io/martha'
const A_HOUR = MINUTE_MS * 60

/** A home of the tests: the crew's own directory, under a root the test removes. */
const home = mkdtempSync(join(tmpdir(), 'martha-320-ci-wait-'))
after(() => removeTheTree(home))

/** The crew's place for the budget, on this disk. */
const aPlace = (): CrewPlace => {
  const place = crewFilesDirectory(join(home, `crew-${String(Math.trunc(Math.random() * 1e9))}`)).place(GITHUB_BUDGET_PLACE)
  assert.ok(!('refusal' in place), 'the crew store refused its own place')
  return place
}

/** A clock the test moves by hand. */
const aClock = (start: number): { now: () => number } => {
  const held = { now: start }
  return { now: () => held.now }
}

/** What gh says when asked what the crew has left. */
const whatsLeft = (remaining: number): ProcessOutcome => ({
  exit_code: 0,
  stdout: JSON.stringify({ resources: { core: { remaining, reset: Math.trunc((Date.now() + A_HOUR) / 1000) } } }),
  stderr: '',
})

/** One run of GitHub's, as its answer names it. */
const aRun = (id: number, status: string, conclusion: string | null): Record<string, unknown> => ({ id, name: `a job of run ${String(id)}`, status, conclusion })

/** What GitHub answers for a page of runs. */
const theRuns = (...runs: readonly Record<string, unknown>[]): ProcessOutcome => ({ exit_code: 0, stdout: JSON.stringify({ workflow_runs: runs }), stderr: '' })

/** A runner that answers from a list, in order, and keeps what it was asked. */
const aRunner = (answers: readonly ProcessOutcome[]): { readonly asked: readonly string[][]; readonly run: (args: readonly string[]) => Promise<ProcessOutcome> } => {
  const asked: string[][] = []
  return {
    asked,
    run: async (args) => {
      asked.push([...args])
      return answers[asked.length - 1] ?? theRuns()
    },
  }
}

/** A spender over the place and the runner the test gives it, with a window the test wrote or none. */
const aSpender = (place: CrewPlace, clock: { now: () => number }, run: (args: readonly string[]) => Promise<ProcessOutcome>): TheGithubSpender => ({ place, clock, run })

/** The budget a test starts from: a window with plenty left and the wait before a call over. */
const withRoom = (now: number): typeof A_FRESH_BUDGET => ({ ...A_FRESH_BUDGET, remaining: THE_FLOOR * 10, resets_at: now + A_HOUR })

test('#320 B: the runs on a sha that all succeeded answer green, and the green is kept for the crew', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([whatsLeft(THE_FLOOR * 10), theRuns(aRun(1, 'completed', 'success'), aRun(2, 'completed', 'success'))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.deepEqual(outcome, { kind: 'green', run_ids: [1, 2], reused: false }, 'the runs that all succeeded did not answer green')
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), 'the budget could not be read back')
  assert.deepEqual(held.greens[A_SHA]?.run_ids, [1, 2], 'the green was not kept for the crew')
})

test('#320 B: a second wait on a green sha makes no call at all', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), greens: { [A_SHA]: { run_ids: [1, 2], at: clock.now() } } }))
  const runner = aRunner([])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.deepEqual(outcome, { kind: 'green', run_ids: [1, 2], reused: true }, 'the kept green was not answered')
  assert.deepEqual(runner.asked, [], 'a call was spent on a sha the crew already knew was green')
})

test('#320 B: a run that failed answers red, naming it, and its wait is over', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), reads: { [A_SHA]: CALLS_PER_WAIT - 1 } }))
  const runner = aRunner([theRuns(aRun(1, 'completed', 'success'), aRun(2, 'completed', 'failure'))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'red', 'a failed run did not answer red')
  assert.deepEqual(outcome.kind === 'red' ? outcome.ended.map((run) => run.id) : [], [2], 'the run that failed was not the one named')
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), 'the budget could not be read back')
  assert.equal(held.reads[A_SHA], undefined, 'a wait that ended kept its reads counted against it')
})

test('#320 B: a run that has not ended answers still running, with the moment another read may be spent', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const runner = aRunner([theRuns(aRun(1, 'in_progress', null))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'still_running', 'a run that has not ended did not answer still running')
  assert.equal(outcome.kind === 'still_running' ? outcome.read_again_at : 0, clock.now() + BACKOFF_MIN_MS, 'the moment of the next read was not the wait the call began')
})

test('#320 B: a wait that has spent its reads reads no more', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), reads: { [A_SHA]: CALLS_PER_WAIT } }))
  const runner = aRunner([])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'over_its_reads', 'a wait past its reads was read anyway')
  assert.deepEqual(runner.asked, [], 'a call was spent by a wait past its reads')
})

test('#320 B: a crew at its GitHub floor is told so, and no call is made', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), remaining: THE_FLOOR }))
  const runner = aRunner([])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'out_of_budget', 'a wait at the floor was read anyway')
  assert.match(outcome.kind === 'out_of_budget' ? outcome.refusal : '', new RegExp(String(THE_FLOOR)))
  assert.deepEqual(runner.asked, [], 'a call reached GitHub at the floor')
})

test('#320 B: a read GitHub cannot answer says so, rather than answering red', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const runner = aRunner([{ exit_code: 1, stdout: '', stderr: 'gh: could not resolve host' }])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'cannot_tell', 'a read that could not be made was answered as a red')
})
