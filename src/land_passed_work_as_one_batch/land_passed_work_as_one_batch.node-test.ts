// Landing passed work as one batch (martha#256, slice 2).
//
// Every test works on a throwaway origin and a clone of it, so what is pinned is what git really does: one `--no-ff`
// merge per package at the head its reviewer passed, on a `land/` branch cut from the default branch and pushed; the
// refusals that stop a batch before anything is merged, each by name; a merge that does not go cleanly stopping the
// batch there and naming the packages not tried; the range the answer names passing the range check; and the
// fast-forward — onto the default branch when it has not moved, refused when it has, and a push row in every package's
// ledger, announced before the push runs and concluded after it, or left standing when the outcome cannot be kept.
//
// GitHub's answers are written per pull request head, in GitHub's own shape, because what a landing decides is which
// pull request stands open at exactly which head — the answers are the test's input, and git beside them is real.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { verifyRange } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import type { HostContract, ProcessOutcome, ProcessRequest, Row, RowStore, StoredRow } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { noteMilestone, readLedger } from '../log_ledger/log_ledger.ts'
import { reviewWaitsIn } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { keepTheLinesRow, readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { repoOfTheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { GIT, GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { A_HOLD_REFUSES } from '../hold_a_package_back_from_a_batch/hold_a_package_back_from_a_batch.ts'
import { STANDING_CLOSE, closeAStandingItem, recordAStandingItem } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import {
  FAST_FORWARD_DESCRIPTION,
  LAND,
  LAND_BATCH_DESCRIPTION,
  fastForwardAfterTheOwnersYes,
  landingsOf,
  landPassedWorkAsOneBatch,
  theBatchACallNames,
  theFastForwardACallNames,
  type Landing,
} from './land_passed_work_as_one_batch.ts'

/** What a call the slice refuses says, or a failure naming what it answered instead. */
const refusedBy = (asked: { readonly ok?: unknown; readonly refused?: string }): string =>
  asked.refused ?? assert.fail(`the call was not refused: ${JSON.stringify(asked)}`)

/** A clock that stands still, so the integration branch's date is the test's to know. */
const THE_DAY = Date.UTC(2026, 10, 12)

const MEMBER = 'Ceres'

interface Fixture {
  readonly root: string
  readonly origin: string
  readonly seed: string
  readonly clone: string
  readonly repo: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync(GIT, [...args], { cwd, encoding: 'utf8' }).trim()

const withAnAuthor = ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid']

const commitIn = (cwd: string, message: string): void => {
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, ...withAnAuthor, 'commit', '--quiet', '-m', message)
}

/** A real git, so a test sees what git does rather than what a stand-in is told to say. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
}

/** A bare origin at `<root>/acme/widget.git`, a seed checkout that pushes to it, and a clone the landing works in. */
function aRepository(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'martha-256-landing-'))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'acme', 'widget.git')
  mkdirSync(dirname(origin), { recursive: true })
  execFileSync(GIT, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(root, 'seed')
  mkdirSync(seed)
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'shared.txt'), 'one\n')
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  const clone = join(root, 'clone')
  execFileSync(GIT, ['clone', '--quiet', origin, clone])
  // Who commits is set in the clone itself: a merge writes a commit, and a machine with no global identity (a CI
  // runner is one) would refuse it. The test that wants the refusal empties this.
  gitIn(clone, 'config', 'user.name', 'Ann')
  gitIn(clone, 'config', 'user.email', 'ann@example.invalid')
  return { root, origin, seed, clone, repo: repoOfTheOrigin(origin) ?? '' }
}

/** Writes a file in a checkout, making the directories between when it names them. */
function writeIn(checkout: string, name: string, text: string): void {
  mkdirSync(dirname(join(checkout, name)), { recursive: true })
  writeFileSync(join(checkout, name), text)
}

/** A new branch from `from` holding one commit that writes `text` to `file`, pushed; answers the commit it made. */
function aBranchWithOneCommit(fixture: Fixture, name: string, from: string, file: string, text: string): string {
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', name, from)
  writeIn(fixture.clone, file, text)
  commitIn(fixture.clone, `the work on ${name}`)
  gitIn(fixture.clone, 'push', '--quiet', 'origin', name)
  return gitIn(fixture.clone, 'rev-parse', 'HEAD')
}

/** One entry of a test's own list, or a failure saying the test built its list wrong. */
function at<T>(list: readonly T[], index: number): T {
  const one = list[index]
  assert.ok(one !== undefined, `this test's own list holds no entry ${String(index)}`)
  return one
}

