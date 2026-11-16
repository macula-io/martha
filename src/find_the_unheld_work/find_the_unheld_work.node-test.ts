// Work nobody in the crew holds (martha#319, package B): the search, the pages, and the split.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProcessOutcome } from '../host_contract/host_contract.ts'
import {
  BACKLOG_PAGES_MOST,
  PURPOSE_SHOWN_MOST,
  UNHELD_SHOWN_MOST,
  aPageIn,
  readTheBacklog,
  theSearchOf,
  theSplitInWords,
  theSplitOf,
  thePurposeIn,
  type AnIssue,
} from './find_the_unheld_work.ts'

const NOW = Date.parse('2026-11-16T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

/** One issue node as GitHub's search returns it. */
function aNode(number: number, changes: { labels?: readonly string[]; body?: string; created?: string; timeline?: readonly unknown[] } = {}): unknown {
  return {
    number,
    title: `Issue ${String(number)}`,
    createdAt: changes.created ?? '2026-11-10T12:00:00Z',
    body: changes.body ?? '',
    repository: { nameWithOwner: 'macula-io/martha' },
    labels: { nodes: (changes.labels ?? ['work-package']).map((name) => ({ name })) },
    timelineItems: { nodes: changes.timeline ?? [] },
  }
}

/** One page of the search, as `gh api graphql` prints it. */
const aPage = (nodes: readonly unknown[], next: string | null): string =>
  JSON.stringify({ data: { search: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } })

const ok = (stdout: string): ProcessOutcome => ({ exit_code: 0, stdout, stderr: '' })

/** An issue as the split reads it. */
const anIssue = (number: number, holders: readonly string[], opened_at = NOW - 3 * DAY): AnIssue => ({
  package: `macula-io/martha#${String(number)}`,
  title: `Issue ${String(number)}`,
  opened_at,
  purpose: '',
  holders,
  mentioned: '',
})

test('#319 B: the search names each declared place as an organisation or a repository, open issues of either label, oldest first', () => {
  assert.equal(theSearchOf(['macula-io', 'macula-io/macula']), 'is:issue is:open label:work-package,backlog sort:created-asc org:macula-io repo:macula-io/macula')
})

test('#319 B test 1: a crew: label naming someone outside the crew holds nothing, and the answer names the label', () => {
  const split = theSplitOf([anIssue(1, ['Stranger']), anIssue(2, ['vesta']), anIssue(3, [])], ['Vesta', 'Supervisor'])
  assert.deepEqual(split.unheld.map((issue) => issue.package), ['macula-io/martha#1', 'macula-io/martha#3'], 'a label naming a non-member was taken for a holder')
  assert.deepEqual(split.held, [{ member: 'Vesta', packages: ['macula-io/martha#2'] }], 'a member\'s label, spelled in another case, did not hold its issue')
  assert.match(theSplitInWords(split, NOW), /labelled crew:Stranger, which names nobody in this crew/)
})

test('#319 B test 2: a sixth page is never asked for, and the read says it was cut', async () => {
  const asked: (readonly string[])[] = []
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    asked.push(args)
    return ok(aPage([aNode(asked.length)], `cursor-${String(asked.length)}`))
  }
  const read = await readTheBacklog(run, ['macula-io'])
  assert.equal(asked.length, BACKLOG_PAGES_MOST, 'the read asked past its page cap')
  assert.ok('issues' in read && read.cut, 'a backlog deeper than the cap was not marked cut')
  assert.equal(read.issues.length, BACKLOG_PAGES_MOST)
  assert.ok(asked[1]?.includes('after=cursor-1'), 'the second page was not asked after the first one\'s cursor')
})

test('#319 B: a backlog that ends inside the cap is whole, and its last page is not followed', async () => {
  let calls = 0
  const run = async (): Promise<ProcessOutcome> => {
    calls += 1
    return ok(aPage([aNode(calls)], calls < 2 ? 'next' : null))
  }
  const read = await readTheBacklog(run, ['macula-io'])
  assert.equal(calls, 2)
  assert.ok('issues' in read && !read.cut)
})

test('#319 B: a page GitHub refuses fails the whole read, naming what gh said, so a partial list is never kept', async () => {
  let calls = 0
  const run = async (): Promise<ProcessOutcome> => {
    calls += 1
    return calls === 1 ? ok(aPage([aNode(1)], 'next')) : { exit_code: 1, stdout: '', stderr: 'API rate limit exceeded\nmore' }
  }
  assert.deepEqual(await readTheBacklog(run, ['macula-io']), { error: 'API rate limit exceeded' })
  assert.deepEqual(await readTheBacklog(async () => ok('not json'), ['macula-io']), { error: 'GitHub answered the backlog search with something this cannot read' })
})

test('#319 B: a page reads the Purpose line, the holders, and the last merged PR or commit that mentioned the issue', () => {
  const page = aPageIn(
    aPage(
      [
        aNode(7, {
          labels: ['backlog', 'crew:Vesta', 'plan'],
          body: 'Intro\nPurpose (capability): the Supervisor sees unheld work.\nMore',
          timeline: [
            { __typename: 'ReferencedEvent', commit: { abbreviatedOid: 'abc1234' } },
            { __typename: 'CrossReferencedEvent', source: { number: 9, merged: true, repository: { nameWithOwner: 'macula-io/martha' } } },
            { __typename: 'CrossReferencedEvent', source: { number: 10, merged: false, repository: { nameWithOwner: 'macula-io/martha' } } },
          ],
        }),
        { not: 'an issue' },
      ],
      null,
    ),
  )
  assert.ok(page !== undefined)
  assert.deepEqual(page.issues, [
    {
      package: 'macula-io/martha#7',
      title: 'Issue 7',
      opened_at: Date.parse('2026-11-10T12:00:00Z'),
      purpose: 'Purpose (capability): the Supervisor sees unheld work.',
      holders: ['Vesta'],
      mentioned: 'merged PR macula-io/martha#9',
    },
  ])
  assert.equal(page.next, null)
})

test('#319 B: a Purpose line is cut to what an answer prints', () => {
  const long = `Purpose (upkeep): ${'x'.repeat(PURPOSE_SHOWN_MOST)}`
  assert.equal(thePurposeIn(long).length, PURPOSE_SHOWN_MOST + 1)
  assert.equal(thePurposeIn('no purpose here'), '')
})

test('#319 B: the answer lists the oldest unheld first, counts what it does not show, and says what a mention means', () => {
  const issues = Array.from({ length: UNHELD_SHOWN_MOST + 2 }, (_, index) => anIssue(index + 1, [], NOW - (index + 1) * DAY))
  const mentioned = { ...anIssue(999, [], NOW - 2 * 60 * 60 * 1000), mentioned: 'commit abc1234' }
  const words = theSplitInWords(theSplitOf([...issues, mentioned], ['Vesta']), NOW)
  const lines = words.split('\n')
  assert.match(lines[1] ?? '', new RegExp(`^- macula-io/martha#${String(UNHELD_SHOWN_MOST + 2)}, ${String(UNHELD_SHOWN_MOST + 2)} d old`), 'the oldest issue is not first')
  assert.match(words, /- and 3 more, not shown/)
  assert.match(words, /Held: nothing\./)
  const recent = theSplitInWords(theSplitOf([mentioned], []), NOW)
  assert.match(recent, /macula-io\/martha#999, 2 h old/)
  assert.match(recent, /last mentioned by commit abc1234: check it is not already done/)
})
