// Where a member's brief lives, which one is its newest, and which packages in it are still the member's (martha#999
// package 1, gap 7 of martha#957). Ported from crew-code (macula-sponsors 6f353d51, crew-code/):
//
// - The place and the name: the Supervisor writes each brief as BRIEF_<YYYY-MM-DD>_<Name>.md beside the member's
//   handovers, and the newest is the last by name (hooks/register.tsx:3086-3095). In Martha both live in the crew's
//   own store: handovers in `handovers`, briefs in `briefs`.
// - The packages a brief names: <org>/<repo>#<n>, and <org>/<repo>#8,#11 is one package per issue (core/handover_shape.ts:15-30).
// - Which of them the member still holds: a package counts unless GitHub says it is not the member's, closed or
//   labelled crew:<name> for other members only, or the member has an open pull request from its own branch for it
//   (core/handover_shape.ts:32-58, hooks/register.tsx:3359-3379). What GitHub could not answer keeps the package, so a
//   hiccup never hides a real gap. Every read goes through the crew's GitHub budget, never `gh` on its own.
//
// Member names are compared by the one rule the tree has (../declare_crew/member_names.ts, martha#528), where crew-code
// folds case on the spot.

import { join } from 'node:path'

import type { CrewPlace, CrewStore, Refused } from '../host_contract/host_contract.ts'
import { sameMemberName } from '../declare_crew/declare_crew.ts'
import { A_PAGE, spendTheGithubBudget, type TheGithubSpender } from '../spend_the_github_budget/spend_the_github_budget.ts'

/** The place in the crew's store a member's briefs live in, beside its handovers. */
export const BRIEFS_PLACE = 'briefs'

/** The name a brief written on `day` (YYYY-MM-DD) for `member` has. */
export const theBriefFile = (member: string, day: string): string => `BRIEF_${day}_${member}.md`

/** A brief's name, read back: the day it was written for and the member it is for. */
const A_BRIEF = /^BRIEF_(\d{4}-\d{2}-\d{2})_(.+)\.md$/

/** Whether `name` is a brief for `member`. */
const isABriefFor = (name: string, member: string): boolean => {
  const found = A_BRIEF.exec(name)
  return found !== null && sameMemberName(found[2] ?? '', member)
}

/** A member's newest brief: its file, its absolute path, and its text. */
export interface ABrief {
  readonly file: string
  readonly path: string
  readonly text: string
}

/** Where one crew's briefs live, `<crew>/briefs`: made when missing, refused when it is not a place to read. */
export function briefsPlace(crew: CrewStore): CrewPlace | Refused {
  return crew.place(BRIEFS_PLACE)
}

/**
 * `member`'s newest brief, by its name's day; undefined when it has none; or why the place could not be read. Two briefs
 * on one day are one file, since the Supervisor appends to a same-day brief rather than writing a second.
 */
export function theNewestBriefOf(crew: CrewStore, member: string): ABrief | undefined | Refused {
  const place = briefsPlace(crew)
  if ('refusal' in place) return place
  const names = place.names()
  if ('refusal' in names) return names
  const newest = names.filter((name) => isABriefFor(name, member)).sort().at(-1)
  if (newest === undefined) return undefined
  const read = place.read(newest)
  if (read === undefined) return undefined
  if ('refusal' in read) return read
  return { file: newest, path: join(place.path, newest), text: read.text }
}