/** GitHub as these tests give it: one answer per path it was told about, and every path it was asked. */
function aGithub(answers: ReadonlyMap<string, unknown>): (request: ProcessRequest) => Promise<ProcessOutcome> {
  return async (request: ProcessRequest): Promise<ProcessOutcome> => {
    if (request.command !== GITHUB_CLI) return runReal(request)
    const path = request.args[1] ?? ''
    const found = [...answers.entries()].find(([start]) => path.startsWith(start))
    if (found === undefined) return { exit_code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' }
    return { exit_code: 0, stdout: JSON.stringify(found[1]), stderr: '' }
  }
}

/** What GitHub answers for a head: one open pull request there, by its number. */
const anOpenPullRequest = (number: number, head: string): unknown => [{ number, state: 'open', merged_at: null, head: { sha: head } }]

/** The answers a landing needs: the pull requests at these heads, and no CI runs to read. */
function theAnswersFor(repo: string, pulls: ReadonlyMap<string, unknown>): Map<string, unknown> {
  const answers = new Map<string, unknown>(pulls)
  answers.set(`repos/${repo}/actions/runs?head_sha=`, { total_count: 0, workflow_runs: [] })
  return answers
}

/** A host over this GitHub, at the test's own day. */
function aHostOver(run: (request: ProcessRequest) => Promise<ProcessOutcome>, rows?: HostContract['stores']['rows']): HostForTests {
  return hostForTests({ run, now: THE_DAY, ...(rows === undefined ? {} : { rows }) })
}

/** A package's PASS row, as the crew's own line writes one. */
const aPassedVerdict = async (tests: HostForTests, work_package: string, base: string, head: string): Promise<void> => {
  const reading = readACrewLine(`VERDICT ${work_package} PASS ${base}..${head} r=2 ci=1 req=0`)
  if (!('line' in reading) || reading.line === null) throw new Error(`the crew's own PASS line was not read: ${JSON.stringify(reading)}`)
  await keepTheLinesRow(tests.host, 'Mercurius', reading.line)
}

/** Passed packages named by this test: the packages, their heads, and GitHub's answer for each head. */
interface Passed {
  readonly packages: readonly string[]
  readonly heads: readonly string[]
  readonly pulls: Map<string, unknown>
}

/** Three passed packages, each one commit away from the default branch's tip, each with an open pull request. */
function threePassedPackages(fixture: Fixture): Passed {
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((entry) => `${fixture.repo}#${String(250 + entry)}`)
  const heads = packages.map((_, entry) => aBranchWithOneCommit(fixture, `passed${String(entry)}`, base, `work${String(entry)}.txt`, `work ${String(entry)}\n`))
  const pulls = new Map<string, unknown>()
  heads.forEach((head, entry) => pulls.set(`repos/${fixture.repo}/commits/${head}/pulls`, anOpenPullRequest(281 + entry, head)))
  return { packages, heads, pulls }
}

/** What a landing answered, as the words a refusal or a telling gives. */
const wordsOf = (landing: Landing): string => ('told' in landing ? landing.told : landing.refused)

/** A git answer read from the bare origin itself: the refs there are what was pushed, whatever the clone knows. */
const inTheOrigin = (fixture: Fixture, ...args: readonly string[]): string =>
  execFileSync(GIT, ['--git-dir', fixture.origin, ...args], { encoding: 'utf8' }).trim()

/** Where the bare origin's default branch stands. */
const theOriginMain = (fixture: Fixture): string => inTheOrigin(fixture, 'rev-parse', 'refs/heads/main')

/** The integration branches the bare origin holds; the passed branches this test pushed are not the landing's. */
const theLandBranchesOnOrigin = (fixture: Fixture): readonly string[] =>
  inTheOrigin(fixture, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${LAND}`)
    .split('\n')
    .filter((branch) => branch !== '')

/** The integration branches the clone holds itself; a landing's own branch is pushed, not kept here. */
const theLandBranchesIn = (clone: string): readonly string[] =>
  gitIn(clone, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${LAND}`)
    .split('\n')
    .filter((branch) => branch !== '')

/** A store that keeps every row but one, at the position the test names: an append the host does not keep. */
function aStoreThatRefusesTheAppendAt(refused: number): HostContract['stores']['rows'] {
  const streams = new Map<string, Row[]>()
  let appends = 0
  return {
    append: async (stream: string, row: Row): Promise<number> => {
      appends += 1
      if (appends === refused) throw new Error(`the store kept no row at append ${String(appends)}`)
      const held = streams.get(stream) ?? []
      held.push(row)
      streams.set(stream, held)
      return held.length - 1
    },
    read: async (stream: string): Promise<readonly StoredRow[]> =>
      (streams.get(stream) ?? []).map((row, position) => ({ position, row })),
  }
}

test('#256: three passed packages land as one batch, one --no-ff merge each, on a land branch cut from the default branch', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const passed = threePassedPackages(fixture)
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, passed.pulls)))
  for (const [entry, work_package] of passed.packages.entries()) await aPassedVerdict(tests, work_package, base, at(passed.heads, entry))

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: passed.packages })
  assert.ok('told' in landed, `a batch of three passed packages was refused: ${wordsOf(landed)}`)
  // The batch's own push is no landing: it pushes the integration branch, and the owner has not said yes (martha#320).
  for (const work_package of passed.packages) {
    const rows = await readLedger(tests.host, work_package)
    assert.deepEqual(rows.filter((row) => row.kind === 'package_landed'), [], `the batch wrote a landing for ${work_package}, which the default branch does not hold`)
  }
  const branches = theLandBranchesOnOrigin(fixture)
  assert.equal(branches.length, 1, `the batch was not pushed as one ${LAND}/ branch: ${branches.join(', ')}`)
  const branch = branches[0] ?? ''
  assert.ok(landed.told.includes(branch), 'the answer did not name the branch it made')
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${branch}`)
  const merges = inTheOrigin(fixture, 'log', '--first-parent', '--format=%P', '-3', branch).split('\n').reverse()
  assert.deepEqual(
    merges.map((parents) => parents.trim().split(/\s+/)[1]),
    passed.heads,
    'the batch is not one --no-ff merge per package, in order, at the head its reviewer passed',
  )
  for (const [entry, work_package] of passed.packages.entries()) {
    assert.ok(landed.told.includes(work_package), `the answer did not name ${work_package}`)
    assert.ok(landed.told.includes(`PR ${String(281 + entry)}`), `the answer did not name the pull request of ${work_package}`)
  }
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages: passed.packages })
  assert.ok('told' in checked, `the range the landing named did not pass the check: ${wordsOf(checked)}`)
})

test('#256: a landing leaves the clone on the branch and commit it stood on, clean, and keeps no land branch of its own', async (t) => {
  const fixture = aRepository(t)
  const stood_on = gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD')
  const stood_at = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const passed = threePassedPackages(fixture)
  // Cutting the passed branches left the clone on the last of them; a landing starts where a workspace clone stands.
  gitIn(fixture.clone, 'checkout', '--quiet', stood_on)
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, passed.pulls)))
  for (const [entry, work_package] of passed.packages.entries()) await aPassedVerdict(tests, work_package, base, at(passed.heads, entry))

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: passed.packages })
  assert.ok('told' in landed, `a batch of three passed packages was refused: ${wordsOf(landed)}`)
  assert.equal(gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), stood_on, 'the clone was left on the integration branch the landing cut')
  assert.equal(gitIn(fixture.clone, 'rev-parse', 'HEAD'), stood_at, 'the clone moved its HEAD, although a landing commits on its own branch')
  assert.equal(gitIn(fixture.clone, 'status', '--porcelain'), '', 'the clone was left holding a change after a landing')
  assert.deepEqual(theLandBranchesIn(fixture.clone), [], 'a land branch was kept in the clone, where nothing would remove it')
  assert.equal(theLandBranchesOnOrigin(fixture).length, 1, 'the integration branch the landing made was not pushed')
})

test('#256: a stopped batch aborts its merge and leaves the clone where it stood, clean, with no land branch left', async (t) => {
  const fixture = aRepository(t)
  const stood_on = gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD')
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((entry) => `${fixture.repo}#${String(250 + entry)}`)
  // The first two change the same line of one file, so the second is a conflict; the third is never reached.
  const heads = [
    aBranchWithOneCommit(fixture, 'passed0', base, 'shared.txt', 'two\n'),
    aBranchWithOneCommit(fixture, 'passed1', base, 'shared.txt', 'three\n'),
    aBranchWithOneCommit(fixture, 'passed2', base, 'later.txt', 'later\n'),
  ]
  gitIn(fixture.clone, 'checkout', '--quiet', stood_on)
  const pulls = new Map<string, unknown>()
  heads.forEach((head, entry) => pulls.set(`repos/${fixture.repo}/commits/${head}/pulls`, anOpenPullRequest(281 + entry, head)))
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, pulls)))
  for (const [entry, work_package] of packages.entries()) await aPassedVerdict(tests, work_package, base, at(heads, entry))

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.match(wordsOf(landed), /stopped at/)
  assert.equal(gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), stood_on, 'the clone was left on the integration branch a stopped batch cut')
  assert.equal(gitIn(fixture.clone, 'rev-parse', 'HEAD'), base, 'the clone moved its HEAD, although the batch stopped before anything was pushed')
  // Without the abort, git refuses the checkout back and the clone stands mid-merge on the branch, which this reads.
  assert.equal(gitIn(fixture.clone, 'status', '--porcelain'), '', 'the clone was left mid-merge after the batch stopped')
  assert.deepEqual(theLandBranchesIn(fixture.clone), [], 'the stopped batch left its land branch in the clone, holding a merge never pushed')
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'a stopped batch pushed something')
})

