// The crew's one GitHub budget (martha#320, package B).
//
// What is pinned here: that the record asks GitHub what is left before it spends anything and spends nothing at all at
// its floor; that the question is asked before every call, so a token another reader spent down to the floor stops this
// crew too, and that the crew stops after as many calls as it was above its floor; that a call is followed by a wait
// that doubles to five minutes and then stays there, and that the wait belongs to the thing read, so two packages
// waiting are both read; that a crew whose store will not keep its count spends nothing; that a green found on a sha is
// answered for the crew's next wait without a call; that a read GitHub does not answer keeps the head it last showed
// rather than clearing the flag; and that a pull request is matched by a whole package number, so `#1434` is never the
// pull request of `#143`.
//
// The store is the crew's own, on a disk of the test's making (../crew_files_directory), so the record read back is the
// one a launch would have left, and the process runner is a stand-in that answers what the test says.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import type { CrewPlace, ProcessOutcome } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import {
  A_FRESH_BUDGET,
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  GITHUB_BUDGET_PLACE,
  THE_BUDGET_FILE,
  THE_FLOOR,
  keepTheHead,
  namesTheWholeNumber,
  readTheHeadOfAPackagesPullRequest,
  spendTheGithubBudget,
  theBudgetIn,
  theHeadsOfTheWaits,
  theNextBackoff,
  theTextOf,
  type TheBudget,
  type TheGithubSpender,
} from './spend_the_github_budget.ts'

/** The package the tests wait on. */
const A_PACKAGE = 'macula-io/martha#143'

/** A home of the tests: the crew's own directory, under a root the test removes. */
const home = mkdtempSync(join(tmpdir(), 'martha-320-budget-'))
after(() => removeTheTree(home))

/** The crew's place for the budget, on this disk. */
const aPlace = (): CrewPlace => {
  const place = crewFilesDirectory(join(home, `crew-${String(Math.trunc(Math.random() * 1e9))}`)).place(GITHUB_BUDGET_PLACE)
  assert.ok(!('refusal' in place), 'the crew store refused its own place')
  return place
}

/** A clock the test moves by hand, so a backoff is measured rather than waited out. */
const aClock = (start: number): { now: () => number; wait: (ms: number) => void } => {
  let now = start
  return { now: () => now, wait: (ms: number) => (now += ms) }
}

/** What gh says when asked what the crew has left. */
const whatsLeft = (remaining: number, reset_in_ms: number): ProcessOutcome => ({
  exit_code: 0,
  stdout: JSON.stringify({ resources: { core: { remaining, reset: Math.trunc((Date.now() + reset_in_ms) / 1000) } } }),
  stderr: '',
})

const anAnswer = (stdout: string): ProcessOutcome => ({ exit_code: 0, stdout, stderr: '' })

const aFailure = (stderr: string): ProcessOutcome => ({ exit_code: 1, stdout: '', stderr })

/** Whether `gh` was asked what the crew has left, which is the one read made before every other. */
const asksWhatIsLeft = (args: readonly string[]): boolean => args[1] === 'rate_limit'

/** What the tests' GitHub says is left, unless a test says otherwise: a window with plenty in it. */
const PLENTY_LEFT = whatsLeft(THE_FLOOR * 10, MINUTE_MS * 60)

/**
 * A runner that answers what GitHub is asked what is left with `left`, and every other read from a list, in order, so a
 * test says what each call of the crew's own reads and the question before it is not counted against that list.
 */
const aRunner = (
  answers: readonly ProcessOutcome[],
  left: ProcessOutcome = PLENTY_LEFT,
): { readonly asked: readonly string[][]; readonly run: (args: readonly string[]) => Promise<ProcessOutcome> } => {
  const asked: string[][] = []
  let read = 0
  return {
    asked,
    run: async (args) => {
      asked.push([...args])
      if (asksWhatIsLeft(args)) return left
      read += 1
      return answers[read - 1] ?? anAnswer('{}')
    },
  }
}

/** The reads of the list a runner was asked, apart from the question asked before each. */
const theReadsOf = (asked: readonly (readonly string[])[]): readonly (readonly string[])[] => asked.filter((args) => !asksWhatIsLeft(args))

/** A spender over the place and the runner the test gives it. */
const aSpender = (place: CrewPlace, clock: { now: () => number }, run: (args: readonly string[]) => Promise<ProcessOutcome>): TheGithubSpender => ({ place, clock, run })

/** The budget a test starts from: a window with plenty left, and the wait before a call over. GitHub resets its
 * allowance on the hour, which is longer than any wait a test moves its clock through. */
