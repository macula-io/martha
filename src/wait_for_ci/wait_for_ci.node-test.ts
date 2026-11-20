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

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, ProcessOutcome } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { A_FRESH_BUDGET, BACKOFF_MAX_MS, BACKOFF_MIN_MS, CALLS_PER_WAIT, GITHUB_BUDGET_PLACE, THE_BUDGET_FILE, theBudgetIn, theHeadsOfTheWaits, theTextOf, type TheGithubSpender } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { waitForCi } from './wait_for_ci.ts'
import { GITHUB_WHEN_UNNAMED } from '../declare_crew/the_crews_github.ts'
import { CLOCK_ZONE_WHEN_UNNAMED, theClockOf } from '../declare_crew/the_crews_clock_zone.ts'
import { theCiWaitACallNames, theCiWaitOver } from './the_ci_wait_tool.ts'
/** The crew's default, as a declaration that names no block reads it (martha#931 B). */
const THE_FLOOR = GITHUB_WHEN_UNNAMED.budget_floor

const A_SHA = 'e'.repeat(40)
const A_REPO = 'macula-io/martha'
const A_HOUR = MINUTE_MS * 60

/** A home of the tests: the crew's own directory, under a root the test removes. */
const home = mkdtempSync(join(tmpdir(), 'martha-320-ci-wait-'))
after(() => removeTheTree(home))

/** The crew's place for the budget, on this disk. */
const aPlace = (): CrewPlace => {
  const place = keepTheCrewsFilesAsDirectories(join(home, `crew-${String(Math.trunc(Math.random() * 1e9))}`)).place(GITHUB_BUDGET_PLACE)
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

/** Whether `gh` was asked what the crew has left, which is the one read made before every other. */
const asksWhatIsLeft = (args: readonly string[]): boolean => args[1] === 'rate_limit'

/**
 * A runner that answers what GitHub is asked what is left with `left`, and every other read from a list, in order, so a
 * test says what each read of the crew's own came to and the question before it is not counted against that list.
 */
const aRunner = (
  answers: readonly ProcessOutcome[],
  left: ProcessOutcome = whatsLeft(THE_FLOOR * 10),
): { readonly asked: readonly string[][]; readonly run: (args: readonly string[]) => Promise<ProcessOutcome> } => {
  const asked: string[][] = []
  let read = 0
  return {
    asked,
    run: async (args) => {
      asked.push([...args])
      if (asksWhatIsLeft(args)) return left
      read += 1
      return answers[read - 1] ?? theRuns()
    },
  }
}

/** The reads of the runs a runner was asked, apart from the question asked before each. */
const theReadsOf = (asked: readonly (readonly string[])[]): readonly (readonly string[])[] => asked.filter((args) => !asksWhatIsLeft(args))

/** A spender over the place and the runner the test gives it, with a window the test wrote or none. */
const aSpender = (place: CrewPlace, clock: { now: () => number }, run: (args: readonly string[]) => Promise<ProcessOutcome>): TheGithubSpender => ({ place, clock, run, floor: THE_FLOOR, zone: CLOCK_ZONE_WHEN_UNNAMED })

/** The budget a test starts from: a window with plenty left and the wait before a call over. */
const withRoom = (now: number): typeof A_FRESH_BUDGET => ({ ...A_FRESH_BUDGET, remaining: THE_FLOOR * 10, resets_at: now + A_HOUR })

test('#320 B: the runs on a sha that all succeeded answer green, and the green is kept for the crew', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([theRuns(aRun(1, 'completed', 'success'), aRun(2, 'completed', 'success'))])
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
  const runner = aRunner([], whatsLeft(THE_FLOOR))
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'out_of_budget', 'a wait at the floor was read anyway')
  assert.match(outcome.kind === 'out_of_budget' ? outcome.refusal : '', new RegExp(String(THE_FLOOR)))
  // The question is asked even at the floor; the read of the runs, which GitHub charges for, is not.
  assert.deepEqual(theReadsOf(runner.asked), [], 'a read of the runs reached GitHub at the floor')
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
  const asked: string[][] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    if (asksWhatIsLeft(args)) return whatsLeft(THE_FLOOR * 10)
    return theRuns(aRun(1, 'completed', 'success'))
  }
  const spender = aSpender(place, clock, run)
  await waitForCi(spender, { repo: A_REPO, sha: A_SHA })
  await waitForCi(spender, { repo: A_REPO, sha: another })
  assert.equal(theReadsOf(asked).length, 2, 'the second sha was held out by the wait the first one began')
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
    if (asksWhatIsLeft(args)) return whatsLeft(THE_FLOOR * 10)
    return args[0] === 'pr' ? { exit_code: 0, stdout: listed, stderr: '' } : theRuns(aRun(1, 'completed', 'success'))
  }
  const spender = aSpender(place, clock, run)
  await theHeadsOfTheWaits(spender, ['macula-io/martha#143'])
  const outcome = await waitForCi(spender, { repo: A_REPO, sha: A_SHA })
  assert.equal(outcome.kind, 'green', 'the wait on this sha was held by the wait on a package\'s head')
  assert.ok(asked.some((args) => args[1]?.includes('actions/runs') === true), 'no read of the runs was made while a head was backing off')
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

