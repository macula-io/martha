// The crew's one GitHub budget (martha#320, package B).
//
// This exists so the members of one crew on one machine spend one token's GitHub allowance as one buyer, rather than as
// several blind ones. The instances are the crew's own: a 20 second poll cost the whole crew 18 minutes of refusals,
// every session read the same runs and nobody could tell what the others had already asked, and a read that could not
// be made was taken for a "no" and cleared a flag that was still true.
//
// One record, kept in the crew's own store, and what it holds:
//
//   - the calls the crew has spent;
//   - what GitHub itself says is left of the token's allowance and when that window resets, asked before every call the
//     wait allows — the one read GitHub does not charge against the core allowance — so the floor sees what everything
//     else on the same token spent too, and not only this crew: a token drained by another reader, by the range check or
//     by a member's own `gh` stops the crew at its floor just the same. An answer the crew cannot read keeps the count it
//     already held, and every call still comes down off it, so a count the crew keeps is never one that overstates what
//     is left;
//   - the wait in force for each thing the crew reads — a sha's runs, a package's head — so two readers do not hold
//     each other: a package backing off no longer stops a sha from being read. The wait grows per thing, from a minute
//     to five, and a thing's wait is over when the wait that held it ends;
//   - the crew's own spacing, which is what a thing the record has not read yet waits: it is left by the reads that name
//     nothing, so an old record's spacing is honoured instead of lost, and a read that says what it reads is never held
//     by the crew's last call of any kind;
//   - the green a wait found on a sha, so the next member's wait on that sha makes no call at all;
//   - the head last seen on a package's pull request, so a read GitHub did not answer keeps the last flag rather than
//     clearing it (../nudge_the_supervisor reads it as its head kind);
//   - how many reads one sha's wait has spent, so a wait that will not end stops costing calls.
//
// Every GitHub read of package B goes through spendTheGithubBudget: the runs on a sha, the head of a package's pull
// request, and the rate limit itself. Nothing outside this directory names `gh` with `run list` or `run watch`, and
// prove_the_core/one_place_asks_github fails by name when something does.
//
// The numbers are named once, here: a floor of five hundred calls left, a minute of backoff that doubles to five, and
// twelve reads for one wait. They are the crew's, not a declaration's: a crew cannot buy itself a bigger token by
// editing a file.

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { clockOf } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import type { CrewPlace, ProcessOutcome, Refused } from '../host_contract/host_contract.ts'

/** Where a crew keeps its GitHub budget, under the one crew store (../host_contract's CrewStore). */
export const GITHUB_BUDGET_PLACE = 'github_budget'

/** The one record it holds. */
export const THE_BUDGET_FILE = 'budget.json'

/** The calls GitHub says are left below which nothing more is spent: crew-code's floor, which this ports. */
export const THE_FLOOR = 500

/** The wait between two reads of GitHub, and the longest that wait grows to. */
export const BACKOFF_MIN_MS = MINUTE_MS
export const BACKOFF_MAX_MS = 5 * MINUTE_MS

/** How many reads one wait may spend on one sha before it waits to be asked again. */
export const CALLS_PER_WAIT = 12

/** How much of a list one read asks GitHub for. */
export const A_PAGE = 100

/** The one read that asks GitHub what the crew has left: core's own count, not a page of anything. */
const RATE_LIMIT_ARGS = ['api', 'rate_limit'] as const

/** The green a CI wait found on one sha, kept so the crew's next wait on it costs nothing. */
export interface GreenRun {
  readonly run_ids: readonly number[]
  /** When the runs on that sha were first seen green. */
  readonly at: number
}

/** The head GitHub last showed for a package's pull request, and when that head was first seen. */
export interface AHead {
  readonly head: string
  /** When this head was first recorded, which is when the head moved if it ever did. */
  readonly at: number
}

/** The wait in force for one thing the crew reads: when it was last read, and how long the next read of it waits. */
export interface AWait {
  readonly last_at: number
  readonly wait_ms: number
}

