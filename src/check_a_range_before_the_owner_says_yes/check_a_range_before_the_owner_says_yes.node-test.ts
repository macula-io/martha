// The range check before the owner says yes (martha#256, slice 1).
//
// Every test works on a throwaway origin and a clone of it, so what is pinned is what git really does: the three
// refusals the design names (a base that is not the default tip, a tip that does not descend from it, a committed
// conflict marker), the one menu line with the CI GitHub holds on the tip, a range touching a workflow asking for a
// by-eye read, and a batch: one --no-ff merge per package passes, a merge carrying a change of its own fails naming
// its package and its pull request, and a range that lands none of a passed package is refused naming that package.
//
// GitHub's answer for a green tip is a recording kept beside this slice (recorded_runs_on_a_tip.json); the states it
// cannot hold — a skipped job, a run with no jobs, no run at all — are written in the tests that need them and said to
// be written, in GitHub's own shape.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { keepThePackageContract } from '../keep_the_package_contract/keep_the_package_contract.ts'
import { ASK_QUEUED, ASKS_SETTLED, OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { SHORT_SHA } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { keepTheLinesRow, readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { repoOfTheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { GIT, GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { theRangeACallNames, verifyRange, type CheckedRange } from './check_a_range_before_the_owner_says_yes.ts'

/** What a call the slice refuses says, or a failure naming what it answered instead. */
const refusedBy = (asked: { readonly ok?: unknown; readonly refused?: string }): string =>
  asked.refused ?? assert.fail(`the call was not refused: ${JSON.stringify(asked)}`)

const RECORDED = JSON.parse(readFileSync(new URL('./recorded_runs_on_a_tip.json', import.meta.url), 'utf8')) as {
  readonly workflow_runs: readonly RecordedRun[]
  readonly jobs: Readonly<Record<string, readonly RecordedJob[]>>
}

interface RecordedRun {
  readonly id: number
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

interface RecordedJob {
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

interface Fixture {
  readonly root: string
  readonly origin: string
  readonly seed: string
  readonly clone: string
  readonly repo: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync(GIT, [...args], { cwd, encoding: 'utf8' }).trim()

/** git with the identity a throwaway repository has no config for: the commits and the merges both need one. */
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

/** A bare origin at `<root>/acme/widget.git`, a seed checkout that pushes to it, and a clone the check reads. */
function aRepository(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'martha-256-range-'))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'acme', 'widget.git')
  mkdirSync(dirname(origin), { recursive: true })
  execFileSync(GIT, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(root, 'seed')
  mkdirSync(seed)
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  const clone = join(root, 'clone')
  execFileSync(GIT, ['clone', '--quiet', origin, clone])
  return { root, origin, seed, clone, repo: repoOfTheOrigin(origin) ?? '' }
}

/** Writes a file in the clone, making the directories between when it names them. */
function writeIn(clone: string, name: string, text: string): void {
  mkdirSync(dirname(join(clone, name)), { recursive: true })
  writeFileSync(join(clone, name), text)
}

/** A new branch from `from` holding one commit, pushed; answers the commit it made. */
function aBranchWithOneCommit(fixture: Fixture, name: string, from: string, file: string, text: string): string {
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', name, from)
  writeIn(fixture.clone, file, text)
  commitIn(fixture.clone, `the work on ${name}`)
  gitIn(fixture.clone, 'push', '--quiet', 'origin', name)
  return gitIn(fixture.clone, 'rev-parse', 'HEAD')
}

/** Merges a head into the branch the clone stands on, `--no-ff`, and answers the merge's sha. */
function mergeHere(clone: string, head: string, message: string): string {
  gitIn(clone, ...withAnAuthor, 'merge', '--no-ff', '--no-edit', '-m', message, head)
  return gitIn(clone, 'rev-parse', 'HEAD')
}

/** GitHub as these tests give it: an answer per path it was told about, and every path it was asked. */
interface AGithub {
  readonly run: (request: ProcessRequest) => Promise<ProcessOutcome>
  readonly asked: readonly ProcessRequest[]
}

function aGithub(answers: ReadonlyMap<string, unknown>): AGithub {
  const asked: ProcessRequest[] = []
  const run = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    if (request.command !== GITHUB_CLI) return runReal(request)
    asked.push(request)
    const path = request.args[1] ?? ''
    const found = [...answers.entries()].find(([start]) => path.startsWith(start))
    if (found === undefined) return { exit_code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' }
    return { exit_code: 0, stdout: JSON.stringify(found[1]), stderr: '' }
  }
  return { run, asked }
}

/** The recorded answer, told to GitHub under this test's own repository name: the shapes are the recording's. */
function theRecordedRuns(repo: string): ReadonlyMap<string, unknown> {
  const answers = new Map<string, unknown>([
    [`repos/${repo}/actions/runs?head_sha=`, { total_count: RECORDED.workflow_runs.length, workflow_runs: RECORDED.workflow_runs }],
  ])
  for (const [run, jobs] of Object.entries(RECORDED.jobs)) {
    answers.set(`repos/${repo}/actions/runs/${run}/jobs`, { total_count: jobs.length, jobs })
  }
  return answers
}

/** A host over this GitHub, and nothing yet in its ledger. */
function aHostOver(github: AGithub): HostForTests {
  return hostForTests({ run: github.run })
}

/** The line the answer ends with: the one thing the owner reads. */
const theLineOf = (checked: CheckedRange): string => ('told' in checked ? (checked.told.split('\n').at(-1) ?? '') : checked.refused)

/** A package's PASS row, written as the crew's own line writes one. */
const aPassedVerdict = async (host: HostForTests, work_package: string, base: string, head: string): Promise<void> => {
  const reading = readACrewLine(`VERDICT ${work_package} PASS ${base}..${head} r=2 ci=1 req=0`)
  if (!('line' in reading) || reading.line === null) throw new Error(`the crew's own PASS line was not read: ${JSON.stringify(reading)}`)
  await keepTheLinesRow(host.host, 'Mercurius', reading.line)
}

/** An answer holding one open pull request at each head, by the pull request's number. */
function oneOpenPullRequestAtEach(repo: string, heads: readonly string[], first_pr: number): Map<string, unknown> {
  const answers = new Map<string, unknown>()
  heads.forEach((head, at) => {
    answers.set(`repos/${repo}/commits/${head}/pulls`, [{ number: first_pr + at, state: 'open', merged_at: null, head: { sha: head } }])
  })
  answers.set(`repos/${repo}/actions/runs?head_sha=`, { total_count: 0, workflow_runs: [] })
  return answers
}

test('#256: the range is refused when its base is not the tip of the origin default branch', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  // A later commit reaches the default branch, so the base the range names is no longer where it stands.
  writeFileSync(join(fixture.seed, 'later.txt'), 'later work\n')
  commitIn(fixture.seed, 'a later commit')
  gitIn(fixture.seed, 'push', '--quiet', 'origin', 'main')
  const now = gitIn(fixture.seed, 'rev-parse', 'HEAD')
  const checked = await verifyRange(aHostOver(aGithub(new Map())).host, { path: fixture.clone, base, tip: base })
  assert.ok('refused' in checked, `a stale base was checked: ${JSON.stringify(checked)}`)
  assert.match(checked.refused, /is not the tip of origin\/main/)
  assert.match(checked.refused, new RegExp(now), 'the answer did not name where the default branch stands')
})

test('#256: the range is refused when its tip does not descend from its base', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  // Another line of work entirely: a branch whose first commit is its own root, so nothing of it descends from the
  // default branch's tip.
  gitIn(fixture.clone, 'checkout', '--quiet', '--orphan', 'sideways')
  gitIn(fixture.clone, 'rm', '-r', '-f', '--quiet', '--ignore-unmatch', '.')
  writeIn(fixture.clone, 'sideways.txt', 'sideways\n')
  commitIn(fixture.clone, 'a root of its own')
  const tip = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  gitIn(fixture.clone, 'push', '--quiet', 'origin', 'sideways')
  const checked = await verifyRange(aHostOver(aGithub(new Map())).host, { path: fixture.clone, base, tip })
  assert.ok('refused' in checked, `a tip from another line of work was checked: ${JSON.stringify(checked)}`)
  assert.match(checked.refused, /does not descend from/)
})

test('#601: a committed conflict marker and an unreadable CI are each one notice, and the owner is asked anyway', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const tip = aBranchWithOneCommit(fixture, 'unresolved', base, 'notes.md', 'ours\n<<<<<<< HEAD\ntheirs\n')
  const checked = await verifyRange(aHostOver(aGithub(new Map())).host, { path: fixture.clone, base, tip })
  assert.ok('told' in checked, `a committed conflict marker stopped the check: ${JSON.stringify(checked)}`)
  assert.match(checked.told, /notice: the tree at .* holds a committed conflict marker: notes\.md/, 'the answer did not name the file that carries it')
  assert.match(theLineOf(checked), /CI on [0-9a-f]+: gh could not read the runs on/, 'the line did not say the CI could not be read')
})

test('#256: a tip GitHub really answered for is named job by job, the skipped job the recording holds included', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const tip = aBranchWithOneCommit(fixture, 'work', base, 'work.txt', 'the work\n')
  const checked = await verifyRange(aHostOver(aGithub(theRecordedRuns(fixture.repo))).host, { path: fixture.clone, base, tip })
  const line = theLineOf(checked)
  assert.ok('told' in checked, `a green range was refused: ${line}`)
  const jobs = Object.values(RECORDED.jobs).flat()
  assert.match(line, new RegExp(`${RECORDED.workflow_runs.length} runs`), 'the line did not name how many runs the tip has')
  assert.match(line, new RegExp(`${String(jobs.length)} jobs`), 'the line did not name how many jobs the runs hold')
  const skipped = jobs.find((job) => job.conclusion === 'skipped')
  assert.ok(skipped !== undefined, 'the recording holds no skipped job, so this case proves nothing')
  assert.ok(line.includes(skipped.name), `the line did not name the skipped job: ${line}`)
  assert.match(line, new RegExp(skipped.conclusion ?? ''), 'the line did not say how the skipped job ended')
  assert.match(checked.told, /the work on work/, 'the answer did not name the commit the range adds')
})

test('#256: every job green reads as all green, and a job that was skipped, a run with no jobs and no run at all are each named', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const tip = aBranchWithOneCommit(fixture, 'work', base, 'work.txt', 'the work\n')
  const run = { id: 4321, name: 'CI', status: 'completed', conclusion: 'success' }
  const green = { id: 7, name: 'structural floor', status: 'completed', conclusion: 'success' }
  const answersFor = (jobs: readonly unknown[]): ReadonlyMap<string, unknown> =>
    new Map<string, unknown>([
      [`repos/${fixture.repo}/actions/runs?head_sha=`, { total_count: 1, workflow_runs: [run] }],
      [`repos/${fixture.repo}/actions/runs/${run.id}/jobs`, { total_count: jobs.length, jobs }],
    ])
  const green_line = theLineOf(await verifyRange(aHostOver(aGithub(answersFor([green]))).host, { path: fixture.clone, base, tip }))
  assert.match(green_line, /all green/, `a tip whose every job succeeded did not read as all green: ${green_line}`)

  // Written, not recorded: a job that ended skipped, and a run holding no job at all. Both are GitHub's own shape, and
  // the second is the state the design calls "a run with no jobs"; no recording of either was at hand.
  const skipped = { id: 8, name: 'installer', status: 'completed', conclusion: 'skipped' }
  const skipped_line = theLineOf(await verifyRange(aHostOver(aGithub(answersFor([skipped]))).host, { path: fixture.clone, base, tip }))
  assert.ok(skipped_line.includes(skipped.name), 'the line did not name the job that was skipped')
  assert.match(skipped_line, new RegExp(skipped.conclusion ?? ''), 'the line did not say how the job ended')

  const no_jobs = theLineOf(await verifyRange(aHostOver(aGithub(answersFor([]))).host, { path: fixture.clone, base, tip }))
  assert.match(no_jobs, new RegExp(`run ${String(run.id)} .* has no jobs`), 'a run with no jobs was not named')

  const none = new Map<string, unknown>([[`repos/${fixture.repo}/actions/runs?head_sha=`, { total_count: 0, workflow_runs: [] }]])
  const no_run = theLineOf(await verifyRange(aHostOver(aGithub(none)).host, { path: fixture.clone, base, tip }))
  assert.match(no_run, /no run found/)
})

