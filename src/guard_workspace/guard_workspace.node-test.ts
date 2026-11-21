// What the workspace's layout refuses of a call, and what it only notices (martha#562, port-map step 9, martha#601).
//
// The claims this file pins are the slice's. A clone stays on its default branch, so a call that would move one runs as
// asked with one line saying where the work belongs, a call that only reads, or works in a worktree, says nothing, and a
// call that puts a drifted clone back on that branch says nothing either. Another member's worktree or branch is theirs,
// in every shape a call can reach one — the delete, the move, the worktree removal and the worktree's own move and
// prune, the pruning push, the deleting push and the raw ref update — however the worktree's path is spelled, and a
// member's own branch stays deletable, a `main` and a `feature/x` belong to nobody and are not touched by the rule. A
// call is judged where its line leaves the shell, and where the reader cannot tell, it is judged nowhere rather than
// somewhere it is not. The last claim is the one that keeps the rule honest: a place is read with a separator after it,
// so a path that merely starts with the same letters is another place. One push is refused whoever makes it
// (martha#925): a push whose target is the default branch git names, in every shape a refspec writes it; any other
// target passes, and so does every push where git names none.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { readTheGitCallsInAShellLine } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  WORKTREES_BESIDE_CLONES,
  declareCrew,
  type CrewSettings,
} from '../declare_crew/declare_crew.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { theWorkspacesClonesOf } from '../declare_crew/the_crews_workspace.ts'
import {
  refuseACallInTheWorkspace,
  refuseARefUpdate,
  theCloneOf,
  theWorkspaceTheCrewDeclared,
  type TheFacts,
  type TheWorkspace,
} from './guard_workspace.ts'

/** The crew's places: two directories nothing else in the tree names, so a test never borrows a constant's words. */
const CLONES = '/place/a'
const WORKTREES = '/place/b'

/** The folder a declaration's `workspace.root` is read against: the crew's project root, absolute. */
const A_PROJECT_ROOT = '/place'

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

/** A refusal as a shell call meets it, read from the line the way the relay reads it, with the sink the notice goes through. */
const refused = (line: string, directory: string | null, member = 'Hygiea', facts: TheFacts = FACTS, note: (line: string) => void = () => {}): string | undefined =>
  refuseACallInTheWorkspace({ calls: readTheGitCallsInAShellLine(line, { directory }), workspace: WORKSPACE, member, facts }, note)

/** A line is refused, and its words say why. */
const refusedWith = (line: string, directory: string | null, member: string, says: RegExp): void => {
  const refusal = refused(line, directory, member)
  assert.ok(refusal !== undefined, `${line} was not refused`)
  assert.match(refusal, says)
}

// A crew declared at a workspace, as `martha up` reads it (martha#958): a root the project holds, and no house rules.
const DECLARED_AT = join(A_PROJECT_ROOT, DECLARATION_DIRECTORY, DECLARATION_FILE)

/** The answer, and everything written to the process's own error output while the call is judged (martha#601). */
const theNoticeWhile = (act: (note: (line: string) => void) => string | undefined): { readonly answer: string | undefined; readonly notice: string } => {
  const written: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    return { answer: act((line) => void process.stderr.write(`${line}\n`)), notice: written.join('') }
  } finally {
    process.stderr.write = original
  }
}


/** The team a reading test declares: two builders and a lead, no act named, so every act stays the owner's. */
const aTeam = (extra: Readonly<Record<string, unknown>>): unknown => ({
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: 'Hygiea', role: 'builder' },
    { name: 'Uranus', role: 'builder' },
    { name: 'Lead', role: 'lead' },
  ],
  mode: { name: 'a-team', roles: ['lead', 'builder'], may: {} },
  ...extra,
})

/** The models this test's host runs: none, since no declaration here names a model. */
const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: [] }

/** The settings a declaration is read into, on the core's in-memory host. */
const declared = (extra: Readonly<Record<string, unknown>>): Promise<CrewSettings> => {
  const { host } = hostForTests({ documents: { [DECLARED_AT]: JSON.stringify(aTeam(extra)) } })
  return declareCrew(host.stores.documents, A_PROJECT_ROOT, HOST_MODELS)
}