test('#256: a clone on no branch is refused before a branch is cut, because a landing would have none to go back to', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#251`
  const head = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  const pulls = new Map<string, unknown>([[`repos/${fixture.repo}/commits/${head}/pulls`, anOpenPullRequest(281, head)]])
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, pulls)))
  await aPassedVerdict(tests, work_package, base, head)
  // The clone stands on a commit rather than a branch, so there is no branch to put it back on afterwards.
  gitIn(fixture.clone, 'checkout', '--quiet', '--detach', base)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: [work_package] })
  assert.match(wordsOf(landed), /is on no branch/)
  assert.match(wordsOf(landed), /default branch/, 'the answer did not say where to go before landing again')
  assert.equal(gitIn(fixture.clone, 'rev-parse', 'HEAD'), base, 'the clone moved for a batch that could never be put back')
  assert.deepEqual(theLandBranchesIn(fixture.clone), [], 'a branch was cut in a clone with no branch to go back to')
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'a batch was pushed from a clone with no branch to go back to')
})

test('#256: a package with no PASS row stops the whole batch before a branch is cut, merged or pushed', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const passed = threePassedPackages(fixture)
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, passed.pulls)))
  await aPassedVerdict(tests, at(passed.packages, 0), base, at(passed.heads, 0))
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: passed.packages })
  assert.match(wordsOf(landed), /no PASS row/)
  assert.ok(wordsOf(landed).includes(at(passed.packages, 1)), 'the answer did not name the package that stopped it')
  assert.doesNotMatch(gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), new RegExp(`^${LAND}/`), 'a branch was cut for a batch that could not land')
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'an integration branch was pushed for a batch that could not land')
})

