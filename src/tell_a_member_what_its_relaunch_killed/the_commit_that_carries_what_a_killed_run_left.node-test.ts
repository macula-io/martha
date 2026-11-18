// A commit that would ship what a killed run left (#693): judged on the bytes the index holds, never on the file.
//
// These run a real git in a temporary repository: the promise is that `git add -A` puts a mutant in the index, that the
// commit which would carry it is refused, and that staging the member's own bytes over it lets the commit through.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { runAProcessOnThisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theRefusalOfTheCommit } from './the_commit_that_carries_what_a_killed_run_left.ts'
import { THE_RELEASE_ACT, theDigestOf, type WhatAKilledRunLeft } from './tell_a_member_what_its_relaunch_killed.ts'

const THE_MEMBER = 'Proteus'
const A_FILE = 'src/a_file.ts'
const THE_COMMITTED = 'what was committed\n'
const THE_MUTANT = 'if (false) return\n'
const THE_MEMBERS_OWN = 'what the member meant to commit\n'

const processes = { run: runAProcessOnThisMachine }

const scratch = (t: TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-a-commit-'))
  t.after(() => removeTheTree(dir))
  return dir
}

/** One git run in `where`, refused verbosely when the test's own setup failed. */
const git = (where: string, args: readonly string[]): void => {
  const run = spawnSync('git', [...args], { cwd: where, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')} failed: ${run.stderr}`)
}

/** A repository with one committed file, which a killed command then overwrites with its mutant. */
const aRepoWithAMutant = (t: TestContext): string => {
  const checkout = scratch(t)
  mkdirSync(join(checkout, 'src'))
  git(checkout, ['init', '-q', '-b', 'main'])
  writeFileSync(join(checkout, A_FILE), THE_COMMITTED)
  git(checkout, ['add', A_FILE])
  git(checkout, ['-c', 'user.email=a@example.invalid', '-c', 'user.name=a-test', 'commit', '-q', '-m', 'a start'])
  writeFileSync(join(checkout, A_FILE), THE_MUTANT)
  return checkout
}

/** The record a launch end kept of that mutant: the file, at the digest the killed command left. */
const theRecordOf = (): WhatAKilledRunLeft => ({
  member: THE_MEMBER,
  at_ms: 1_794_998_400_000,
  running: [{ command_line: 'node --test a_runner.mjs', started_at_ms: 1_794_998_340_000 }],
  dirty: [{ path: A_FILE, digest: theDigestOf(new TextEncoder().encode(THE_MUTANT)) }],
  leftovers: [
    {
      path: A_FILE,
      digest: theDigestOf(new TextEncoder().encode(THE_MUTANT)),
      mtime_ms: 1_794_998_399_000,
      command_line: 'node --test a_runner.mjs',
      started_at_ms: 1_794_998_340_000,
    },
  ],
  dropped: { commands: 0, files: 0, leftovers: 0 },
})

test('#693: a commit that would carry the mutant the index holds is refused, and names the release act', async (t) => {
  const checkout = aRepoWithAMutant(t)
  git(checkout, ['add', '-A'])
  const refused = await theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() })
  assert.ok(refused !== undefined)
  assert.ok(refused.includes(A_FILE))
  assert.ok(refused.includes(THE_RELEASE_ACT))
})

test('#693: the index is what is judged, so editing the file after staging it does not let the commit through', async (t) => {
  const checkout = aRepoWithAMutant(t)
  git(checkout, ['add', '-A'])
  writeFileSync(join(checkout, A_FILE), THE_MEMBERS_OWN)
  const refused = await theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() })
  assert.ok(refused !== undefined)
})

test('#693: the member\'s own bytes, staged over the mutant, are the ones committed, and nothing is refused', async (t) => {
  const checkout = aRepoWithAMutant(t)
  writeFileSync(join(checkout, A_FILE), THE_MEMBERS_OWN)
  git(checkout, ['add', '-A'])
  assert.equal(await theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() }), undefined)
})

test('#693: a path the member released is not refused, and a deletion in the index has nothing to digest', async (t) => {
  const checkout = aRepoWithAMutant(t)
  git(checkout, ['add', '-A'])
  assert.equal(await theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf(), released: [{ path: A_FILE }] }), undefined)
  git(checkout, ['rm', '-q', '--cached', A_FILE])
  assert.equal(await theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() }), undefined)
})

test('#693: a call with no directory, or a directory git will not answer in, refuses nothing', async () => {
  assert.equal(await theRefusalOfTheCommit({ processes, directory: null, record: theRecordOf() }), undefined)
  assert.equal(await theRefusalOfTheCommit({ processes, directory: join(tmpdir(), 'no-checkout-of-ours-at-all'), record: theRecordOf() }), undefined)
})
