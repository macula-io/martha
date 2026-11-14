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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { verifyRange } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { DASHBOARD } from '../declare_crew/declare_crew.ts'
import { forecastWhatABatchLands } from '../forecast_what_a_batch_lands/forecast_what_a_batch_lands.ts'
import { LINTER_CONFIG, theManifestOfAPlantedTree } from '../check_a_host_directory_stays_under_its_ceiling/a_tree_whose_ceilings_a_test_reads.ts'
import type { HostContract, ProcessOutcome, ProcessRequest, Row, RowStore, StoredRow } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { noteMilestone, readLedger } from '../log_ledger/log_ledger.ts'
import { reviewWaitsIn } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { keepTheLinesRow, readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { repoOfTheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { GIT, GITHUB_CLI, NPM } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { A_HOLD_REFUSES } from '../hold_a_package_back_from_a_batch/hold_a_package_back_from_a_batch.ts'
import { STANDING_CLOSE, closeAStandingItem, recordAStandingItem } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { HOST_CEILINGS_SCRIPT, manifestPathOf, type Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import {
  A_DRY_RUN,
  FAST_FORWARD_DESCRIPTION,
  LAND,
  LAND_BATCH,
  LAND_BATCH_DESCRIPTION,
  REDONE_GENERATED,
  THE_CEILINGS_STILL_AHEAD,
  THE_CHECK_PROGRAM,
  THE_REDO_PROGRAM,
  THE_REDO_SCRIPT,
  aDryRunIsAsked,
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
  // A landing's tree carries a package.json, and the ceilings it declares are read from the tree it merges: a fixture
  // without one is a tree no landing could hold to them, and one without a cap on its core slices fails by name (#415).
  writeFileSync(manifestPathOf(seed), theManifestOfAPlantedTree({}))
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

/** A host over this GitHub, at the test's own day, with the programs and scripts a landing runs answered below. */
function aHostOver(
  run: (request: ProcessRequest) => Promise<ProcessOutcome>,
  rows?: RowStore,
  runs?: TheRuns,
): HostForTests {
  return hostForTests({ run: theProcessesALandingMeets(runs, run), now: THE_DAY, ...(rows === undefined ? {} : { rows }) })
}

/** What a landing's runs came to: the scripts it ran with npm, and the programs it ran over the tree. */
interface TheRuns {
  readonly npm: ProcessRequest[]
  readonly programs: ProcessRequest[]
}

/** This repository, as the landing's programs are named from its top: the test runs them where package.json does. */
const THE_ROOT_OF_THIS_TREE = join(import.meta.dirname, '..', '..')

const THE_CHECK_IN_THIS_TREE = join(THE_ROOT_OF_THIS_TREE, THE_CHECK_PROGRAM)
const THE_REDO_IN_THIS_TREE = join(THE_ROOT_OF_THIS_TREE, THE_REDO_PROGRAM)

/**
 * The processes a landing meets in these tests: the two programs it runs over the tree are the real ones, run against
 * the clone the landing is merging (a fixture carries a stand-in for the C4 program, which draws into the tree it is run
 * in), and npm answers at once — a fixture holds neither a type check nor a suite.
 */
function theProcessesALandingMeets(runs: TheRuns | undefined, under: (request: ProcessRequest) => Promise<ProcessOutcome>) {
  const the_programs: Readonly<Record<string, string>> = {
    [THE_REDO_PROGRAM]: THE_REDO_IN_THIS_TREE,
    [THE_CHECK_PROGRAM]: THE_CHECK_IN_THIS_TREE,
  }
  return async (request: ProcessRequest): Promise<ProcessOutcome> => {
    if (request.command === NPM) {
      runs?.npm.push(request)
      const redo = theRedoRunByNpm(request.args)
      if (redo === undefined) return { exit_code: 0, stdout: '', stderr: '' }
      const ran = spawnSync(process.execPath, [THE_REDO_IN_THIS_TREE, ...redo], { cwd: request.cwd, encoding: 'utf8' })
      return { exit_code: ran.status, stdout: ran.stdout, stderr: ran.stderr }
    }
    const here = the_programs[request.args[0] ?? '']
    if (here === undefined) return under(request)
    runs?.programs.push(request)
    const ran = spawnSync(process.execPath, [here, ...request.args.slice(1)], { cwd: request.cwd, encoding: 'utf8' })
    return { exit_code: ran.status, stdout: ran.stdout, stderr: ran.stderr }
  }
}

/**
 * The redo program's own arguments, when npm is asked to run it by its script (`run --silent redo:generated -- ...`), as
 * the range gate and the batch's dry run do (martha#339); undefined for any other npm run, which answers at once.
 */
function theRedoRunByNpm(args: readonly string[]): readonly string[] | undefined {
  const script = args.indexOf(THE_REDO_SCRIPT)
  if (args[0] !== 'run' || script === -1) return undefined
  const rest = args.slice(script + 1)
  return rest[0] === '--' ? rest.slice(1) : rest
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

/** The adapter a batch's two heads grow, and the picture they redraw: what a landing may redo, and what it may not. */
const AN_ADAPTER = 'src/an_adapter'
const THE_PICTURE = 'assets/c4-context.svg'
const REDRAWN = 'the picture, redrawn over the merged tree\n'

/** A stand-in for the C4 program inside a fixture: it draws the picture into the tree it is run in, where the real one does. */
const A_STAND_IN_FOR_THE_C4_PROGRAM = [
  "import { writeFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  `writeFileSync(join(import.meta.dirname, '..', 'assets', 'c4-context.svg'), ${JSON.stringify(REDRAWN)})`,
].join('\n')

/** `n` lines the linter counts as code, under `name`, so a planted tree's count is a number the test knows. */
const codeLines = (name: string, n: number): string =>
  Array.from({ length: n }, (_, at) => `export const ${name}${String(at)} = ${String(at)}\n`).join('')

/** The package.json of a planted tree under these ceilings, with scripts a change outside the map made. */
function aManifestWithScripts(scripts: Readonly<Record<string, string>>, ceilings: Readonly<Record<string, number>>): string {
  const manifest = JSON.parse(theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings })) as Record<string, unknown>
  return `${JSON.stringify({ ...manifest, scripts }, null, 2)}\n`
}

/** The tree a batch's heads are cut from, committed on the default branch and pushed. */
function theBaseTreeOfABatch(fixture: Fixture, files: Readonly<Record<string, string>>): string {
  writeIn(fixture.clone, 'eslint.config.mjs', LINTER_CONFIG)
  for (const [file, text] of Object.entries(files)) writeIn(fixture.clone, file, text)
  commitIn(fixture.clone, 'the tree the batch lands on')
  gitIn(fixture.clone, 'push', '--quiet', 'origin', 'main')
  return gitIn(fixture.clone, 'rev-parse', 'HEAD')
}

/** A branch from `from` holding one commit that writes every file of `files`, pushed; answers the commit it made. */
function aBranchWriting(fixture: Fixture, name: string, from: string, files: Readonly<Record<string, string>>): string {
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', name, from)
  for (const [file, text] of Object.entries(files)) writeIn(fixture.clone, file, text)
  commitIn(fixture.clone, `the work on ${name}`)
  gitIn(fixture.clone, 'push', '--quiet', 'origin', name)
  return gitIn(fixture.clone, 'rev-parse', 'HEAD')
}

/** The two passed packages a test lands: their names, and the host the landing runs on. */
async function theBatchOfTwo(fixture: Fixture, heads: readonly string[], runs: TheRuns) {
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = heads.map((_, at) => `${fixture.repo}#${String(380 + at)}`)
  const pulls = new Map<string, unknown>()
  heads.forEach((head, at) => pulls.set(`repos/${fixture.repo}/commits/${head}/pulls`, anOpenPullRequest(281 + at, head)))
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, pulls)), undefined, runs)
  for (const [entry, work_package] of packages.entries()) await aPassedVerdict(tests, work_package, base, at(heads, entry))
  return { packages, tests }
}