test('#256: a head no open pull request stands at, and a head two stand at, are each refused by name', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const passed = threePassedPackages(fixture)
  const [first, second] = passed.heads
  const no_pulls = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map([[`repos/${fixture.repo}/commits/${String(first)}/pulls`, []]]))))
  await aPassedVerdict(no_pulls, at(passed.packages, 0), base, String(first))
  const no_pull = await landPassedWorkAsOneBatch(no_pulls.host, MEMBER, { path: fixture.clone, packages: [at(passed.packages, 0)] })
  assert.match(wordsOf(no_pull), /no open pull request/)
  assert.ok(wordsOf(no_pull).includes(String(first)), 'the answer did not name the head it asked about')

  // Two open pull requests at one head: written, not recorded, because GitHub allows one per head and base and no
  // recording of the state was at hand. Its shape is GitHub's own.
  const two_at_one = [anOpenPullRequest(291, String(second)), anOpenPullRequest(292, String(second))].flat()
  const two_pulls = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map([[`repos/${fixture.repo}/commits/${String(second)}/pulls`, two_at_one]]))))
  await aPassedVerdict(two_pulls, at(passed.packages, 1), base, String(second))
  const two = await landPassedWorkAsOneBatch(two_pulls.host, MEMBER, { path: fixture.clone, packages: [at(passed.packages, 1)] })
  assert.match(wordsOf(two), /more than one open pull request/)
  assert.match(wordsOf(two), /#291/, 'the answer did not name the first pull request')
  assert.match(wordsOf(two), /#292/, 'the answer did not name the second pull request')
})

test('#256: a package is landed as the pull request its verdict passed, whose number is not the issue number', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#243`
  const head = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  const pulls = new Map<string, unknown>([[`repos/${fixture.repo}/commits/${head}/pulls`, anOpenPullRequest(246, head)]])
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, pulls)))
  await aPassedVerdict(tests, work_package, base, head)
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: [work_package] })
  assert.ok('told' in landed, `a package whose pull request number differs from its issue was refused: ${wordsOf(landed)}`)
  assert.ok(landed.told.includes(`${work_package} (PR 246)`), `the answer did not name the pull request: ${landed.told}`)
  // The clone is back on its default branch, so the merge is read where it was pushed: on the origin's land branch.
  const branch = theLandBranchesOnOrigin(fixture)[0] ?? ''
  assert.match(inTheOrigin(fixture, 'log', '-1', '--format=%s', `refs/heads/${branch}`), /Land #246 \(.*#243, PASS\)/)
})

