// One place per crew, however many checkouts its members work in (martha#254 R1).
//
// The rows a member beats and the ledger a successor reads used to sit under the state directory of one checkout, so
// two members in two worktrees of one repository could not see each other, and one package's ledger was split across
// as many directories as there were worktrees. The crew's place is keyed by the git common directory every worktree of
// a repository shares, so one crew is one place.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CREW_ROWS_PLACE, CREWS_PLACE, crewKeyOf, crewRowsDirectory, crewStateDirectory, nodeIdsFor, openState, PERMISSION_BITS, projectStateDirectory } from './keep_martha_state_outside_the_checkout.ts'

/** A directory the test owns, removed when it ends. */
function aDirectory(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `martha-254-${prefix}-`))
  t.after(() => removeTheTree(dir))
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
  const worktree = join(aDirectory(t, 'some-worktrees'), 'a-worktree')
  git(repo, 'worktree', 'add', '-q', '-b', 'a-branch', worktree)
  const clone = join(aDirectory(t, 'some-clones'), 'a-clone')
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

test(`the place is <state root>/${CREWS_PLACE}/<64 hex>, mode 0700, and its rows sit under it (R1)`, (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)

  const crew = pathOf(crewStateDirectory(state_root, repo))
  assert.match(crew, new RegExp(`/${CREWS_PLACE}/[0-9a-f]{64}$`), `the place is keyed by a sha256 (${crew})`)
  assert.equal(modeOf(crew), 0o700, 'only the owner may enter the crew place')

  const rows = pathOf(crewRowsDirectory(state_root, repo))
  assert.equal(rows, join(crew, CREW_ROWS_PLACE), 'the streams live under the crew place, in one rows directory')
  assert.equal(modeOf(rows), 0o700, 'only the owner may enter the rows directory')
})

test('the crews directory itself is said in one line when it is a link, or when others may write into it, and used anyway (r=1 R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)

  // The directory every crew's place sits in, as a link to one this test owns.
  symlinkSync(aDirectory(t, 'elsewhere'), join(state_root, CREWS_PLACE))
  const linkedSaid: string[] = []
  const linked = crewStateDirectory(state_root, repo, (line) => linkedSaid.push(line))
  assert.ok('path' in linked, 'a linked crews directory is used')
  assert.equal(linkedSaid.length, 1, linkedSaid.join('\n'))
  assert.match(linkedSaid[0] ?? '', /is a link/, linkedSaid.join('\n'))

  rmSync(join(state_root, CREWS_PLACE))
  mkdirSync(join(state_root, CREWS_PLACE), { recursive: true, mode: 0o700 })
  chmodSync(join(state_root, CREWS_PLACE), 0o777)
  const writtenSaid: string[] = []
  const written = crewStateDirectory(state_root, repo, (line) => writtenSaid.push(line))
  assert.ok('path' in written, 'a crews directory anyone may write into is used')
  assert.equal(writtenSaid.length, 1, writtenSaid.join('\n'))
  assert.match(writtenSaid[0] ?? '', /may be written by others/, writtenSaid.join('\n'))
})

test('a crew place that a link stands in for is said in one line, and used anyway (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  mkdirSync(join(state_root, CREWS_PLACE), { recursive: true, mode: 0o700 })
  const elsewhere = aDirectory(t, 'elsewhere')
  // The key of this repository, as a link to a directory this test owns.
  symlinkSync(elsewhere, join(state_root, CREWS_PLACE, crewKeyOf(repo)))

  const said: string[] = []
  const answer = crewStateDirectory(state_root, repo, (line) => said.push(line))
  assert.ok('path' in answer, 'a linked crew place is used')
  assert.equal(answer.path, join(state_root, CREWS_PLACE, crewKeyOf(repo)))
  assert.equal(said.length, 1, said.join('\n'))
  assert.match(said[0] ?? '', /is a link/, said.join('\n'))
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

test('a crew place others may write into is said in one line, and used anyway (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  const crew = pathOf(crewStateDirectory(state_root, repo))
  chmodSync(crew, 0o777)

  const said: string[] = []
  const answer = crewStateDirectory(state_root, repo, (line) => said.push(line))
  assert.ok('path' in answer, 'a crew place anyone may write into is used')
  assert.equal(answer.path, crew)
  assert.equal(said.length, 1, said.join('\n'))
  assert.match(said[0] ?? '', /may be written by others/, said.join('\n'))
})

test('everything else stays keyed by the checkout: two worktrees of one repository keep their own state (R1)', (t) => {
  const state_root = aDirectory(t, 'state')
  const repo = aRepository(t)
  const worktree = join(aDirectory(t, 'some-worktrees'), 'a-worktree')
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