const withRoom = (now: number): TheBudget => ({ ...A_FRESH_BUDGET, remaining: THE_FLOOR * 10, resets_at: now + MINUTE_MS * 60 })

/** The record kept in the place, as the crew's store holds it. */
const theBudgetHeld = (place: CrewPlace): TheBudget => {
  const held = theBudgetIn(place)
  assert.ok(!('refusal' in held), `the budget could not be read back: ${JSON.stringify(held)}`)
  return held
}

test('#320 B: the budget asks GitHub what is left before it spends its first call', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([anAnswer('{"workflow_runs":[]}')], whatsLeft(THE_FLOOR * 20, MINUTE_MS * 60))
  const spent = await spendTheGithubBudget(aSpender(place, clock, runner.run), ['api', 'repos/macula-io/martha/actions/runs'])
  assert.ok(!('refusal' in spent), `the first call was refused: ${JSON.stringify(spent)}`)
  assert.deepEqual(runner.asked[0], ['api', 'rate_limit'], 'the budget did not ask GitHub what was left first')
  assert.deepEqual(runner.asked[1], ['api', 'repos/macula-io/martha/actions/runs'], 'the call the crew asked for was not the second one')
  const held = theBudgetHeld(place)
  assert.equal(held.calls, runner.asked.length, 'the record did not count both calls')
  assert.equal(held.remaining, THE_FLOOR * 20 - 1, 'what GitHub said is left was not kept, less the call it was spent on')
})

test('#320 B: at its floor the budget spends nothing, and says where the floor is', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([anAnswer('{}')])
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), remaining: THE_FLOOR }))
  const spent = await spendTheGithubBudget(aSpender(place, clock, runner.run), ['api', 'repos/macula-io/martha/actions/runs'])
  assert.ok('refusal' in spent, 'a call was spent at the floor')
  assert.match(spent.refusal, new RegExp(String(THE_FLOOR)))
  assert.deepEqual(runner.asked, [], 'a call reached GitHub at the floor')
})

test('#320 B: a call is followed by a wait that doubles to five minutes and then stays there', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const runner = aRunner([anAnswer('{}'), anAnswer('{}'), anAnswer('{}')], whatsLeft(THE_FLOOR * 20, MINUTE_MS * 60))
  const spender = aSpender(place, clock, runner.run)
  await spendTheGithubBudget(spender, ['api', 'one'])
  const tooSoon = await spendTheGithubBudget(spender, ['api', 'two'])
  assert.ok('refusal' in tooSoon, 'a second call was spent inside the wait')
  assert.match(tooSoon.refusal, /backing off until/)
  assert.equal(theBudgetHeld(place).backoff_ms, BACKOFF_MIN_MS, 'the first wait was not the shortest one')
  clock.wait(BACKOFF_MIN_MS)
  await spendTheGithubBudget(spender, ['api', 'three'])
  assert.equal(theBudgetHeld(place).backoff_ms, BACKOFF_MIN_MS * 2, 'the wait did not double')
  assert.equal(theNextBackoff(BACKOFF_MAX_MS), BACKOFF_MAX_MS, 'the wait grew past its longest')
})

test('#320 B: a read GitHub does not answer keeps the head it last showed', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const head = 'a'.repeat(40)
  place.keep(THE_BUDGET_FILE, theTextOf(keepTheHead(withRoom(clock.now()), A_PACKAGE, head, clock.now())))
  const runner = aRunner([aFailure('gh: no network')])
  const heads = await theHeadsOfTheWaits(aSpender(place, clock, runner.run), [A_PACKAGE])
  assert.ok(!('refusal' in heads), `the heads could not be read: ${JSON.stringify(heads)}`)
  assert.equal(heads[A_PACKAGE]?.head, head, 'a read GitHub could not answer cleared the head it had')
})

test('#320 B: a head GitHub does show is kept, and a pull request that names no package is not', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const head = 'd'.repeat(40)
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const listed = JSON.stringify([{ number: 7, headRefOid: head, state: 'OPEN', title: 'feat(#1434): another thing', body: '' }])
  const runner = aRunner([anAnswer(listed)])
  const heads = await theHeadsOfTheWaits(aSpender(place, clock, runner.run), [A_PACKAGE])
  assert.ok(!('refusal' in heads), `the heads could not be read: ${JSON.stringify(heads)}`)
  assert.equal(heads[A_PACKAGE], undefined, 'a pull request naming #1434 was taken for the one of #143')
})

