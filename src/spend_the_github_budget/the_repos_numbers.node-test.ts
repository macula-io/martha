// The repo's three drift numbers (martha#1010's addendum): four searches a day for each repo the crew's packages name,
// through the crew's one budget, kept as a row per repo per day. Nothing here refuses; a read GitHub does not answer
// leaves no row, so the next read tries again rather than keeping a number nobody said.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { A_DAY_MS, DAYS_KEPT, GITHUB_DRIFT_PLACE, THE_DRIFT_FILE, dayOf, keepTheDriftRecord, theDriftReadToday, theDriftRecordIn, type TheDriftRecord } from './the_repos_numbers.ts'
import type { TheGithubSpender } from './spend_the_github_budget.ts'

const REPO = 'macula-io/martha'
const NOW = Date.parse('2026-11-20T12:00:00Z')

/** The moment the crew's budget is told it may spend again: the day after now. */
const THE_WINDOW_RESETS_AT = Math.trunc((NOW + A_DAY_MS) / 1000)

/** The searches this test's GitHub knows a count for, by the query's own words. */
const aGithubOf = (counts: Readonly<Record<string, number>>): { readonly crew: string; readonly asked: string[][]; readonly spender: TheGithubSpender } => {
  const asked: string[][] = []
  const run = async (args: readonly string[]) => {
    asked.push([...args])
    if (args.includes('rate_limit')) {
      return { exit_code: 0, stdout: JSON.stringify({ resources: { core: { remaining: 5_000, reset: THE_WINDOW_RESETS_AT } } }), stderr: '' }
    }
    const url = args[1] ?? ''
    const query = decodeURIComponent(url.slice(url.indexOf('q=') + 2))
    const count = counts[query]
    if (count === undefined) return { exit_code: 1, stdout: '', stderr: 'Bad credentials' }
    return { exit_code: 0, stdout: JSON.stringify({ total_count: count }), stderr: '' }
  }
  const crew = mkdtempSync(join(tmpdir(), 'martha-1010-numbers-'))
  const place = keepTheCrewsFilesAsDirectories(crew).place(GITHUB_DRIFT_PLACE)
  if ('refusal' in place) throw new Error(`the test's own crew store would not give a place: ${place.refusal}`)
  return {
    crew,
    asked,
    spender: { place, clock: { now: () => NOW }, run, floor: 0, zone: 'UTC' },
  }
}

/** Every query a repo's four numbers are read with, and what this test's GitHub answers each. */
const THE_COUNTS = {
  [`repo:${REPO} is:issue is:open`]: 123,
  [`repo:${REPO} is:issue is:open updated:<${dayOf(NOW - 3 * A_DAY_MS)}`]: 68,
  [`repo:${REPO} is:pr`]: 641,
  [`repo:${REPO} is:pr is:closed is:unmerged`]: 84,
}

/** The searches an ask made: the rate-limit questions taken out, since the budget asks one before every call. */
const theSearches = (asked: readonly string[][]): readonly string[] => asked.filter((args) => !args.includes('rate_limit')).map((args) => args[1] ?? '')

test('#1010 B: a repo is read four times through the budget, and its numbers are kept for the day', async (t: TestContext) => {
  const github = aGithubOf(THE_COUNTS)
  t.after(() => removeTheTree(github.crew))

  const record = await theDriftReadToday(github.spender, [REPO], NOW, 3)
  assert.deepEqual(record[REPO]?.[dayOf(NOW)], { open_issues: 123, untouched_issues: 68, abandoned_prs: 84, all_prs: 641 })
  assert.equal(theSearches(github.asked).length, 4, `a repo's numbers cost more than the four search reads: ${JSON.stringify(theSearches(github.asked))}`)
  assert.deepEqual(theDriftRecordIn(github.spender.place)[REPO]?.[dayOf(NOW)], record[REPO]?.[dayOf(NOW)], 'the numbers were read and not kept')
})

test('#1010 B: a number read today is never asked for again today', async (t: TestContext) => {
  const github = aGithubOf(THE_COUNTS)
  t.after(() => removeTheTree(github.crew))

  await theDriftReadToday(github.spender, [REPO], NOW, 3)
  const before = theSearches(github.asked).length
  const again = await theDriftReadToday(github.spender, [REPO], NOW + 60_000, 3)
  assert.equal(theSearches(github.asked).length, before, 'a second read the same day asked GitHub again')
  assert.equal(again[REPO]?.[dayOf(NOW)]?.open_issues, 123, 'the numbers kept for today were not read back')
})

test('#1010 B: a read GitHub does not answer keeps no row, so the next read asks again', async (t: TestContext) => {
  const abandoned = `repo:${REPO} is:pr is:closed is:unmerged`
  const unanswered = Object.fromEntries(Object.entries(THE_COUNTS).filter(([query]) => query !== abandoned))
  const github = aGithubOf(unanswered)
  t.after(() => removeTheTree(github.crew))

  const first = await theDriftReadToday(github.spender, [REPO], NOW, 3)
  assert.equal(first[REPO], undefined, 'a number nobody said was kept as one')

  const next = aGithubOf(THE_COUNTS)
  t.after(() => removeTheTree(next.crew))
  const again = await theDriftReadToday(next.spender, [REPO], NOW, 3)
  assert.equal(again[REPO]?.[dayOf(NOW)]?.abandoned_prs, 84, 'the read that failed was never made again')
})

test('#1010 B: a repo keeps a week and today, and a row older than that is dropped', async (t: TestContext) => {
  const github = aGithubOf(THE_COUNTS)
  t.after(() => removeTheTree(github.crew))
  const older: TheDriftRecord = { [REPO]: Object.fromEntries(Array.from({ length: DAYS_KEPT + 4 }, (_, at) => [dayOf(NOW - (at + 1) * A_DAY_MS), { open_issues: 1, untouched_issues: 1, abandoned_prs: 1, all_prs: 1 }])) }
  const reopened = keepTheCrewsFilesAsDirectories(github.crew).place(GITHUB_DRIFT_PLACE)
  if ('refusal' in reopened) throw new Error(reopened.refusal)
  keepTheDriftRecord(reopened, older)

  const record = await theDriftReadToday({ ...github.spender, place: reopened }, [REPO], NOW, 3)
  assert.equal(Object.keys(record[REPO] ?? {}).length, DAYS_KEPT, 'the rows kept are not a week and today')
  assert.ok(record[REPO]?.[dayOf(NOW)] !== undefined, 'today\'s row was dropped')
})

test('#1010 B: a record the store holds that is not one reads as none, and the day is read afresh', async (t: TestContext) => {
  const github = aGithubOf(THE_COUNTS)
  t.after(() => removeTheTree(github.crew))
  const place = keepTheCrewsFilesAsDirectories(github.crew).place(GITHUB_DRIFT_PLACE)
  if ('refusal' in place) throw new Error(place.refusal)
  place.keep(THE_DRIFT_FILE, 'not a record {')

  const record = await theDriftReadToday(github.spender, [REPO], NOW, 3)
  assert.equal(record[REPO]?.[dayOf(NOW)]?.open_issues, 123, 'an unreadable record stopped the day\'s read')
})

test('#1010 B: the record lives under the crew\'s own place for it, and a repo name off the shape is never asked about', async (t: TestContext) => {
  const github = aGithubOf(THE_COUNTS)
  t.after(() => removeTheTree(github.crew))

  await theDriftReadToday(github.spender, ['not a repo', '../../etc'], NOW, 3)
  assert.deepEqual(theSearches(github.asked), [], `a name that is not a repo reached GitHub: ${JSON.stringify(theSearches(github.asked))}`)
})
