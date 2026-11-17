// What the workspace's places look like against the layout the crew declared (martha#562, port-map step 9).
//
// Every test makes its own throwaway origin, clone and worktrees, and then plants one drift; what is pinned is that
// the drift is named in one line and that nothing else is, so a check that fails by name says what a member has to fix
// and a clean workspace says nothing at all. The last two claims are the check's honesty: a place the crew declared but
// a git that cannot answer leaves no line invented, and a place that is empty is not a drift.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { FileTree, Processes } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theDriftInTheWorkspace } from './check_the_workspace_matches_its_layout.ts'

/** A bare origin, a clone of it under the crew's clone place, and the worktree place beside it. */
interface Fixture {
  readonly clones: string
  readonly worktrees: string
  readonly clone: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()

const commitIn = (cwd: string, message: string): void => {
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', message)
}

/** A clean clone of one repository, on the default branch its origin starts on. */
function aCleanWorkspace(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'martha-562-scan-'))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'origin.git')
  const clones = join(root, 'some-clones')
  const worktrees = join(root, 'some-worktrees')
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
  const clone = join(clones, 'acme', 'widget')
  // The clone's own record of what its origin starts on, which a fresh clone has and a test may want to drop.
  gitIn(clone, 'remote', 'set-head', 'origin', '--auto')
  return { clones, worktrees, clone }
}

/** The places as a check reads them: names from the disk, git from the disk. */
const anInspectionOf = (fixture: Fixture) => ({
  files: { childrenOf: (path: string): readonly string[] => { try { return readdirSync(path) } catch { return [] } } } as Pick<FileTree, 'childrenOf'>,
  processes: {
    run: async (request) => {
      const ended = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
      return { exit_code: ended.error === undefined ? ended.status : null, stdout: ended.stdout ?? '', stderr: ended.stderr ?? '' }
    },
  } as Pick<Processes, 'run'>,
  workspace: { clones: fixture.clones, worktrees: fixture.worktrees, members: ['Hygiea', 'Uranus'] },
})

test('a workspace that matches the layout it declared drifts by nothing', async (t) => {
  const fixture = aCleanWorkspace(t)
  assert.deepEqual(await theDriftInTheWorkspace(anInspectionOf(fixture)), [])
})

test('a clone moved off its default branch is named, and so is a clone holding work', async (t) => {
  const fixture = aCleanWorkspace(t)
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'hygiea/562')
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture)))[0] ?? '', /is on hygiea\/562, and a clone stays on main/)
  writeFileSync(join(fixture.clone, 'notes.md'), 'work in progress\n')
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n'), /holds work nothing has committed/)
})

test('a worktree outside the place the crew declared is named, and one inside it is not', async (t) => {
  const fixture = aCleanWorkspace(t)
  const outside = join(fixture.clones, 'acme', 'widget-9')
  gitIn(fixture.clone, 'worktree', 'add', '--quiet', '-b', 'uranus/9', outside)
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n'), /is not in .*some-worktrees, the place this crew declared for worktrees/)
  gitIn(fixture.clone, 'worktree', 'remove', outside)
  gitIn(fixture.clone, 'worktree', 'add', '--quiet', '-b', 'uranus/10', join(fixture.worktrees, 'widget-9'))
  assert.deepEqual(await theDriftInTheWorkspace(anInspectionOf(fixture)), [])
  // A directory that merely starts with the place's own name is another place: the separator after it is what counts.
  const nearMiss = `${fixture.worktrees}-elsewhere`
  mkdirSync(nearMiss, { recursive: true })
  gitIn(fixture.clone, 'worktree', 'add', '--quiet', '-b', 'uranus/11', join(nearMiss, 'widget-11'))
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n'), /widget-11.*is not in/)
})

test('a worktree whose directory is gone is named, and one the crew declared is not', async (t) => {
  const fixture = aCleanWorkspace(t)
  const gone = join(fixture.worktrees, 'widget-9')
  gitIn(fixture.clone, 'worktree', 'add', '--quiet', '-b', 'uranus/9', gone)
  removeTheTree(gone)
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n'), /is recorded as a worktree and its directory is gone/)
})

test('one repository cloned twice is named with both of its clones', async (t) => {
  const fixture = aCleanWorkspace(t)
  const origin = gitIn(fixture.clone, 'config', '--get', 'remote.origin.url')
  gitIn(fixture.clones, 'clone', '--quiet', origin, join('acme', 'widget-again'))
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n'), /is cloned 2 times/)
})

test('a place with no clones in it drifts by nothing, and a git that cannot answer invents no line', async (t) => {
  const fixture = aCleanWorkspace(t)
  const empty = { ...anInspectionOf(fixture), workspace: { clones: join(fixture.clones, 'nothing-here'), worktrees: fixture.worktrees, members: [] } }
  assert.deepEqual(await theDriftInTheWorkspace(empty), [])
  // A clone git cannot read: every question goes unanswered, and no line is invented for it.
  const silent = { ...anInspectionOf(fixture), processes: { run: async () => ({ exit_code: null, stdout: '', stderr: '' }) } as Pick<Processes, 'run'> }
  assert.deepEqual(await theDriftInTheWorkspace(silent), [])
})