test('#256: a pull request that does not merge cleanly stops the batch there and names the packages not tried', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((entry) => `${fixture.repo}#${String(250 + entry)}`)
  // The first two change the same line of one file, so the second is a conflict; the third is never reached.
  const heads = [
    aBranchWithOneCommit(fixture, 'passed0', base, 'shared.txt', 'two\n'),
    aBranchWithOneCommit(fixture, 'passed1', base, 'shared.txt', 'three\n'),
    aBranchWithOneCommit(fixture, 'passed2', base, 'later.txt', 'later\n'),
  ]
  const pulls = new Map<string, unknown>()
  heads.forEach((head, entry) => pulls.set(`repos/${fixture.repo}/commits/${head}/pulls`, anOpenPullRequest(281 + entry, head)))
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, pulls)))
  for (const [entry, work_package] of packages.entries()) await aPassedVerdict(tests, work_package, base, at(heads, entry))

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.match(wordsOf(landed), /stopped at/)
  assert.ok(wordsOf(landed).includes(at(packages, 1)), 'the answer did not name the package that would not merge')
  assert.match(wordsOf(landed), /PR 282/, 'the answer did not name its pull request')
  assert.ok(wordsOf(landed).includes(`Untried: ${at(packages, 2)}`), `the answer did not name the package not tried: ${wordsOf(landed)}`)
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'a batch that could not merge everything was pushed anyway')
})

test('#256: the fast-forward puts the passed tip on the default branch, and its push is announced and concluded in the ledger', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#256`
  const tip = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())))
  await aPassedVerdict(tests, work_package, base, tip)

  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: fixture.clone, base, tip, packages: [work_package] })
  assert.ok('told' in forwarded, `a fast-forward the owner said yes to was refused: ${wordsOf(forwarded)}`)
  assert.equal(theOriginMain(fixture), tip, 'the default branch was not fast-forwarded onto the passed tip')
  const rows = await readLedger(tests.host, work_package)
  const announced = rows.filter((row) => row.kind === 'act_announced')
  const concluded = rows.filter((row) => row.kind === 'act_concluded')
  assert.equal(announced.length, 1, 'the push was not announced once in the ledger')
  assert.equal(concluded.length, 1, 'the push was not concluded once in the ledger')
  assert.deepEqual(announced[0]?.kind === 'act_announced' ? announced[0].act.kind : '', 'push', 'the act was not kept as a push')
  assert.equal(concluded[0]?.kind === 'act_concluded' ? concluded[0].outcome.succeeded : false, true, 'the push was kept as failed')
})

test('#320: a package that reached the default branch is noted as landed, and read back as landed', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const landed_package = `${fixture.repo}#320`
  const tip = aBranchWithOneCommit(fixture, 'landed', base, 'work.txt', 'the work\n')
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())))
  await aPassedVerdict(tests, landed_package, base, tip)

  assert.deepEqual(await landingsOf(tests.host, [landed_package]), [], 'a package that has not landed holds no landing row')
  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: fixture.clone, base, tip, packages: [landed_package] })
  assert.ok('told' in forwarded, `a fast-forward the owner said yes to was refused: ${wordsOf(forwarded)}`)

  const rows = await readLedger(tests.host, landed_package)
  const landings = rows.filter((row) => row.kind === 'package_landed')
  assert.equal(landings.length, 1, 'the landing was not noted once in the ledger')
  assert.deepEqual(landings[0]?.kind === 'package_landed' ? landings[0].note : '', `${base}..${tip}`, 'the note holds the range that landed, as the two shas')
  const read_back = await landingsOf(tests.host, [landed_package])
  assert.deepEqual(read_back, [{ package: landed_package, at: landings[0]?.kind === 'package_landed' ? landings[0].at : -1 }], 'the package did not read back as landed, with the moment its own row carries')
})

