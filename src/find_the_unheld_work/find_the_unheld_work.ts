// The work nobody in this crew holds (martha#319, package B).
//
// This exists so open work does not sit for days beside members who are free to take it. In crew-code, unheld issues
// were found only because the owner named the repos to look in. Here the crew's declaration names the places, and one
// GitHub search lists every open issue labelled `work-package` or `backlog` there that no member of this crew holds.
//
// What is in this file:
//
//   - the one GraphQL search, built from the places, read at most BACKLOG_PAGES_MOST pages deep. A deeper backlog is
//     cut, and the answer says so rather than passing a partial list off as the whole;
//   - each page parsed into issues: the package, the title, when it was opened, its Purpose line, the `crew:` labels on
//     it, and what last mentioned it (a merged pull request or a commit);
//   - the split into what nobody holds and what each member holds. A `crew:<name>` label holds an issue only when
//     <name> is a member of this crew: anyone with triage rights can put a label on an issue, and a label naming
//     someone outside the crew holds nothing. The answer names such a label beside the issue.
//
// Core: no disk and no clock of its own. GitHub is reached through the `run` it is handed, and the time is handed in.

import { sameMemberName, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { A_PAGE } from '../spend_the_github_budget/spend_the_github_budget.ts'
import type { ProcessOutcome, Refused } from '../host_contract/host_contract.ts'

/** The labels that mark an issue as work a member could take. */
export const WORK_LABELS = ['work-package', 'backlog'] as const

/** The prefix of a label that says which member holds an issue. */
export const HOLDER_PREFIX = 'crew:'

/** The most pages one read asks GitHub for: crew-code's cap, which this ports. */
export const BACKLOG_PAGES_MOST = 5

/** The most unheld issues an answer lists; the rest are counted. */
export const UNHELD_SHOWN_MOST = 30

/** The longest Purpose line an answer prints, in characters. */
export const PURPOSE_SHOWN_MOST = 200

/** The one search, with the fields this file reads and nothing else. */
const THE_QUERY = [
  'query($q: String!, $after: String) {',
  '  search(query: $q, type: ISSUE, first: ' + String(A_PAGE) + ', after: $after) {',
  '    pageInfo { hasNextPage endCursor }',
  '    nodes { ... on Issue {',
  '      number title createdAt body',
  '      repository { nameWithOwner }',
  '      labels(first: ' + String(A_PAGE) + ') { nodes { name } }',
  '      timelineItems(last: 10, itemTypes: [CROSS_REFERENCED_EVENT, REFERENCED_EVENT]) { nodes {',
  '        __typename',
  '        ... on CrossReferencedEvent { source { ... on PullRequest { number merged repository { nameWithOwner } } } }',
  '        ... on ReferencedEvent { commit { abbreviatedOid } }',
  '      } }',
  '    } }',
  '  }',
  '}',
].join('\n')

/** One open issue, as an answer shows it. */
export interface AnIssue {
  /** owner/repo#n */
  readonly package: string
  readonly title: string
  /** When it was opened, in milliseconds since the epoch. */
  readonly opened_at: number
  /** Its `Purpose (<kind>): <outcome>` line, or '' when its body has none. */
  readonly purpose: string
  /** The member names its `crew:` labels give, as the labels spell them. */
  readonly holders: readonly string[]
  /** What last mentioned it: `merged PR owner/repo#n`, `commit <sha>`, or '' when nothing did. */
  readonly mentioned: string
}

/** One read of the backlog: the issues, oldest first, and whether a deeper backlog was cut. */
export interface ABacklogRead {
  readonly issues: readonly AnIssue[]
  readonly cut: boolean
}

/** The search text for the declared places: open issues with either label, oldest first. */
export function theSearchOf(places: readonly string[]): string {
  const where = places.map((place) => (place.includes('/') ? `repo:${place}` : `org:${place}`))
  return ['is:issue', 'is:open', `label:${WORK_LABELS.join(',')}`, 'sort:created-asc', ...where].join(' ')
}

/** The `gh` arguments for one page: the query, the search, and the cursor after the page before it. */
export function thePageArgs(places: readonly string[], after: string | null): readonly string[] {
  const cursor = after === null ? [] : ['-f', `after=${after}`]
  return ['api', 'graphql', '-f', `query=${THE_QUERY}`, '-f', `q=${theSearchOf(places)}`, ...cursor]
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const objectAt = (value: unknown, key: string): Json | undefined => (isObject(value) && isObject(value[key]) ? value[key] : undefined)
const listAt = (value: unknown, key: string): readonly unknown[] => {
  const list = isObject(value) ? value[key] : undefined
  return Array.isArray(list) ? list : []
}
const textAt = (value: unknown, key: string): string | undefined => {
  const text = isObject(value) ? value[key] : undefined
  return typeof text === 'string' ? text : undefined
}

/** The Purpose line of an issue's body, cut to what an answer prints, or ''. */
export function thePurposeIn(body: string): string {
  const line = /^Purpose \([a-z]+\): .+$/m.exec(body)?.[0].trim() ?? ''
  return line.length > PURPOSE_SHOWN_MOST ? `${line.slice(0, PURPOSE_SHOWN_MOST)}…` : line
}

/** What one timeline event names: a merged pull request, a commit, or nothing worth showing. */
function aMentionIn(event: unknown): string {
  const source = objectAt(event, 'source')
  const repository = textAt(objectAt(source, 'repository'), 'nameWithOwner')
  const number = isObject(source) ? source['number'] : undefined
  if (isObject(source) && source['merged'] === true && repository !== undefined && typeof number === 'number') return `merged PR ${repository}#${String(number)}`
  const commit = textAt(objectAt(event, 'commit'), 'abbreviatedOid')
  return commit === undefined ? '' : `commit ${commit}`
}

/** One issue of a page, or undefined when the node is not one this can read. */
function anIssueIn(node: unknown): AnIssue | undefined {
  const repository = textAt(objectAt(node, 'repository'), 'nameWithOwner')
  const number = isObject(node) ? node['number'] : undefined
  const title = textAt(node, 'title')
  const opened_at = Date.parse(textAt(node, 'createdAt') ?? '')
  if (repository === undefined || typeof number !== 'number' || title === undefined || Number.isNaN(opened_at)) return undefined
  const labels = listAt(objectAt(node, 'labels'), 'nodes').flatMap((label) => {
    const name = textAt(label, 'name')
    return name !== undefined && name.startsWith(HOLDER_PREFIX) ? [name.slice(HOLDER_PREFIX.length)] : []
  })
  const mentions = listAt(objectAt(node, 'timelineItems'), 'nodes').map(aMentionIn).filter((mention) => mention !== '')
  return {
    package: `${repository}#${String(number)}`,
    title,
    opened_at,
    purpose: thePurposeIn(textAt(node, 'body') ?? ''),
    holders: labels,
    mentioned: mentions.at(-1) ?? '',
  }
}

/** One page of the search: its issues and the cursor of the next page, or undefined when GitHub's answer is unreadable. */
export function aPageIn(stdout: string): { readonly issues: readonly AnIssue[]; readonly next: string | null } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const search = objectAt(objectAt(parsed, 'data'), 'search')
  const info = objectAt(search, 'pageInfo')
  if (search === undefined || info === undefined) return undefined
  const issues = listAt(search, 'nodes').flatMap((node) => anIssueIn(node) ?? [])
  return { issues, next: info['hasNextPage'] === true ? (textAt(info, 'endCursor') ?? null) : null }
}

/** What `gh` said when it failed, in one line. */
const theFailureOf = (said: ProcessOutcome): string => {
  const words = (said.stderr.trim() === '' ? said.stdout : said.stderr).trim().split('\n')[0] ?? ''
  return words === '' ? `gh ended with ${String(said.exit_code)} and said nothing` : words
}

/**
 * Reads the backlog of the declared places, page after page up to BACKLOG_PAGES_MOST: the issues, oldest first, and
 * whether a deeper backlog was cut. A page GitHub refused, the run refused before asking (the crew's budget at its
 * floor, martha#947) or GitHub answered with something unreadable fails the whole read, so a partial list is never kept
 * as if it were the whole one. The run is told which page it reads, counted from 1.
 */
export async function readTheBacklog(
  run: (args: readonly string[], page: number) => Promise<ProcessOutcome | Refused>,
  places: readonly string[],
): Promise<ABacklogRead | { readonly error: string }> {
  const issues: AnIssue[] = []
  let after: string | null = null
  for (let page = 0; page < BACKLOG_PAGES_MOST; page += 1) {
    const said = await run(thePageArgs(places, after), page + 1)
    if ('refusal' in said) return { error: said.refusal }
    if (said.exit_code !== 0) return { error: theFailureOf(said) }
    const read = aPageIn(said.stdout)
    if (read === undefined) return { error: 'GitHub answered the backlog search with something this cannot read' }
    issues.push(...read.issues)
    if (read.next === null) return { issues, cut: false }
    after = read.next
  }
  return { issues, cut: true }
}

/** An issue as the split shows it: with the `crew:` labels that name nobody in this crew. */
export interface AnUnheldIssue extends AnIssue {
  readonly foreign: readonly string[]
}

/** The backlog split: what nobody in this crew holds, oldest first, and what each member holds, in the declaration's order. */
export interface TheSplit {
  readonly unheld: readonly AnUnheldIssue[]
  readonly held: readonly { readonly member: string; readonly packages: readonly string[] }[]
}

/** Whether `name` is `member`, compared as the declaration compares member names. */
const same = sameMemberName

/** The split of a read among the crew's members: a holder counts only when it is one of them. */
export function theSplitOf(issues: readonly AnIssue[], members: readonly string[]): TheSplit {
  const held = (issue: AnIssue): boolean => issue.holders.some((holder) => members.some((member) => same(holder, member)))
  const unheld = [...issues]
    .filter((issue) => !held(issue))
    .sort((one, two) => one.opened_at - two.opened_at)
    .map((issue) => ({ ...issue, foreign: issue.holders }))
  const holding = members.map((member) => ({
    member,
    packages: issues.filter((issue) => issue.holders.some((holder) => same(holder, member))).map((issue) => issue.package),
  }))
  return { unheld, held: holding.filter((one) => one.packages.length > 0) }
}

const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** How old an issue is, in whole days, or hours under a day. */
export const anAgeOf = (opened_at: number, now: number): string =>
  now - opened_at >= DAY_MS ? `${String(Math.floor((now - opened_at) / DAY_MS))} d` : `${String(Math.floor((now - opened_at) / HOUR_MS))} h`

/** One unheld issue as an answer line. */
function anUnheldLine(issue: AnUnheldIssue, now: number): string {
  const parts = [`- ${issue.package}, ${anAgeOf(issue.opened_at, now)} old: ${issue.title}`]
  if (issue.purpose !== '') parts.push(`  ${issue.purpose}`)
  if (issue.mentioned !== '') parts.push(`  last mentioned by ${issue.mentioned}: check it is not already done`)
  for (const label of issue.foreign) parts.push(`  labelled ${HOLDER_PREFIX}${label}, which names nobody in this crew`)
  return parts.join('\n')
}

/** The split, as the words an answer gives. */
export function theSplitInWords(split: TheSplit, now: number): string {
  const shown = split.unheld.slice(0, UNHELD_SHOWN_MOST).map((issue) => anUnheldLine(issue, now))
  const more = split.unheld.length - shown.length
  const unheld = split.unheld.length === 0 ? ['Nobody-held work: none.'] : [`Nobody-held work, oldest first (${String(split.unheld.length)}):`, ...shown]
  if (more > 0) unheld.push(`- and ${String(more)} more, not shown`)
  const held = split.held.length === 0 ? ['Held: nothing.'] : ['Held:', ...split.held.map((one) => `- ${one.member}: ${one.packages.join(', ')}`)]
  return [...unheld, ...held].join('\n')
}