test('the places a crew names turn the guard on, whichever block named them (#958)', async () => {
  // Raf's draft shape: a workspace root alone, and no house_rules at all. The reader derives both places from it.
  const rootOnly = theWorkspaceTheCrewDeclared(await declared({ workspace: { root: 'projects' } }))
  assert.deepEqual(rootOnly, {
    clones: join(A_PROJECT_ROOT, 'projects'),
    worktrees: join(A_PROJECT_ROOT, WORKTREES_BESIDE_CLONES),
    members: ['Hygiea', 'Uranus', 'Lead'],
  })
  // The older spelling, with no switch beside it: the same fact, read the same way.
  assert.deepEqual(theWorkspaceTheCrewDeclared(await declared({ house_rules: { clones: CLONES, worktrees: WORKTREES } })), {
    clones: CLONES,
    worktrees: WORKTREES,
    members: ['Hygiea', 'Uranus', 'Lead'],
  })
})

test('a crew that named no places is guarded by nothing, and one that named them is guarded by its rules (#958)', async () => {
  assert.equal(theWorkspaceTheCrewDeclared(await declared({})), undefined)
  const workspace = theWorkspaceTheCrewDeclared(await declared({ workspace: { root: 'projects' } }))!
  const judged = (line: string, note?: (line: string) => void) =>
    refuseACallInTheWorkspace({ calls: readTheGitCallsInAShellLine(line, { directory: join(workspace.clones, 'acme', 'widget') }), workspace, member: 'Hygiea', facts: FACTS }, note)
  assert.match(judged('git push origin main') ?? '', /default branch/, 'the push rule refuses in a crew declared this way')
  // The switch rule is the notice martha#601 made it: what this test pins is that the rules are read at all here.
  const { answer, notice } = theNoticeWhile((note) => judged('git checkout -b mine', note))
  assert.equal(answer, undefined)
  assert.match(notice, /a clone stays on its default branch/, 'a crew declared this way is judged, and its rules speak')
})

// --- a clone stays on its default branch --------------------------------------------

test('#601: a call that moves a clone off its default branch runs as asked, in every shape it is written in', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git checkout -b mine', 'git checkout -B mine', 'git checkout --orphan mine', 'git switch -c mine', 'git switch -C mine', 'git branch mine']) {
    const { answer, notice } = theNoticeWhile((note) => refused(line, inAClone, 'Hygiea', undefined, note))
    assert.equal(answer, undefined, `${line} was refused`)
    assert.match(notice, /a clone stays on its default branch/, `${line} was allowed without a notice`)
  }
  // A switch to a branch that is not the clone's default is the same drift, written the other way.
  for (const line of ['git checkout uranus/9', 'git switch hygiea/562']) {
    const { answer, notice } = theNoticeWhile((note) => refused(line, inAClone, 'Hygiea', undefined, note))
    assert.equal(answer, undefined, `${line} was refused`)
    assert.match(notice, /a clone stays on its default branch/, `${line} was allowed without a notice`)
  }
})

test('a call that puts a drifted clone back on its default branch says nothing', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git checkout main', 'git switch main', 'git checkout main && git pull', 'git status']) {
    assert.equal(refused(line, inAClone), undefined, line)
  }
  // A clone whose default branch git cannot name is not one the rule can read: it does not fire, and a branch made
  // there is still noticed, since making one needs no fact.
  const unknown: TheFacts = { ...FACTS, defaultBranch: null }
  assert.equal(refused('git checkout uranus/9', inAClone, 'Hygiea', unknown), undefined)
  const { answer, notice } = theNoticeWhile((note) => refused('git switch -c mine', inAClone, 'Hygiea', undefined, note))
  assert.equal(answer, undefined)
  assert.match(notice, /a clone stays on its default branch/)
})

test('#601: a worktree is made inside a clone as asked, with one line saying where it belongs', () => {
  const { answer, notice } = theNoticeWhile((note) => refused(`git worktree add ${CLONES}/org/repo-x`, null, 'Hygiea', undefined, note))
  assert.equal(answer, undefined, 'a worktree inside a clone was refused')
  assert.match(notice, /a worktree made inside a clone/, 'the worktree was made without a notice')
  assert.equal(refused(`git worktree add ${WORKTREES}/repo-7 -b hygiea/7`, null), undefined)
  assert.equal(refused('git worktree add ../repo-7 -b hygiea/7', '/place/b'), undefined)
})

