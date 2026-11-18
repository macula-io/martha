// What the workspace's layout refuses of a call (martha#562, port-map step 9).
//
// The claims this file pins are the slice's. A clone stays on its default branch, so a call that would move one is
// refused where it stands, a call that only reads, or works in a worktree, is not, and a call that puts a drifted clone
// back on that branch is not either. Another member's worktree or branch is theirs, in every shape a call can reach one
// — the delete, the move, the worktree removal and the worktree's own move and prune, the pruning push, the deleting
// push and the raw ref update — however the worktree's path is spelled, and a member's own branch stays deletable, a
// `main` and a `feature/x` belong to nobody and are not touched by the rule. A call is judged where its line leaves the
// shell, and where the reader cannot tell, it is judged nowhere rather than somewhere it is not. The last claim is the
// one that keeps the rule honest: a place is read with a separator after it, so a path that merely starts with the same
// letters is another place.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readTheGitCallsInAShellLine } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import {
  refuseACallInTheWorkspace,
  refuseARefUpdate,
  theWorkspaceTheCrewDeclared,
  type TheFacts,
  type TheWorkspace,
} from './guard_workspace.ts'

/** The crew's places: two directories nothing else in the tree names, so a test never borrows a constant's words. */
const CLONES = '/place/a'
const WORKTREES = '/place/b'

/** A crew of three members, the Supervisor among them, so a test can hold the rule to no role being exempt. */
const WORKSPACE: TheWorkspace = { clones: CLONES, worktrees: WORKTREES, members: ['Hygiea', 'Uranus', 'Supervisor'] }

/** What git says: a clone on main with the crew's branches, and the worktrees a removal or a prune would meet. */
const FACTS: TheFacts = {
  branches: ['main', 'hygiea/562', 'uranus/9'],
  defaultBranch: 'main',
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

/** A declaration carrying only what this slice reads: the layout switch, its places, and the members. */
const settingsWith = (layout: { readonly on: boolean; readonly clones: string | null; readonly worktrees: string | null }): CrewSettings =>
  ({
    house_rules: { workspace_layout: layout.on, clones: layout.clones, worktrees: layout.worktrees },
    members: [{ name: 'Hygiea' }, { name: 'Uranus' }],
  }) as unknown as CrewSettings

test('a crew that turned no layout on is guarded by nothing, and one that did names its places and its members', () => {
  assert.equal(theWorkspaceTheCrewDeclared(settingsWith({ on: false, clones: CLONES, worktrees: WORKTREES })), undefined)
  assert.equal(theWorkspaceTheCrewDeclared(settingsWith({ on: true, clones: null, worktrees: WORKTREES })), undefined)
  assert.deepEqual(theWorkspaceTheCrewDeclared(settingsWith({ on: true, clones: CLONES, worktrees: WORKTREES })), {
    clones: CLONES,
    worktrees: WORKTREES,
    members: ['Hygiea', 'Uranus'],
  })
})

// --- a clone stays on its default branch --------------------------------------------

test('a call that moves a clone off its default branch is refused, in every shape it is written in', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git checkout -b mine', 'git checkout -B mine', 'git checkout --orphan mine', 'git switch -c mine', 'git switch -C mine', 'git branch mine']) {
    refusedWith(line, inAClone, 'Hygiea', /a clone stays on its default branch/)
  }
  // A switch to a branch that is not the clone's default is the same drift, written the other way.
  refusedWith('git checkout uranus/9', inAClone, 'Hygiea', /a clone stays on its default branch/)
  refusedWith('git switch hygiea/562', inAClone, 'Hygiea', /a clone stays on its default branch/)
})

test('a call that puts a drifted clone back on its default branch is not refused', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git checkout main', 'git switch main', 'git checkout main && git pull', 'git status']) {
    assert.equal(refused(line, inAClone), undefined, line)
  }
  // A clone whose default branch git cannot name is not one the rule can read: it does not fire, and a branch made
  // there is still refused, since making one needs no fact.
  const unknown: TheFacts = { ...FACTS, defaultBranch: null }
  assert.equal(refused('git checkout uranus/9', inAClone, 'Hygiea', unknown), undefined)
  refusedWith('git switch -c mine', inAClone, 'Hygiea', /a clone stays on its default branch/)
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

test("another member's worktree is not moved or reached past the spelling of its path, and one's own is", () => {
  // Every way of writing the same place: past the directory the line stands in, with the separator after it, and by
  // the command that moves a worktree rather than removing it.
  refusedWith('git worktree remove ../repo-9', `${WORKTREES}/own-562`, 'Hygiea', /uranus\/9 is another member's branch/)
  refusedWith(`git worktree remove ${WORKTREES}/repo-9/`, null, 'Hygiea', /uranus\/9 is another member's branch/)
  refusedWith(`git worktree move ${WORKTREES}/repo-9 ${WORKTREES}/anywhere`, null, 'Hygiea', /uranus\/9 is another member's branch/)
  refusedWith(`git worktree move ${WORKTREES}/repo-9 ${WORKTREES}/renamed/`, null, 'Hygiea', /uranus\/9 is another member's branch/)
  assert.equal(refused('git worktree move ../repo-562 ../repo-562-again', `${WORKTREES}/own-562`), undefined)
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

// --- where a call runs, as the guard reads it ---------------------------------------

test('a call is judged where its line leaves the shell, and unknown rather than somewhere it is not', () => {
  // A newline ends a command as a semicolon does, so the second `cd` is the one in force when the call runs.
  refusedWith(`cd ${CLONES}\ncd ${CLONES}/org/repo\ngit switch -c mine`, '/place/nowhere', 'Hygiea', /a clone stays on its default branch/)
  // A `cd` behind `then` sits where the reader does not see a command begin, so where the call runs is not known: it is
  // not handed the directory the line started in, and a call that really runs in a worktree is not refused as a clone's.
  assert.equal(refused(`if true; then cd ${WORKTREES}/repo-562; fi; git switch -c mine`, `${CLONES}/org/repo`), undefined)
  // A `cd` with no path of its own, or with an option before it, names a directory the reader does not follow either.
  assert.equal(refused('cd; git switch -c mine', `${CLONES}/org/repo`), undefined)
  assert.equal(refused(`cd -P ${CLONES}/org/repo && git switch -c mine`, '/place/nowhere'), undefined)
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
