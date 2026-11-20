// Asking git how far a read's clone is behind (martha#969, gap 9 of #957).
//
// Every test works on a throwaway repository it makes for itself: a bare origin, a clone under the crew's clone place,
// and a worktree of it under the crew's worktree place. The adapter runs real git through the host contract's
// processes.run and reads the real FETCH_HEADs, so what is pinned is what git and the disk say.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { STALE_FETCH_MS } from '../note_a_read_in_a_stale_clone/note_a_read_in_a_stale_clone.ts'
import { HELD_FACTS_MS, staleReadsOver } from './ask_git_how_far_a_clone_is_behind.ts'

const SESSION = 'the-session'

interface Fixture {
  readonly clones: string
  readonly worktrees: string
  readonly clone: string
  readonly seed: string
  readonly worktree: string
}

const gitIn = (cwd: string, ...args: readonly string[]): string => execFileSync('git', [...args], { cwd, encoding: 'utf8' }).trim()

const commitIn = (cwd: string, message: string): void => {
  writeFileSync(join(cwd, `${message.replaceAll(' ', '-')}.md`), `${message}\n`)
  gitIn(cwd, 'add', '-A')
  gitIn(cwd, '-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', message)
}

/** A clone of one repository under the clone place, never fetched since it was cloned, and one worktree of it. */
function aCrew(t: TestContext): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'martha-969-'))
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
  commitIn(seed, 'the first commit')
  gitIn(seed, 'remote', 'add', 'origin', origin)
  gitIn(seed, 'push', '--quiet', '-u', 'origin', 'main')
  gitIn(clones, 'clone', '--quiet', origin, join('acme', 'widget'))
  const clone = join(clones, 'acme', 'widget')
  const worktree = join(worktrees, 'widget-969')
  gitIn(clone, 'worktree', 'add', '--quiet', '-b', 'venus/969', worktree)
  return { clones, worktrees, clone, seed, worktree }
}

/** origin moves on by `count` commits, and the clone hears of it by a fetch it runs itself, without moving its branch. */
function originMovesOnAndTheCloneFetches(fixture: Fixture, count: number): void {
  for (let n = 0; n < count; n += 1) commitIn(fixture.seed, `a later commit ${n}`)
  gitIn(fixture.seed, 'push', '--quiet', 'origin', 'main')
  gitIn(fixture.clone, 'fetch', '--quiet')
}

/** The adapter over a fixture, on a clock the test moves. */
function readsOver(fixture: Fixture, clock: { now: number }) {
  return staleReadsOver({ host: thisMachine, places: { clones: fixture.clones, worktrees: fixture.worktrees }, now: () => clock.now })
}

test('#969: a read in a clone behind its origin is told how far, from git\'s own count and the fetch it ran', async (t) => {
  const fixture = aCrew(t)
  originMovesOnAndTheCloneFetches(fixture, 2)
  const reads = readsOver(fixture, { now: Date.now() })
  reads.aTurnStarted(SESSION)
  const note = await reads.theNoteForARead(SESSION, join(fixture.clone, 'the-first-commit.md'))
  assert.match(note, new RegExp(`^note: the clone ${fixture.clone} is 2 commits behind origin/main as of the last fetch \\(0 minutes ago\\), `))
})

test('#969: a clone never fetched since it was cloned is told so, and a fetch in one of its worktrees counts as its fetch', async (t) => {
  const fixture = aCrew(t)
  const reads = readsOver(fixture, { now: Date.now() })
  reads.aTurnStarted(SESSION)
  assert.match(await reads.theNoteForARead(SESSION, fixture.clone), / has never been fetched, /)
  // A fetch in a worktree moves the shared refs and writes the worktree's own FETCH_HEAD, never the clone's.
  gitIn(fixture.worktree, 'fetch', '--quiet')
  const later = readsOver(fixture, { now: Date.now() })
  later.aTurnStarted(SESSION)
  assert.equal(await later.theNoteForARead(SESSION, fixture.clone), '', 'a clone a worktree just fetched is told it was never fetched')
})

test('#969: a current clone fetched within the hour, a worktree, and a place outside the clones are told nothing', async (t) => {
  const fixture = aCrew(t)
  originMovesOnAndTheCloneFetches(fixture, 0)
  const clock = { now: Date.now() }
  const reads = readsOver(fixture, clock)
  reads.aTurnStarted(SESSION)
  assert.equal(await reads.theNoteForARead(SESSION, fixture.clone), '')
  originMovesOnAndTheCloneFetches(fixture, 1)
  assert.equal(await reads.theNoteForARead(SESSION, join(fixture.worktree, 'the-first-commit.md')), '', 'a worktree behind its origin is told')
  assert.equal(await reads.theNoteForARead(SESSION, fixture.seed), '', 'a place outside the clones is told')
})

test('#969: the same clone is told once in a turn, and again in the next turn', async (t) => {
  const fixture = aCrew(t)
  originMovesOnAndTheCloneFetches(fixture, 1)
  const reads = readsOver(fixture, { now: Date.now() })
  reads.aTurnStarted(SESSION)
  assert.notEqual(await reads.theNoteForARead(SESSION, fixture.clone), '')
  assert.equal(await reads.theNoteForARead(SESSION, join(fixture.clone, 'the-first-commit.md')), '', 'a second read in the turn is told again')
  reads.aTurnStarted(SESSION)
  assert.notEqual(await reads.theNoteForARead(SESSION, fixture.clone), '', 'the next turn is not told')
})

test('#969: a clone\'s facts are held for a while, then asked of git again', async (t) => {
  const fixture = aCrew(t)
  originMovesOnAndTheCloneFetches(fixture, 0)
  const clock = { now: Date.now() }
  const reads = readsOver(fixture, clock)
  reads.aTurnStarted(SESSION)
  assert.equal(await reads.theNoteForARead(SESSION, fixture.clone), '')
  originMovesOnAndTheCloneFetches(fixture, 1)
  reads.aTurnStarted(SESSION)
  assert.equal(await reads.theNoteForARead(SESSION, fixture.clone), '', 'facts held under their time were asked again')
  clock.now += HELD_FACTS_MS
  assert.match(await reads.theNoteForARead(SESSION, fixture.clone), / is 1 commit behind /)
  assert.ok(HELD_FACTS_MS < STALE_FETCH_MS)
})

test('#969: a directory under the clones that is no repository is told nothing, and the read is not refused', async (t) => {
  const fixture = aCrew(t)
  const plain = join(fixture.clones, 'acme', 'plain')
  mkdirSync(plain)
  const reads = readsOver(fixture, { now: Date.now() })
  reads.aTurnStarted(SESSION)
  assert.equal(await reads.theNoteForARead(SESSION, join(plain, 'a.md')), '')
})