/** What the crew's store keeps, whole: one record every member of one crew spends from. */
export interface TheBudget {
  /** How many calls the crew has spent since the record began. */
  readonly calls: number
  /** What GitHub said is left of the allowance, less the crew's own calls since it said so; null until GitHub has said. */
  readonly remaining: number | null
  /** When that window resets, in milliseconds since the epoch; null until GitHub has said. */
  readonly resets_at: number | null
  /** When the crew's own spacing was last begun: the last call a read that named nothing made, 0 until one does. */
  readonly last_call_at: number
  /** The crew's spacing: the wait a thing the record has not read yet is given. */
  readonly backoff_ms: number
  /** The wait in force for each thing the crew reads, keyed by the sha or the work package named. */
  readonly waits: Readonly<Record<string, AWait>>
  readonly greens: Readonly<Record<string, GreenRun>>
  readonly heads: Readonly<Record<string, AHead>>
  readonly reads: Readonly<Record<string, number>>
}

/** What a crew that has spent nothing holds. */
export const A_FRESH_BUDGET: TheBudget = {
  calls: 0,
  remaining: null,
  resets_at: null,
  last_call_at: 0,
  backoff_ms: 0,
  waits: {},
  greens: {},
  heads: {},
  reads: {},
}

/** What the budget says about one call, before any is made. */
export type TheWord = { readonly may: true } | { readonly may: false; readonly refusal: string }

/**
 * The wait in force for what a read reads: a sha's own wait, or a package's, or the crew's spacing when the record has
 * not read that thing yet. A read that names nothing — `of` left out — waits the crew's spacing itself.
 *
 * A thing the record has not read takes the crew's spacing as it stands, so a record written before a thing had a wait
 * of its own is honoured rather than lost; and because nothing a read that names what it reads does renews the crew's
 * spacing, that wait runs out in minutes at the latest, never once per read.
 */
export function theWaitOn(budget: TheBudget, of: string | undefined): AWait {
  const crews = { last_at: budget.last_call_at, wait_ms: budget.backoff_ms }
  return of === undefined ? crews : (budget.waits[of] ?? crews)
}

/**
 * Whether the thing named by `of` is due now, or why it is not. This is judged before GitHub is asked anything, and it
 * is what makes a read the wait refuses cost the crew no call at all — neither the read nor the question before it.
 */
export function theWaitsWord(budget: TheBudget, now: number, of?: string): TheWord {
  const wait = theWaitOn(budget, of)
  const free_at = wait.last_at + wait.wait_ms
  if (wait.wait_ms > 0 && now < free_at) {
    return { may: false, refusal: `the crew's GitHub budget is backing off until ${clockOf(free_at)}.` }
  }
  return { may: true }
}

/** Why the crew may not spend a call at the count this record holds, or undefined when it may. */
export function theFloorsRefusal(budget: TheBudget): string | undefined {
  if (budget.remaining === null || budget.remaining > THE_FLOOR) return undefined
  const when = budget.resets_at === null ? '' : `, which resets at ${clockOf(budget.resets_at)}`
  return `the crew's GitHub budget is at its floor: ${String(budget.remaining)} calls left${when}.`
}

/** Whether the crew may spend one call at the count this record holds, or why it may not. */
export function theFloorsWord(budget: TheBudget): TheWord {
  const refusal = theFloorsRefusal(budget)
  return refusal === undefined ? { may: true } : { may: false, refusal }
}

/** The wait the call after this one is held for: a minute, then double it, to no longer than five. */
export const theNextBackoff = (backoff_ms: number): number =>
  backoff_ms === 0 ? BACKOFF_MIN_MS : Math.min(backoff_ms * 2, BACKOFF_MAX_MS)