test('a call that only reads or works is not refused, even in a clone', () => {
  const inAClone = `${CLONES}/org/repo`
  for (const line of ['git status', 'git branch', 'git branch -a', 'git branch --list', 'git fetch', 'git checkout -- src/app.ts', 'git checkout src/app.ts']) {
    assert.equal(refused(line, inAClone), undefined, line)
  }
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

test("martha#925: a push onto the origin's default branch is refused in every shape a call names it, the Supervisor's too", () => {
  const inAWorktree = `${WORKTREES}/repo-562`
  const lines = [
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin hygiea/562:refs/heads/main',
    'git push --force origin +HEAD:main',
    'git push -o ci.skip origin HEAD:main',
    'git push origin :main',
    'git push --delete origin main',
    `cd ${inAWorktree} && git push origin HEAD:main`,
    `git -C ${inAWorktree} push origin main`,
  ]
  for (const line of lines) {
    for (const member of ['Hygiea', 'Supervisor']) refusedWith(line, inAWorktree, member, /main is the default branch.*fast_forward_after_the_owners_yes.*Nothing was pushed/)
  }
})

test("martha#925: a push onto any other branch is not refused, and one whose target the line does not name is not either", () => {
  for (const line of ['git push origin hygiea/562', 'git push origin HEAD:hygiea/562', 'git push origin main:hygiea/562', 'git push origin mainline', 'git push origin HEAD', 'git push', 'git push origin feature/main']) {
    assert.equal(refused(line, `${WORKTREES}/repo-562`), undefined, line)
  }
})

test("martha#925: the default branch is the one git names, and a push where git names none is let through", () => {
  const onTrunk: TheFacts = { ...FACTS, branches: ['trunk', 'hygiea/562'], defaultBranch: 'trunk' }
  assert.match(refused('git push origin HEAD:trunk', null, 'Hygiea', onTrunk) ?? '', /trunk is the default branch/)
  assert.equal(refused('git push origin HEAD:main', null, 'Hygiea', onTrunk), undefined)
  assert.equal(refused('git push origin HEAD:main', null, 'Hygiea', { ...FACTS, defaultBranch: null }), undefined)
})

// --- where a call runs, as the guard reads it ---------------------------------------

test('a call is judged where its line leaves the shell, and unknown rather than somewhere it is not', () => {
  // A newline ends a command as a semicolon does, so the second `cd` is the one in force when the call runs.
  const { answer, notice } = theNoticeWhile((note) =>
    refused(`cd ${CLONES}\ncd ${CLONES}/org/repo\ngit switch -c mine`, '/place/nowhere', 'Hygiea', undefined, note),
  )
  assert.equal(answer, undefined)
  assert.match(notice, /a clone stays on its default branch/, 'the call in the clone was not noticed')
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

test('a workspace_layout switch beside a root is not read: false there is accepted and the crew is still guarded (#958 review r=1)', async () => {
  // The places are the fact, beside a root as beside house_rules' own places: a switch the reader no longer reads
  // neither refuses the declaration nor turns the guard off.
  const workspace = theWorkspaceTheCrewDeclared(await declared({ workspace: { root: 'projects' }, house_rules: { workspace_layout: false } }))
  assert.deepEqual(workspace, {
    clones: join(A_PROJECT_ROOT, 'projects'),
    worktrees: join(A_PROJECT_ROOT, WORKTREES_BESIDE_CLONES),
    members: ['Hygiea', 'Uranus', 'Lead'],
  })
})

// --- the places, however their root is spelled (martha#995) --------------------------

test('#995: a root declared with a trailing slash places the same clones folder, so the clone under it is found', () => {
  const said = (field: string, why: string): never => assert.fail(`${field} ${why}`)
  const clonesOf = (root: string) => theWorkspacesClonesOf({ workspace: { root } }, A_PROJECT_ROOT, said)
  const withoutOne = clonesOf('projects')
  const withOne = clonesOf('projects/')
  assert.equal(withOne, withoutOne)
  assert.ok(withoutOne !== null, 'the root names no clones folder')
  const clone = join(withoutOne, 'org', 'repo')
  // The clone the guard is asked about is found under both spellings, since both read as one place.
  assert.equal(theCloneOf(clone, withoutOne), clone)
  assert.equal(theCloneOf(clone, withOne), clone)
})