/** The ceiling the landed tip holds for the adapter, as package.json on the origin has it. */
function theCeilingOnTheTip(fixture: Fixture, tip: string): number | undefined {
  const manifest = JSON.parse(inTheOrigin(fixture, 'show', `${tip}:package.json`)) as {
    readonly martha?: { readonly hostCeilings?: Readonly<Record<string, number>> }
  }
  return manifest.martha?.hostCeilings?.[AN_ADAPTER]
}

/** The `count` merges a batch made on the origin, by the second parent of each, oldest first. */
const theMergesOf = (fixture: Fixture, branch: string, count: number): readonly string[] =>
  inTheOrigin(fixture, 'log', '--first-parent', '--format=%P', `-${String(count)}`, branch)
    .split('\n')
    .reverse()
    .map((parents) => parents.trim().split(/\s+/)[1] ?? '')

/**
 * A batch that left one package out (martha#339): it was still pushed, as one land branch whose merges land exactly
 * `landed`, in order; the default branch did not move; the clone is clean; and the answer names the package left out
 * as the owner's menu carries it. Answers the words the answer gave.
 */
function aBatchLeftOneOut(fixture: Fixture, landing: Landing, base: string, landed: readonly string[], out: { readonly package: string; readonly pr: number }): string {
  assert.ok('told' in landing, `a batch with a package left out did not land the rest: ${wordsOf(landing)}`)
  assert.ok(landing.told.includes(`Left out: PR ${String(out.pr)} (${out.package}), `), `the answer did not name the package left out: ${landing.told}`)
  const branches = theLandBranchesOnOrigin(fixture)
  assert.equal(branches.length, 1, `the rest of the batch was not pushed as one ${LAND}/ branch: ${branches.join(', ')}`)
  const branch = branches[0] ?? ''
  const merges = inTheOrigin(fixture, 'rev-list', '--first-parent', '--count', `${base}..refs/heads/${branch}`)
  assert.equal(merges, String(landed.length), 'the land branch holds a merge for the package left out')
  assert.deepEqual(theMergesOf(fixture, branch, landed.length), landed, 'the land branch does not land the rest, in order')
  assert.equal(theOriginMain(fixture), base, 'the default branch moved before the owner said yes')
  assert.equal(gitIn(fixture.clone, 'status', '--porcelain'), '', 'the clone was left holding a change after a package was left out')
  assert.deepEqual(theLandBranchesIn(fixture.clone), [], 'the batch kept its land branch in the clone')
  return landing.told
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

test('#339: a head left out aborts its merge and leaves the clone where it stood, clean, with no land branch left', async (t) => {
  const fixture = aRepository(t)
  const stood_on = gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD')
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((entry) => `${fixture.repo}#${String(250 + entry)}`)
  // The first two change the same line of one file, so the second is a conflict and is left out; the third lands.
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
  // Without the abort, the next merge is refused on a tree mid-merge, and the third head would be left out too.
  aBatchLeftOneOut(fixture, landed, base, [at(heads, 0), at(heads, 2)], { package: at(packages, 1), pr: 282 })
  assert.equal(gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), stood_on, 'the clone was left on the integration branch the batch cut')
  assert.equal(gitIn(fixture.clone, 'rev-parse', 'HEAD'), base, 'the clone moved its HEAD, although a landing commits on its own branch')
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

test('#339 T3: a pull request that clashes by hand with an earlier one is left out, naming the paths and that PR, and the rest land (mutants: stop on a hand clash; resolve it with ours)', async (t) => {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const packages = [1, 2, 3].map((entry) => `${fixture.repo}#${String(250 + entry)}`)
  // The first two change the same line of one file, so the second clashes by hand with the first; the third lands.
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
  const words = aBatchLeftOneOut(fixture, landed, base, [at(heads, 0), at(heads, 2)], { package: at(packages, 1), pr: 282 })
  assert.match(words, /it clashes in shared\.txt with PR 281/, `the answer did not say what the package left out clashes with: ${words}`)
  assert.match(words, /over [^.]*\(PR 281\), [^.]*\(PR 283\)\./, `the range is not said over the packages that landed: ${words}`)
  assert.equal(inTheOrigin(fixture, 'show', `refs/heads/${theLandBranchesOnOrigin(fixture)[0] ?? ''}:shared.txt`), 'two', 'the land branch holds the left-out head\'s side of the clash')
  const ledger = await readLedger(tests.host, at(packages, 1))
  assert.deepEqual(ledger.filter((row) => row.kind === 'act_announced'), [], 'the push was announced in the ledger of the package it left out')
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${theLandBranchesOnOrigin(fixture)[0] ?? ''}`)
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages: [at(packages, 0), at(packages, 2)] })
  assert.ok('told' in checked, `the range over the packages that landed did not pass the check: ${wordsOf(checked)}`)
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

test('#256: a clone that does not say who commits is refused before a branch is cut, with what to set', async (t) => {  const fixture = aRepository(t)
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

test('#381: two heads that both grow one adapter land together, its ceiling at the base plus both raises', async (t) => {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
  })
  // One line both heads add: each counted it, and the merged tree holds it once, so the sum stands one above the tree
  // and only a record run brings the ceiling down to the count.
  const shared = `${codeLines('a', 2)}export const shared = 0\n`
  const ours = aBranchWriting(fixture, 'passed0', base, {
    [`${AN_ADAPTER}/one.ts`]: shared,
    [`${AN_ADAPTER}/two.ts`]: codeLines('c', 1),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 4 } }),
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    [`${AN_ADAPTER}/one.ts`]: shared,
    [`${AN_ADAPTER}/three.ts`]: codeLines('d', 2),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 5 } }),
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const runs: TheRuns = { npm: [], programs: [] }
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], runs)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.ok('told' in landed, `a batch that clashes only in the ceilings was refused: ${wordsOf(landed)}`)
  const branch = theLandBranchesOnOrigin(fixture)[0] ?? ''
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${branch}`)
  assert.deepEqual(theMergesOf(fixture, branch, 2), [ours, theirs], 'the batch is not one merge per head, in order')
  assert.equal(
    theCeilingOnTheTip(fixture, tip),
    6,
    'the tip does not hold the base plus both raises: 2 + 2 + 3 read 7, and the merged tree counts 6',
  )
  assert.match(
    inTheOrigin(fixture, 'log', '-1', '--format=%B', tip),
    /Redone-generated: package\.json martha\.hostCeilings \(measured\)/,
    'the landing commit does not say the ceilings were redone',
  )
  assert.ok(landed.told.includes(packages[1] ?? ''), 'the answer did not name the package whose ceiling was redone')
  assert.ok(runs.npm.some((ran) => ran.args.includes('typecheck')), 'a redone landing pushed without the type check')
  assert.ok(runs.npm.some((ran) => ran.args.includes('test')), 'a redone landing pushed without the suite')
})

test('#381: two heads that clash only in the picture and the ceilings land both, the picture redrawn from the merged tree', async (t) => {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
    [THE_PICTURE]: 'the picture as the base draws it\n',
    'architecture/c4_diagrams.ts': A_STAND_IN_FOR_THE_C4_PROGRAM,
  })
  const ours = aBranchWriting(fixture, 'passed0', base, {
    [`${AN_ADAPTER}/two.ts`]: codeLines('c', 1),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 3 } }),
    [THE_PICTURE]: 'the picture as ours draws it\n',
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    [`${AN_ADAPTER}/three.ts`]: codeLines('d', 2),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 4 } }),
    [THE_PICTURE]: 'the picture as theirs draws it\n',
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const runs: TheRuns = { npm: [], programs: [] }
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], runs)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.ok('told' in landed, `a batch that clashes only in generated files was refused: ${wordsOf(landed)}`)
  const branch = theLandBranchesOnOrigin(fixture)[0] ?? ''
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${branch}`)
  assert.deepEqual(theMergesOf(fixture, branch, 2), [ours, theirs], 'the batch is not one merge per head, in order')
  assert.ok(
    runs.programs.some((ran) => ran.args[0] === THE_REDO_PROGRAM),
    'the landing did not run the program that redoes the generated files',
  )
  assert.equal(inTheOrigin(fixture, 'show', `${tip}:${THE_PICTURE}`), REDRAWN.trim(), 'the tip holds a picture the landing did not draw')
  assert.equal(theCeilingOnTheTip(fixture, tip), 5, 'the tip does not hold the count the merged tree measures: 2 + 1 + 2')
  assert.match(
    inTheOrigin(fixture, 'log', '-1', '--format=%B', tip),
    /Redone-generated: assets\/c4-context\.svg \(picture\); package\.json martha\.hostCeilings \(measured\)/,
    'the landing commit does not say what it redid',
  )
  assert.equal(gitIn(fixture.clone, 'status', '--porcelain'), '', 'the clone was left holding a change after a redone landing')
  assert.deepEqual(theLandBranchesIn(fixture.clone), [], 'a redone landing kept its land branch in the clone')
})

test('#381 #339: a clash that also touches a source file leaves that head out, naming the path it will not settle', async (t) => {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
    [THE_PICTURE]: 'the picture as the base draws it\n',
    'architecture/c4_diagrams.ts': A_STAND_IN_FOR_THE_C4_PROGRAM,
  })
  const ours = aBranchWriting(fixture, 'passed0', base, {
    [`${AN_ADAPTER}/one.ts`]: `${codeLines('a', 2)}export const ours = 1\n`,
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 3 } }),
    [THE_PICTURE]: 'the picture as ours draws it\n',
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    [`${AN_ADAPTER}/one.ts`]: `${codeLines('a', 2)}export const theirs = 1\n`,
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 3 } }),
    [THE_PICTURE]: 'the picture as theirs draws it\n',
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const runs: TheRuns = { npm: [], programs: [] }
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], runs)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  const words = aBatchLeftOneOut(fixture, landed, base, [ours], { package: at(packages, 1), pr: 282 })
  assert.ok(words.includes(`clashes in ${AN_ADAPTER}/one.ts, which a landing does not redo`), `the answer did not name the path a builder has to settle: ${words}`)
})

test('#381 #339: a package.json that differs outside the ceilings is not a generated file: that head is left out, named', async (t) => {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
  })
  const ours = aBranchWriting(fixture, 'passed0', base, {
    'package.json': aManifestWithScripts({ ours: 'echo ours' }, { [AN_ADAPTER]: 2 }),
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    'package.json': aManifestWithScripts({ theirs: 'echo theirs' }, { [AN_ADAPTER]: 3 }),
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const runs: TheRuns = { npm: [], programs: [] }
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], runs)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  const words = aBatchLeftOneOut(fixture, landed, base, [ours], { package: at(packages, 1), pr: 282 })
  assert.match(words, /package\.json differs outside/, `the answer did not say what the clash was: ${words}`)
})

/** Two heads that each merge cleanly and each raise one ceiling to 3, so together they leave the adapter at 4 lines. */
async function twoHeadsOverACeilingTogether(t: TestContext) {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
  })
  // Each head adds a file of its own to the adapter and writes the same raised ceiling, so package.json merges cleanly,
  // nothing is redone, and the two of them together count one line more than either review saw (martha#381, design §4).
  const ours = aBranchWriting(fixture, 'passed0', base, {
    [`${AN_ADAPTER}/two.ts`]: codeLines('c', 1),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 3 } }),
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    [`${AN_ADAPTER}/three.ts`]: codeLines('d', 1),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 3 } }),
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], { npm: [], programs: [] })
  return { fixture, base, ours, packages, tests }
}

test('#381 #339: two heads merge cleanly and leave the tree over a ceiling: the second is taken back off and left out, naming the directory', async (t) => {
  const { fixture, base, ours, packages, tests } = await twoHeadsOverACeilingTogether(t)
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  const words = aBatchLeftOneOut(fixture, landed, base, [ours], { package: at(packages, 1), pr: 282 })
  assert.ok(words.includes(`${AN_ADAPTER}: 4 lines of code, ceiling 3`), `the answer did not name the directory that is over its ceiling: ${words}`)
})

test('#423: the dry run of two heads the landing leaves one of out on the ceilings answers each lands only as a forecast that still faces them (mutant: a plain lands)', async (t) => {
  // The same batch as the test above, where the landing leaves PR 282 out: the dry run merges in memory, has no tree on
  // disk to measure, and so may not answer a plain "lands" for a head the landing it forecasts can leave out.
  const { fixture, packages, tests } = await twoHeadsOverACeilingTogether(t)
  const forecast = await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages })
  const words = wordsOf(forecast)
  for (const [entry, pr] of [281, 282].entries()) {
    assert.ok(words.includes(`- lands: ${at(packages, entry)} (PR ${String(pr)}) (${THE_CEILINGS_STILL_AHEAD})`), `PR ${String(pr)} is not answered lands as a forecast that still faces the ceilings: ${words}`)
  }
})

test('#381: the programs the landing runs are the ones package.json runs them by, in the scripts it names', () => {
  // The landing spells each program once, and package.json spells it again in the script that runs it: the three are
  // held together here, so a program that moves cannot leave a constant or a script pointing where nothing is.
  const declared = JSON.parse(readFileSync(manifestPathOf(THE_ROOT_OF_THIS_TREE), 'utf8')) as Manifest
  assert.equal(
    declared.scripts[THE_REDO_SCRIPT],
    `node ${THE_REDO_PROGRAM}`,
    `package.json's ${THE_REDO_SCRIPT} does not run the program the landing runs`,
  )
  assert.equal(
    declared.scripts[HOST_CEILINGS_SCRIPT],
    `node ${THE_CHECK_PROGRAM}`,
    `package.json's ${HOST_CEILINGS_SCRIPT} does not run the program the landing runs`,
  )
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

