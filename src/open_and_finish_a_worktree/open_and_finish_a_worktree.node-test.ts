// Opening and finishing a worktree (martha#256, slice 4).
//
// Every test works on throwaway git repositories it makes for itself: a bare origin, a clone under the crew's
// `clones` place and an empty `worktrees` place beside it. The tools run real git through the host contract's
// processes.run, so what is pinned here is what git really does, not what a stand-in says.
//
// Six things are pinned: that a worktree is made where the crew's declaration says and on a branch of its own
// member's name; that an argument which would steer the path out of those places is refused by name; that the
// refusal that keeps work from being lost stands — an uncommitted change, and a commit no remote has; that a
// worktree on a branch Martha's naming did not make is refused rather than taken for one of its own; that
// finishing removes the worktree, its local branch and, once the default branch holds what origin has, its branch
// on origin too; and that the deletion of that branch is an outward act kept in the package's ledger before it
// runs, so a successor knows whether it was sent (martha#25).

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { readLedger } from '../log_ledger/log_ledger.ts'
import {
  NO_LAYOUT,
  finishAWorktree,
  openAWorktree,
  type WorktreeAnswer,
  type WorktreesRequest,
} from './open_and_finish_a_worktree.ts'

/** The member these tools answer for, and the branch prefix its worktrees carry. */
const MEMBER = 'Ceres'
const SLUG = '261-the-refusals'

/** The package a finished worktree's deletion is kept under, as the member names it (martha#25). */
const PACKAGE = 'macula-io/martha#25'

interface Fixture {
  readonly origin: string
  readonly seed: string
  readonly clones: string
  readonly worktrees: string
  readonly clone: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()

/** git with the identity a throwaway repository has no config for, and every word it is given. */
const commitIn = (cwd: string, message: string): void => {
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', message)
}

/** A bare origin holding one commit on main, and a clone of it under `<clones>/acme/widget`. */
function aCrew(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'martha-256-worktrees-'))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'origin.git')
  const clones = join(root, 'clones')
  const worktrees = join(root, 'worktrees')
  mkdirSync(join(clones, 'acme'), { recursive: true })
  mkdirSync(worktrees)
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(root, 'seed')
  mkdirSync(seed)
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  gitIn(clones, 'clone', '--quiet', origin, join('acme', 'widget'))
  return { origin, seed, clones, worktrees, clone: join(clones, 'acme', 'widget') }
}

const settingsFor = (fixture: Fixture, places: { readonly clones: string | null; readonly worktrees: string | null }): CrewSettings => ({
  paths: { root: fixture.clone, crew: join(fixture.clone, '.crew'), declaration: join(fixture.clone, '.crew', 'crew.json'), conventions: null },
  owner: 'Ann',
  members: [{ name: MEMBER, role: 'builder', model: null }],
  mode: { name: 'solo', roles: ['builder'], may: { assign_work: ['owner'], approve_landing: ['owner'], resume_parked_work: ['owner'] } },
  house_rules: {
    owner_items: false,
    workspace_layout: true,
    member_work: false,
    practice: false,
    strict_gate: false,
    // Off unless the declaration names it true, as every switch is (martha#254 added the crew's dashboard).
    dashboard: false,
  refresh_between_tasks: false,
    review_model: null,
    clones: places.clones,
    worktrees: places.worktrees,
  },
  channel_read_seconds: 30,
})

/** A real git, so a test sees what git does rather than what a stand-in is told to say. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
}

interface Tools {
  readonly open: AnsweringTool
  readonly finish: AnsweringTool
  /** The host the tools run over: its store's rows are the package's ledger (martha#25). */
  readonly host: HostForTests
}

/** One of the two tools, as a call reaches it: the slice's own answer for the arguments a call names (martha#256). */
interface AnsweringTool {
  answer(args: Readonly<Record<string, unknown>>): Promise<WorktreeAnswer>
}