test('#320 r=3: a package that landed twice is read at each landing, so a hand-off after the first one still ends', async (t) => {
  // A package lands, is fixed, and lands again at a new head, so its ledger holds two landing rows — the row the
  // fast-forward writes, written here at three moments. Keeping only the first would leave every hand-off made after
  // it standing for ever, and its reviewer nudged for a verdict that had already been given.
  const fixture = aRepository(t)
  const first_package = `${fixture.repo}#320`
  const second_package = `${fixture.repo}#321`
  const HOUR = 60 * 60 * 1_000
  const tests = aHostOver(async (): Promise<ProcessOutcome> => ({ exit_code: 1, stdout: '', stderr: '' }))
  const landed = async (work_package: string, range: string): Promise<void> => {
    await noteMilestone(tests.host, { package: work_package, member: MEMBER, milestone: 'package_landed', note: range })
  }

  await landed(first_package, `${'a'.repeat(7)}..${'b'.repeat(7)}`)
  tests.advanceClock(HOUR)
  await landed(second_package, `${'a'.repeat(7)}..${'c'.repeat(7)}`)
  const first_time_second_landed = THE_DAY + HOUR
  const handed = THE_DAY + 2 * HOUR
  tests.advanceClock(HOUR)
  tests.advanceClock(HOUR)
  await landed(second_package, `${'c'.repeat(7)}..${'d'.repeat(7)}`)
  const second_time_second_landed = THE_DAY + 3 * HOUR

  const landings = await landingsOf(tests.host, [first_package, second_package])
  assert.deepEqual(
    landings,
    [
      { package: first_package, at: THE_DAY },
      { package: second_package, at: first_time_second_landed },
      { package: second_package, at: second_time_second_landed },
    ],
    'every landing a ledger keeps is read, each with its own moment',
  )

  const banded = `${'a'.repeat(40)}..${'b'.repeat(40)}`
  const hand_off = { from: 'Vesta', to: ['Mars'], text: `HANDOFF ${second_package} ${banded} r=1 ci=none:paths`, sent_at: handed }
  assert.deepEqual(reviewWaitsIn([hand_off], landings, [SUPERVISOR]), [], 'the landing after the hand-off ended it, though the package had landed before')
})

test('#256: the fast-forward is refused when the default branch moved after the range was checked', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#256`
  const tip = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())))
  await aPassedVerdict(tests, work_package, base, tip)
  // Someone else lands on the default branch between the check and the owner's yes.
  writeFileSync(join(fixture.seed, 'elsewhere.txt'), 'elsewhere\n')
  commitIn(fixture.seed, 'a landing of someone else')
  gitIn(fixture.seed, 'push', '--quiet', 'origin', 'main')
  const moved_to = gitIn(fixture.seed, 'rev-parse', 'HEAD')

  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: fixture.clone, base, tip, packages: [work_package] })
  assert.match(wordsOf(forwarded), /moved after the range was checked/)
  assert.ok(wordsOf(forwarded).includes(base), 'the answer did not name the base the check was made against')
  assert.ok(wordsOf(forwarded).includes(moved_to), 'the answer did not name where the default branch stands')
  assert.equal(theOriginMain(fixture), moved_to, 'the default branch was pushed anyway')
  const rows = await readLedger(tests.host, work_package)
  const concluded = rows.filter((row) => row.kind === 'act_concluded')
  assert.equal(concluded.length, 1, 'the refused push was not kept in the ledger')
  assert.equal(concluded[0]?.kind === 'act_concluded' ? concluded[0].outcome.succeeded : true, false, 'a refused push was kept as succeeded')
  assert.deepEqual(rows.filter((row) => row.kind === 'package_landed'), [], 'a fast-forward that was refused wrote a landing')
})

test('#256: a push git refuses is answered with what git said, and kept in the ledger as failed', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#256`
  const tip = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  // The origin refuses every push: a hook of its own, which is where a real refusal comes from.
  const hook = join(fixture.origin, 'hooks', 'pre-receive')
  writeFileSync(hook, '#!/bin/sh\necho "the branch is protected" >&2\nexit 1\n')
  chmodSync(hook, 0o755)
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())))
  await aPassedVerdict(tests, work_package, base, tip)

  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: fixture.clone, base, tip, packages: [work_package] })
  assert.match(wordsOf(forwarded), /was refused/)
  assert.match(wordsOf(forwarded), /the branch is protected/, 'the answer did not keep what git said')
  assert.equal(theOriginMain(fixture), base, 'the default branch moved although the push was refused')
  const concluded = (await readLedger(tests.host, work_package)).filter((row) => row.kind === 'act_concluded')
  assert.equal(concluded[0]?.kind === 'act_concluded' ? concluded[0].outcome.succeeded : true, false, 'a push git refused was kept as succeeded')
})