// --- the range gate passes what the redo makes, and nothing more (martha#339, T4) ------------------------------------

/**
 * A batch of two heads that both moved the adapter's ceiling, landed by the tool: the second merge clashes in
 * package.json alone and is redone, and the picture, which only the first head redrew, merges cleanly. So the tool's own
 * merge is the one the gate has to pass, and a merge like it that does more is one it has to refuse.
 */
async function aBatchWithARedoneMerge(t: TestContext) {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 2 } }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
    [THE_PICTURE]: 'the picture as the base draws it\n',
  })
  const ours = aBranchWriting(fixture, 'passed0', base, {
    [`${AN_ADAPTER}/two.ts`]: codeLines('c', 1),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 3 } }),
    [THE_PICTURE]: 'the picture as ours draws it\n',
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    [`${AN_ADAPTER}/three.ts`]: codeLines('d', 2),
    'package.json': theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: 4 } }),
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], { npm: [], programs: [] })
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.ok('told' in landed, `a batch that clashes only in the ceilings was refused: ${wordsOf(landed)}`)
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${theLandBranchesOnOrigin(fixture)[0] ?? ''}`)
  return { fixture, tests, base, tip, packages }
}

/** The message a merge carries, read in the clone. */
const theMessageOf = (fixture: Fixture, merge: string): string => gitIn(fixture.clone, 'log', '-1', '--format=%B', merge)

/**
 * A merge with the same two parents as `merge`, made by hand: its tree with each of `files` written over it, and the
 * message given. No ref names it; the range gate is asked about it as the range's tip.
 */
function aMergeMadeByHand(fixture: Fixture, merge: string, files: Readonly<Record<string, string>>, message: string): string {
  const index = join(fixture.root, 'a-hand-made-index')
  const env = { ...process.env, GIT_INDEX_FILE: index }
  execFileSync(GIT, ['read-tree', `${merge}^{tree}`], { cwd: fixture.clone, env })
  for (const [file, text] of Object.entries(files)) {
    const blob = execFileSync(GIT, ['hash-object', '-w', '--stdin'], { cwd: fixture.clone, input: text, encoding: 'utf8' }).trim()
    execFileSync(GIT, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], { cwd: fixture.clone, env })
  }
  const tree = execFileSync(GIT, ['write-tree'], { cwd: fixture.clone, env, encoding: 'utf8' }).trim()
  const [into = '', landed = ''] = gitIn(fixture.clone, 'log', '-1', '--format=%P', merge).split(' ')
  return gitIn(fixture.clone, ...withAnAuthor, 'commit-tree', tree, '-p', into, '-p', landed, '-m', message)
}

test('#339 T4: the range gate passes the merge the landing redid, which merging its parents does not write', async (t) => {
  const { fixture, tests, base, tip, packages } = await aBatchWithARedoneMerge(t)
  assert.match(theMessageOf(fixture, tip), new RegExp(`^${REDONE_GENERATED} package\\.json martha\\.hostCeilings \\(measured\\)$`, 'm'))
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages })
  assert.ok('told' in checked, `the range gate refused the merge the landing redid: ${wordsOf(checked)}`)
})

test('#339 T4: a redone merge that also edits a source file is refused, naming the file (mutant: accept any merge with a redo line)', async (t) => {
  const { fixture, tests, base, tip, packages } = await aBatchWithARedoneMerge(t)
  const evil = aMergeMadeByHand(fixture, tip, { [`${AN_ADAPTER}/one.ts`]: `${codeLines('a', 2)}export const unreviewed = 1\n` }, theMessageOf(fixture, tip))
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip: evil, packages })
  assert.match(wordsOf(checked), new RegExp(`it changes ${AN_ADAPTER}/one\\.ts, which merging its parents does not`))
})

test('#339 T4: a redo line naming a picture that merged cleanly is refused (mutant: take the redone paths from the trailer)', async (t) => {
  const { fixture, tests, base, tip, packages } = await aBatchWithARedoneMerge(t)
  const claimed = theMessageOf(fixture, tip).replace(`${REDONE_GENERATED} `, `${REDONE_GENERATED} ${THE_PICTURE} (picture); `)
  const evil = aMergeMadeByHand(fixture, tip, {}, claimed)
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip: evil, packages })
  assert.match(wordsOf(checked), new RegExp(`line names ${THE_PICTURE.replace('.', '\\.')} \\(picture\\); package\\.json .* and merging its parents clashes in package\\.json`))
})

test('#339 T4: a clashed merge with no redo line is refused, so a merge redone by hand does not pass (mutant: trust the tree alone)', async (t) => {
  const { fixture, tests, base, tip, packages } = await aBatchWithARedoneMerge(t)
  const evil = aMergeMadeByHand(fixture, tip, {}, theMessageOf(fixture, tip).split('\n')[0] ?? '')
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip: evil, packages })
  assert.match(wordsOf(checked), new RegExp(`carries no ${REDONE_GENERATED} line`))
})

test('#339 T4: a redone package.json that also adds a dependency is refused (mutant: skip the manifest check)', async (t) => {
  const { fixture, tests, base, tip, packages } = await aBatchWithARedoneMerge(t)
  const landed = JSON.parse(gitIn(fixture.clone, 'show', `${tip}:package.json`)) as Record<string, unknown>
  const widened = `${JSON.stringify({ ...landed, dependencies: { 'left-pad': '1.3.0' } }, null, 2)}\n`
  const evil = aMergeMadeByHand(fixture, tip, { 'package.json': widened }, theMessageOf(fixture, tip))
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip: evil, packages })
  assert.match(wordsOf(checked), /package\.json, outside martha\.hostCeilings and martha\.sliceCeilings, is not what merging the two reviewed heads writes/)
})

// --- the dry run says what a batch would do, and writes nothing (martha#339, T1, T2, T5, T6) ----------------------

/** What a dry run that refused said, or a failure naming what it told instead. */
const refusedLanding = (landing: Landing): string => ('refused' in landing ? landing.refused : assert.fail(`the dry run was not refused: ${landing.told}`))

/** Lands one branch on the default branch as a batch would, by a `--no-ff` merge whose subject names its pull request. */
function aLandingOnMain(fixture: Fixture, base: string, pr: number, files: Readonly<Record<string, string>>): void {
  const head = aBranchWriting(fixture, `landed${String(pr)}`, base, files)
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  gitIn(fixture.clone, ...withAnAuthor, 'merge', '--quiet', '--no-ff', '-m', `Land #${String(pr)} (${fixture.repo}#${String(pr)}, PASS)`, head)
  gitIn(fixture.clone, 'push', '--quiet', 'origin', 'main')
}

