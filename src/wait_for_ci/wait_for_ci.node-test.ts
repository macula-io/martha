// Waiting on CI through the crew's one GitHub budget (martha#320, package B).
//
// What is pinned here: that a read of the runs on a sha answers green, red or still running as they stand; that a run
// which ended without succeeding — failed, cancelled, timed out — is red and never a green kept for the crew; that a
// green the crew already holds is answered without a call at all, which is the whole point of one result kept for the
// crew; that a wait which will not end stops at its reads, and that a read the crew's wait refuses spends none of them;
// that a sha is read while another reader waits; and that a crew at its GitHub floor is told so rather than read into
// the floor.

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
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  CALLS_PER_WAIT,
  GITHUB_BUDGET_PLACE,
  THE_BUDGET_FILE,
  THE_FLOOR,
  theBudgetIn,
  theHeadsOfTheWaits,
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
  assert.equal(held.waits[A_SHA], undefined, 'a wait that ended kept its own wait, so the sha is not read from the start')
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

test('#320 B: a read the crew\'s wait refuses spends none of the wait\'s reads', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), last_call_at: clock.now(), backoff_ms: BACKOFF_MAX_MS }))
  const runner = aRunner([])
  const spender = aSpender(place, clock, runner.run)
  for (let i = 0; i < CALLS_PER_WAIT + 1; i += 1) await waitForCi(spender, { repo: A_REPO, sha: A_SHA })
  const outcome = await waitForCi(spender, { repo: A_REPO, sha: A_SHA })
  assert.deepEqual(runner.asked, [], 'a call was made inside the crew\'s wait')
  assert.equal(outcome.kind, 'out_of_budget', 'a wait that was refused every time was answered as over its reads')
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), 'the budget could not be read back')
  assert.equal(held.reads[A_SHA], undefined, 'a read that was never made was counted against the wait')
})

test('#320 B: two shas waiting are both read, so one member\'s wait does not hold another\'s', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const another = 'f'.repeat(40)
  const asked: string[] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push(args[args.length - 1] ?? '')
    return theRuns(aRun(1, 'completed', 'success'))
  }
  const spender = aSpender(place, clock, run)
  await waitForCi(spender, { repo: A_REPO, sha: A_SHA })
  await waitForCi(spender, { repo: A_REPO, sha: another })
  assert.equal(asked.length, 2, 'the second sha was held out by the wait the first one began')
})

test('#320 B: a sha is read while a package\'s head is backing off', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const asked: string[][] = []
  const head = 'a'.repeat(40)
  const listed = JSON.stringify([{ number: 1, headRefOid: head, state: 'OPEN', title: 'feat(#143): a thing', body: '' }])
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    return args[0] === 'pr' ? { exit_code: 0, stdout: listed, stderr: '' } : theRuns(aRun(1, 'completed', 'success'))
  }
  const spender = aSpender(place, clock, run)
  await theHeadsOfTheWaits(spender, ['macula-io/martha#143'])
  const outcome = await waitForCi(spender, { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'green', 'the wait on this sha was held by the wait on a package\'s head')
  assert.ok(asked.some((args) => args[0] === 'api'), 'no read of the runs was made while a head was backing off')
})

test('#320 B: a run that was cancelled or timed out answers red, never green', async () => {
  for (const conclusion of ['cancelled', 'timed_out']) {
    const place = aPlace()
    const clock = aClock(Date.now())
    place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
    const runner = aRunner([theRuns(aRun(1, 'completed', 'success'), aRun(2, 'completed', conclusion))])
    const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
    assert.equal(outcome.kind, 'red', `a ${conclusion} run was not answered as red`)
    const held = theBudgetIn(place)
    assert.ok(!('refusal' in held), 'the budget could not be read back')
    assert.equal(held.greens[A_SHA], undefined, `a ${conclusion} run was kept as a green for the whole crew`)
  }
})
