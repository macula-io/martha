// Asking git what a member is about to change (martha#562, port-map step 9).
//
// Every test works on a throwaway repository it makes for itself: a bare origin, a clone under the crew's clone place,
// and worktrees of it under the crew's worktree place. The glue runs real git through the host contract's
// processes.run, so what is pinned here is what git says, not what a stand-in claims.
//
// Four things are pinned: that a call which would move a clone off its branch is refused because git says the word it
// names is a branch, while the same call naming a path is not; that another member's worktree is refused for a removal
// and for a prune in the shapes git lists them, and one's own passes; that a call whose directory names no repository is
// asked nowhere and refused by nothing it could not look at. The last is the fail-open claim: a git that cannot be run
// leaves the fact empty and the call goes through, because a member's shell must not wait on a guard.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { readTheGitCallsInAShellLine } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { askGitWhatAMemberIsAboutToChange } from './ask_git_what_a_member_is_about_to_change.ts'

/** The member acting, and the one whose worktree and branches are not theirs to touch. */
const MEMBER = 'Hygiea'
const OTHER = 'Uranus'

/** A place and a repository under it, as the crew declared them and as worktree_open lays them out. */
interface Fixture {
  readonly clones: string
  readonly worktrees: string
  readonly clone: string
  readonly branch_of_other: string
  readonly worktree_of_other: string
  readonly worktree_of_member: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()

/** git with the identity a throwaway repository has no config for: a commit needs a name and an address. */
const commitIn = (cwd: string, message: string): void => {
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', message)
}

/** A clone of one repository under the clone place, and two worktrees of it: one each member's. */
function aCrew(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'martha-562-glue-'))
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
  mkdirSync(join(seed, 'src'))
  writeFileSync(join(seed, 'src', 'app.ts'), 'export {}\n')
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  gitIn(clones, 'clone', '--quiet', origin, join('acme', 'widget'))
  const clone = join(clones, 'acme', 'widget')
  const branch_of_other = `${OTHER.toLowerCase()}/9`
  const worktree_of_other = join(worktrees, 'widget-9')
  const worktree_of_member = join(worktrees, 'widget-562')
  gitIn(clone, 'worktree', 'add', '--quiet', '-b', branch_of_other, worktree_of_other)
  gitIn(clone, 'worktree', 'add', '--quiet', '-b', `${MEMBER.toLowerCase()}/562`, worktree_of_member)
  return { clones, worktrees, clone, branch_of_other, worktree_of_other, worktree_of_member }
}

/** The crew's places and members, as the declaration hands them to the guard. */
const workspaceOf = (fixture: Fixture): TheWorkspace => ({
  clones: fixture.clones,
  worktrees: fixture.worktrees,
  members: [MEMBER, OTHER, 'Supervisor'],
})

/** A host whose processes.run really runs the command, in the directory it is given. */
const aHostThatRunsGit = () =>
  hostForTests({
    run: async (request) => {
      const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
      return { exit_code: outcome.error === undefined ? outcome.status : null, stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' }
    },
  }).host

/** The refusal a shell line meets, read the way a seam reads it and asked of real git. */
async function refusalOf(fixture: Fixture, line: string, directory: string | null, member = MEMBER): Promise<string | undefined> {
  return askGitWhatAMemberIsAboutToChange({
    host: aHostThatRunsGit(),
    calls: readTheGitCallsInAShellLine(line, { directory }),
    workspace: workspaceOf(fixture),
    member,
  })
}

test('a word git says is a branch is refused in a clone, and the same call naming a path is not', async (t) => {
  const fixture = aCrew(t)
  assert.match((await refusalOf(fixture, 'git checkout main', fixture.clone)) ?? '', /a clone stays on its default branch/)
  assert.match((await refusalOf(fixture, 'git switch -c mine', fixture.clone)) ?? '', /a clone stays on its default branch/)
  // git itself says `src/app.ts` is no branch of this clone, so the same command is a pathspec and passes.
  assert.equal(await refusalOf(fixture, 'git checkout src/app.ts', fixture.clone), undefined)
  // A call that runs in a worktree is not in a clone at all.
  assert.equal(await refusalOf(fixture, 'git checkout -b mine', fixture.worktree_of_member), undefined)
})

test("another member's worktree is refused for a removal and for a prune, and one's own passes", async (t) => {
  const fixture = aCrew(t)
  assert.match((await refusalOf(fixture, `git worktree remove ${fixture.worktree_of_other}`, fixture.worktrees)) ?? '', /is another member's branch/)
  assert.equal(await refusalOf(fixture, `git worktree remove ${fixture.worktree_of_member}`, fixture.worktrees), undefined)
  // A record whose directory is gone is what a prune takes, and it is another member's while it stands.
  removeTheTree(fixture.worktree_of_other)
  assert.match((await refusalOf(fixture, 'git worktree prune', fixture.clone)) ?? '', /is another member's branch/)
})

test("another member's branch is refused for a delete the shell writes, which needs no fact at all", async (t) => {
  const fixture = aCrew(t)
  assert.match((await refusalOf(fixture, `git branch -D ${fixture.branch_of_other}`, null)) ?? '', /is another member's branch/)
  assert.equal(await refusalOf(fixture, 'git branch -D hygiea/562', null), undefined)
})

test("a call that spells a place through a link meets the same rule", async (t) => {
  const fixture = aCrew(t)
  // A link to the worktree place, as a machine's temp or work place may be reached by one (martha#79): git answers with
  // the path it resolved, and the shell names the path through the link.
  const throughALink = join(fixture.clones, 'worktrees-link')
  symlinkSync(fixture.worktrees, throughALink)
  assert.match(
    (await refusalOf(fixture, `git worktree remove ${join(throughALink, 'widget-9')}`, fixture.worktrees)) ?? '',
    /is another member's branch/,
  )
  // The place itself, spelled through the link, is the same place: a clone in it is still a clone.
  const clonesThroughALink = join(fixture.worktrees, 'clones-link')
  symlinkSync(fixture.clones, clonesThroughALink)
  assert.match((await refusalOf(fixture, 'git checkout main', join(clonesThroughALink, 'acme', 'widget'))) ?? '', /a clone stays on its default branch/)
})

test('a call nowhere near a repository is asked nowhere, and refused by nothing it could not look at', async (t) => {
  const fixture = aCrew(t)
  // No directory: no clone to ask for its branches, so the branch rule cannot fire and the call goes through.
  assert.equal(await refusalOf(fixture, 'git checkout main', null), undefined)
  // A directory that is no repository: git fails there, every fact is empty, and the call goes through.
  assert.equal(await refusalOf(fixture, 'git checkout main', join(fixture.clones, 'acme')), undefined)
})