/** What the clone holds that a dry run must leave alone: every ref, where HEAD stands, and its status. */
const whatTheCloneHolds = (fixture: Fixture): string =>
  [gitIn(fixture.clone, 'for-each-ref', '--format=%(refname) %(objectname)'), gitIn(fixture.clone, 'rev-parse', 'HEAD'), gitIn(fixture.clone, 'status', '--porcelain')].join('\n')

const A_RELAY_SCRIPT = 'prove_the_relay_loads/prove_the_relay_loads.sh'
const ONE_TOOL_FILE = 'src/a_crews_tools/a_crews_tools.ts'
const ONE_EXCEPTIONS_FILE = 'src/check_no_literal_restates_a_value/exceptions.ts'

test('#339 T1: a head that clashes with three landings on main is named, each path with the landing that brought it, and nothing is written (mutants: classify every path as generated; write the branch; attribute every clash to the last landing)', async (t) => {
  // The shape of PR 382's head 760e5e6 against main 0c8802c: since it branched, main landed #392 (the picture only),
  // #376 (two source files) and #396 (the relay script), and the head changed all four.
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, { [THE_PICTURE]: 'base\n', [ONE_TOOL_FILE]: 'base\n', [ONE_EXCEPTIONS_FILE]: 'base\n', [A_RELAY_SCRIPT]: 'base\n' })
  const head = aBranchWriting(fixture, 'passed0', base, { [THE_PICTURE]: 'head\n', [ONE_TOOL_FILE]: 'head\n', [ONE_EXCEPTIONS_FILE]: 'head\n', [A_RELAY_SCRIPT]: 'head\n' })
  aLandingOnMain(fixture, base, 392, { [THE_PICTURE]: 'main\n' })
  aLandingOnMain(fixture, base, 376, { [ONE_TOOL_FILE]: 'main\n', [ONE_EXCEPTIONS_FILE]: 'main\n' })
  aLandingOnMain(fixture, base, 396, { [A_RELAY_SCRIPT]: 'main\n' })
  const { packages, tests } = await theBatchOfTwo(fixture, [head], { npm: [], programs: [] })
  const before = whatTheCloneHolds(fixture)

  const forecast = await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages })
  const words = refusedLanding(forecast)
  assert.ok(words.includes(`- clashes by hand: ${at(packages, 0)} (PR 281): `), `the dry run did not name the head that clashes by hand: ${words}`)
  assert.ok(words.includes(`${ONE_TOOL_FILE}, ${ONE_EXCEPTIONS_FILE} with PR 376`), `the two source files are not named with the landing that brought them: ${words}`)
  assert.ok(words.includes(`${A_RELAY_SCRIPT} with PR 396`), `the relay script is not named with the landing that brought it: ${words}`)
  assert.ok(words.includes(`(it would redo ${THE_PICTURE} (picture))`), `the picture is not said to be redone: ${words}`)
  assert.ok(!words.includes(`${THE_PICTURE} with`), `the picture, which the redo redraws, was named as a clash by hand: ${words}`)
  assert.equal(whatTheCloneHolds(fixture), before, 'the dry run changed a ref, HEAD or the status of the clone')
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'the dry run pushed a land branch')
})

