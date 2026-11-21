// martha#947: a launch's backlog read spends through the crew's GitHub budget, so its floor holds the read and each
// page's call is counted in the crew's record.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewPlace, ProcessOutcome, ProcessRequest, Processes, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { theClockOf } from '../declare_crew/the_crews_clock_zone.ts'
import { GITHUB_WHEN_UNNAMED } from '../declare_crew/the_crews_github.ts'
import { BACKOFF_MAX_MS, GITHUB_BUDGET_PLACE, THE_BUDGET_FILE } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { BACKLOG_PAGES_MOST } from './find_the_unheld_work.ts'
import { BACKLOG_READ_INTERVAL_MS, theBacklogNow, THE_READ_FILE, BACKLOG_PLACE, type TheKeptRead } from './keep_the_backlog_read.ts'
import { theBacklogPagesWait, theBacklogReaderIn } from './the_backlog_reader_of_a_launch.ts'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const AN_HOUR_MS = 60 * 60 * 1000
const RESETS_AT = NOW + AN_HOUR_MS

/** A zone that is not the one a crew gets when it names none, so a time read in the wrong zone shows. */
const ZONE = 'Asia/Kolkata'

/** A floor that is not the default one, so a reader that ignored the declared floor shows. */
const FLOOR = GITHUB_WHEN_UNNAMED.budget_floor + 211

/** A crew place held in memory. */
function aPlace(): CrewPlace & { readonly files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    path: '/a-crew-store/a-place',
    keep: (name, text) => void files.set(name, text),
    read: (name) => (files.has(name) ? { text: files.get(name) ?? '' } : undefined),
    names: () => [...files.keys()],
  }
}

/** The crew's stores, one place per name, made on first use. */
function theStores(): TheCrewFilesStores & { readonly at: (name: string) => CrewPlace & { readonly files: Map<string, string> } } {
  const places = new Map<string, ReturnType<typeof aPlace>>()
  const at = (name: string): ReturnType<typeof aPlace> => {
    const held = places.get(name) ?? aPlace()
    places.set(name, held)
    return held
  }
  return { at, crew: { place: at } }
}

/** GitHub's answer to what the crew has left. */
const left = (remaining: number): ProcessOutcome => ({
  exit_code: 0,
  stderr: '',
  stdout: JSON.stringify({ resources: { core: { remaining, reset: RESETS_AT / 1000 } } }),
})

/** One backlog page holding the issues numbered, and a cursor to the next page when there is one. */
const aPage = (next: string | null, ...numbers: readonly number[]): ProcessOutcome => ({
  exit_code: 0,
  stderr: '',
  stdout: JSON.stringify({
    data: {
      search: {
        pageInfo: { hasNextPage: next !== null, endCursor: next },
        nodes: numbers.map((number) => ({
          number,
          title: `Issue ${String(number)}`,
          createdAt: '2026-11-10T12:00:00Z',
          body: '',
          repository: { nameWithOwner: 'macula-io/martha' },
          labels: { nodes: [{ name: 'work-package' }] },
          timelineItems: { nodes: [] },
        })),
      },
    },
  }),
})

const asksWhatIsLeft = (args: readonly string[]): boolean => args[1] === 'rate_limit'

/** Processes whose `gh` answers the rate-limit question with `what_is_left` and each other call with the next page. */
function aGh(what_is_left: ProcessOutcome, ...pages: ProcessOutcome[]): Processes & { readonly asked: readonly (readonly string[])[] } {
  const asked: (readonly string[])[] = []
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    asked.push(request.args)
    if (asksWhatIsLeft(request.args)) return what_is_left
    return pages.shift() ?? { exit_code: 1, stdout: '', stderr: 'no page left in the test' }
  }
  return { asked, run } as unknown as Processes & { readonly asked: readonly (readonly string[])[] }
}

/** The calls the budget record says the crew has spent, 0 when it holds none. */
const theCallsIn = (place: CrewPlace & { readonly files: Map<string, string> }): number => {
  const text = place.files.get(THE_BUDGET_FILE)
  return text === undefined ? 0 : (JSON.parse(text) as { calls: number }).calls
}

