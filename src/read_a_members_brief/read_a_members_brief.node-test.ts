// A member's brief (martha#999 package 1): where it lives, which is the newest, and which of its packages are still the
// member's, each read as crew-code reads it (core/handover_shape.ts, hooks/register.tsx:3086-3095, :3359-3379), through
// the crew's GitHub budget.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import type { CrewStore, ProcessOutcome } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { GITHUB_BUDGET_PLACE, type TheGithubSpender } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { GITHUB_WHEN_UNNAMED } from '../declare_crew/the_crews_github.ts'
import { CLOCK_ZONE_WHEN_UNNAMED } from '../declare_crew/the_crews_clock_zone.ts'
import {
  BRIEFS_PLACE,
  isHeld,
  issueFactsIn,
  ownsTheLinkedPull,
  theBriefFile,
  theNewestBriefOf,
  thePackagesABriefNames,
  thePackagesAMemberHolds,
} from './read_a_members_brief.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-999-brief-'))
after(() => removeTheTree(home))

let storesSoFar = 0
/** A crew store of its own on this disk, under the root the test removes. */
const aStore = (): CrewStore => {
  storesSoFar += 1
  return keepTheCrewsFilesAsDirectories(join(home, `crew-${String(storesSoFar)}`))
}

/** Keeps `text` as `file` in the store's briefs place, as the Supervisor writes a brief. */
const keepABrief = (crew: CrewStore, file: string, text: string): void => {
  const place = crew.place(BRIEFS_PLACE)
  assert.ok(!('refusal' in place), 'the crew store refused its briefs place')
  assert.equal(place.keep(file, text), undefined)
}

test('martha#999: the newest brief is the member\'s by its latest day, never another member\'s, and the name is folded as every member name is', () => {
  const crew = aStore()
  keepABrief(crew, theBriefFile('Vesta', '2026-11-19'), 'the older one')
  keepABrief(crew, theBriefFile('vesta', '2026-11-20'), 'the newest one')
  keepABrief(crew, theBriefFile('Ceres', '2026-11-21'), 'another member\'s, later')
  const newest = theNewestBriefOf(crew, 'Vesta')
  assert.ok(newest !== undefined && !('refusal' in newest), 'no brief was found for a member with two')
  assert.equal(newest.text, 'the newest one')
  assert.equal(newest.file, theBriefFile('vesta', '2026-11-20'))
  assert.ok(newest.path.endsWith(join(BRIEFS_PLACE, newest.file)), `the path is not in the briefs place: ${newest.path}`)
  assert.equal(theNewestBriefOf(crew, 'Pluto'), undefined, 'a member with no brief was handed one')
})

test('martha#999: a brief names each synthetic-owner/repo#n once, and synthetic-owner/repo#8,#11 as one package per issue', () => {
  const text = 'Package: synthetic-owner/widget#8,#11 and synthetic-owner/tool#3. Again synthetic-owner/widget#8. A bare #40 names no repository.'
  assert.deepEqual(thePackagesABriefNames(text), ['synthetic-owner/widget#8', 'synthetic-owner/widget#11', 'synthetic-owner/tool#3'])
})

test('martha#999: GitHub\'s facts keep a package unless it is closed or labelled for other members only; facts it could not give keep it', () => {
  const facts = (state: string, labels: readonly string[]): string => JSON.stringify({ state, labels: labels.map((name) => ({ name })) })
  assert.equal(isHeld(issueFactsIn(facts('OPEN', [])), 'Vesta'), true)
  assert.equal(isHeld(issueFactsIn(facts('CLOSED', [])), 'Vesta'), false, 'a closed issue was kept')
  assert.equal(isHeld(issueFactsIn(facts('OPEN', ['crew:Ceres'])), 'Vesta'), false, 'an issue labelled for another member was kept')
  assert.equal(isHeld(issueFactsIn(facts('OPEN', ['crew:VESTA '])), 'Vesta'), true, 'a label naming the member in another case was not read as the member')
  assert.equal(isHeld(issueFactsIn('not json'), 'Vesta'), true, 'an answer that could not be read dropped the package')
})