test('#339 T2: two heads that clash only in the picture are answered lands, picture redone, and nothing is written (mutants: ignore the generated list; write the branch)', async (t) => {
  // The shape of PR 335 and PR 333 at 7283107: both redrew the picture, and nothing else of theirs clashes.
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, { [THE_PICTURE]: 'base\n' })
  const ours = aBranchWriting(fixture, 'passed0', base, { [THE_PICTURE]: 'ours\n', 'ours.txt': 'ours\n' })
  const theirs = aBranchWriting(fixture, 'passed1', base, { [THE_PICTURE]: 'theirs\n', 'theirs.txt': 'theirs\n' })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], { npm: [], programs: [] })
  const before = whatTheCloneHolds(fixture)

  const forecast = await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages })
  assert.equal(whatTheCloneHolds(fixture), before, 'the dry run changed a ref, HEAD or the status of the clone while it chained a merge')
  assert.ok('told' in forecast, `a batch that clashes only in the picture was refused by the dry run: ${wordsOf(forecast)}`)
  assert.ok(forecast.told.includes(`- lands: ${at(packages, 0)} (PR 281)`), `the first head is not answered lands: ${forecast.told}`)
  assert.ok(forecast.told.includes(`- lands, redone: ${at(packages, 1)} (PR 282): ${THE_PICTURE} (picture) (a forecast:`), `the second head is not answered lands, redone, as a forecast: ${forecast.told}`)
})