/** What a tool told, or a failure naming the refusal it answered with instead (martha#256 r=3). */
const toldOf = (answer: WorktreeAnswer): string => ('told' in answer ? answer.told : assert.fail(`refused instead of telling: ${answer.refused}`))

/** The refusal a tool answered with, or a failure naming what it told instead (martha#256 r=3). */
const refusedOf = (answer: WorktreeAnswer): string => ('refused' in answer ? answer.refused : assert.fail(`told instead of refusing: ${answer.told}`))

function toolsOf(
  settings: CrewSettings,
  member: string = MEMBER,
  run: (request: ProcessRequest) => Promise<ProcessOutcome> = runReal,
): Tools {
  const testHost = hostForTests({ run })
  const request: WorktreesRequest = { host: theHostOver(testHost), settings, member }
  return {
    open: { answer: (args) => openAWorktree(request, args) },
    finish: { answer: (args) => finishAWorktree(request, args) },
    host: testHost,
  }
}

/** The host the slice acts over: the test host's own processes, with the ledger's clock and rows (martha#256). */
const theHostOver = (testHost: HostForTests): WorktreesRequest['host'] => ({
  processes: testHost.host.processes,
  clock: testHost.host.clock,
  stores: { rows: testHost.host.stores.rows },
})

const asked = (repo: string, slug: string): Readonly<Record<string, unknown>> => ({ repo, slug })

/** What `worktree_finish` is given: the worktree, and the package its deletion is kept under. */
const finished = (repo: string, slug: string, package_name: string = PACKAGE): Readonly<Record<string, unknown>> => ({ ...asked(repo, slug), package: package_name })

/** The kinds of row a package's ledger holds, in order, as the ledger reads them back. */
const rowKinds = async (testHost: HostForTests): Promise<readonly string[]> =>
  (await readLedger(testHost.host, PACKAGE)).map((row) => row.kind)

/** The one act the package's ledger announced, or a failure naming what was read instead. */
const theAnnouncedAct = (rows: Awaited<ReturnType<typeof readLedger>>): { readonly kind: string; readonly what: string } => {
  const announced = rows[0]
  assert.equal(announced?.kind, 'act_announced', 'the first row is the act, kept before it ran')
  return announced?.kind === 'act_announced' ? announced.act : assert.fail('no act was announced')
}

/** The outcome kept for the announced act, or a failure naming what was read instead. */
const theKeptOutcome = (rows: Awaited<ReturnType<typeof readLedger>>): { readonly succeeded: boolean; readonly detail: string } => {
  const concluded = rows[1]
  assert.equal(concluded?.kind, 'act_concluded', 'the second row is the act\'s outcome')
  return concluded?.kind === 'act_concluded' ? concluded.outcome : assert.fail('the act was not concluded')
}

/** Whether origin still has `branch` among its branches. */
const onOrigin = (fixture: Fixture, branch: string): boolean =>
  execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' }).includes(`refs/heads/${branch}`)

/** The landing of the worktree's branch: pushed from the seed checkout, so the crew's clone has not heard of it. */
const landTheBranch = (fixture: Fixture): void => {
  gitIn(fixture.seed, 'fetch', '--quiet', 'origin')
  gitIn(fixture.seed, 'merge', '--ff-only', '--quiet', `origin/${MEMBER}/${SLUG}`)
  gitIn(fixture.seed, 'push', '--quiet', 'origin', 'main')
}

/** A worktree with one commit, pushed, so its branch is on origin and on no other branch. */
const aPushedWorktree = async (fixture: Fixture, tools: Tools): Promise<string> => {
  await tools.open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'the work\n')
  commitIn(path, 'the work')
  gitIn(path, 'push', '--quiet', '-u', 'origin', `${MEMBER}/${SLUG}`)
  return path
}