test('martha#999: the member owns the pull request whose branch names the issue and starts with its own name', () => {
  const pulls = [{ branch: 'VESTA/143-hygiene-r2', body: '' }, { branch: 'ceres/2-other', body: '' }]
  assert.equal(ownsTheLinkedPull(pulls, 143, 'vesta'), true, 'a branch under the member\'s name in another case was not the member\'s')
  assert.equal(ownsTheLinkedPull(pulls, 2, 'vesta'), false, 'the -r2 of a branch was read as issue #2, or another member\'s branch as the member\'s')
  assert.equal(ownsTheLinkedPull([{ branch: 'vesta/fix', body: 'Refs #143' }], 143, 'vesta'), true, 'a body naming the issue did not link the pull request')
  assert.equal(ownsTheLinkedPull([{ branch: 'vesta/fix', body: 'Refs #1434' }], 143, 'vesta'), false, 'a longer number linked the pull request')
  assert.equal(ownsTheLinkedPull([{ branch: 'vesta/143-a', body: '' }, { branch: 'vesta/143-b', body: '' }], 143, 'vesta'), false, 'two candidates were read as one')
})

/** A spender over a fresh budget, whose `gh` answers each read by the first answer whose test it passes. */
const aSpender = (answers: readonly { readonly when: (args: readonly string[]) => boolean; readonly said: ProcessOutcome }[]): { readonly spender: TheGithubSpender; readonly asked: string[][] } => {
  const place = aStore().place(GITHUB_BUDGET_PLACE)
  assert.ok(!('refusal' in place), 'the crew store refused its budget place')
  const asked: string[][] = []
  const plenty = { exit_code: 0, stdout: JSON.stringify({ resources: { core: { remaining: GITHUB_WHEN_UNNAMED.budget_floor * 10, reset: Math.trunc(Date.now() / 1000) + 3600 } } }), stderr: '' }
  const run = async (args: readonly string[]): Promise<ProcessOutcome> => {
    if (args[1] === 'rate_limit') return plenty
    asked.push([...args])
    return answers.find((one) => one.when(args))?.said ?? { exit_code: 1, stdout: '', stderr: 'not asked for in this test' }
  }
  return { spender: { place, clock: { now: () => Date.now() }, run, floor: GITHUB_WHEN_UNNAMED.budget_floor, zone: CLOCK_ZONE_WHEN_UNNAMED }, asked }
}

const said = (stdout: unknown): ProcessOutcome => ({ exit_code: 0, stdout: JSON.stringify(stdout), stderr: '' })
const anIssue = (issue: number) => (args: readonly string[]): boolean => args[0] === 'issue' && args[2] === String(issue)
const thePulls = (args: readonly string[]): boolean => args[0] === 'pr'

test('martha#999: the packages a member holds are read through the budget: a closed one is dropped, one with the member\'s open pull request kept, and the pull requests listed once per repository', async () => {
  const { spender, asked } = aSpender([
    { when: anIssue(1), said: said({ state: 'OPEN', labels: [] }) },
    { when: anIssue(2), said: said({ state: 'CLOSED', labels: [] }) },
    { when: anIssue(3), said: said({ state: 'OPEN', labels: [{ name: 'crew:ceres' }] }) },
    { when: anIssue(4), said: said({ state: 'OPEN', labels: [{ name: 'crew:ceres' }] }) },
    { when: thePulls, said: said([{ headRefName: 'vesta/3-mine', body: '' }]) },
  ])
  const brief = 'synthetic-owner/widget#1, synthetic-owner/widget#2, synthetic-owner/widget#3, synthetic-owner/widget#4, and a GitHub hiccup: synthetic-owner/widget#5'
  assert.deepEqual(await thePackagesAMemberHolds(spender, brief, 'Vesta'), ['synthetic-owner/widget#1', 'synthetic-owner/widget#3', 'synthetic-owner/widget#5'])
  assert.equal(asked.filter(thePulls).length, 1, 'the open pull requests of one repository were listed more than once')
  assert.ok(asked.every((args) => args.includes('--repo') && args.includes('synthetic-owner/widget')), 'a read went to another repository')
})