const theReaderOver = (stores: TheCrewFilesStores, processes: Processes, now: number = NOW): ReturnType<typeof theBacklogReaderIn> =>
  theBacklogReaderIn({ stores, root: '/a-checkout', processes, ledger: { clock: { now: () => now } }, github: { budget_floor: FLOOR }, clock_zone: ZONE })

/** The waits the budget record holds, by key. */
const theWaitsIn = (place: CrewPlace & { readonly files: Map<string, string> }): readonly string[] =>
  Object.keys((JSON.parse(place.files.get(THE_BUDGET_FILE) ?? '{"waits":{}}') as { waits: Record<string, unknown> }).waits)

test('#947: at the declared floor a backlog read asks only what is left, makes no search call, and keeps the floor\'s words as its failure', async () => {
  const stores = theStores()
  const gh = aGh(left(FLOOR - 1), aPage(null, 1))
  const kept = (await theBacklogNow(theReaderOver(stores, gh), ['macula-io'])) as TheKeptRead
  assert.deepEqual(gh.asked.map((args) => args.join(' ')), ['api rate_limit'], 'the backlog read made a call past the crew\'s floor')
  assert.equal(
    kept.error,
    `the crew's GitHub budget is at its floor: ${String(FLOOR - 1)} calls left, which resets at ${theClockOf(RESETS_AT, ZONE)}.`,
  )
  assert.equal(kept.tried_at, NOW, 'a read the floor refused was not kept as a try')
  assert.deepEqual(kept.issues, [], 'a refused read was kept as a list')
  assert.equal(kept.read_at, null, 'a refused read was kept as a success')
  assert.equal(stores.at(BACKLOG_PLACE).files.has(THE_READ_FILE), true, 'the failed try was not kept')
})

test('#947: above the floor every page of a backlog read is spent through the crew\'s budget: two calls a page', async () => {
  const stores = theStores()
  const budget = stores.at(GITHUB_BUDGET_PLACE)
  const before = theCallsIn(budget)
  const gh = aGh(left(FLOOR + 1000), aPage('page-2', 1, 2), aPage(null, 3))
  const kept = (await theBacklogNow(theReaderOver(stores, gh), ['macula-io'])) as TheKeptRead
  assert.equal(kept.error, null, `the read failed: ${String(kept.error)}`)
  assert.deepEqual(kept.issues.map((issue) => issue.package), ['macula-io/martha#1', 'macula-io/martha#2', 'macula-io/martha#3'])
  assert.deepEqual(gh.asked.map((args) => asksWhatIsLeft(args)), [true, false, true, false], 'each page was not asked after the question of what is left')
  assert.equal(theCallsIn(budget), before + 4, 'the budget record does not count the read\'s two pages, each with its question')
})

test('#947: each page waits on its own key, at most BACKLOG_PAGES_MOST of them, and no page\'s wait holds the next read', async () => {
  assert.ok(BACKOFF_MAX_MS < BACKLOG_READ_INTERVAL_MS, 'a page\'s longest wait outlasts the read interval, so it would hold the next read')
  const stores = theStores()
  const budget = stores.at(GITHUB_BUDGET_PLACE)
  const pages = (from: number): ProcessOutcome[] => Array.from({ length: BACKLOG_PAGES_MOST }, (_, at) => aPage(`after-${String(from + at)}`, from + at))
  const first = (await theBacklogNow(theReaderOver(stores, aGh(left(FLOOR + 1000), ...pages(1))), ['macula-io'])) as TheKeptRead
  assert.equal(first.error, null, `the read failed: ${String(first.error)}`)
  assert.equal(first.cut, true)
  const keys = Array.from({ length: BACKLOG_PAGES_MOST }, (_, at) => theBacklogPagesWait(at + 1))
  assert.deepEqual([...theWaitsIn(budget)].sort(), [...keys].sort(), 'the pages did not each wait on their own key')
  const next = (await theBacklogNow(theReaderOver(stores, aGh(left(FLOOR + 1000), ...pages(100)), NOW + BACKLOG_READ_INTERVAL_MS), ['macula-io'])) as TheKeptRead
  assert.equal(next.error, null, `the next read was held: ${String(next.error)}`)
  assert.equal(next.read_at, NOW + BACKLOG_READ_INTERVAL_MS)
  assert.deepEqual([...theWaitsIn(budget)].sort(), [...keys].sort(), 'a second read added keys to the record')
})
