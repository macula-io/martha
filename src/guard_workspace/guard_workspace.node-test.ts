// What the workspace's layout refuses of a call (martha#562, port-map step 9).
//
// The claims this file pins are the slice's. A clone stays on its default branch, so a call that would move one is
// refused where it stands, and a call that only reads, or works in a worktree, is not. Another member's worktree or
// branch is theirs, in every shape a call can reach one — the delete, the move, the worktree removal and prune, the
// pruning push, the deleting push and the raw ref update — and a member's own branch stays deletable, a `main` and a
// `feature/x` belong to nobody and are not touched by the rule. The last claim is the one that keeps the rule honest:
// a place is read with a separator after it, so a path that merely starts with the same letters is another place.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readTheGitCallsInAShellLine } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { refuseACallInTheWorkspace, refuseARefUpdate, type TheFacts, type TheWorkspace } from './guard_workspace.ts'

/** The crew's places: two directories nothing else in the tree names, so a test never borrows a constant's words. */
const CLONES = '/place/a'
const WORKTREES = '/place/b'

/** A crew of three members, the Supervisor among them, so a test can hold the rule to no role being exempt. */
const WORKSPACE: TheWorkspace = { clones: CLONES, worktrees: WORKTREES, members: ['Hygiea', 'Uranus', 'Supervisor'] }

/** What git says: a clone on main with the crew's branches, and the worktrees a removal or a prune would meet. */
const FACTS: TheFacts = {
  branches: ['main', 'hygiea/562', 'uranus/9'],
  worktrees: [
    { path: '/place/b/repo-562', branch: 'hygiea/562', prunable: false },
    { path: '/place/b/repo-9', branch: 'uranus/9', prunable: false },
    { path: '/place/b/repo-4', branch: 'uranus/4', prunable: true },
  ],
}

/** A refusal as a shell call meets it, read from the line the way the relay reads it. */
const refused = (line: string, directory: string | null, member = 'Hygiea', facts: TheFacts = FACTS): string | undefined =>
  refuseACallInTheWorkspace({ calls: readTheGitCallsInAShellLine(line, { directory }), workspace: WORKSPACE, member, facts })

/** A line is refused, and its words say why. */
const refusedWith = (line: string, directory: string | null, member: string, says: RegExp): void => {
  const refusal = refused(line, directory, member)
  assert.ok(refusal !== undefined, `${line} was not refused`)
  assert.match(refusal, says)
}

// --- a clone stays on its default branch --------------------------------------------

test('a call that moves a clone off its default branch is refused, in every shape it is written in', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git checkout -b mine', 'git checkout -B mine', 'git checkout --orphan mine', 'git switch -c mine', 'git switch -C mine', 'git switch main', 'git checkout main', 'git branch mine']) {
    refusedWith(line, inAClone, 'Hygiea', /a clone stays on its default branch/)
  }
})

test('a call that only reads or works is not refused, even in a clone', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git status', 'git branch', 'git branch -a', 'git branch --list', 'git fetch', 'git checkout -- src/app.ts', 'git checkout src/app.ts']) {
    assert.equal(refused(line, inAClone), undefined, line)
  }
})

test('a worktree is not made inside a clone, and the place a crew declared for one is not a clone', () => {
  refusedWith(`git worktree add ${CLONES}/org/repo-x`, null, 'Hygiea', /a worktree is not made inside a clone/)
  assert.equal(refused(`git worktree add ${WORKTREES}/repo-7 -b hygiea/7`, null), undefined)
  assert.equal(refused('git worktree add ../repo-7 -b hygiea/7', '/place/b'), undefined)
})

test('a call in a worktree, or in a place that merely starts like the clone place, is not a call in a clone', () => {
  assert.equal(refused('git checkout -b mine', `${WORKTREES}/repo-562`), undefined)
  assert.equal(refused('git checkout -b mine', `${CLONES}-elsewhere/org/repo`), undefined)
})

