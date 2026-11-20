// A commit that would ship what a killed run left (#693): judged on the bytes the index holds, never on the file.
//
// These run a real git in a temporary repository: the promise is that `git add -A` puts a mutant in the index, that the
// commit which would carry it prints one notice naming the file and still goes ahead (martha#601), and that staging the
// member's own bytes over it says nothing.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import type { CrewStore } from '../host_contract/host_contract.ts'
import { filesOnThisMachine, runAProcessOnThisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import type { AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theLeftoversRefusal, theRefusalOfTheCommit } from './judge_the_commit_a_member_is_about_to_make.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { keepTheLeftoverRecordOf, theLeftoverRecordOf, theReleasedPathsOf, theTellingOnTheNextStart } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'
import { releaseTheFilesAKilledRunLeft } from '../release_what_a_killed_run_left/release_what_a_killed_run_left.ts'
import { THE_RELEASE_ACT, theDigestOf, type WhatAKilledRunLeft } from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'

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

/** The answer, and everything written to the process's own error output while the commit is judged (martha#601). */
async function theNoticeWhile(act: () => Promise<string | undefined>): Promise<{ readonly answer: string | undefined; readonly notice: string }> {
  const written: string[] = []
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    return { answer: await act(), notice: written.join('') }
  } finally {
    process.stderr.write = original
  }
}

test('#601: a commit that would carry the mutant the index holds goes ahead, one line naming it and the release act', async (t) => {
  const checkout = aRepoWithAMutant(t)
  git(checkout, ['add', '-A'])
  const { answer, notice } = await theNoticeWhile(() => theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() }))
  assert.equal(answer, undefined, 'the commit was refused')
  assert.match(notice, /notice: this commit carries what a killed run left/, 'the commit went ahead without a notice')
  assert.ok(notice.includes(A_FILE))
  assert.ok(notice.includes(THE_RELEASE_ACT))
})

test('#601: the index is what is judged, so editing the file after staging it is still noticed', async (t) => {
  const checkout = aRepoWithAMutant(t)
  git(checkout, ['add', '-A'])
  writeFileSync(join(checkout, A_FILE), THE_MEMBERS_OWN)
  const { answer, notice } = await theNoticeWhile(() => theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() }))
  assert.equal(answer, undefined, 'the commit was refused')
  assert.match(notice, /notice: this commit carries what a killed run left/, 'the commit went ahead without a notice')
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
  const record = theRecordOf()
  const released = record.leftovers.map((one) => ({ path: one.path, digest: one.digest }))
  assert.equal(await theRefusalOfTheCommit({ processes, directory: checkout, record, released }), undefined)
  git(checkout, ['rm', '-q', '--cached', A_FILE])
  assert.equal(await theRefusalOfTheCommit({ processes, directory: checkout, record: theRecordOf() }), undefined)
})

test('#693: a call with no directory, or a directory git will not answer in, refuses nothing', async () => {
  assert.equal(await theRefusalOfTheCommit({ processes, directory: null, record: theRecordOf() }), undefined)
  assert.equal(await theRefusalOfTheCommit({ processes, directory: join(tmpdir(), 'no-checkout-of-ours-at-all'), record: theRecordOf() }), undefined)
})

// The two ordinary ways a member commits a mutant, judged through the shell line's own calls (#693 r=2). The index is
// empty at that moment — the line has not run — so what catches these is the working tree's own bytes, read through the
// file port, on the paths the record holds as leftovers.

/** A crew store over a directory of the test's own, holding this member's record. */
const aCrewHoldingTheRecord = (t: TestContext): CrewStore => {
  const crew = keepTheCrewsFilesAsDirectories(scratch(t))
  assert.equal(keepTheLeftoverRecordOf(crew, theRecordOf()), undefined)
  return crew
}

/** The git calls a line makes, as the reader hands them to the guard: the command word and the words after it. */
const aCall = (command: string, args: readonly string[], directory: string): AGitCall => ({ options: [], command, args, directory })

const refusedSoFar = async (t: TestContext, calls: readonly AGitCall[]): Promise<string | undefined> => {
  const crew = aCrewHoldingTheRecord(t)
  return theLeftoversRefusal({ calls, processes, leftovers: crew, files: filesOnThisMachine, member: THE_MEMBER })
}