/** The record after one call the crew made, whatever it read: the call is counted, and comes down off what is left. */
const aCallSpent = (budget: TheBudget): TheBudget => ({
  ...budget,
  calls: budget.calls + 1,
  remaining: budget.remaining === null ? null : Math.max(budget.remaining - 1, 0),
})

/**
 * The budget after one call was made at `now`, whatever GitHub answered. A call that could not be made at all is not
 * counted, so a machine with no `gh` never spends the crew's allowance.
 *
 * The call is one this crew spent, so what GitHub said is left comes down by it. The wait it begins belongs to what was
 * read, and grows from the shortest to the longest by that thing's own calls, so a reader cannot hold another. Only a
 * read that names nothing moves the crew's own spacing on, and the crew's spacing is never renewed by a read that names
 * what it reads: were it otherwise, every read would push back the first read of everything else until nothing new
 * could be read at all.
 */
export function afterACall(budget: TheBudget, now: number, of?: string): TheBudget {
  const spent = aCallSpent(budget)
  if (of !== undefined) {
    return { ...spent, waits: { ...budget.waits, [of]: { last_at: now, wait_ms: theNextBackoff(budget.waits[of]?.wait_ms ?? 0) } } }
  }
  return { ...spent, last_call_at: now, backoff_ms: theNextBackoff(budget.backoff_ms) }
}

/**
 * The budget after the one read that asks GitHub what is left. An answer this can read is the count itself, and takes the
 * place of the one the record held; an answer it cannot read — a `gh` that failed, or one that said something else —
 * keeps the last flag, with this call come down off it like any other. The read is counted as a call, and moves no wait:
 * the wait spaces out reads of the same thing, and this is the read that lets the next one be made at all.
 *
 * A count kept this way is never higher than the truth, so a crew that cannot hear GitHub stops at or above its floor
 * rather than eating into it.
 */
export function afterWhatIsLeft(budget: TheBudget, left: WhatIsLeft | undefined): TheBudget {
  const spent = aCallSpent(budget)
  return left === undefined ? spent : { ...spent, remaining: left.remaining, resets_at: left.resets_at }
}

/** The green kept for `sha`, or undefined when the crew has not seen one. */
export const theGreenRecorded = (budget: TheBudget, sha: string): GreenRun | undefined => budget.greens[sha]

/** The budget with a green kept on `sha`, and that sha's wait over: its reads and its wait go with it. */
export function keepTheGreen(budget: TheBudget, sha: string, run_ids: readonly number[], at: number): TheBudget {
  const waits = Object.fromEntries(Object.entries(budget.waits).filter(([read]) => read !== sha))
  const reads = Object.fromEntries(Object.entries(budget.reads).filter(([read]) => read !== sha))
  return { ...budget, greens: { ...budget.greens, [sha]: { run_ids, at } }, waits, reads }
}

/** The budget with a head kept for `package` at `now`, the moment it was first seen being that head. */
export function keepTheHead(budget: TheBudget, work_package: string, head: string, now: number): TheBudget {
  const heard = budget.heads[work_package]
  if (heard !== undefined && heard.head === head) return budget
  return { ...budget, heads: { ...budget.heads, [work_package]: { head, at: now } } }
}

/** How many reads this sha's wait has already spent. */
export const theReadsOn = (budget: TheBudget, sha: string): number => budget.reads[sha] ?? 0

/** The budget after one read of this sha, with the wait's count moved on by one. */
export const afterAReadOf = (budget: TheBudget, sha: string): TheBudget => ({
  ...budget,
  reads: { ...budget.reads, [sha]: theReadsOn(budget, sha) + 1 },
})

/** The budget with this sha's wait over, whatever it ended as: a red sha is read again from the start. */
export function theEndOfTheWait(budget: TheBudget, sha: string): TheBudget {
  const waits = Object.fromEntries(Object.entries(budget.waits).filter(([read]) => read !== sha))
  const reads = Object.fromEntries(Object.entries(budget.reads).filter(([read]) => read !== sha))
  return { ...budget, waits, reads }
}