test('worktree_open makes the path and the branch from the origin\'s default branch, and answers where it is (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, fixture))
  const answer = toldOf(await open.answer(asked('acme/widget', SLUG)))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  assert.match(answer, new RegExp(path.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(answer, /on Ceres\/261-the-refusals, from origin\/main at [0-9a-f]{40}/)
  assert.ok(existsSync(join(path, 'README.md')), 'the worktree holds the default branch\'s tree')
  assert.equal(gitIn(path, 'rev-parse', '--abbrev-ref', 'HEAD'), `${MEMBER}/${SLUG}`)
  assert.equal(gitIn(path, 'rev-parse', 'HEAD'), gitIn(fixture.clone, 'rev-parse', 'origin/main'))
})

test('worktree_open refuses an argument that would steer the worktree out of its places, and one already made (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  assert.match(refusedOf(await open.answer(asked('acme/widget', SLUG))), /was not made: .*already exists/)
  assert.match(refusedOf(await open.answer(asked('acme/widget', '../../etc'))), /is not a slug/)
  assert.match(refusedOf(await open.answer(asked('acme/..', SLUG))), /is not a repository, as org\/name/)
  assert.match(refusedOf(await open.answer(asked('acme/widget', 'Uppercase'))), /is not a slug/)
})

test('a member the declaration does not name gets no worktree (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, fixture), 'Nobody')
  assert.match(refusedOf(await open.answer(asked('acme/widget', SLUG))), /Nobody is not a member of this crew/)
})

test('worktree_finish is refused while the worktree holds a change, or a commit on no remote branch (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'not committed yet\n')
  assert.match(refusedOf(await finish.answer(finished('acme/widget', SLUG))), /has uncommitted changes \(.*work\.txt/)
  commitIn(path, 'the work')
  assert.match(refusedOf(await finish.answer(finished('acme/widget', SLUG))), /holds 1 commit\(s\) on no remote branch: push Ceres\/261-the-refusals/)
  assert.ok(existsSync(path), 'the worktree is still there, with the work in it')
})

test('worktree_open is refused, not told, when git cannot fetch from origin (#256 r=4)', async (t) => {
  const fixture = aCrew(t)
  // The one stop on this path that is git's own failure rather than the arguments': nothing is made, so it refuses.
  const denyingTheFetch = async (request: ProcessRequest): Promise<ProcessOutcome> =>
    request.args.includes('fetch') ? { exit_code: 1, stdout: '', stderr: 'could not read from remote repository\n' } : runReal(request)
  const { open } = toolsOf(settingsFor(fixture, fixture), MEMBER, denyingTheFetch)
  assert.match(refusedOf(await open.answer(asked('acme/widget', SLUG))), /git fetch did not work/)
  assert.equal(existsSync(join(fixture.worktrees, `widget-${SLUG}`)), false, 'no worktree was made')
})

test('worktree_finish is refused, not told, when git will not remove the worktree (#256 r=4)', async (t) => {
  const fixture = aCrew(t)
  // `git worktree remove` is the act itself: refused here, nothing was removed, so the answer refuses too.
  const denyingTheRemove = async (request: ProcessRequest): Promise<ProcessOutcome> =>
    request.args.includes('remove') ? { exit_code: 1, stdout: '', stderr: 'the worktree is locked\n' } : runReal(request)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture), MEMBER, denyingTheRemove)
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  assert.match(refusedOf(await finish.answer(finished('acme/widget', SLUG))), /was not removed: the worktree is locked/)
  assert.ok(existsSync(path), 'the worktree is still there: git did not remove it')
})