test('#320 B: a pull request is matched by a whole package number, never a longer one beside it', () => {
  assert.equal(namesTheWholeNumber('feat(#143): a thing', 143), true)
  assert.equal(namesTheWholeNumber('feat(#1434): a thing', 143), false, '#1434 was taken for the pull request of #143')
  assert.equal(namesTheWholeNumber('feat(#1430): a thing', 1430), true)
  assert.equal(namesTheWholeNumber('plain text', 143), false)
})

test('#320 B: a head kept once is not re-stamped when the same head is seen again', () => {
  const at = 1_000
  const once = keepTheHead({ ...A_FRESH_BUDGET }, 'macula-io/martha#143', 'b'.repeat(40), at)
  const twice = keepTheHead(once, 'macula-io/martha#143', 'b'.repeat(40), at + MINUTE_MS)
  assert.equal(twice.heads['macula-io/martha#143']?.at, at, 'the moment the head was first seen was lost')
  const moved = keepTheHead(twice, 'macula-io/martha#143', 'c'.repeat(40), at + MINUTE_MS)
  assert.equal(moved.heads['macula-io/martha#143']?.at, at + MINUTE_MS, 'a moved head did not carry the moment it moved')
})

test('#320 B: a read that could not be made is never answered as "no pull request"', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const failed = aRunner([aFailure('gh: could not resolve host')])
  const unreadable = await readTheHeadOfAPackagesPullRequest(aSpender(place, clock, failed.run), { repo: 'macula-io/martha', number: 143 })
  assert.equal(unreadable.kind, 'cannot_tell', 'a read GitHub could not answer was answered as no pull request, which clears a flag it never saw')

  // A place of its own: the failed read above left the crew backing off, and that is a refusal, not this answer.
  const other = aPlace()
  other.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const none = aRunner([anAnswer('[]')])
  const missing = await readTheHeadOfAPackagesPullRequest(aSpender(other, clock, none.run), { repo: 'macula-io/martha', number: 143 })
  assert.equal(missing.kind, 'none', 'a repository with no pull request naming the package was not answered as none')
})

/** A head of the tests, so a package's pull request answers with one. */
const A_HEAD = 'f'.repeat(40)

/** One pull request, as GitHub lists it, naming the package number in its title. */
const aPullRequest = (number: number, head: string = A_HEAD): Record<string, unknown> => ({ number, headRefOid: head, state: 'OPEN', title: `feat(#${String(number)}): a thing`, body: '' })

/** A second work package, in the same public repository as the first. */
const ANOTHER_PACKAGE = 'macula-io/martha#144'

test('#320 B: two packages waiting are both read, so no reader holds the crew', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  const asked: string[][] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    if (asksWhatIsLeft(args)) return PLENTY_LEFT
    return anAnswer(JSON.stringify([aPullRequest(143, 'a'.repeat(40)), aPullRequest(144, 'b'.repeat(40))]))
  }
  const spender = aSpender(place, clock, run)
  const first = await theHeadsOfTheWaits(spender, [A_PACKAGE, ANOTHER_PACKAGE])
  assert.ok(!('refusal' in first), `the heads could not be read: ${JSON.stringify(first)}`)
  assert.equal(theReadsOf(asked).length, 2, 'the second package was not read while the first one was being read')
  assert.equal(first[ANOTHER_PACKAGE]?.head, 'b'.repeat(40), 'the second package\'s head was not kept')
  // A redraw six minutes on reads both again: each package's wait is its own, and neither has grown past that.
  clock.wait(BACKOFF_MAX_MS + MINUTE_MS)
  await theHeadsOfTheWaits(spender, [A_PACKAGE, ANOTHER_PACKAGE])
  assert.equal(theReadsOf(asked).length, 4, 'a package was skipped on the redraw after it was read')
})

test('#320 B: an old record\'s spacing has run out, and no read renews it', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  // A record written while the crew had one clock for everything: five minutes, from a call ten minutes ago.
  place.keep(THE_BUDGET_FILE, theTextOf({ ...withRoom(clock.now()), last_call_at: clock.now() - BACKOFF_MAX_MS * 2, backoff_ms: BACKOFF_MAX_MS }))
  const asked: string[][] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    if (asksWhatIsLeft(args)) return PLENTY_LEFT
    return anAnswer(JSON.stringify([aPullRequest(143, 'a'.repeat(40)), aPullRequest(144, 'b'.repeat(40))]))
  }
  const spender = aSpender(place, clock, run)
  await theHeadsOfTheWaits(spender, [A_PACKAGE])
  assert.equal(theReadsOf(asked).length, 1, 'the first package of a record whose spacing has run out was not read')
  await theHeadsOfTheWaits(spender, [A_PACKAGE, ANOTHER_PACKAGE])
  assert.equal(theReadsOf(asked).length, 2, 'the crew\'s spacing was renewed by a read that names what it reads, holding a new reader out')
})