/** Whether the window the record holds has turned since it was read, so GitHub has to be asked again. */
const theWindowHasTurned = (budget: TheBudget, now: number): boolean =>
  budget.resets_at !== null && now >= budget.resets_at

/**
 * Whether the record already reads at or below its floor for the window in force, and the window has not turned, so
 * GitHub can only confirm what the crew would be refused for. A count the crew keeps is never higher than the truth, so
 * nothing is lost by refusing here: there is no call to make and no count worth asking for.
 */
const theCrewIsOut = (budget: TheBudget, now: number): boolean =>
  budget.remaining !== null && budget.remaining <= THE_FLOOR && !theWindowHasTurned(budget, now)

/** What GitHub says the crew has left: the core allowance's count, and the second it resets at. */
export interface WhatIsLeft {
  readonly remaining: number
  readonly resets_at: number
}

/** What GitHub says the crew has left, or undefined when its answer is not one this reads. */
function whatIsLeftIn(text: string): WhatIsLeft | undefined {
  const core = asARecord(asARecord(aRecordIn(text)?.['resources'])?.['core'])
  const remaining = core?.['remaining']
  const reset = core?.['reset']
  if (typeof remaining !== 'number' || typeof reset !== 'number') return undefined
  // GitHub counts its window in seconds; every moment here is milliseconds since the epoch.
  return { remaining, resets_at: reset * 1000 }
}

/** Parsed JSON as an object with named members, or undefined when the text is not one. */
function aRecordIn(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return asARecord(parsed)
  } catch {
    return undefined
  }
}

/** One value as an object with named members, or undefined when it is not one. */
const asARecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

/** The budget the crew's store keeps, or why it may not be read: a place the host refuses, or a record that is not one. */
export function theBudgetIn(place: CrewPlace | Refused): TheBudget | Refused {
  if ('refusal' in place) return place
  const read = place.read(THE_BUDGET_FILE)
  if (read === undefined) return A_FRESH_BUDGET
  if ('refusal' in read) return read
  const held = aBudgetFrom(read.text)
  return held ?? { refusal: `${place.path} holds no GitHub budget this crew can read, so nothing may be spent.` }
}

/**
 * The budget `text` holds, or undefined when it holds none: every field of it, or it is nobody's budget. A record
 * written before a thing had a wait of its own holds no waits table, and reads as a crew that has not read anything yet.
 */
function aBudgetFrom(text: string): TheBudget | undefined {
  const held = aRecordIn(text)
  if (held === undefined) return undefined
  const counts = theCountsIn(held)
  if (counts === undefined) return undefined
  const { greens, heads, reads, waits } = held
  if (!isAGreenTable(greens) || !isAHeadTable(heads) || !isAReadTable(reads)) return undefined
  if (waits !== undefined && !isAWaitTable(waits)) return undefined
  return { ...counts, waits: waits ?? {}, greens, heads, reads }
}

/** The budget's five numbers, apart from the tables it holds. */
type TheCounts = Omit<TheBudget, 'waits' | 'greens' | 'heads' | 'reads'>

/** Those five numbers as a record holds them, or undefined when one of them is not a count it could hold. */
function theCountsIn(held: Record<string, unknown>): TheCounts | undefined {
  const { calls, remaining, resets_at, last_call_at, backoff_ms } = held
  if (!isACount(calls) || !isACount(backoff_ms) || !isACount(last_call_at)) return undefined
  if (!isACount(remaining) && remaining !== null) return undefined
  if (!isACount(resets_at) && resets_at !== null) return undefined
  return { calls, remaining, resets_at, last_call_at, backoff_ms }
}

const isACount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isAGreenTable = (value: unknown): value is Record<string, GreenRun> =>
  isATable(value, (one) => isACount(one['at']) && Array.isArray(one['run_ids']) && one['run_ids'].every(isACount))