test('worktree_finish refuses a worktree that is on another branch, and leaves that branch where it is (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'the work\n')
  commitIn(path, 'the work')
  // Another branch is cut where the work stands and the worktree is switched onto it, then that branch is pushed: it
  // is the shape a member's own branch takes, holding pushed work and clean, so only Martha's own naming tells the two
  // apart. Removing the worktree on this branch would delete a branch Martha never made.
  gitIn(path, 'checkout', '--quiet', '-b', 'other')
  gitIn(path, 'push', '--quiet', '-u', 'origin', 'other')
  assert.match(
    refusedOf(await finish.answer(finished('acme/widget', SLUG))),
    /is on other, not Ceres\/261-the-refusals: Martha removes only the worktree its own naming made/,
  )
  assert.ok(existsSync(path), 'the worktree is still there')
  assert.equal(gitIn(fixture.clone, 'rev-parse', '--abbrev-ref', 'other'), 'other', 'the other branch is still there')
  const onOrigin = execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' })
  assert.ok(onOrigin.includes('other'), 'the other branch is still on origin')
})

test('worktree_finish removes the worktree, its local branch and the branch on origin once the default holds its tip (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'the work\n')
  commitIn(path, 'the work')
  gitIn(path, 'push', '--quiet', '-u', 'origin', `${MEMBER}/${SLUG}`)
  // The landing is done from the seed checkout, which leaves the crew's own clone with an origin/main that does not
  // know it yet: finishing has to ask origin afresh, or it would keep a branch origin no longer needs.
  gitIn(fixture.seed, 'fetch', '--quiet', 'origin')
  gitIn(fixture.seed, 'merge', '--ff-only', '--quiet', `origin/${MEMBER}/${SLUG}`)
  gitIn(fixture.seed, 'push', '--quiet', 'origin', 'main')
  assert.notEqual(gitIn(fixture.clone, 'rev-parse', 'origin/main'), gitIn(fixture.seed, 'rev-parse', 'HEAD'), 'the clone has not heard of the landing yet')
  const answer = toldOf(await finish.answer(finished('acme/widget', SLUG)))
  assert.match(answer, new RegExp(`removed ${path.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')} and removed Ceres/261-the-refusals`))
  assert.match(answer, /removed Ceres\/261-the-refusals on origin/)
  assert.equal(existsSync(path), false, 'the worktree is gone')
  assert.equal(gitIn(fixture.clone, 'branch', '--list', `${MEMBER}/${SLUG}`), '', 'the local branch is gone')
  const onOrigin = execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' })
  assert.equal(onOrigin.includes(`${MEMBER}/${SLUG}`), false, 'the branch on origin is gone')
})

test('worktree_finish leaves the branch on origin while the default branch does not hold its tip (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'the work\n')
  commitIn(path, 'the work')
  gitIn(path, 'push', '--quiet', '-u', 'origin', `${MEMBER}/${SLUG}`)
  gitIn(fixture.clone, 'fetch', '--quiet', 'origin')
  assert.match(toldOf(await finish.answer(finished('acme/widget', SLUG))), /stays on origin, which its tip is not on yet/)
  const onOrigin = execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' })
  assert.ok(onOrigin.includes(`${MEMBER}/${SLUG}`), 'the branch on origin is still there, holding work main does not have')
})