test('#256: a range that touches a workflow asks for a by-eye read, and one that does not does not', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const touching = aBranchWithOneCommit(fixture, 'touching', base, '.github/workflows/ci.yml', 'name: CI\n')
  const answers = new Map<string, unknown>([[`repos/${fixture.repo}/actions/runs?head_sha=`, { total_count: 0, workflow_runs: [] }]])
  const asked = theLineOf(await verifyRange(aHostOver(aGithub(answers)).host, { path: fixture.clone, base, tip: touching }))
  assert.match(asked, /needs a by-eye read/)
  assert.match(asked, /\.github\/workflows\//, 'the line did not name what asks for the read')

  const plain = aBranchWithOneCommit(fixture, 'plain', base, 'plain.txt', 'plain\n')
  const not_asked = theLineOf(await verifyRange(aHostOver(aGithub(answers)).host, { path: fixture.clone, base, tip: plain }))
  assert.doesNotMatch(not_asked, /by-eye/)
})

test('#256: a batch of three passed packages passes, and one merge carrying a change of its own fails, naming it', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((at) => `${fixture.repo}#${String(250 + at)}`)
  const heads = packages.map((_, at) => aBranchWithOneCommit(fixture, `passed${String(at)}`, base, `work${String(at)}.txt`, `work ${String(at)}\n`))
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'batch', base)
  for (const [at, head] of heads.entries()) mergeHere(fixture.clone, head, `Land #${String(280 + at)} (${packages[at] ?? ''}, PASS)`)
  const tip = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const github = aGithub(oneOpenPullRequestAtEach(fixture.repo, heads, 281))
  const tests = aHostOver(github)
  for (const [at, work_package] of packages.entries()) await aPassedVerdict(tests, work_package, base, heads[at] ?? '')

  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages })
  const line = theLineOf(checked)
  assert.ok('told' in checked, `a batch of three passed packages was refused: ${line}`)
  for (const work_package of packages) assert.ok(line.includes(work_package), `the line did not name ${work_package}`)
  assert.match(line, /PR 281/, 'the line did not name the pull request the package landed as')

  // The last merge is amended to carry a change nobody reviewed, which is what an evil merge looks like.
  writeIn(fixture.clone, 'sneaked.txt', 'not reviewed\n')
  gitIn(fixture.clone, 'add', '-A')
  gitIn(fixture.clone, ...withAnAuthor, 'commit', '--quiet', '--amend', '--no-edit')
  const evil = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const refused = await verifyRange(tests.host, { path: fixture.clone, base, tip: evil, packages })
  assert.ok('refused' in refused, `a merge carrying a change of its own was checked: ${JSON.stringify(refused)}`)
  assert.match(refused.refused, /carries a change of its own/)
  assert.ok(refused.refused.includes(packages[2] ?? ''), 'the answer did not name the package whose merge it is')
  assert.match(refused.refused, /PR 283/, 'the answer did not name the pull request whose merge it is')
})