test('#931 C: a wait still running names the moment of its next read in the spender\'s declared zone', async () => {
  const zone = 'Asia/Kolkata'
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const runner = aRunner([theRuns(aRun(1, 'in_progress', null))])
  const answered = await theCiWaitOver({ ...aSpender(place, clock, runner.run), zone }, { repo: A_REPO, sha: A_SHA })
  assert.ok('answer' in answered)
  assert.ok(answered.answer.endsWith(`may be spent at ${theClockOf(clock.now() + BACKOFF_MIN_MS, zone)}.`), `the next read's moment is not in the declared zone: ${answered.answer}`)
})

/** A run of GitHub's, as a wait on one run names it (martha#976). */
const A_RUN = 44773705880

/** What GitHub answers for one run: the run itself, not a page of runs (martha#976). */
const theOneRun = (run: Record<string, unknown>): ProcessOutcome => ({ exit_code: 0, stdout: JSON.stringify(run), stderr: '' })

/** The read a wait on one run makes, as the words `gh` was given name it. */
const theOneRunRead = (run_id: number): readonly string[] => ['api', `repos/${A_REPO}/actions/runs/${String(run_id)}`]

/** The key the crew files a run's green under, as crew-code files its record (martha#976). */
const theRunKey = (run_id: number): string => `run-${String(run_id)}`

test('#976: a wait on one run answers green with that run, spends one read, and keeps the green under the run', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([theOneRun(aRun(A_RUN, 'completed', 'success'))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, run_id: A_RUN })
  assert.deepEqual(outcome, { kind: 'green', run_ids: [A_RUN], reused: false }, 'one run that succeeded did not answer green with that run')
  assert.deepEqual(theReadsOf(runner.asked), [theOneRunRead(A_RUN)], 'the read was not the one run named')
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), 'the budget could not be read back')
  assert.deepEqual(held.greens[theRunKey(A_RUN)]?.run_ids, [A_RUN], 'the green was not kept under the run')
  assert.equal(held.greens[A_SHA], undefined, 'the green was filed under a commit nobody named')
})

test('#976: a second wait on a green run makes no call at all', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([theOneRun(aRun(A_RUN, 'completed', 'success'))])
  const spender = aSpender(place, clock, runner.run)
  await waitForCi(spender, { repo: A_REPO, run_id: A_RUN })
  const again = await waitForCi(spender, { repo: A_REPO, run_id: A_RUN })
  assert.deepEqual(again, { kind: 'green', run_ids: [A_RUN], reused: true }, 'the green kept for the run was not answered')
  assert.deepEqual(theReadsOf(runner.asked), [theOneRunRead(A_RUN)], 'a call was spent on a run the crew already knew was green')
})

test('#976: a run that has not ended answers still running, naming that run', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const runner = aRunner([theOneRun(aRun(A_RUN, 'in_progress', null))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, run_id: A_RUN })
  assert.equal(outcome.kind, 'still_running', 'a run that has not ended did not answer still running')
  assert.deepEqual(outcome.kind === 'still_running' ? outcome.ended.map((run) => run.id) : [], [A_RUN], 'the run named was not the one asked after')
  assert.equal(outcome.kind === 'still_running' ? outcome.read_again_at : 0, clock.now() + BACKOFF_MIN_MS, 'the moment of the next read was not the wait the call began')
})

test('#976: a run that ended red answers red, naming that run, and never a green', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([theOneRun(aRun(A_RUN, 'completed', 'failure'))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, run_id: A_RUN })
  assert.equal(outcome.kind, 'red', 'a failed run did not answer red')
  assert.deepEqual(outcome.kind === 'red' ? outcome.ended.map((run) => run.id) : [], [A_RUN], 'the run that failed was not the one named')
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), 'the budget could not be read back')
  assert.equal(held.greens[theRunKey(A_RUN)], undefined, 'a failed run was kept as a green for the whole crew')
})

