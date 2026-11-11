// One place per crew, however many checkouts its members work in (martha#254 R1).
//
// The rows a member beats and the ledger a successor reads used to sit under the state directory of one checkout, so
// two members in two worktrees of one repository could not see each other, and one package's ledger was split across
// as many directories as there were worktrees. The crew's place is keyed by the git common directory every worktree of
// a repository shares, so one crew is one place.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { chmodSync } from 'node:fs'

import { CREW_ROWS_PLACE, CREWS_PLACE, crewKeyOf, crewRowsDirectory, crewStateDirectory, nodeIdsFor, openState, PERMISSION_BITS, projectStateDirectory } from './keep_martha_state_outside_the_checkout.ts'

/** A directory the test owns, removed when it ends. */
function aDirectory(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `martha-254-${prefix}-`))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A repository with one commit, and the directory git works in. */
function aRepository(t: TestContext): string {
  const repo = aDirectory(t, 'repo')
  git(repo, 'init', '-q', '-b', 'main', '.')
  git(repo, 'config', 'user.name', 'martha-test')
  git(repo, 'config', 'user.email', 'martha-test@example.invalid')
  writeFileSync(join(repo, 'README.md'), 'a project\n')
  git(repo, 'add', '--all')
  git(repo, 'commit', '-q', '-m', 'start')
  return repo
}

function git(cwd: string, ...args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()
}

/** The path a crew state answer holds, or the refusal it is instead. */
function pathOf(answer: { readonly path: string } | { readonly refusal: string }): string {
  assert.ok('path' in answer, `the crew place is a path (${'refusal' in answer ? answer.refusal : ''})`)
  return answer.path
}

test('two worktrees of one repository share one crew place, and a separate clone gets its own (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  const worktree = join(aDirectory(t, 'worktrees'), 'a-worktree')
  git(repo, 'worktree', 'add', '-q', '-b', 'a-branch', worktree)
  const clone = join(aDirectory(t, 'clones'), 'a-clone')
  git(repo, 'clone', '-q', repo, clone)

  const inTheRepository = pathOf(crewStateDirectory(state_root, repo))
  assert.equal(pathOf(crewStateDirectory(state_root, worktree)), inTheRepository, 'a worktree reads the crew place of its repository')
  assert.notEqual(pathOf(crewStateDirectory(state_root, clone)), inTheRepository, 'a clone is another repository, so another place')
})

test('a directory that is not in git is keyed by its own real path, which is one checkout and so one place (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const plain = aDirectory(t, 'plain')
  const other = aDirectory(t, 'other')

  assert.equal(crewKeyOf(plain), crewKeyOf(plain), 'the same directory is the same key every time')
  assert.notEqual(crewKeyOf(other), crewKeyOf(plain), 'two directories are two keys')
  assert.equal(pathOf(crewStateDirectory(state_root, plain)), pathOf(crewStateDirectory(state_root, plain)))
})

test('the place is <state root>/crews/<64 hex>, mode 0700, and its rows sit under it (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)

  const crew = pathOf(crewStateDirectory(state_root, repo))
  assert.match(crew, new RegExp(`/${CREWS_PLACE}/[0-9a-f]{64}$`), `the place is keyed by a sha256 (${crew})`)
  assert.equal(modeOf(crew), 0o700, 'only the owner may enter the crew place')

  const rows = pathOf(crewRowsDirectory(state_root, repo))
  assert.equal(rows, join(crew, CREW_ROWS_PLACE), 'the streams live under the crew place, in one rows directory')
  assert.equal(modeOf(rows), 0o700, 'only the owner may enter the rows directory')
})

test('the crews directory itself is refused when it is a link, or when others may write into it (r=1 R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)

  // The directory every crew's place sits in, as a link to one this test owns.
  symlinkSync(aDirectory(t, 'elsewhere'), join(state_root, CREWS_PLACE))
  const linked = crewStateDirectory(state_root, repo)
  assert.ok('refusal' in linked, 'a linked crews directory is refused')
  assert.match(linked.refusal, /is a link/, 'and the refusal says it is a link')

  rmSync(join(state_root, CREWS_PLACE))
  mkdirSync(join(state_root, CREWS_PLACE), { recursive: true, mode: 0o700 })
  chmodSync(join(state_root, CREWS_PLACE), 0o777)
  const written = crewStateDirectory(state_root, repo)
  assert.ok('refusal' in written, 'a crews directory anyone may write into is refused')
  assert.match(written.refusal, /may be written by others/, 'and the refusal says so')
})

test('a crew place that a link stands in for is refused, never followed (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  mkdirSync(join(state_root, CREWS_PLACE), { recursive: true, mode: 0o700 })
  const elsewhere = aDirectory(t, 'elsewhere')
  // The key of this repository, as a link to a directory this test owns.
  symlinkSync(elsewhere, join(state_root, CREWS_PLACE, crewKeyOf(repo)))

  const answer = crewStateDirectory(state_root, repo)
  assert.ok('refusal' in answer, 'a linked crew place is refused')
  assert.match(answer.refusal, /is a link/, 'the refusal says the place is a link')
})

/** The permission bits of the directory at `path`. */
function modeOf(path: string): number {
  const found = lstatSync(path, { throwIfNoEntry: false })
  assert.ok(found !== undefined, `${path} was made`)
  return Number(found.mode) & PERMISSION_BITS
}

test('a directory that is not in git is keyed by its real path, so a link to it is the same place (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const plain = aDirectory(t, 'plain')
  const link = join(aDirectory(t, 'links'), 'a-link')
  symlinkSync(plain, link)

  assert.equal(crewKeyOf(link), crewKeyOf(plain), 'the key follows the link to the directory it names')
  assert.equal(pathOf(crewStateDirectory(state_root, link)), pathOf(crewStateDirectory(state_root, plain)))
})

test('a crew place others may write into is refused (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  const crew = pathOf(crewStateDirectory(state_root, repo))
  chmodSync(crew, 0o777)

  const answer = crewStateDirectory(state_root, repo)
  assert.ok('refusal' in answer, 'a crew place anyone may write into is refused')
  assert.match(answer.refusal, /may be written by others/, 'the refusal says so')
})

test('everything else stays keyed by the checkout: two worktrees of one repository keep their own state (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  const worktree = join(aDirectory(t, 'worktrees'), 'a-worktree')
  git(repo, 'worktree', 'add', '-q', '-b', 'a-branch', worktree)

  const inTheRepository = openState(state_root, repo)
  const inTheWorktree = openState(state_root, worktree)
  assert.ok('directory' in inTheRepository && 'directory' in inTheWorktree, 'both states open')
  assert.equal(inTheRepository.directory, projectStateDirectory(state_root, repo), 'a checkout keeps its state where it did')
  assert.notEqual(inTheWorktree.directory, inTheRepository.directory, 'a worktree does not read the other checkout\'s approvals, ids or own writes')

  const ids = nodeIdsFor(inTheRepository, ['Vesta'])
  assert.ok('ids' in ids, 'the ids are kept')
  const elsewhere = nodeIdsFor(inTheWorktree, ['Vesta'])
  assert.ok('ids' in elsewhere && elsewhere.ids['Vesta'] !== ids.ids['Vesta'], 'each checkout keeps its own ids, so one does not sign for the other')
})