test('#320 B: a thing\'s own wait is the one that holds it, and it holds nothing else', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf({
    ...withRoom(clock.now()),
    waits: { [A_PACKAGE]: { last_at: clock.now(), wait_ms: BACKOFF_MAX_MS } },
  }))
  const asked: string[][] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    if (asksWhatIsLeft(args)) return PLENTY_LEFT
    return anAnswer(JSON.stringify([aPullRequest(143, 'a'.repeat(40)), aPullRequest(144, 'b'.repeat(40))]))
  }
  const heads = await theHeadsOfTheWaits(aSpender(place, clock, run), [A_PACKAGE, ANOTHER_PACKAGE])
  assert.ok(!('refusal' in heads), `the heads could not be read: ${JSON.stringify(heads)}`)
  assert.equal(theReadsOf(asked).length, 1, 'the package held by its own wait was read anyway')
  assert.equal(heads[ANOTHER_PACKAGE]?.head, 'b'.repeat(40), 'the second package was held out by the first package\'s wait')
  assert.equal(heads[A_PACKAGE], undefined, 'the package held by its own wait answered a head it never read')
})

test('#320 B: a call comes down off what GitHub said is left, so the floor is reached by the crew\'s own spending', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  const toSpend = 7
  place.keep(THE_BUDGET_FILE, theTextOf({ ...A_FRESH_BUDGET, remaining: THE_FLOOR + toSpend, resets_at: clock.now() + MINUTE_MS * 60 * 100 }))
  const asked: string[][] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    return anAnswer('{}')
  }
  const spender = aSpender(place, clock, run)
  for (let i = 0; i < toSpend * 2; i += 1) {
    await spendTheGithubBudget(spender, ['api', 'x'])
    clock.wait(BACKOFF_MAX_MS + MINUTE_MS)
  }
  // Every call the crew made comes down off the count — the question asked before each read included, since an answer
  // this cannot read keeps the last flag rather than replacing it — so the crew stops after as many calls as it was
  // above its floor.
  assert.equal(asked.length, toSpend, `the crew spent ${String(asked.length)} calls from ${String(toSpend)} above its floor`)
  assert.equal(theBudgetHeld(place).remaining, THE_FLOOR, 'the count the crew held was never brought down by the calls spent')
})

test('#320 B: another spender on the same token is seen before the next call, and the crew stops at its floor', async () => {
  const place = aPlace()
  const clock = aClock(Date.now())
  place.keep(THE_BUDGET_FILE, theTextOf(withRoom(clock.now())))
  let left = THE_FLOOR * 2
  const asked: string[][] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    return asksWhatIsLeft(args) ? whatsLeft(left, MINUTE_MS * 60) : anAnswer('{}')
  }
  const spender = aSpender(place, clock, run)
  const first = await spendTheGithubBudget(spender, ['api', 'one'])
  assert.ok(!('refusal' in first), `the first call was refused: ${JSON.stringify(first)}`)
  // Another reader of the same token — the range check, the owner's list, a member's own `gh` — spends it below the
  // floor while the crew is between calls. The record still says plenty.
  left = THE_FLOOR - 1
  clock.wait(BACKOFF_MAX_MS + MINUTE_MS)
  const second = await spendTheGithubBudget(spender, ['api', 'two'])
  assert.ok('refusal' in second, 'a call was spent on a token another reader had already drained below the floor')
  assert.match(second.refusal, /is at its floor/, 'the refusal did not name the floor')
  assert.deepEqual(theReadsOf(asked), [['api', 'one']], 'the call refused at the floor reached GitHub anyway')
})

test('#320 B: a crew whose store will not keep its count spends nothing', async () => {
  const asked: string[][] = []
  const place: CrewPlace = { path: '/a/place/that/will/not/keep', read: () => undefined, keep: () => ({ refusal: 'the place is full' }), names: () => [] }
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push([...args])
    return anAnswer('{}')
  }
  const spent = await spendTheGithubBudget(aSpender(place, aClock(Date.now()), run), ['api', 'x'])
  assert.ok('refusal' in spent, 'a crew whose store would not keep its count spent a call anyway')
  assert.deepEqual(asked, [], 'a call reached GitHub although the count could not be kept')
})