const isAHeadTable = (value: unknown): value is Record<string, AHead> =>
  isATable(value, (one) => typeof one['head'] === 'string' && isACount(one['at']))

const isAWaitTable = (value: unknown): value is Record<string, AWait> =>
  isATable(value, (one) => isACount(one['last_at']) && isACount(one['wait_ms']))

const isAReadTable = (value: unknown): value is Record<string, number> => {
  const table = asARecord(value)
  return table !== undefined && Object.values(table).every(isACount)
}

/** Whether every entry of a table the store wrote holds what the table says it does. */
function isATable(value: unknown, each: (one: Record<string, unknown>) => boolean): boolean {
  const table = asARecord(value)
  if (table === undefined) return false
  return Object.values(table).every((one) => {
    const record = asARecord(one)
    return record !== undefined && each(record)
  })
}

/** The budget as the text the store keeps: whole, so a reader never sees half of one. */
export const theTextOf = (budget: TheBudget): string => `${JSON.stringify(budget)}\n`

/** Keeps the budget in the crew's store, or says why the store would not. */
export const keepTheBudget = (place: CrewPlace, budget: TheBudget): Refused | undefined =>
  place.keep(THE_BUDGET_FILE, theTextOf(budget))

/** What GitHub is asked through: the crew's place for the record, the clock, and how `gh` is run. */
export interface TheGithubSpender {
  readonly place: CrewPlace | Refused
  readonly clock: { readonly now: () => number }
  readonly run: (args: readonly string[]) => Promise<ProcessOutcome>
}

/** What one spent call came to: what `gh` answered and the budget after it, or why no call was made. */
export type Spent = { readonly said: ProcessOutcome; readonly budget: TheBudget } | Refused

/**
 * Spends one GitHub call through the crew's budget, in the one order that keeps both promises: the wait first, so a read
 * it refuses makes no call at all; then GitHub asked what is left, so the floor sees every other spender on the same
 * token and not only this crew; then the floor, and the call. A crew whose store will not keep its count spends nothing
 * — the count is the only thing that bounds it. `of` is what the call reads — a sha, or a work package — and is left out
 * by a read that names nothing.
 */
export async function spendTheGithubBudget(spender: TheGithubSpender, args: readonly string[], of?: string): Promise<Spent> {
  const place = spender.place
  if ('refusal' in place) return place
  const held = theBudgetIn(place)
  if ('refusal' in held) return held
  const writable = keepTheBudget(place, held)
  if (writable !== undefined) return writable
  const due = theWaitIsDue(spender, held, of)
  if ('refusal' in due) return due
  const learned = await theBudgetWithWhatIsLeft(spender, due.held)
  if ('refusal' in learned) return learned
  keepTheBudget(place, learned.budget)
  return await theCall(spender, place, learned.budget, args, of)
}

/** The record once the wait on `of` is known to be over, or why no call may be made before GitHub is asked anything. */
function theWaitIsDue(spender: TheGithubSpender, held: TheBudget, of?: string): { readonly held: TheBudget } | Refused {
  const now = spender.clock.now()
  const waited = theWaitsWord(held, now, of)
  if (!waited.may) return { refusal: waited.refusal }
  const floor = theCrewIsOut(held, now) ? theFloorsRefusal(held) : undefined
  return floor === undefined ? { held } : { refusal: floor }
}

/**
 * The budget once GitHub has been asked what is left: the count it answered, or the last flag kept when its answer is
 * not one this can read. With no count to keep, the crew has nothing to bound it by, and nothing is spent.
 */
async function theBudgetWithWhatIsLeft(
  spender: TheGithubSpender,
  budget: TheBudget,
): Promise<{ readonly budget: TheBudget } | Refused> {
  const said = await spender.run(RATE_LIMIT_ARGS)
  const learned = afterWhatIsLeft(budget, said.exit_code === 0 ? whatIsLeftIn(said.stdout) : undefined)
  if (learned.remaining !== null) return { budget: learned }
  return { refusal: couldNotSay(said) }
}