test('#256: a push whose outcome the ledger cannot keep stands announced and unconcluded, and the answer says so', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#256`
  const tip = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  // The package's PASS row is the first append; the push's announcement the second; its outcome the third, which this
  // store will not keep.
  const rows = aStoreThatRefusesTheAppendAt(3)
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())), rows)
  await aPassedVerdict(tests, work_package, base, tip)

  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: fixture.clone, base, tip, packages: [work_package] })
  assert.match(wordsOf(forwarded), /was sent/)
  assert.match(wordsOf(forwarded), /its outcome was not recorded/)
  const kept = await readLedger(tests.host, work_package)
  assert.equal(kept.filter((row) => row.kind === 'act_announced').length, 1, 'the push was not announced before it ran')
  assert.equal(kept.filter((row) => row.kind === 'act_concluded').length, 0, 'an outcome was kept although the store refused it')
})

test('#256: a landing call that names no package, no base or no tip is refused by name', () => {
  assert.match(refusedBy(theBatchACallNames({ path: '/clone' })), /work packages it lands/)
  assert.match(refusedBy(theFastForwardACallNames({ path: '/clone', packages: ['synthetic-owner/widget#1'] })), /names the base the range was checked against/)
  assert.match(refusedBy(theFastForwardACallNames({ path: '/clone', base: 'a', packages: ['synthetic-owner/widget#1'] })), /names the tip the owner said yes to/)
  assert.match(refusedBy(theFastForwardACallNames({ path: '/clone', base: '', packages: ['synthetic-owner/widget#1'] })), /names the base the range was checked against/)
})

test('#256: a fast-forward whose row one package will not keep does not run, and the package already announced is told so', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const tip = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  const packages = [1, 2].map((entry) => `${fixture.repo}#${String(300 + entry)}`)
  // The first package's announcement is the first row this store keeps, and the second package's is the one it refuses.
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())), aStoreThatRefusesTheAppendAt(2))
  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: fixture.clone, base, tip, packages })
  assert.match(wordsOf(forwarded), /was not sent/)
  assert.ok(wordsOf(forwarded).includes(at(packages, 1)), 'the answer did not name the package whose row was not kept')
  assert.equal(theOriginMain(fixture), base, 'the default branch moved although the push was never sent')
  const concluded = (await readLedger(tests.host, at(packages, 0))).filter((row) => row.kind === 'act_concluded')
  assert.equal(concluded.length, 1, 'the package announced before the refusal was left without an outcome')
  assert.equal(concluded[0]?.kind === 'act_concluded' ? concluded[0].outcome.succeeded : true, false, 'an act that was never sent was kept as succeeded')
})

test('#256: a clone that does not say who commits is refused before a branch is cut, with what to set', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  // A merge writes a commit, and git refuses one with no committer: the run must say so rather than cut a branch it
  // cannot merge onto.
  gitIn(fixture.clone, 'config', 'user.name', '')
  gitIn(fixture.clone, 'config', 'user.email', '')
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, new Map())))
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: [`${fixture.repo}#251`] })
  assert.match(wordsOf(landed), /does not say who commits/)
  assert.match(wordsOf(landed), /user\.name/, 'the answer did not name the setting to make')
  assert.match(wordsOf(landed), /user\.email/, 'the answer did not name the setting to make')
  assert.doesNotMatch(gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), new RegExp(`^${LAND}/`), 'a branch was cut for a batch that could not merge')
  assert.equal(base, gitIn(fixture.clone, 'rev-parse', 'origin/main'))
})

// --- a held package stops a batch before anything runs (martha#364) ------------------------------------------------

/** A host whose processes fail the test if anything is run: a batch a hold stops runs no git and asks no GitHub. */
function aHostThatMayRunNothing(rows?: RowStore): { readonly tests: HostForTests; readonly ran: ProcessRequest[] } {
  const ran: ProcessRequest[] = []
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    ran.push(request)
    return { exit_code: 1, stdout: '', stderr: 'a held batch ran this' }
  }
  return { tests: aHostOver(run, rows), ran }
}

/** A hold on `work_package`, recorded through the standing items' own tool, by the Supervisor. */
async function aHoldOn(host: HostForTests['host'], id: string, work_package: string | undefined, until = 'the demo is over'): Promise<void> {
  const call = { kind: 'held', id, item: 'the restart PR', reason: 'lands after the demo', until, ...(work_package === undefined ? {} : { package: work_package }) }
  const recorded = await recordAStandingItem(host, call, SUPERVISOR)
  assert.ok('told' in recorded, `the hold was not recorded: ${JSON.stringify(recorded)}`)
}