/** Two heads whose package.json differ from the base in the ceilings, and in `scripts` when the test asks. */
async function twoHeadsThatClashInTheManifest(t: TestContext, scripts: { readonly ours: Record<string, string>; readonly theirs: Record<string, string> }) {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, { 'package.json': aManifestWithScripts({}, { [AN_ADAPTER]: 2 }) })
  const ours = aBranchWriting(fixture, 'passed0', base, { 'package.json': aManifestWithScripts(scripts.ours, { [AN_ADAPTER]: 3 }) })
  const theirs = aBranchWriting(fixture, 'passed1', base, { 'package.json': aManifestWithScripts(scripts.theirs, { [AN_ADAPTER]: 4 }) })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], { npm: [], programs: [] })
  return { packages, forecast: await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages }) }
}

test('#339 T5: two heads that clash only in the ceilings are answered lands, redone, in the redo\'s own words (mutant: treat the manifest as hand-written)', async (t) => {
  const { packages, forecast } = await twoHeadsThatClashInTheManifest(t, { ours: {}, theirs: {} })
  assert.ok('told' in forecast, `a clash in the ceilings alone was refused by the dry run: ${wordsOf(forecast)}`)
  assert.ok(forecast.told.includes(`- lands, redone: ${at(packages, 1)} (PR 282): package.json martha.hostCeilings (measured)`), `the ceilings are not said to be redone: ${forecast.told}`)
})

test('#339 T6: two heads whose package.json also differ outside the ceilings clash by hand in it (mutant: treat the manifest as generated by its path)', async (t) => {
  const { packages, forecast } = await twoHeadsThatClashInTheManifest(t, { ours: { ours: 'echo ours' }, theirs: { theirs: 'echo theirs' } })
  const words = refusedLanding(forecast)
  assert.ok(words.includes(`- clashes by hand: ${at(packages, 1)} (PR 282): package.json with PR 281`), `package.json is not named a clash by hand with the first head: ${words}`)
})

test('#410: a head that adds a script the other left alone is answered lands, redone (mutants: compare the two sides whole; write the manifest from the first head)', async (t) => {
  const { packages, forecast } = await twoHeadsThatClashInTheManifest(t, { ours: {}, theirs: { added: 'echo theirs' } })
  assert.ok('told' in forecast, `a script one head added beside the ceilings was refused by the dry run: ${wordsOf(forecast)}`)
  assert.ok(
    forecast.told.includes(`- lands, redone: ${at(packages, 1)} (PR 282): package.json martha.hostCeilings (measured)`),
    `the head that raises a ceiling beside a script is not answered lands, redone: ${forecast.told}`,
  )
})