/** A package as a brief names it: <org>/<repo>#<n>, or several issues of one repository as <org>/<repo>#8,#11. */
const A_PACKAGE = /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([0-9]+(?:,#[0-9]+)*)\b/g

/** Every package a brief names, once each, in the order it names them. */
export function thePackagesABriefNames(text: string): readonly string[] {
  const named = [...text.matchAll(A_PACKAGE)].flatMap((match) => (match[2] ?? '').split(',').map((issue) => `${match[1] ?? ''}#${issue.replace(/^#/, '')}`))
  return [...new Set(named)]
}

/** What GitHub says about a package's issue that decides whether it is still the member's. */
export interface IssueFacts {
  readonly closed: boolean
  /** The members its crew:<name> labels name; none when it carries no such label. */
  readonly members: readonly string[]
}

/** The label that hands an issue to named members only. */
const A_MEMBER_LABEL = /^crew:(.+)$/

/** `gh issue view --json state,labels` read as facts, or undefined when the answer is not that. */
export function issueFactsIn(stdout: string): IssueFacts | undefined {
  const fields = aRecordIn(stdout)
  if (fields === undefined || typeof fields['state'] !== 'string' || !Array.isArray(fields['labels'])) return undefined
  const names = fields['labels'].map((label: unknown) => String(aRecord(label)?.['name'] ?? ''))
  const members = names.map((name) => A_MEMBER_LABEL.exec(name)?.[1] ?? '').filter((one) => one !== '')
  return { closed: fields['state'].toUpperCase() === 'CLOSED', members }
}

/** Whether the facts leave the package with `member`. Facts GitHub could not give keep it. */
export function isHeld(facts: IssueFacts | undefined, member: string): boolean {
  if (facts === undefined) return true
  return !facts.closed && (facts.members.length === 0 || facts.members.some((one) => sameMemberName(one, member)))
}

/** One open pull request, as far as owning a package reads it. */
export interface APull {
  readonly branch: string
  readonly body: string
}

/** `gh pr list --json headRefName,body` read as pulls, or undefined when the answer is not a list. */
export function pullsIn(stdout: string): readonly APull[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  return parsed.map((one: unknown) => {
    const fields = aRecord(one)
    return { branch: typeof fields?.['headRefName'] === 'string' ? fields['headRefName'] : '', body: typeof fields?.['body'] === 'string' ? fields['body'] : '' }
  })
}

// A branch names an issue where the number starts a path segment and ends it: `ada/143-hygiene-r2` is #143, and its
// `-r2` is not #2. A body names one as a bare `#n`: `Refs #143` is #143, while `<org>/<repo>#143` and `#1434` are not.
const branchNames = (branch: string, issue: number): boolean => new RegExp(`(^|/)${String(issue)}(-|$)`).test(branch)
const bodyNames = (body: string, issue: number): boolean => new RegExp(`(^|[^\\w/-])#${String(issue)}(?!\\d)`).test(body)

/** Exactly one candidate, or none: two pull requests naming one issue is not an answer. */
const theOnlyOne = (pulls: readonly APull[]): APull | undefined => (pulls.length === 1 ? pulls[0] : undefined)

/** The open pull request a package is about: the one whose branch names the issue, else the one whose body does. */
export function theLinkedPull(pulls: readonly APull[], issue: number): APull | undefined {
  return theOnlyOne(pulls.filter((pull) => branchNames(pull.branch, issue))) ?? theOnlyOne(pulls.filter((pull) => bodyNames(pull.body, issue)))
}

/** Whether `member` owns the pull request linked to `issue`: its branch starts with the member's name and a slash. */
export function ownsTheLinkedPull(pulls: readonly APull[], issue: number, member: string): boolean {
  const branch = theLinkedPull(pulls, issue)?.branch ?? ''
  const slash = branch.indexOf('/')
  return slash > 0 && sameMemberName(branch.slice(0, slash), member)
}

/** A package's repository and issue number, or undefined when it is not <org>/<repo>#<n>. */
const A_WHOLE_PACKAGE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([0-9]+)$/
function partsOf(named: string): { readonly repo: string; readonly issue: number } | undefined {
  const found = A_WHOLE_PACKAGE.exec(named)
  return found === null ? undefined : { repo: found[1] ?? '', issue: Number(found[2]) }
}

/**
 * What each read is spaced by in the budget: its own thing, so one read never holds another back. A read that named
 * nothing would move the crew's own spacing, and the second package of a brief would wait behind the first.
 */
const theFactsWaitOf = (named: string): string => `${named} held`
const thePullsWaitOf = (repo: string): string => `${repo} open pulls`

/** The facts of one package's issue, spent through the budget; undefined when GitHub could not give them. */
async function theFactsOf(spender: TheGithubSpender, repo: string, issue: number): Promise<IssueFacts | undefined> {
  const spent = await spendTheGithubBudget(spender, ['issue', 'view', String(issue), '--repo', repo, '--json', 'state,labels'], theFactsWaitOf(`${repo}#${String(issue)}`))
  if ('refusal' in spent || spent.said.exit_code !== 0) return undefined
  return issueFactsIn(spent.said.stdout)
}

/**
 * The open pull requests of one repository, spent through the budget, at most a page of them; undefined when GitHub
 * could not list them.
 */
async function theOpenPullsOf(spender: TheGithubSpender, repo: string): Promise<readonly APull[] | undefined> {
  const spent = await spendTheGithubBudget(spender, ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'headRefName,body', '--limit', String(A_PAGE)], thePullsWaitOf(repo))
  if ('refusal' in spent || spent.said.exit_code !== 0) return undefined
  return pullsIn(spent.said.stdout)
}

/**
 * The packages a brief names that are still `member`'s: one issue read per package, and, only for a package GitHub says
 * is not the member's, one open-pull-request list per repository, kept for the rest of the read.
 */
export async function thePackagesAMemberHolds(spender: TheGithubSpender, brief: string, member: string): Promise<readonly string[]> {
  const pulls = new Map<string, readonly APull[] | undefined>()
  const held: string[] = []
  for (const named of thePackagesABriefNames(brief)) {
    const parts = partsOf(named)
    if (parts === undefined || isHeld(await theFactsOf(spender, parts.repo, parts.issue), member)) {
      held.push(named)
      continue
    }
    if (!pulls.has(parts.repo)) pulls.set(parts.repo, await theOpenPullsOf(spender, parts.repo))
    if (ownsTheLinkedPull(pulls.get(parts.repo) ?? [], parts.issue, member)) held.push(named)
  }
  return held
}

/** A JSON object's fields, or undefined when the text is not one. */
function aRecordIn(text: string): Readonly<Record<string, unknown>> | undefined {
  try {
    return aRecord(JSON.parse(text))
  } catch {
    return undefined
  }
}

/** A value's fields when it is an object, else undefined. */
function aRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