test('#364: a held package in a batch refuses it, naming the hold and the package, and runs no git at all (mutant: drop the check; move it after the fetch)', async () => {
  const work_package = 'macula-io/martha#364'
  const { tests, ran } = aHostThatMayRunNothing()
  await aHoldOn(tests.host, 'hold-martha-364', work_package)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: '/no/clone/is/read', packages: ['macula-io/martha#1', work_package] })
  assert.ok('refused' in landed, `a batch holding a held package was not refused: ${wordsOf(landed)}`)
  assert.match(landed.refused, /nothing was landed/)
  assert.ok(landed.refused.includes('hold-martha-364'), `the refusal did not name the hold: ${landed.refused}`)
  assert.ok(landed.refused.includes(work_package), `the refusal did not name the package: ${landed.refused}`)
  assert.ok(landed.refused.includes(STANDING_CLOSE), `the refusal did not say how a hold is closed: ${landed.refused}`)
  assert.deepEqual(ran.map((request) => request.args.join(' ')), [], 'a batch a hold stops ran something before it refused')
})

test('#364: the hold closed with its evidence, the same batch lands', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const passed = threePassedPackages(fixture)
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, passed.pulls)))
  for (const [entry, work_package] of passed.packages.entries()) await aPassedVerdict(tests, work_package, base, at(passed.heads, entry))
  const held = at(passed.packages, 1)
  await aHoldOn(tests.host, 'hold-second', held)

  const stopped = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: passed.packages })
  assert.ok('refused' in stopped, `the batch landed with ${held} held: ${wordsOf(stopped)}`)
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'a held batch pushed a land branch')

  const closed = await closeAStandingItem(tests.host, { id: 'hold-second', evidence: 'the demo is over' }, SUPERVISOR)
  assert.ok('told' in closed, `the hold was not closed: ${JSON.stringify(closed)}`)
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages: passed.packages })
  assert.ok('told' in landed, `the batch was refused after its hold was closed: ${wordsOf(landed)}`)
  assert.equal(theLandBranchesOnOrigin(fixture).length, 1, 'the batch did not land once its hold was closed')
})

test('#364: a hold whose day has come still stops the batch: only a close ends a hold (mutant: treat DUE as released)', async () => {
  const { tests, ran } = aHostThatMayRunNothing()
  await aHoldOn(tests.host, 'hold-due', 'macula-io/martha#7', '2026-11-01')

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: '/no/clone/is/read', packages: ['macula-io/martha#7'] })
  assert.ok('refused' in landed, `a batch whose hold is due landed: ${wordsOf(landed)}`)
  assert.ok(landed.refused.includes('hold-due'))
  assert.deepEqual(ran, [], 'a batch a due hold stops ran something')
})

test('#364: the holds that cannot be read refuse the batch, and nothing runs (mutant: let an unreadable stream through)', async () => {
  const rows: RowStore = {
    append: async () => {
      throw new Error('this store keeps nothing')
    },
    read: async () => {
      throw new Error('the standing stream is unreadable')
    },
  }
  const { tests, ran } = aHostThatMayRunNothing(rows)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: '/no/clone/is/read', packages: ['macula-io/martha#7'] })
  assert.ok('refused' in landed, `a batch that could not read the holds landed: ${wordsOf(landed)}`)
  assert.match(landed.refused, /holds could not be read/)
  assert.match(landed.refused, /the standing stream is unreadable/)
  assert.deepEqual(ran, [], 'a batch that could not read its holds ran something')
})

test('#364: the fast-forward of a held package is refused before its push is announced or sent (mutant: drop the check from the fast-forward)', async () => {
  const work_package = 'macula-io/martha#364'
  const { tests, ran } = aHostThatMayRunNothing()
  await aHoldOn(tests.host, 'hold-martha-364', work_package)

  const forwarded = await fastForwardAfterTheOwnersYes(tests.host, MEMBER, { path: '/no/clone/is/read', base: 'a'.repeat(40), tip: 'b'.repeat(40), packages: [work_package] })
  assert.ok('refused' in forwarded, `the fast-forward of a held package ran: ${wordsOf(forwarded)}`)
  assert.match(forwarded.refused, /nothing was pushed/)
  assert.ok(forwarded.refused.includes('hold-martha-364') && forwarded.refused.includes(work_package))
  assert.deepEqual(ran, [], 'the fast-forward of a held package ran git')
  assert.deepEqual(await readLedger(tests.host, work_package), [], 'the fast-forward of a held package announced a push in its ledger')
})

test('#364: both tools say an open hold on a listed package refuses the call', () => {
  for (const description of [LAND_BATCH_DESCRIPTION, FAST_FORWARD_DESCRIPTION]) assert.ok(description.includes(A_HOLD_REFUSES), `a landing tool does not say a hold refuses it: ${description}`)
})