test('#256: a range that lands none of a passed package is refused, naming that package and its pull request', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((at) => `${fixture.repo}#${String(250 + at)}`)
  const heads = packages.map((_, at) => aBranchWithOneCommit(fixture, `passed${String(at)}`, base, `work${String(at)}.txt`, `work ${String(at)}\n`))
  // The batch lands two of the three: the third package's verdict passed work that the owner's yes would not land, so
  // the menu line must not name it as a PASS the range carries.
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'batch', base)
  for (const at of [0, 1]) mergeHere(fixture.clone, heads[at] ?? '', `Land #${String(281 + at)} (${packages[at] ?? ''}, PASS)`)
  const tip = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const tests = aHostOver(aGithub(oneOpenPullRequestAtEach(fixture.repo, heads, 281)))
  for (const [at, work_package] of packages.entries()) await aPassedVerdict(tests, work_package, base, heads[at] ?? '')

  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages })
  assert.ok('refused' in checked, `a range that lands two of three passed packages was checked: ${JSON.stringify(checked)}`)
  assert.equal(
    checked.refused,
    `no merge lands ${packages[2] ?? ''} (PR 283).`,
    'the refusal did not name exactly the package the range does not land, and its pull request',
  )
})

test('#256: a range that is not one merge per package is refused, naming the commit that is not a merge', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#251`
  const head = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'not-a-batch', base)
  mergeHere(fixture.clone, head, `Land #281 (${work_package}, PASS)`)
  writeIn(fixture.clone, 'of-its-own.txt', 'its own change\n')
  commitIn(fixture.clone, 'a commit of its own')
  const plain = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const github = aGithub(oneOpenPullRequestAtEach(fixture.repo, [head], 281))
  const tests = aHostOver(github)
  await aPassedVerdict(tests, work_package, base, head)
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip: plain, packages: [work_package] })
  assert.ok('refused' in checked, `a plain commit in a batch was checked: ${JSON.stringify(checked)}`)
  assert.match(checked.refused, /is not a merge/)
})

