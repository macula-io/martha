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

import { CREW_ROWS_PLACE, CREWS_PLACE, crewKeyOf, crewRowsDirectory, crewStateDirectory, PERMISSION_BITS } from './keep_martha_state_outside_the_checkout.ts'

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
