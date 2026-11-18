// What the workspace guard refuses of a tool call a member's host reports (martha#562, seam a).
//
// The relay answers before the tool runs, so the only directory a call has is the one its own line names: `cd` first,
// or `-C`. Every test here asks real git, through a host that really runs it, so what is pinned is the answer the relay
// hands on and not a stand-in's.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import type { HostContract } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { refuseAGitCallInAMembersShell } from './refuse_a_git_call_in_a_members_shell.ts'

/** The member making the call, and the one whose branch is not theirs to delete. */
const MEMBER = 'Hygiea'
const OTHER = 'Uranus'

/** A clone of one repository under the crew's clone place, and the worktree place beside it. */
interface Fixture {
  readonly clones: string
  readonly worktrees: string
  readonly clone: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()

/** A crew's places and a clone under them, in a directory the test removes. */
function aWorkspace(t: TestContext): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-562-seam-a-')))
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
  gitIn(seed, 'add', '-A')
  gitIn(seed, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  gitIn(clones, 'clone', '--quiet', origin, join('acme', 'widget'))
  return { clones, worktrees, clone: join(clones, 'acme', 'widget') }
}

/** A host whose processes.run really runs the command, in the directory it is given. */
const aHostThatRunsGit = (): Pick<HostContract, 'processes'> => ({
  processes: hostForTests({
    run: async (request) => {
      const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
      return { exit_code: outcome.error === undefined ? outcome.status : null, stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' }
    },
  }).host.processes,
})

/** The crew's places, as the declaration hands them to the guard. */
const workspaceOf = (fixture: Fixture): TheWorkspace => ({ clones: fixture.clones, worktrees: fixture.worktrees, members: [MEMBER, OTHER, 'Supervisor'] })

/** The refusal of one shell line, or of a call that is no shell. */
async function refusalOf(fixture: Fixture, tool: string, input: Readonly<Record<string, unknown>>): Promise<string | undefined> {
  return refuseAGitCallInAMembersShell({ host: aHostThatRunsGit(), workspace: workspaceOf(fixture), member: MEMBER, tool, input })
}

test('a shell line that names its directory and moves a clone off its branch is refused', async (t) => {
  const fixture = aWorkspace(t)
  // A branch the clone has that is not the one it starts on: the switch the rule is about.
  gitIn(fixture.clone, 'branch', 'feature/widget')
  assert.match(
    (await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: `cd ${fixture.clone} && git checkout feature/widget` })) ?? '',
    /a clone stays on its default branch/,
  )
  // A switch back to the branch the clone starts on is the call that puts a drifted clone right, and passes (martha#584).
  assert.equal(await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: `cd ${fixture.clone} && git checkout main` }), undefined)
  // The same line, with no directory named, is asked nowhere and passes: the relay does not know where the shell runs.
  assert.equal(await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: 'git checkout main' }), undefined)
})

test("another member's branch is refused even with no directory, because that rule needs no fact at all", async (t) => {
  const fixture = aWorkspace(t)
  assert.match((await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: `git branch -D ${OTHER.toLowerCase()}/9` })) ?? '', /is another member's branch/)
  assert.equal(await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: 'git branch -D hygiea/562' }), undefined)
  assert.equal(await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: 'git status' }), undefined)
})

test('a call that is no shell, or a shell line that names no git, is judged by nothing', async (t) => {
  const fixture = aWorkspace(t)
  assert.equal(await refusalOf(fixture, 'Read', { command: `cd ${fixture.clone} && git checkout main` }), undefined)
  assert.equal(await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, { command: 'ls -la' }), undefined)
  assert.equal(await refusalOf(fixture, CLAUDE_CODE_SHELL_TOOL, {}), undefined)
})