test('#256: a verify_range call that names no clone, no end or no list is refused by name', () => {
  assert.match(refusedBy(theRangeACallNames({})), /names the clone it is checked in, as path/)
  assert.match(refusedBy(theRangeACallNames({ path: '/clone', base: '', tip: 'b' })), /names its base/)
  assert.match(refusedBy(theRangeACallNames({ path: '/clone', base: 'a', tip: 'b', packages: 'nope' })), /packages is the list of work packages/)
})

test('#513: the menu line says what each package\'s acceptance criteria have at the exact tip', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#513`
  const head = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'batch', base)
  mergeHere(fixture.clone, head, `Land #281 (${work_package}, PASS)`)
  const tip = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const tests = aHostOver(aGithub(oneOpenPullRequestAtEach(fixture.repo, [head], 281)))
  await aPassedVerdict(tests, work_package, base, head)

  const without = theLineOf(await verifyRange(tests.host, { path: fixture.clone, base, tip, packages: [work_package] }))
  assert.ok(without.includes(`acceptance of ${work_package}: no package contract recorded`), without)

  // Two criteria: the file the branch adds is at the tip, and one nobody added is not.
  const brief = [
    '```package-contract',
    'goal: the package is checked against its own criteria',
    'acceptance: the work the branch adds is at the tip | document: work.txt',
    'acceptance: a document nobody added is at the tip | document: nowhere.txt',
    'allowed: push',
    'budget: 30 minutes',
    'done: every criterion is met at the tip',
    '```',
  ].join('\n')
  const kept = await keepThePackageContract(tests.host, { package: work_package, member: SUPERVISOR, brief })
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')

  const line = theLineOf(await verifyRange(tests.host, { path: fixture.clone, base, tip, packages: [work_package] }))
  assert.ok(line.includes(`acceptance of ${work_package}: 1 of 2 criteria met at ${tip.slice(0, SHORT_SHA)}`), line)
  assert.match(line, /not met: "a document nobody added is at the tip" \(nowhere\.txt is not at /)
})