/** Why a crew with no count to go on spends nothing: in `gh`'s own words, or in the crew's. */
const couldNotSay = (said: ProcessOutcome): string =>
  said.exit_code === 0
    ? 'GitHub answered what the crew has left with something this cannot read.'
    : `GitHub could not say what the crew has left: ${saidBy(said)}.`

/** One GitHub call, once the budget allows it, with the record kept afterwards. */
async function theCall(spender: TheGithubSpender, place: CrewPlace, budget: TheBudget, args: readonly string[], of?: string): Promise<Spent> {
  const word = theFloorsWord(budget)
  if (!word.may) return { refusal: word.refusal }
  const said = await spender.run(args)
  const after = afterACall(budget, spender.clock.now(), of)
  // A store that will not keep this leaves the count short; the answer GitHub gave is real either way, and is returned.
  keepTheBudget(place, after)
  return { said, budget: after }
}

/** What `gh` said, in one clause: its own words, or that it ended with nothing to say. */
const saidBy = (said: ProcessOutcome): string => {
  const words = (said.stderr.trim() === '' ? said.stdout : said.stderr).trim().split('\n')[0] ?? ''
  return words === '' ? 'it said nothing' : words
}

/** One run GitHub holds on a sha, as far as a wait reads it. */
export interface ARun {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

/** What a read of the runs on a sha came to. */
export type RunsRead =
  | { readonly kind: 'read'; readonly runs: readonly ARun[] }
  | { readonly kind: 'out_of_budget'; readonly refusal: string }
  | { readonly kind: 'cannot_tell'; readonly refusal: string }

/** The runs GitHub holds on a sha, spent through the crew's budget, spaced by that sha's own wait. */
export async function readTheRunsOn(
  spender: TheGithubSpender,
  ask: { readonly repo: string; readonly sha: string },
): Promise<RunsRead> {
  const args = ['api', `repos/${ask.repo}/actions/runs?head_sha=${ask.sha}&per_page=${String(A_PAGE)}`]
  const spent = await spendTheGithubBudget(spender, args, ask.sha)
  if ('refusal' in spent) return { kind: 'out_of_budget', refusal: spent.refusal }
  const runs = theRunsIn(spent.said)
  if (runs === undefined) return { kind: 'cannot_tell', refusal: `GitHub answered for the runs on ${ask.sha} with something this cannot read.` }
  return { kind: 'read', runs }
}

/** GitHub's answer as the runs it holds, or undefined when the answer is not one or is a refusal. */
function theRunsIn(said: ProcessOutcome): readonly ARun[] | undefined {
  if (said.exit_code !== 0) return undefined
  const listed = aRecordIn(said.stdout)?.['workflow_runs']
  if (!Array.isArray(listed)) return undefined
  return listed.flatMap((one) => {
    const run = asARecord(one)
    if (run === undefined || !isACount(run['id']) || typeof run['name'] !== 'string') return []
    if (typeof run['status'] !== 'string' || !isAConclusion(run['conclusion'])) return []
    return [{ id: run['id'], name: run['name'], status: run['status'], conclusion: run['conclusion'] }]
  })
}

/** JSON's null, as GitHub writes the conclusion of a run that has not ended. */
const isAConclusion = (value: unknown): value is string | null => value === null || typeof value === 'string'

/** What a read of a package's pull request came to: the head GitHub shows, or that no pull request names it. */
export type HeadRead =
  | { readonly kind: 'head'; readonly head: string; readonly state: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'cannot_tell'; readonly refusal: string }

/**
 * The head GitHub shows on the pull request that names `number`, spent through the crew's budget and spaced by that
 * package's own wait. The number is matched as a whole one — `#1434` is not `#143` — in the title first and then in the
 * body, and the newest such pull request is the one read, since a package fixed after a review gets a second one.
 *
 * The reading of the design this departs from, said plainly: #256 of this crew has no pull-request reader, so this
 * matcher is new rather than reused, and the design's "rather than a second matcher" does not hold. It lives here, in
 * the one place that asks GitHub, so there is still one place to look.
 */
export async function readTheHeadOfAPackagesPullRequest(
  spender: TheGithubSpender,
  ask: { readonly repo: string; readonly number: number },
): Promise<HeadRead> {
  const args = ['pr', 'list', '--repo', ask.repo, '--state', 'all', '--json', 'number,headRefOid,state,title,body', '--limit', String(A_PAGE)]
  const spent = await spendTheGithubBudget(spender, args, `${ask.repo}#${String(ask.number)}`)
  if ('refusal' in spent) return { kind: 'cannot_tell', refusal: spent.refusal }
  const head = thePullRequestIn(spent.said, ask.number)
  if (head === 'unreadable') return { kind: 'cannot_tell', refusal: `GitHub answered for the pull requests of ${ask.repo} with something this cannot read.` }
  return head === undefined ? { kind: 'none' } : { kind: 'head', head: head.head, state: head.state }
}

/** The newest pull request whose title or body names `number`, 'unreadable' when GitHub's answer is not a list. */
function thePullRequestIn(said: ProcessOutcome, number: number): { readonly head: string; readonly state: string } | undefined | 'unreadable' {
  // A read that could not be made is never "no pull request": that would clear a flag GitHub never answered.
  if (said.exit_code !== 0) return 'unreadable'
  const listed = aListIn(said.stdout)
  if (listed === undefined) return 'unreadable'
  const found = listed.find((one) => {
    const pull = asARecord(one)
    return pull !== undefined && (namesTheWholeNumber(pull['title'], number) || namesTheWholeNumber(pull['body'], number))
  })
  const pull = asARecord(found)
  if (pull === undefined || typeof pull['headRefOid'] !== 'string' || typeof pull['state'] !== 'string') return undefined
  return { head: pull['headRefOid'], state: pull['state'] }
}

/** The repository a work package belongs to: the `org/name` of `org/repo#n`. */
const repoOf = (work_package: string): string => work_package.slice(0, work_package.indexOf('#'))

/** The number a work package names: the `n` of `org/repo#n`. */
const numberOf = (work_package: string): number => Number(work_package.slice(work_package.indexOf('#') + 1))

/**
 * The heads GitHub shows for the packages a crew waits on, each read through the budget, with the head last seen kept
 * when GitHub cannot be asked — so a flag that was true is not cleared by a read that failed. A package whose pull
 * request GitHub no longer shows keeps the head it had, for the same reason.
 */
export async function theHeadsOfTheWaits(
  spender: TheGithubSpender,
  work_packages: readonly string[],
): Promise<Readonly<Record<string, AHead>> | Refused> {
  const place = spender.place
  if ('refusal' in place) return place
  const first = theBudgetIn(place)
  if ('refusal' in first) return first
  for (const work_package of [...new Set(work_packages)]) {
    const read = await readTheHeadOfAPackagesPullRequest(spender, { repo: repoOf(work_package), number: numberOf(work_package) })
    if (read.kind !== 'head') continue
    const held = theBudgetIn(place)
    if ('refusal' in held) return held
    keepTheBudget(place, keepTheHead(held, work_package, read.head, spender.clock.now()))
  }
  const last = theBudgetIn(place)
  return 'refusal' in last ? last : last.heads
}

/** Parsed JSON as the list it holds, or undefined when the text is not one. */
function aListIn(text: string): readonly unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Whether `text` names `number` as a package number: `#143` in it yes, `#1434` and `x143` no. */
export const namesTheWholeNumber = (text: unknown, number: number): boolean =>
  typeof text === 'string' && new RegExp(`(?<![0-9])#${String(number)}(?![0-9])`).test(text)