test('#601: git add -A && git commit -m x goes ahead with a notice, though nothing is staged when the line is judged', async (t) => {
  const checkout = aRepoWithAMutant(t)
  const calls = [aCall('add', ['-A'], checkout), aCall('commit', ['-m', 'x'], checkout)]
  const { answer, notice } = await theNoticeWhile(() => refusedSoFar(t, calls))
  assert.equal(answer, undefined, 'the commit was refused')
  assert.match(notice, /notice: this commit carries what a killed run left/, 'the mutant in the working tree was not noticed')
  assert.ok(notice.includes(A_FILE))
  assert.ok(notice.includes(THE_RELEASE_ACT))
})

test('#601: git commit -am x goes ahead with a notice, though nothing is staged when the line is judged', async (t) => {
  const checkout = aRepoWithAMutant(t)
  const { answer, notice } = await theNoticeWhile(() => refusedSoFar(t, [aCall('commit', ['-am', 'x'], checkout)]))
  assert.equal(answer, undefined, 'the commit was refused')
  assert.match(notice, /notice: this commit carries what a killed run left/, 'the mutant commit -a carries was not noticed')
  assert.ok(notice.includes(A_FILE))
})

test('#693 r=2: a plain git commit -m x carries only the index, so a mutant in the working tree is not refused', async (t) => {
  const checkout = aRepoWithAMutant(t)
  assert.equal(await refusedSoFar(t, [aCall('commit', ['-m', 'x'], checkout)]), undefined)
})

test('#693 r=2: the member\'s own edit to that path is not refused, even though an add would stage it', async (t) => {
  const checkout = aRepoWithAMutant(t)
  writeFileSync(join(checkout, A_FILE), THE_MEMBERS_OWN)
  assert.equal(await refusedSoFar(t, [aCall('add', ['-A'], checkout), aCall('commit', ['-m', 'x'], checkout)]), undefined)
})

// R2's way out: the release act, and the pin the design named — a leftover that really is the member's own edit is
// committed unrefused once the member has released it.

test('#601: a leftover with no release is noticed, and the same one after the release act says nothing', async (t) => {
  const checkout = aRepoWithAMutant(t)
  const crew = aCrewHoldingTheRecord(t)
  const calls = [aCall('add', ['-A'], checkout), aCall('commit', ['-m', 'x'], checkout)]
  const { answer, notice } = await theNoticeWhile(() => theLeftoversRefusal({ calls, processes, leftovers: crew, files: filesOnThisMachine, member: THE_MEMBER }))
  assert.equal(answer, undefined, 'the commit was refused')
  assert.match(notice, /notice: this commit carries what a killed run left/, 'the leftover was not noticed')
  const told = releaseTheFilesAKilledRunLeft({ crew, member: THE_MEMBER, paths: [A_FILE] })
  assert.ok('answer' in told, JSON.stringify(told))
  assert.equal(await theLeftoversRefusal({ calls, processes, leftovers: crew, files: filesOnThisMachine, member: THE_MEMBER }), undefined)
})

test('#693 r=2: a release of a path no record holds is refused, and the path is not kept', async (t) => {
  const crew = aCrewHoldingTheRecord(t)
  const told = releaseTheFilesAKilledRunLeft({ crew, member: THE_MEMBER, paths: ['src/not_ours.ts'] })
  assert.ok('refused' in told, JSON.stringify(told))
  assert.deepEqual(theReleasedPathsOf(crew, THE_MEMBER), [])
})

test('#693 r=3 R5: the act keeps the digest of the bytes it released, not only the path', (t) => {
  const crew = aCrewHoldingTheRecord(t)
  const kept = theLeftoverRecordOf(crew, THE_MEMBER)
  assert.ok(kept !== undefined && !('refusal' in kept) && !('unreadable' in kept), 'the record the act reads is kept')
  releaseTheFilesAKilledRunLeft({ crew, member: THE_MEMBER, paths: [A_FILE] })
  const standing = kept.record.leftovers.filter((one) => one.path === A_FILE).map((one) => one.digest)
  assert.deepEqual(theReleasedPathsOf(crew, THE_MEMBER).map((one) => one.digest), standing)
})

test('#693 r=2: the telling leaves a released path out, and still names the ones that stand', async (t) => {
  const crew = aCrewHoldingTheRecord(t)
  releaseTheFilesAKilledRunLeft({ crew, member: THE_MEMBER, paths: [A_FILE] })
  const telling = theTellingOnTheNextStart({ crew, member: THE_MEMBER, now_ms: 1_794_998_500_000 }).telling ?? ''
  assert.ok(telling.includes('cut short'), 'the run is still told: a released file does not mean nothing was killed')
  assert.ok(!telling.includes(A_FILE), 'the released path is left out of the telling')
})