test('#513: a criterion\'s evidence is read at the tip, not at whatever the clone has checked out (r=1 M7)', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#513`
  const head = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'batch', base)
  mergeHere(fixture.clone, head, `Land #281 (${work_package}, PASS)`)
  const tip = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  // The clone is left standing on another branch, which holds a file the tip does not: the tip is no longer HEAD, so a
  // check reading HEAD instead of the tip names the wrong evidence either way.
  aBranchWithOneCommit(fixture, 'elsewhere', base, 'elsewhere-only.txt', 'not part of the tip\n')
  assert.notEqual(gitIn(fixture.clone, 'rev-parse', 'HEAD'), tip, 'the clone still stands on the tip, so this proves nothing')
  const tests = aHostOver(aGithub(oneOpenPullRequestAtEach(fixture.repo, [head], 281)))
  await aPassedVerdict(tests, work_package, base, head)

  const brief = [
    '```package-contract',
    'goal: the evidence is read at the revision the owner is asked about',
    'acceptance: the work the branch adds is at the tip | document: work.txt',
    'acceptance: a document only the clone holds | document: elsewhere-only.txt',
    'allowed: push',
    'budget: 30 minutes',
    'done: every criterion is met at the tip',
    '```',
  ].join('\n')
  const kept = await keepThePackageContract(tests.host, { package: work_package, member: SUPERVISOR, brief })
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')

  const line = theLineOf(await verifyRange(tests.host, { path: fixture.clone, base, tip, packages: [work_package] }))
  assert.ok(line.includes(`acceptance of ${work_package}: 1 of 2 criteria met at ${tip.slice(0, SHORT_SHA)}`), line)
  assert.match(line, /not met: "a document only the clone holds" \(elsewhere-only\.txt is not at /)
})

