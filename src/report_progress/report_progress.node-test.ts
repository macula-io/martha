// What a progress report records, and what it only tells the member (martha#254 tests 4, 5, 6 and 14).
//
// The report is the member's own word about itself: these tests pin the bounds it is kept to, and the two rules that
// make a wait worth reading — a wait on a person says what for, and a name nobody has is shown, not hidden.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { REPORT_PROGRESS_DESCRIPTION, TASK_CHARACTERS, takeProgress, cutTask, type TheCrew } from './report_progress.ts'

const CREW: TheCrew = { owner: 'raf', members: ['Vesta', 'Uranus'] }
const NO_WAIT_BEFORE = { waits: null, holds: '' }
const NOW = 1_762_900_000_000

test('a report lands step and of clamped into the bound it names, and a task cut to its limit (test 4)', () => {
  const too_far = takeProgress({ task: 'Build the crew store', step: 9, of: 4 }, CREW, NO_WAIT_BEFORE, NOW)
  assert.deepEqual(too_far.taken.progress, { step: 4, of: 4 }, 'a step past the total is kept at the total')
  assert.match(too_far.told, /between 0 and 4/, 'the member is told what happened to its step')

  const below = takeProgress({ task: 'Build the crew store', step: -3, of: 0 }, CREW, NO_WAIT_BEFORE, NOW)
  assert.deepEqual(below.taken.progress, { step: 0, of: 1 }, 'a total below one is one, and a step below zero is zero')

  const long = 'a task that goes on and on and on, past the number of characters a task is kept to, and then further still'
  const cut = takeProgress({ task: long, step: 1, of: 2 }, CREW, NO_WAIT_BEFORE, NOW)
  assert.ok(cut.taken.task.length <= TASK_CHARACTERS, `the task is kept to ${TASK_CHARACTERS} characters (${cut.taken.task.length})`)
  assert.equal(cutTask(long), cut.taken.task, 'the cut the test reads is the cut the slice makes')
  assert.match(cut.told, new RegExp(`cut to ${TASK_CHARACTERS} characters`), 'and the member is told')
})

test('a wait on a person with no waiting_for is not recorded, the member is told, and the row keeps its wait (test 5)', () => {
  const held = { on: 'Supervisor', for: 'a verdict', since: NOW - 60_000 }
  const reported = takeProgress({ task: 'Build the crew store', step: 1, of: 3, waiting_on: 'Supervisor' }, CREW, { waits: held, holds: '' }, NOW)

  assert.deepEqual(reported.taken.waits, held, 'the wait the row had is the wait it keeps')
  assert.equal(reported.taken.state, 'waiting', 'and the row still reads as waiting on it')
  assert.match(reported.told, /Not recorded: a wait on Supervisor says what it waits for/, 'the member is told why, and how to say it')

  const withFor = takeProgress({ task: 'Build the crew store', step: 1, of: 3, waiting_on: 'Uranus', waiting_for: 'a review' }, CREW, NO_WAIT_BEFORE, NOW)
  assert.deepEqual(withFor.taken.waits, { on: 'Uranus', for: 'a review', since: NOW }, 'a person waited on, and what for, is recorded')

  const cleared = takeProgress({ task: 'Build the crew store', step: 2, of: 3 }, CREW, { waits: held, holds: '' }, NOW)
  assert.equal(cleared.taken.waits, null, 'a report that names no wait clears the one the row had')
})

test('a report naming a name nobody on the crew has is recorded, with a warning naming it (test 6)', () => {
  const reported = takeProgress({ task: 'Build the crew store', step: 1, of: 2, waiting_on: 'Mercurius', waiting_for: 'a review' }, CREW, NO_WAIT_BEFORE, NOW)

  assert.deepEqual(reported.taken.waits, { on: 'Mercurius', for: 'a review', since: NOW }, 'the wait is recorded as the member gave it')
  assert.match(reported.told, /nobody on this crew is named "Mercurius"/, 'and the member is shown the name it used')
})

test('the tool description quotes the limit, and a task is cut at exactly that many characters (test 14)', () => {
  assert.ok(REPORT_PROGRESS_DESCRIPTION.includes(`kept to ${TASK_CHARACTERS} characters`), 'the description quotes the constant, not a number of its own')
  const oneWordTooLong = 'x'.repeat(TASK_CHARACTERS + 40)
  assert.equal(cutTask(oneWordTooLong).length, TASK_CHARACTERS, 'words with no space between them are cut at the limit itself')
  assert.equal(cutTask('x'.repeat(TASK_CHARACTERS)).length, TASK_CHARACTERS, 'a task at the limit is kept whole')
})
