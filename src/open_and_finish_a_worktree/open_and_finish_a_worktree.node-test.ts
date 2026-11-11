// Opening and finishing a worktree (martha#256, slice 4).
//
// Every test works on throwaway git repositories it makes for itself: a bare origin, a clone under the crew's
// `clones` place and an empty `worktrees` place beside it. The tools run real git through the host contract's
// processes.run, so what is pinned here is what git really does, not what a stand-in says.
//
// Four things are pinned: that a worktree is made where the crew's declaration says and on a branch of its own
// member's name; that an argument which would steer the path out of those places is refused by name; that the
// refusal that keeps work from being lost stands — an uncommitted change, and a commit no remote has; and that
// finishing removes the worktree, its local branch and, once the default branch holds its tip, its branch on
// origin too.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ProcessOutcome, ProcessRequest, Tool } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
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
  t.after(() => rmSync(root, { recursive: true, force: true }))
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
  return { origin, clones, worktrees, clone: join(clones, 'acme', 'widget') }
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

test('worktree_finish removes the worktree, its local branch and the branch on origin once the default holds its tip (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open, finish } = toolsOf(settingsFor(fixture, fixture))
  await open.answer(asked('acme/widget', SLUG))
  const path = join(fixture.worktrees, `widget-${SLUG}`)
  writeFileSync(join(path, 'work.txt'), 'the work\n')
  commitIn(path, 'the work')
  gitIn(path, 'push', '--quiet', '-u', 'origin', `${MEMBER}/${SLUG}`)
  gitIn(fixture.clone, 'fetch', '--quiet', 'origin')
  gitIn(fixture.clone, 'merge', '--ff-only', '--quiet', `origin/${MEMBER}/${SLUG}`)
  gitIn(fixture.clone, 'push', '--quiet', 'origin', 'main')
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

test('a crew with no workspace layout is told which fields to add, not given a worktree in a place nobody named (#256)', async (t) => {
  const fixture = aCrew(t)
  const { open } = toolsOf(settingsFor(fixture, { clones: null, worktrees: null }))
  assert.equal(await open.answer(asked('acme/widget', SLUG)), NO_LAYOUT)
})