/** The fixture #513's `ci` criteria are read on: a passed package landed at a tip GitHub answers for, held to a brief. */
interface ACIPackage {
  readonly fixture: Fixture
  readonly base: string
  readonly tip: string
  readonly work_package: string
  readonly tests: HostForTests
  readonly answers: Map<string, unknown>
  readonly never: number
  readonly run: { readonly id: number; readonly name: string; readonly status: string; readonly conclusion: string }
  readonly green_job: Record<string, unknown>
  readonly installer_ran: Record<string, unknown>
  readonly failed_job: Record<string, unknown>
  /** The one menu line, the tip read again under whatever GitHub has answered since this was called. */
  readonly theLineNow: () => Promise<string>
  /** What the tip's own run of `CI` holds as its jobs. */
  readonly theJobsAre: (jobs: readonly unknown[]) => void
}

async function aPackageHeldToItsCICriteria(t: TestContext): Promise<ACIPackage> {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const work_package = `${fixture.repo}#513`
  const head = aBranchWithOneCommit(fixture, 'passed', base, 'work.txt', 'the work\n')
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'batch', base)
  mergeHere(fixture.clone, head, `Land #281 (${work_package}, PASS)`)
  const tip = gitIn(fixture.clone, 'rev-parse', 'HEAD')
  const run = { id: 9001, name: 'CI', status: 'completed', conclusion: 'success' }
  const green_job = { id: 1, name: 'structural floor', status: 'completed', conclusion: 'success' }
  const failed_job = { id: 2, name: 'installer', status: 'completed', conclusion: 'failure' }
  const installer_ran = { id: 3, name: 'installer', status: 'completed', conclusion: 'success' }
  // The answers are one map a test rewrites between calls, so the same tip is read under several states of its own run.
  const answers = oneOpenPullRequestAtEach(fixture.repo, [head], 281)
  answers.set(`repos/${fixture.repo}/actions/runs?head_sha=`, { total_count: 1, workflow_runs: [run] })
  const theJobsAre = (jobs: readonly unknown[]): void => {
    answers.set(`repos/${fixture.repo}/actions/runs/${String(run.id)}/jobs`, { total_count: jobs.length, jobs })
  }
  theJobsAre([green_job, failed_job])
  const tests = aHostOver(aGithub(answers))
  const ask = await tests.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: 'is the evidence of this package enough?', asked_by: SUPERVISOR, since: 0 })
  const never = await tests.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: 'an ask the owner never answered', asked_by: SUPERVISOR, since: 0 })
  await tests.host.stores.rows.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 0, yes: [ask] })

  const brief = [
    '```package-contract',
    'goal: the CI evidence is read from the runs on the tip and the owner\'s yes from their asks',
    'acceptance: the whole CI ran green at the tip | ci: CI',
    'acceptance: the structural floor ran green at the tip | ci: structural floor',
    'acceptance: the installer ran green at the tip | ci: installer',
    'acceptance: a job nothing ran | ci: a job nothing ran',
    'acceptance: the owner said the evidence is enough | owner_yes: ' + String(ask),
    'acceptance: an ask the owner never answered | owner_yes: ' + String(never),
    'allowed: push',
    'budget: 30 minutes',
    'done: every criterion is met at the tip',
    '```',
  ].join('\n')
  const kept = await keepThePackageContract(tests.host, { package: work_package, member: SUPERVISOR, brief })
  assert.ok('answer' in kept, 'refused' in kept ? kept.refused : '')
  await aPassedVerdict(tests, work_package, base, head)
  return {
    fixture,
    base,
    tip,
    work_package,
    tests,
    answers,
    never,
    run,
    green_job,
    installer_ran,
    failed_job,
    theJobsAre,
    theLineNow: async () => theLineOf(await verifyRange(tests.host, { path: fixture.clone, base, tip, packages: [work_package] })),
  }
}