// --- another member's worktree or branch is theirs ----------------------------------

test("a branch another member owns is not deleted or moved, in every shape a call reaches it", () => {
  const onTheLine = 'git branch'
  for (const line of [`${onTheLine} -d uranus/9`, `${onTheLine} -D uranus/9`, `${onTheLine} --delete uranus/9`, `${onTheLine} -m uranus/9 mine`, `${onTheLine} -M uranus/9 mine`, `${onTheLine} --move uranus/9 mine`]) {
    refusedWith(line, null, 'Hygiea', /uranus\/9 is another member's branch, and it is theirs/)
  }
})

test("the rule reads the member the way the tree reads one, and exempts nobody: the Supervisor is refused too", () => {
  refusedWith('git branch -D uranus/9', null, 'hygiea', /another member's branch/)
  refusedWith('git branch -D hygiea/562', null, 'Uranus', /another member's branch/)
  refusedWith('git branch -D hygiea/562', null, 'Supervisor', /another member's branch/)
})

test("a member's own branch, and a branch that belongs to no member, stays deletable", () => {
  for (const line of ['git branch -d hygiea/562', 'git branch -D main', 'git branch -D feature/x', 'git branch -d old-work']) {
    assert.equal(refused(line, null), undefined, line)
  }
})

test("another member's worktree is not removed or pruned away, and one's own is", () => {
  refusedWith(`git worktree remove ${WORKTREES}/repo-9`, null, 'Hygiea', /uranus\/9 is another member's branch/)
  refusedWith('git worktree prune', null, 'Hygiea', /uranus\/4 is another member's branch/)
  assert.equal(refused(`git worktree remove ${WORKTREES}/repo-562`, null), undefined)
})

test('a push that prunes takes refs nobody named, and a push that deletes names whose', () => {
  refusedWith('git push --prune origin', null, 'Hygiea', /a push that prunes takes every remote branch it does not name/)
  refusedWith('git push origin :uranus/9', null, 'Hygiea', /uranus\/9 is another member's branch/)
  refusedWith('git push --delete origin uranus/9', null, 'Hygiea', /uranus\/9 is another member's branch/)
  refusedWith('git push -d origin refs/heads/uranus/9', null, 'Hygiea', /uranus\/9 is another member's branch/)
})

test('a raw ref update deletes only a member\'s own branch', () => {
  refusedWith('git update-ref -d refs/heads/uranus/9', null, 'Hygiea', /uranus\/9 is another member's branch/)
  assert.equal(refused('git update-ref -d refs/heads/hygiea/562', null), undefined)
})

test("a member's own push is never refused: the rule is about whose branch, not about pushing", () => {
  for (const line of ['git push origin hygiea/562', 'git push -u origin hygiea/562', 'git push --force-with-lease origin hygiea/562', 'git push --tags']) {
    assert.equal(refused(line, null), undefined, line)
  }
})

// --- the second seam: a ref update the shell never saw -------------------------------

test('a ref update the shell never saw is judged on the ref it deletes, and only a branch is', () => {
  assert.match(refuseARefUpdate({ ref: 'refs/heads/uranus/9', deletes: true }, WORKSPACE, 'Hygiea') ?? '', /another member's branch/)
  assert.equal(refuseARefUpdate({ ref: 'refs/heads/hygiea/562', deletes: true }, WORKSPACE, 'Hygiea'), undefined)
  assert.equal(refuseARefUpdate({ ref: 'refs/heads/main', deletes: true }, WORKSPACE, 'Hygiea'), undefined)
  assert.equal(refuseARefUpdate({ ref: 'refs/tags/v1', deletes: true }, WORKSPACE, 'Hygiea'), undefined)
  // A create is not a delete: a push of a new branch past the shell is not this rule's.
  assert.equal(refuseARefUpdate({ ref: 'refs/heads/uranus/9', deletes: false }, WORKSPACE, 'Hygiea'), undefined)
})