test('#976: a call that names both forms, and one that names neither, are each refused by name', async () => {
  const both = theCiWaitACallNames({ repo: A_REPO, sha: A_SHA, run_id: A_RUN })
  assert.ok('refused' in both && /either a commit.*or a run id, not both/.test(both.refused), `naming both was not refused by name: ${JSON.stringify(both)}`)
  const neither = theCiWaitACallNames({ repo: A_REPO })
  assert.ok('refused' in neither && /either a commit, as forty hex digits, or a run id/.test(neither.refused), `naming neither was not refused by name: ${JSON.stringify(neither)}`)
  const notANumber = theCiWaitACallNames({ repo: A_REPO, run_id: 'a-run' })
  assert.ok('refused' in notANumber && /a run id is a whole number/.test(notANumber.refused), `a run id that is not a number was not refused by name: ${JSON.stringify(notANumber)}`)
  const named = theCiWaitACallNames({ repo: A_REPO, run_id: String(A_RUN) })
  assert.ok('ok' in named && named.ok.run_id === A_RUN, `a run id was not read as one: ${JSON.stringify(named)}`)
})

test('#976 review r=1: a run id too long to be held exactly is refused, never read as the run it rounds to', async () => {
  // Past the largest whole number a JavaScript number holds exactly, two ids round to one: the wait would read, and keep
  // a green for, a run nobody named.
  const tooLong = (BigInt(Number.MAX_SAFE_INTEGER) + 2n).toString()
  assert.notEqual(String(Number(tooLong)), tooLong, 'the planted id is held exactly, so it proves nothing')
  const asked = theCiWaitACallNames({ repo: A_REPO, run_id: tooLong })
  assert.ok('refused' in asked && /a run id is a whole number/.test(asked.refused), `a run id that rounds was read as another: ${JSON.stringify(asked)}`)
})

test('#976: a run GitHub does not answer for is cannot tell, never green', async () => {
  for (const answer of [{ exit_code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }, { exit_code: 0, stdout: '{"no_run": true}', stderr: '' }]) {
    const place = aPlace()
    const clock = aClock(Date.now())
    const runner = aRunner([answer])
    const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, run_id: A_RUN })
    assert.equal(outcome.kind, 'cannot_tell', `an answer that is not a run was read as one: ${JSON.stringify(outcome)}`)
    const held = theBudgetIn(place)
    assert.ok(!('refusal' in held), 'the budget could not be read back')
    assert.equal(held.greens[theRunKey(A_RUN)], undefined, 'an answer this could not read was kept as a green')
  }
})

test('#976: a green kept for a commit never answers a wait on a run, nor the other way round', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), greens: { [A_SHA]: { run_ids: [1, 2], at: clock.now() } } }))
  const runner = aRunner([theOneRun(aRun(A_RUN, 'completed', 'success'))])
  const outcome = await waitForCi(aSpender(place, clock, runner.run), { repo: A_REPO, run_id: A_RUN })
  assert.equal(outcome.kind, 'green', 'the wait on the run was not read')
  assert.deepEqual(theReadsOf(runner.asked), [theOneRunRead(A_RUN)], 'the green kept for a commit was served to a wait on a run')
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), 'the budget could not be read back')
  assert.deepEqual(held.greens[A_SHA]?.run_ids, [1, 2], 'the commit\'s own green was overwritten by a run\'s')
})

test('#976: a wait on a run names the run, not seven characters of a commit, in its answer', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), reads: { [theRunKey(A_RUN)]: CALLS_PER_WAIT } }))
  const runner = aRunner([])
  const spender = aSpender(place, clock, runner.run)
  const spent = await waitForCi(spender, { repo: A_REPO, run_id: A_RUN })
  assert.equal(spent.kind, 'over_its_reads', 'a wait on a run past its reads was read anyway')
  const answered = await theCiWaitOver(spender, { repo: A_REPO, run_id: A_RUN })
  assert.ok('answer' in answered && answered.answer.includes(`run ${String(A_RUN)}`), `the answer does not name the run: ${JSON.stringify(answered)}`)
  assert.ok('answer' in answered && answered.answer.endsWith('.') && !answered.answer.includes('run-run'), `the answer's name is not the run's: ${JSON.stringify(answered)}`)
})