test('#410: the landing writes the script the second head added, and the summed ceiling beside it (mutant: write the first head\'s file)', async (t) => {
  // The shape of 9c88ca7 + 666c1d0: one head raises three ceilings and adds a script, the other raises a ceiling, and
  // the merged tree measures what the sum says, so only the manifest's own rule is on trial here.
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, {
    'package.json': aManifestWithScripts({}, { [AN_ADAPTER]: 2 }),
    [`${AN_ADAPTER}/one.ts`]: codeLines('a', 2),
  })
  const ours = aBranchWriting(fixture, 'passed0', base, {
    'package.json': aManifestWithScripts({}, { [AN_ADAPTER]: 3 }),
    [`${AN_ADAPTER}/two.ts`]: codeLines('c', 1),
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    'package.json': aManifestWithScripts({ added: 'echo theirs' }, { [AN_ADAPTER]: 4 }),
    [`${AN_ADAPTER}/three.ts`]: codeLines('d', 2),
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], { npm: [], programs: [] })
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.ok('told' in landed, `a batch of one script and two ceilings was refused: ${wordsOf(landed)}`)
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${theLandBranchesOnOrigin(fixture)[0] ?? ''}`)
  const manifest = JSON.parse(gitIn(fixture.clone, 'show', `${tip}:package.json`)) as {
    readonly scripts: Readonly<Record<string, string>>
    readonly martha: { readonly hostCeilings: Readonly<Record<string, number>> }
  }
  assert.deepEqual(manifest.scripts, { added: 'echo theirs' }, "the script the second head added was dropped for the first head's file")
  assert.equal(manifest.martha.hostCeilings[AN_ADAPTER], 5, 'the landing did not write the base plus both raises')
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages })
  assert.ok('told' in checked, `the range gate refused a landed script that merging the two heads writes: ${wordsOf(checked)}`)
})

const A_SLICE_ABOVE_A_SMALL_CAP = 'src/a_slice_above_a_small_cap'
const THE_SMALL_CAP = 20

/** The package.json of a planted tree holding one slice above the cap at `ceiling`, with the scripts a change outside the maps made. */
function aManifestWithOneSliceCeiling(scripts: Readonly<Record<string, string>>, ceiling: number): string {
  const manifest = JSON.parse(
    theManifestOfAPlantedTree({ slice_cap: THE_SMALL_CAP, slice_ceilings: { [A_SLICE_ABOVE_A_SMALL_CAP]: ceiling } }),
  ) as Record<string, unknown>
  return `${JSON.stringify({ ...manifest, scripts }, null, 2)}\n`
}

/** The lines a slice of `n` code lines holds, leaving out the ones already given away. */
const aSliceOf = (n: number, givingAway: readonly number[] = []): string =>
  Array.from({ length: n }, (_, line) => line)
    .filter((line) => !givingAway.includes(line))
    .map((line) => `export const aSliceLine${String(line)} = ${String(line)}\n`)
    .join('')

test('#410 #415: a script one head adds, with both heads moving one slice ceiling, is answered lands, redone, and the judge takes the landing', async (t) => {
  // A slice above a small cap is the one case where two heads move a ceilings map this redo must read as generated: each
  // shrinks the slice in its own place, and one of them adds a script the other left alone.
  const fixture = aRepository(t)
  const theSlice = `${A_SLICE_ABOVE_A_SMALL_CAP}/a_slice.ts`
  const base = theBaseTreeOfABatch(fixture, { 'package.json': aManifestWithOneSliceCeiling({}, 25), [theSlice]: aSliceOf(25) })
  const ours = aBranchWriting(fixture, 'passed0', base, {
    'package.json': aManifestWithOneSliceCeiling({}, 23),
    [theSlice]: aSliceOf(25, [5, 6]),
  })
  const theirs = aBranchWriting(fixture, 'passed1', base, {
    'package.json': aManifestWithOneSliceCeiling({ added: 'echo theirs' }, 24),
    [theSlice]: aSliceOf(25, [20]),
  })
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [ours, theirs], { npm: [], programs: [] })

  const forecast = await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages })
  assert.ok(
    'told' in forecast && forecast.told.includes(`- lands, redone: ${at(packages, 1)} (PR 282): package.json martha.sliceCeilings (measured)`),
    `the head that brings a slice ceiling down beside a script is not answered lands, redone: ${wordsOf(forecast)}`,
  )

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.ok('told' in landed, `a batch of one script and two slice ceilings was refused: ${wordsOf(landed)}`)
  const tip = inTheOrigin(fixture, 'rev-parse', `refs/heads/${theLandBranchesOnOrigin(fixture)[0] ?? ''}`)
  const manifest = JSON.parse(gitIn(fixture.clone, 'show', `${tip}:package.json`)) as {
    readonly scripts: Readonly<Record<string, string>>
    readonly martha: { readonly sliceCeilings: Readonly<Record<string, number>> }
  }
  assert.deepEqual(manifest.scripts, { added: 'echo theirs' }, "the script the second head added was dropped for the first head's file")
  assert.equal(manifest.martha.sliceCeilings[A_SLICE_ABOVE_A_SMALL_CAP], 22, 'the landing did not write the base less both shrinks')
  const checked = await verifyRange(tests.host, { path: fixture.clone, base, tip, packages })
  assert.ok('told' in checked, `the range gate refused a landed slice ceiling that merging the two heads writes: ${wordsOf(checked)}`)
})

/** Three heads: the second clashes by hand with the first, and the third was cut from the second. */
async function aHeadCutFromOneLeftOut(t: TestContext) {
  const fixture = aRepository(t)
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  const first = aBranchWithOneCommit(fixture, 'passed0', base, 'shared.txt', 'two\n')
  const second = aBranchWithOneCommit(fixture, 'passed1', base, 'shared.txt', 'three\n')
  const third = aBranchWithOneCommit(fixture, 'passed2', second, 'later.txt', 'later\n')
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, [first, second, third], { npm: [], programs: [] })
  return { fixture, base, first, packages, tests }
}

test('#339: a head cut from one that clashes by hand is answered left out with it in the dry run', async (t) => {
  const { fixture, packages, tests } = await aHeadCutFromOneLeftOut(t)
  const words = refusedLanding(await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages }))
  assert.ok(words.includes(`- clashes by hand: ${at(packages, 1)} (PR 282): shared.txt with PR 281`), `the clash by hand is not named: ${words}`)
  assert.ok(words.includes(`- left out with PR 282: ${at(packages, 2)} (PR 283)`), `the head cut from it is not left out with it: ${words}`)
})

test('#339: a head cut from one left out is left out of the landing with it, so its unreviewed side of the clash never lands', async (t) => {
  const { fixture, base, first, packages, tests } = await aHeadCutFromOneLeftOut(t)
  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  const words = aBatchLeftOneOut(fixture, landed, base, [first], { package: at(packages, 1), pr: 282 })
  assert.ok(words.includes(`Left out: PR 283 (${at(packages, 2)}), its head holds the head of PR 282`), `the head cut from the one left out was not left out with it: ${words}`)
})

test('#339 T4: an answer from a redo program that cannot judge is no pass, so a clone whose program predates the judge refuses (mutant: take any exit 0 for a pass)', async (t) => {
  const { fixture, tests, base, tip, packages } = await aBatchWithARedoneMerge(t)
  // A program that does not know --judge ends 0 and says nothing, as the redo does over a tree with no clash in it.
  const unjudged = hostForTests({
    run: async (request) => (request.command === NPM ? { exit_code: 0, stdout: '', stderr: '' } : tests.host.processes.run(request)),
    now: THE_DAY,
    rows: tests.host.stores.rows,
  })
  const checked = await verifyRange(unjudged.host, { path: fixture.clone, base, tip, packages })
  assert.match(wordsOf(checked), new RegExp(`${THE_REDO_SCRIPT} did not judge it`))
})

// --- r=2: the dry run as the tool's call reaches it, the chain over ceilings, and a batch that lands nothing ---------

/** The crew's tools over this fixture's host, as a member's session calls them: the ledger is the host's own rows. */
function theToolsOver(fixture: Fixture, tests: HostForTests): CrewTools {
  return crewToolsOver({
    member: MEMBER,
    ledger: { clock: tests.host.clock, stores: { rows: tests.host.stores.rows } },
    beats: dashboardRowsIn(join(fixture.root, DASHBOARD)),
    root: fixture.root,
    documents: { read: async () => '{}' },
    stores: { crew: crewFilesDirectory(join(fixture.root, 'crew-files')) },
    processes: tests.host.processes,
  })
}

/** What the tool said, whether it answered or refused. */
const theToolSaid = (said: { readonly answer: string } | { readonly refused: string }): string => ('answer' in said ? said.answer : said.refused)

test('#339 r=2: land_batch with check 1, called as a session calls it, forecasts and writes nothing; 2 and "1" are refused; 0 lands (mutants U1: the tool drops check 1; U2: check 1 is read as no dry run)', async (t) => {
  const fixture = aRepository(t)
  const { packages, heads, pulls } = threePassedPackages(fixture)
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const tests = aHostOver(aGithub(theAnswersFor(fixture.repo, pulls)), undefined, { npm: [], programs: [] })
  const base = gitIn(fixture.clone, 'rev-parse', 'origin/main')
  for (const [entry, work_package] of packages.entries()) await aPassedVerdict(tests, work_package, base, at(heads, entry))
  const tools = theToolsOver(fixture, tests)
  const before = whatTheCloneHolds(fixture)
  const main_before = theOriginMain(fixture)

  const forecast = await tools.answer(LAND_BATCH, { path: fixture.clone, packages, [A_DRY_RUN]: 1 }, 'session-339')
  assert.ok('answer' in forecast, `the dry run was refused: ${theToolSaid(forecast)}`)
  assert.ok(forecast.answer.includes(`- lands: ${at(packages, 0)} (PR 281)`), `the dry run did not forecast the first head: ${forecast.answer}`)
  assert.equal(whatTheCloneHolds(fixture), before, 'the dry run changed a ref, HEAD or the status of the clone')
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'the dry run pushed a land branch')
  assert.equal(theOriginMain(fixture), main_before, 'the dry run moved main on the origin')

  for (const refused of [2, '1']) {
    const said = await tools.answer(LAND_BATCH, { path: fixture.clone, packages, [A_DRY_RUN]: refused }, 'session-339')
    assert.ok('refused' in said, `check ${JSON.stringify(refused)} was not refused: ${theToolSaid(said)}`)
    assert.match(said.refused, new RegExp(`^${A_DRY_RUN} is 1 for a dry run`))
    assert.equal(whatTheCloneHolds(fixture), before, `check ${JSON.stringify(refused)} changed the clone`)
    assert.deepEqual(theLandBranchesOnOrigin(fixture), [], `check ${JSON.stringify(refused)} pushed a land branch`)
  }

  const landed = await tools.answer(LAND_BATCH, { path: fixture.clone, packages, [A_DRY_RUN]: 0 }, 'session-339')
  assert.ok('answer' in landed, `check 0 did not land: ${theToolSaid(landed)}`)
  assert.equal(theLandBranchesOnOrigin(fixture).length, 1, 'check 0 is the landing, and it pushes one land branch')
})

test('#339 r=2: check 1 asks the dry run; 0 or left out asks the landing; anything else is refused by name (mutant U2)', () => {
  assert.deepEqual(aDryRunIsAsked({ [A_DRY_RUN]: 1 }), { ok: true })
  assert.deepEqual(aDryRunIsAsked({ [A_DRY_RUN]: 0 }), { ok: false })
  assert.deepEqual(aDryRunIsAsked({}), { ok: false })
  for (const refused of [2, '1', true, null]) assert.match(refusedBy(aDryRunIsAsked({ [A_DRY_RUN]: refused })), new RegExp(`^${A_DRY_RUN} is 1 for a dry run`))
})

test('#339 r=2: three heads that each raise one ceiling are chained over the ceilings, so the third is answered lands, redone (mutant U3: the chain without -X ours)', async (t) => {
  // Without -X ours the dry run chains a tree with conflict markers in package.json, and the third head's clash in it
  // reads as one by hand where the landing would redo it.
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, { 'package.json': aManifestWithScripts({}, { [AN_ADAPTER]: 2 }) })
  const heads = [3, 4, 5].map((ceiling, entry) => aBranchWriting(fixture, `passed${String(entry)}`, base, { 'package.json': aManifestWithScripts({}, { [AN_ADAPTER]: ceiling }) }))
  gitIn(fixture.clone, 'checkout', '--quiet', 'main')
  const { packages, tests } = await theBatchOfTwo(fixture, heads, { npm: [], programs: [] })

  const forecast = await forecastWhatABatchLands(tests.host, { path: fixture.clone, packages })
  assert.ok('told' in forecast, `three heads clashing only in the ceilings were refused: ${wordsOf(forecast)}`)
  assert.ok(forecast.told.includes(`- lands, redone: ${at(packages, 2)} (PR 283): package.json martha.hostCeilings (measured)`), `the third head is not answered lands, redone: ${forecast.told}`)
})

test('#339 r=2: a batch that leaves every head out pushes nothing and offers no range (mutant U6: the batch goes on with nothing landed)', async (t) => {
  const fixture = aRepository(t)
  const base = theBaseTreeOfABatch(fixture, { [ONE_TOOL_FILE]: 'base\n' })
  const head = aBranchWriting(fixture, 'passed0', base, { [ONE_TOOL_FILE]: 'head\n' })
  aLandingOnMain(fixture, base, 376, { [ONE_TOOL_FILE]: 'main\n' })
  const { packages, tests } = await theBatchOfTwo(fixture, [head], { npm: [], programs: [] })
  const main_before = theOriginMain(fixture)

  const landed = await landPassedWorkAsOneBatch(tests.host, MEMBER, { path: fixture.clone, packages })
  assert.ok('refused' in landed, `a batch that landed nothing offered a range: ${wordsOf(landed)}`)
  assert.match(landed.refused, /every package was left out/)
  assert.deepEqual(theLandBranchesOnOrigin(fixture), [], 'a batch that landed nothing pushed a land branch')
  assert.deepEqual(theLandBranchesIn(fixture.clone), [], 'a batch that landed nothing kept a land branch in the clone')
  assert.equal(theOriginMain(fixture), main_before, 'a batch that landed nothing moved main')
})
