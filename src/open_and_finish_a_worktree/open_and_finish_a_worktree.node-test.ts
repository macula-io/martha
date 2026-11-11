// Opening and finishing a worktree (martha#256, slice 4).
//
// Every test works on throwaway git repositories it makes for itself: a bare origin, a clone under the crew's
// `clones` place and an empty `worktrees` place beside it. The tools run real git through the host contract's
// processes.run, so what is pinned here is what git really does, not what a stand-in says.
//
// Five things are pinned: that a worktree is made where the crew's declaration says and on a branch of its own
// member's name; that an argument which would steer the path out of those places is refused by name; that the
// refusal that keeps work from being lost stands — an uncommitted change, and a commit no remote has; that a
// worktree on a branch Martha's naming did not make is refused rather than taken for one of its own; and that
// finishing removes the worktree, its local branch and, once the default branch holds what origin has, its branch
// on origin too.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ProcessOutcome, ProcessRequest, Tool } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import {
  NO_LAYOUT,
  WORKTREE_FINISH,
  WORKTREE_OPEN,
  openAndFinishAWorktree,
} from './open_and_finish_a_worktree.ts'

/** The member these tools answer for, and the branch prefix its worktrees carry. */
const MEMBER = 'Ceres'
const SLUG = '261-the-refusals'

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
    review_model: null,
    clones: places.clones,
    worktrees: places.worktrees,
  },
})

/** A real git, so a test sees what git does rather than what a stand-in is told to say. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
}

interface Tools {
  readonly open: Tool
  readonly finish: Tool
}

function toolsOf(settings: CrewSettings, member: string = MEMBER): Tools {
  const { host, registeredTool } = hostForTests({ run: runReal })
  openAndFinishAWorktree({ host, settings, member })
  const tool = (name: string): Tool => {
    const registered = registeredTool(name)
    assert.ok(registered !== undefined, `${name} is registered`)
    return registered
  }
  return { open: tool(WORKTREE_OPEN), finish: tool(WORKTREE_FINISH) }
}

const asked = (repo: string, slug: string): Readonly<Record<string, unknown>> => ({ repo, slug })

test('worktree_open makes the path and the branch from the origin\'s default branch, and answers where it is (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, fixture))
  const answer = await open.answer(asked('acme/widget', SLUG))
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
  assert.match(await open.answer(asked('acme/widget', SLUG)), /was not made: .*already exists/)
  assert.match(await open.answer(asked('acme/widget', '../../etc')), /is not a slug/)
  assert.match(await open.answer(asked('acme/..', SLUG)), /is not a repository, as org\/name/)
  assert.match(await open.answer(asked('acme/widget', 'Uppercase')), /is not a slug/)
})

test('a member the declaration does not name gets no worktree (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, fixture), 'Nobody')
  assert.match(await open.answer(asked('acme/widget', SLUG)), /Nobody is not a member of this crew/)
})

test('worktree_finish is refused while the worktree holds a change, or a commit on no remote branch (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'not committed yet\n')
  assert.match(await finish.answer(asked('acme/widget', SLUG)), /has uncommitted changes \(.*work\.txt/)
  commitIn(path, 'the work')
  assert.match(await finish.answer(asked('acme/widget', SLUG)), /holds 1 commit\(s\) on no remote branch: push Ceres\/261-the-refusals/)
  assert.ok(existsSync(path), 'the worktree is still there, with the work in it')
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
    await finish.answer(asked('acme/widget', SLUG)),
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
  const answer = await finish.answer(asked('acme/widget', SLUG))
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
  assert.match(await finish.answer(asked('acme/widget', SLUG)), /stays on origin, which its tip is not on yet/)
  const onOrigin = execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' })
  assert.ok(onOrigin.includes(`${MEMBER}/${SLUG}`), 'the branch on origin is still there, holding work main does not have')
})

test('worktree_finish leaves the branch on origin, naming its moved head, when another checkout pushed past the tip (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
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
  const answer = await finish.answer(asked('acme/widget', SLUG))
  assert.match(answer, new RegExp(`stays on origin, where it is at ${y}, which the default branch does not hold`))
  const onOrigin = execFileSync('git', ['ls-remote', fixture.origin, `refs/heads/${MEMBER}/${SLUG}`], { encoding: 'utf8' }).trim()
  assert.ok(onOrigin.includes(y), 'origin still holds the commit another checkout pushed, which no other branch has')
  const anywhere = execFileSync('git', ['--git-dir', fixture.origin, 'branch', '--contains', y], { encoding: 'utf8' }).trim()
  assert.notEqual(anywhere, '', 'the commit is still on a branch of origin')
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
  assert.match(await finish.answer(asked('acme/widget', SLUG)), /removed Ceres\/261-the-refusals on origin/)
  const onOrigin = execFileSync('git', ['--git-dir', fixture.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'], { encoding: 'utf8' })
  assert.equal(onOrigin.includes(`${MEMBER}/${SLUG}`), false, 'the branch on origin is gone, since the default branch holds where it stood')
})

test('worktree_finish answers that the branch is gone when origin no longer has it, rather than trusting a stale ref (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
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
  assert.match(await finish.answer(asked('acme/widget', SLUG)), /is no longer on origin/)
  assert.equal(existsSync(path), false, 'the worktree is gone')
})

test('a crew with no workspace layout is told which fields to add, not given a worktree in a place nobody named (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, { clones: null, worktrees: null }))
  assert.equal(await open.answer(asked('acme/widget', SLUG)), NO_LAYOUT)
})
