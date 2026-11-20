// The stale-clone read note (martha#969, gap 9 of #957): where a read lands, the count git prints, the note's words for
// each case, and once per clone per turn. Ported from crew-code's core/stale_clone.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE_MS as A_MINUTE_MS } from '../declare_crew/declare_crew.ts'
import {
  STALE_FETCH_MS,
  behindOf,
  staleCloneNote,
  theCloneAReadLandsIn,
  tellingOncePerTurn,
} from './note_a_read_in_a_stale_clone.ts'

const WORKSPACE = { clones: '/w/repos', worktrees: '/w/trees' }
const CLONE = '/w/repos/acme/widgets'
const NOW = 1_800_000_000_000

test('#969: a read in a clone lands in that clone', () => {
  assert.equal(theCloneAReadLandsIn(`${CLONE}/src/a.ts`, WORKSPACE), CLONE)
  assert.equal(theCloneAReadLandsIn(CLONE, WORKSPACE), CLONE)
})

test('#969: a read in a worktree, outside the clones, or above any one clone lands in no clone', () => {
  // Worktrees declared under the clones' place are still worktrees: being behind is what a worktree is for.
  const nested = { clones: '/w', worktrees: '/w/trees' }
  assert.equal(theCloneAReadLandsIn('/w/trees/widgets-12/src/a.ts', nested), null)
  assert.equal(theCloneAReadLandsIn('/w/trees/widgets-12/src/a.ts', WORKSPACE), null)
  assert.equal(theCloneAReadLandsIn('/elsewhere/notes.md', WORKSPACE), null)
  assert.equal(theCloneAReadLandsIn('/w/repos/acme', WORKSPACE), null)
  assert.equal(theCloneAReadLandsIn('/w/repos', WORKSPACE), null)
})

test('#969: the count is what git printed, and anything that is not a count is no count', () => {
  assert.equal(behindOf('7\n'), 7)
  assert.equal(behindOf('  0 '), 0)
  for (const said of ['', 'fatal: bad revision', '3 4', '-2', 'Fri Nov 20']) assert.equal(behindOf(said), 0, `${JSON.stringify(said)} is read as a count`)
})

test('#969: a clone behind its origin is told how far, as of when it was last fetched, and the fix', () => {
  const note = staleCloneNote({ dir: CLONE, branch: 'main', behind: 3, fetchedAt: NOW - 5 * A_MINUTE_MS, now: NOW })
  assert.equal(note, `note: the clone ${CLONE} is 3 commits behind origin/main as of the last fetch (5 minutes ago), so what you just read there may already be fixed upstream. Run git -C ${CLONE} fetch and read origin/main before you base a finding on it.`)
  assert.match(staleCloneNote({ dir: CLONE, branch: 'main', behind: 1, fetchedAt: null, now: NOW }), / is 1 commit behind origin\/main as far as anything here knows \(it has never been fetched\),/)
})

test('#969: a clone not behind is told only when its count cannot be trusted: never fetched, or fetched over an hour ago', () => {
  assert.equal(staleCloneNote({ dir: CLONE, branch: 'main', behind: 0, fetchedAt: NOW - STALE_FETCH_MS + 1, now: NOW }), '', 'a current clone fetched within the hour is told nothing')
  assert.equal(
    staleCloneNote({ dir: CLONE, branch: 'trunk', behind: 0, fetchedAt: NOW - 3 * STALE_FETCH_MS, now: NOW }),
    `note: the clone ${CLONE} was last fetched 3 hours ago, so what you just read there may already be fixed upstream on origin/trunk and nothing here knows by how far. Run git -C ${CLONE} fetch and read origin/trunk before you base a finding on it.`,
  )
  assert.match(staleCloneNote({ dir: CLONE, branch: 'main', behind: 0, fetchedAt: null, now: NOW }), /^note: the clone \S+ has never been fetched, so /)
})

test('#969: the age reads in minutes, then hours, then days', () => {
  const ageIn = (ms: number): string => /last fetched (.*) ago/.exec(staleCloneNote({ dir: CLONE, branch: 'main', behind: 0, fetchedAt: NOW - ms, now: NOW }))?.[1] ?? ''
  assert.equal(ageIn(119 * A_MINUTE_MS), '119 minutes')
  assert.equal(ageIn(120 * A_MINUTE_MS), '2 hours')
  assert.equal(ageIn(47 * 60 * A_MINUTE_MS), '47 hours')
  assert.equal(ageIn(49 * 60 * A_MINUTE_MS), '2 days')
})

test('#969: a clone is told once per turn per session, and again in the next turn', () => {
  const told = tellingOncePerTurn()
  told.aTurnStarted('s1')
  assert.equal(told.firstThisTurn('s1', CLONE), true)
  assert.equal(told.firstThisTurn('s1', CLONE), false, 'a second read in the same turn is told again')
  assert.equal(told.firstThisTurn('s1', '/w/repos/acme/other'), true, 'another clone is its own')
  assert.equal(told.firstThisTurn('s2', CLONE), true, 'another session is its own')
  told.aTurnStarted('s1')
  assert.equal(told.firstThisTurn('s1', CLONE), true, 'the next turn is not told')
})