test('worktree_finish leaves the branch on origin, naming its moved head, when another checkout pushed past the tip (#256)', async (t) => {
  const fixture = aCrew(t)
  const tools = toolsOf(settingsFor(fixture, fixture))
  const { open, finish } = tools
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'x.txt'), 'x\n')
  commitIn(path, 'X')
  gitIn(path, 'push', '--quiet', 'origin', `${MEMBER}/${SLUG}`)
  // X lands on the default branch.
  gitIn(path, 'push', '--quiet', 'origin', 'HEAD:main')
  // Then another checkout pushes Y onto the same branch on origin: a fold-in, or another member's work.
  gitIn(fixture.seed, 'fetch', '--quiet', 'origin')
  gitIn(fixture.seed, 'checkout', '--quiet', '-b', 'other', `origin/${MEMBER}/${SLUG}`)
  writeFileSync(join(fixture.seed, 'y.txt'), 'y\n')
  commitIn(fixture.seed, 'Y')
  const y = gitIn(fixture.seed, 'rev-parse', 'HEAD')
  gitIn(fixture.seed, 'push', '--quiet', 'origin', `HEAD:refs/heads/${MEMBER}/${SLUG}`)
  const answer = toldOf(await finish.answer(finished('acme/widget', SLUG)))
  assert.match(answer, new RegExp(`stays on origin, where it is at ${y}, which the default branch does not hold`))
  const onOrigin = execFileSync('git', ['ls-remote', fixture.origin, `refs/heads/${MEMBER}/${SLUG}`], { encoding: 'utf8' }).trim()
  assert.ok(onOrigin.includes(y), 'origin still holds the commit another checkout pushed, which no other branch has')
  const anywhere = execFileSync('git', ['--git-dir', fixture.origin, 'branch', '--contains', y], { encoding: 'utf8' }).trim()
  assert.notEqual(anywhere, '', 'the commit is still on a branch of origin')
  assert.deepEqual(await rowKinds(tools.host), [], 'the guard refused before any act was sent, so nothing was announced')
})

test('worktree_finish removes the branch on origin when its head moved past the tip, and the default branch holds it (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'x.txt'), 'x\n')
  commitIn(path, 'X')
  gitIn(path, 'push', '--quiet', '-u', 'origin', `${MEMBER}/${SLUG}`)
  // X lands on the default branch. A fold-in pushes Y onto the branch on origin, and Y lands too: origin's head is no
  // longer the tip this worktree holds, but nothing is lost by removing it, so the branch goes.
  gitIn(path, 'push', '--quiet', 'origin', 'HEAD:main')
  gitIn(fixture.seed, 'fetch', '--quiet', 'origin')
  gitIn(fixture.seed, 'checkout', '--quiet', '-b', 'other', `origin/${MEMBER}/${SLUG}`)
  writeFileSync(join(fixture.seed, 'y.txt'), 'y\n')
  commitIn(fixture.seed, 'Y')
  gitIn(fixture.seed, 'push', '--quiet', 'origin', `HEAD:refs/heads/${MEMBER}/${SLUG}`)
  gitIn(fixture.seed, 'push', '--quiet', 'origin', 'HEAD:main')
  assert.match(toldOf(await finish.answer(finished('acme/widget', SLUG))), /removed Ceres\/261-the-refusals on origin/)
  const onOrigin = execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' })
  assert.equal(onOrigin.includes(`${MEMBER}/${SLUG}`), false, 'the branch on origin is gone, since the default branch holds where it stood')
})