test('#513: a ci criterion is met by a green job or by a whole green run, and an owner_yes one by the owner\'s yes', async (t) => {
  const one = await aPackageHeldToItsCICriteria(t)
  const { tip, work_package, never, theJobsAre, theLineNow } = one
  const at = tip.slice(0, SHORT_SHA)

  // One job of the run failed, so the workflow `CI` is not green and neither is the job that failed; the green job and
  // the owner's yes to their own ask are met, and the ask they never answered is not — this is the case the slice's own
  // example writes, where `CI` is the workflow and not a job of it (r=1 R1).
  const failing_line = await theLineNow()
  assert.ok(failing_line.includes(`acceptance of ${work_package}: 2 of 6 criteria met at ${at}`), failing_line)
  assert.doesNotMatch(failing_line, /not met: "the structural floor ran green at the tip"/)
  assert.match(failing_line, /"the installer ran green at the tip" \(no CI job or run named "installer" was green on /)
  assert.doesNotMatch(failing_line, /not met: "the owner said the evidence is enough"/)
  assert.match(failing_line, /not met: "the whole CI ran green at the tip" \(no CI job or run named "CI" was green on /)
  assert.match(failing_line, /"a job nothing ran" \(no CI job or run named "a job nothing ran" was green on /)
  assert.match(failing_line, new RegExp(`"an ask the owner never answered" \\(the owner has not said yes to ask ${String(never)}\\)`))

  // Every job of the run succeeded, so the workflow named `CI` is green: the criterion the slice's example writes is met.
  theJobsAre([one.green_job, one.installer_ran])
  const green_line = await theLineNow()
  assert.ok(green_line.includes(`acceptance of ${work_package}: 4 of 6 criteria met at ${at}`), green_line)
  assert.doesNotMatch(green_line, /not met: "the whole CI ran green at the tip"/)
  assert.match(green_line, /not met: "a job nothing ran"/)
  assert.match(green_line, new RegExp(`"an ask the owner never answered" \\(the owner has not said yes to ask ${String(never)}\\)`))
})

test('#513: a run of that name holding no job, or a red one beside a green one, is not the workflow green (r=3)', async (t) => {
  const one = await aPackageHeldToItsCICriteria(t)
  const { fixture, tip, work_package, theJobsAre, theLineNow } = one
  const at = tip.slice(0, SHORT_SHA)

  // A run of that name holding no job at all is not green: it ran nothing, whatever GitHub concludes about it.
  theJobsAre([])
  const empty_line = await theLineNow()
  assert.ok(empty_line.includes(`acceptance of ${work_package}: 1 of 6 criteria met at ${at}`), empty_line)
  assert.match(empty_line, /not met: "the whole CI ran green at the tip" \(no CI job or run named "CI" was green on /)

  // Two runs of one workflow on one sha, as a push and a pull_request give: a red one is not overruled by a green one
  // beside it, because the criterion named the workflow and the workflow was red.
  const pull_request_run = { id: one.run.id + 1, name: 'CI', status: 'completed', conclusion: 'success' }
  one.answers.set(`repos/${fixture.repo}/actions/runs?head_sha=`, { total_count: 2, workflow_runs: [one.run, pull_request_run] })
  theJobsAre([one.green_job, one.installer_ran])
  one.answers.set(`repos/${fixture.repo}/actions/runs/${String(pull_request_run.id)}/jobs`, { total_count: 1, jobs: [one.failed_job] })
  const twice_line = await theLineNow()
  assert.ok(twice_line.includes(`acceptance of ${work_package}: 3 of 6 criteria met at ${at}`), twice_line)
  assert.match(twice_line, /not met: "the whole CI ran green at the tip" \(no CI job or run named "CI" was green on /)
})
