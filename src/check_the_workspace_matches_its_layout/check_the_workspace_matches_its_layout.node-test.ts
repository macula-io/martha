// What the workspace's places look like against the layout the crew declared (martha#562, port-map step 9).
//
// Every test makes its own throwaway origin, clone and worktrees, and then plants one drift; what is pinned is that
// the drift is named in one line and that nothing else is, so a check that fails by name says what a member has to fix
// and a clean workspace says nothing at all. The last three claims are the check's honesty: a place reached through a
// link is the place itself and not drift (martha#79), a place the crew declared but a git that cannot answer leaves no
// line invented, and a place that is empty is not a drift.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { FileKind, FileTree, Processes } from '../host_contract/host_contract.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theDriftInTheWorkspace } from './check_the_workspace_matches_its_layout.ts'

/** A bare origin, a clone of it under the crew's clone place, and the worktree place beside it. */
interface Fixture {
  readonly root: string
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-562-scan-')))
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
  return { root, clones, worktrees, clone }
}

/** A second repository's bare origin and a clone of it at `at`, for a case that needs a repository the fixture's own. */
function aSecondClone(root: string, at: string): void {
  const name = basename(at)
  const origin = join(root, `origin-${name}.git`)
  const seed = join(root, `seed-${name}`)
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  mkdirSync(seed)
  gitIn(seed, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  mkdirSync(dirname(at), { recursive: true })
  gitIn(dirname(at), 'clone', '--quiet', origin, name)
  gitIn(at, 'remote', 'set-head', 'origin', '--auto')
}

/** The places as a check reads them: names from the disk, the path itself from the disk, git from the disk. */
const anInspectionOf = (fixture: Fixture) => ({
  files: {
    childrenOf: (path: string): readonly string[] => { try { return readdirSync(path) } catch { return [] } },
    realPathOf: (path: string): string | null => { try { return realpathSync(path) } catch { return null } },
    kindOf: (path: string): FileKind => {
      try {
        const stat = lstatSync(path)
        if (stat.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(path) }
        if (stat.isDirectory()) return { kind: 'directory' }
        return stat.isFile() ? { kind: 'file', ownerExecutes: (stat.mode & 0o100) !== 0 } : { kind: 'other' }
      } catch {
        return { kind: 'absent' }
      }
    },
  } as Pick<FileTree, 'childrenOf' | 'realPathOf' | 'kindOf'>,
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
  const origin = gitIn(fixture.clone, 'remote', 'get-url', 'origin')
  gitIn(fixture.clones, 'clone', '--quiet', origin, join('acme', 'widget-again'))
  assert.match((await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n'), /is cloned 2 times/)
})

test('#670: a double clone is named by its repository, not by an origin URL that can carry a token', async (t) => {
  const fixture = aCleanWorkspace(t)
  const second = join(fixture.clones, 'acme', 'widget-again')
  gitIn(fixture.clones, 'clone', '--quiet', gitIn(fixture.clone, 'remote', 'get-url', 'origin'), second)
  // Both clones name one origin: a URL with a credential in its userinfo, at the example host this repository may name.
  const withAToken = 'https://x-access-token:ghs_plantedtoken@example.invalid/acme/widget.git'
  for (const clone of [fixture.clone, second]) gitIn(clone, 'remote', 'set-url', 'origin', withAToken)
  const lines = (await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n')
  assert.match(lines, /is cloned 2 times/, `the double clone was not named: ${lines}`)
  assert.ok(!lines.includes('ghs_plantedtoken'), `the token in the origin reached the drift: ${lines}`)
  assert.match(lines, /acme\/widget is cloned 2 times/)
})

test('#670: a double clone of an origin that names no repository is named without that URL either', async (t) => {
  const fixture = aCleanWorkspace(t)
  const second = join(fixture.clones, 'acme', 'widget-again')
  gitIn(fixture.clones, 'clone', '--quiet', gitIn(fixture.clone, 'remote', 'get-url', 'origin'), second)
  // A URL that names no repository is the branch a fallback of the raw origin would print from.
  const namelessWithAToken = 'https://x-access-token:ghs_plantedtoken@example.invalid/'
  for (const clone of [fixture.clone, second]) gitIn(clone, 'remote', 'set-url', 'origin', namelessWithAToken)
  const lines = (await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n')
  assert.match(lines, /is cloned 2 times/, `the double clone was not named: ${lines}`)
  assert.ok(!lines.includes('ghs_plantedtoken'), `the token in the origin reached the drift: ${lines}`)
  assert.match(lines, /the origin of .*widget is cloned 2 times/)
})

test('a place spelled through a link drifts by nothing: the places are asked for the path itself (martha#79)', async (t) => {
  const fixture = aCleanWorkspace(t)
  gitIn(fixture.clone, 'worktree', 'add', '--quiet', '-b', 'uranus/9', join(fixture.worktrees, 'widget-9'))
  // A link to the place, as a machine's temp or work place may be reached by one: git answers with the paths it resolved,
  // so the declaration's own spelling of the place would put every worktree under it outside the place.
  const link = join(fixture.root, 'worktrees-link')
  symlinkSync(fixture.worktrees, link)
  const throughTheLink = { ...anInspectionOf(fixture), workspace: { clones: fixture.clones, worktrees: link, members: ['Hygiea'] } }
  assert.deepEqual(await theDriftInTheWorkspace(throughTheLink), [])
  // And the clone place through a link finds the same clone, so nothing is invented and nothing is missed.
  const clonesThroughALink = join(fixture.root, 'clones-link')
  symlinkSync(fixture.clones, clonesThroughALink)
  const bothThroughLinks = { ...anInspectionOf(fixture), workspace: { clones: clonesThroughALink, worktrees: link, members: ['Hygiea'] } }
  assert.deepEqual(await theDriftInTheWorkspace(bothThroughLinks), [])
})

test('a clone whose origin names no default branch is named, with the call that sets one', async (t) => {
  const fixture = aCleanWorkspace(t)
  // The guard's switch rule cannot fire without that fact, so this check is what makes its failing open safe: the
  // clone is named, and the call that sets a head with it.
  gitIn(fixture.clone, 'remote', 'set-head', 'origin', '--delete')
  const drift = (await theDriftInTheWorkspace(anInspectionOf(fixture))).join('\n')
  assert.match(drift, /names no default branch for its origin/)
  assert.match(drift, /git remote set-head origin --auto/)
  // And it is not a way of reporting everything: with a head set, the same workspace drifts by nothing.
  gitIn(fixture.clone, 'remote', 'set-head', 'origin', '--auto')
  assert.deepEqual(await theDriftInTheWorkspace(anInspectionOf(fixture)), [])
})

test('a place with no clones in it drifts by nothing, and a git that cannot answer invents no line', async (t) => {
  const fixture = aCleanWorkspace(t)
  const empty = { ...anInspectionOf(fixture), workspace: { clones: join(fixture.clones, 'nothing-here'), worktrees: fixture.worktrees, members: [] } }
  assert.deepEqual(await theDriftInTheWorkspace(empty), [])
  // A clone git cannot read: every question goes unanswered, and no line is invented for it.
  const silent = { ...anInspectionOf(fixture), processes: { run: async () => ({ exit_code: null, stdout: '', stderr: '' }) } as Pick<Processes, 'run'> }
  assert.deepEqual(await theDriftInTheWorkspace(silent), [])
})

test('a file beside the organisations is named, and the clones are still read past it', async (t) => {
  const fixture = aCleanWorkspace(t)
  gitIn(fixture.clone, 'checkout', '--quiet', '-b', 'hygiea/562')
  const note = join(fixture.clones, 'a-note.md')
  writeFileSync(note, 'left here by someone\n')
  // The walk takes every child of the clones place for an organisation, so a file there killed it with ENOTDIR before
  // this case: what it must do instead is say what it found and carry on to the clone beside it.
  assert.deepEqual(await theDriftInTheWorkspace(anInspectionOf(fixture)), [
    `${note} is not a directory: the crew's clones are laid out <clones>/<org>/<repo>, and every place between them is one.`,
    `${fixture.clone} is on hygiea/562, and a clone stays on main: a branch's work belongs in a worktree.`,
  ])
})

test('a symlinked organisation is followed: the clone under it is read, not skipped', async (t) => {
  const fixture = aCleanWorkspace(t)
  const elsewhere = join(fixture.root, 'elsewhere', 'acme-two')
  aSecondClone(fixture.root, join(elsewhere, 'widget'))
  symlinkSync(elsewhere, join(fixture.clones, 'acme-two'))
  gitIn(join(fixture.clones, 'acme-two', 'widget'), 'checkout', '--quiet', '-b', 'hygiea/562')
  const lines = await theDriftInTheWorkspace(anInspectionOf(fixture))
  // `kindOf` does not follow a link: the walk resolves it first, so a crew that reaches an organisation through one
  // still has its clones read, and the link itself is no drift.
  assert.deepEqual(lines, [`${join(fixture.clones, 'acme-two', 'widget')} is on hygiea/562, and a clone stays on main: a branch's work belongs in a worktree.`])
})

test('a symlinked clone is followed: the clone it points at is read, not skipped', async (t) => {
  const fixture = aCleanWorkspace(t)
  const outside = join(fixture.root, 'outside', 'widget-two')
  aSecondClone(fixture.root, outside)
  gitIn(outside, 'checkout', '--quiet', '-b', 'uranus/563')
  symlinkSync(outside, join(fixture.clones, 'acme', 'widget-two'))
  const lines = await theDriftInTheWorkspace(anInspectionOf(fixture))
  assert.deepEqual(lines, [`${join(fixture.clones, 'acme', 'widget-two')} is on uranus/563, and a clone stays on main: a branch's work belongs in a worktree.`])
})

test('a child the tree will not read is one named line, not a crash', async (t) => {
  const fixture = aCleanWorkspace(t)
  const blind = join(fixture.clones, 'blind-org')
  mkdirSync(blind)
  const clean = anInspectionOf(fixture)
  const files = {
    ...clean.files,
    kindOf: (path: string): FileKind => {
      if (path === blind) throw new Error('EACCES: permission denied')
      return clean.files.kindOf(path)
    },
  }
  assert.deepEqual(await theDriftInTheWorkspace({ ...clean, files }), [
    `${blind} could not be read (EACCES: permission denied), so what the crew put there is not known.`,
  ])
})