test('worktree_finish answers that the branch is gone when origin no longer has it, rather than trusting a stale ref (#256)', async (t) => {
  const fixture = aCrew(t)
  const tools = toolsOf(settingsFor(fixture, fixture))
  const { open, finish } = tools
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'the work\n')
  commitIn(path, 'the work')
  gitIn(path, 'push', '--quiet', '-u', 'origin', `${MEMBER}/${SLUG}`)
  // The work lands and the branch is deleted on origin by someone else. The crew's own clone still carries the ref,
  // so a fetch that does not prune would read it as a branch that is there and report a failed delete instead.
  gitIn(path, 'push', '--quiet', 'origin', 'HEAD:main')
  gitIn(fixture.seed, 'push', '--quiet', 'origin', '--delete', `${MEMBER}/${SLUG}`)
  assert.notEqual(
    gitIn(fixture.clone, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${MEMBER}/${SLUG}`),
    '',
    'the clone still remembers the branch origin no longer has',
  )
  assert.match(toldOf(await finish.answer(finished('acme/widget', SLUG))), /is no longer on origin/)
  assert.equal(existsSync(path), false, 'the worktree is gone')
  assert.deepEqual(await rowKinds(tools.host), [], 'the guard refused before any act was sent, so nothing was announced')
})

test('a crew with no workspace layout is told which fields to add, not given a worktree in a place nobody named (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, { clones: null, worktrees: null }))
  assert.equal(refusedOf(await open.answer(asked('acme/widget', SLUG))), NO_LAYOUT)
})

test('the deletion of the branch on origin is a push in the package\'s ledger, its row before its outcome (#25)', async (t) => {
  const fixture = aCrew(t)
  const tools = toolsOf(settingsFor(fixture, fixture))
  await aPushedWorktree(fixture, tools)
  landTheBranch(fixture)
  assert.match(toldOf(await tools.finish.answer(finished('acme/widget', SLUG))), /removed Ceres\/261-the-refusals on origin/)
  const rows = await readLedger(tools.host.host, PACKAGE)
  assert.deepEqual(rows.map((row) => row.kind), ['act_announced', 'act_concluded'], 'the act, then its outcome')
  assert.deepEqual(theAnnouncedAct(rows), { kind: 'push', what: `origin ${MEMBER}/${SLUG}` })
  assert.equal(rows[0]?.member, MEMBER, 'the row says whose act it was')
  assert.equal(rows[0]?.package, PACKAGE, 'the row is kept under the package the member named')
  assert.deepEqual(theKeptOutcome(rows), { succeeded: true, detail: `removed ${MEMBER}/${SLUG} on origin` })
  assert.equal(onOrigin(fixture, `${MEMBER}/${SLUG}`), false, 'the branch on origin is gone')
})

test('a deletion whose row the store will not keep is not sent, and the branch stays on origin (#25)', async (t) => {
  const fixture = aCrew(t)
  const tools = toolsOf(settingsFor(fixture, fixture))
  await aPushedWorktree(fixture, tools)
  landTheBranch(fixture)
  const refusal = 'the disk would not take it'
  tools.host.refuseNextAppend(refusal)
  const answer = toldOf(await tools.finish.answer(finished('acme/widget', SLUG)))
  assert.match(answer, /stays on origin, since the push was not sent: its row was not kept \(the store refused the row: the disk would not take it\)/)
  assert.equal(onOrigin(fixture, `${MEMBER}/${SLUG}`), true, 'the branch is still on origin, because nothing was sent')
  assert.deepEqual(await rowKinds(tools.host), [], 'no row was kept, and nothing was concluded')
})

test('a deletion git refuses is concluded as failed, and its own words are kept (#25)', async (t) => {
  const fixture = aCrew(t)
  const denied = 'remote: deleting a branch is not allowed here\n'
  const runDenyingTheDelete = async (request: ProcessRequest): Promise<ProcessOutcome> =>
    request.args.includes('--delete') ? { exit_code: 1, stdout: '', stderr: denied } : runReal(request)
  const tools = toolsOf(settingsFor(fixture, fixture), MEMBER, runDenyingTheDelete)
  await aPushedWorktree(fixture, tools)
  landTheBranch(fixture)
  const answer = toldOf(await tools.finish.answer(finished('acme/widget', SLUG)))
  assert.match(answer, /stays on origin \(remote: deleting a branch is not allowed here\)/)
  const rows = await readLedger(tools.host.host, PACKAGE)
  assert.deepEqual(rows.map((row) => row.kind), ['act_announced', 'act_concluded'], 'a failed act is concluded, not lost')
  assert.deepEqual(theKeptOutcome(rows), { succeeded: false, detail: 'remote: deleting a branch is not allowed here' })
  assert.equal(onOrigin(fixture, `${MEMBER}/${SLUG}`), true, 'the branch is still on origin')
})

test('a deletion whose outcome the store will not keep is told as sent, and left awaiting (#25)', async (t) => {
  const fixture = aCrew(t)
  let refuseTheOutcome: (() => void) | undefined
  // The row is announced, git runs, and only then does the store refuse: the one window in which the act happened
  // and its outcome was not kept.
  const runRefusingTheOutcome = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    if (request.args.includes('--delete')) refuseTheOutcome?.()
    return runReal(request)
  }
  const tools = toolsOf(settingsFor(fixture, fixture), MEMBER, runRefusingTheOutcome)
  refuseTheOutcome = (): void => tools.host.refuseNextAppend('the disk would not take it')
  await aPushedWorktree(fixture, tools)
  landTheBranch(fixture)
  const answer = toldOf(await tools.finish.answer(finished('acme/widget', SLUG)))
  assert.match(
    answer,
    /was deleted on origin, and its ledger row was not concluded: the push at row 0 was sent, and its outcome was not kept \(the store refused the row: the disk would not take it\)/,
  )
  assert.equal(onOrigin(fixture, `${MEMBER}/${SLUG}`), false, 'the branch is gone: it was sent')
  assert.deepEqual(await rowKinds(tools.host), ['act_announced'], 'the act is left awaiting, for a successor to check')
})

test('a deletion that failed, whose failure the store will not keep, may still be on origin (#25)', async (t) => {
  const fixture = aCrew(t)
  let refuseTheOutcome: (() => void) | undefined
  // git refuses the deletion, and the store then refuses to keep that failure: the branch is where it was, and the
  // ledger holds only the announced act, so whoever reads it next checks rather than assumes.
  const runFailingAndRefusing = async (request: ProcessRequest): Promise<ProcessOutcome> => {
    if (!request.args.includes('--delete')) return runReal(request)
    refuseTheOutcome?.()
    return { exit_code: 1, stdout: '', stderr: 'remote: deleting a branch is not allowed here\n' }
  }
  const tools = toolsOf(settingsFor(fixture, fixture), MEMBER, runFailingAndRefusing)
  refuseTheOutcome = (): void => tools.host.refuseNextAppend('the disk would not take it')
  await aPushedWorktree(fixture, tools)
  landTheBranch(fixture)
  const answer = toldOf(await tools.finish.answer(finished('acme/widget', SLUG)))
  assert.match(
    answer,
    /may still be on origin, and its ledger row was not concluded: the push at row 0 was sent, and its outcome was not kept \(the store refused the row: the disk would not take it\)/,
  )
  assert.equal(onOrigin(fixture, `${MEMBER}/${SLUG}`), true, 'the branch is where it was: the deletion failed')
  assert.deepEqual(await rowKinds(tools.host), ['act_announced'], 'the act is left awaiting, for a successor to check')
})

test('a finish that never sends the deletion keeps no row, since no act happened (#25)', async (t) => {
  const fixture = aCrew(t)
  const tools = toolsOf(settingsFor(fixture, fixture))
  await aPushedWorktree(fixture, tools)
  gitIn(fixture.clone, 'fetch', '--quiet', 'origin')
  assert.match(toldOf(await tools.finish.answer(finished('acme/widget', SLUG))), /stays on origin, which its tip is not on yet/)
  assert.deepEqual(await rowKinds(tools.host), [], 'the guard refused before any act was sent, so nothing was announced')
})

test('worktree_finish names the package its row is kept under, and refuses before it removes anything (#25)', async (t) => {
  const fixture = aCrew(t)
  const tools = toolsOf(settingsFor(fixture, fixture))
  const path = await aPushedWorktree(fixture, tools)
  landTheBranch(fixture)
  assert.match(refusedOf(await tools.finish.answer(asked('acme/widget', SLUG))), /is not a work package, as owner\/repo#n/)
  assert.match(refusedOf(await tools.finish.answer(finished('acme/widget', SLUG, 'acme/widget'))), /is not a work package, as owner\/repo#n/)
  assert.ok(existsSync(path), 'the worktree is still there: a package it cannot keep a row under is refused first')
  assert.equal(onOrigin(fixture, `${MEMBER}/${SLUG}`), true, 'the branch is still on origin')
  assert.deepEqual(await rowKinds(tools.host), [], 'nothing was kept')
})

