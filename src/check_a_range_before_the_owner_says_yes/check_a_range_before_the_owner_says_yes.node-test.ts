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
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { noteMilestone } from '../log_ledger/log_ledger.ts'
import { repoOfTheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { GIT, GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { checkARangeBeforeTheOwnerSaysYes, VERIFY_RANGE, verifyRange, type CheckedRange } from './check_a_range_before_the_owner_says_yes.ts'

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
const aPassedVerdict = (host: HostForTests, work_package: string, base: string, head: string): Promise<void> =>
  noteMilestone(host.host, {
    package: work_package,
    member: 'Mercurius',
    milestone: 'review_round_closed',
    note: `VERDICT ${work_package} PASS ${base}..${head} r=2 ci=1 req=0`,
  })

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

test('#256: the range is refused when a conflict marker is committed at its tip', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const tip = aBranchWithOneCommit(fixture, 'unresolved', base, 'notes.md', 'ours\n<<<<<<< HEAD\ntheirs\n')
  const checked = await verifyRange(aHostOver(aGithub(new Map())).host, { path: fixture.clone, base, tip })
  assert.ok('refused' in checked, `a committed conflict marker was checked: ${JSON.stringify(checked)}`)
  assert.match(checked.refused, /committed conflict marker/)
  assert.match(checked.refused, /notes\.md/, 'the answer did not name the file that carries it')
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

test('#256: verify_range is registered, and a call that names no clone is refused by name', async () => {
  const tests = hostForTests({ run: runReal })
  checkARangeBeforeTheOwnerSaysYes({ host: tests.host })
  const tool = tests.registeredTool(VERIFY_RANGE)
  assert.ok(tool !== undefined, `${VERIFY_RANGE} was not registered`)
  assert.match(await tool.answer({}), /names the clone it is checked in, as path/)
  assert.match(await tool.answer({ path: '/clone', base: '', tip: 'b' }), /names its base/)
  assert.match(await tool.answer({ path: '/clone', base: 'a', tip: 'b', packages: 'nope' }), /packages is the list of work packages/)
})
