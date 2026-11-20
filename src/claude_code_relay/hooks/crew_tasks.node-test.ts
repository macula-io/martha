// The host's own task list, folded as a session keeps it (martha#1000, gap 8 of #957).
//
// These are plain tests: the fold is the mod's own arithmetic, not a guard, so nothing here is proved by a planted bug
// (Raf's trims of 2026-11-20). Each case is one write the host's own tools make, and what a session's list says after it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  afterATaskWasCreated,
  afterATaskWasUpdated,
  afterAToDoListWasWritten,
  NO_TASKS,
  theTasksToPost,
  type TheTaskList,
} from './crew_tasks.ts'

test('a TaskCreate adds its task as pending, under the id the host gave it', () => {
  const list = afterATaskWasCreated(NO_TASKS, { id: '7', subject: 'write the tests' })
  assert.deepEqual(list, { '7': { subject: 'write the tests', status: 'pending' } }, 'the created task is not the one the host made')
})

test('a TaskCreate the host answered with no id moves nothing', () => {
  const held: TheTaskList = { '1': { subject: 'a task', status: 'pending' } }
  assert.deepEqual(afterATaskWasCreated(held, { id: '', subject: 'ghost' }), held, 'a create with no id was kept, and names a task no later write can reach')
})

test('a TaskUpdate moves one task, keeps what it does not name, and a deleted one is gone', () => {
  const held: TheTaskList = { '1': { subject: 'first', status: 'pending' }, '2': { subject: 'second', status: 'pending' } }
  const started = afterATaskWasUpdated(held, { task_id: '1', status: 'in_progress' })
  assert.deepEqual(started['1'], { subject: 'first', status: 'in_progress' }, 'a status-only update lost the task\'s words')
  assert.deepEqual(started['2'], held['2'], 'an update touched a task it did not name')
  const renamed = afterATaskWasUpdated(started, { task_id: '1', subject: 'first, renamed' })
  assert.deepEqual(renamed['1'], { subject: 'first, renamed', status: 'in_progress' }, 'a subject-only update lost the task\'s standing')
  assert.deepEqual(afterATaskWasUpdated(renamed, { task_id: '1', status: 'deleted' }), { '2': held['2'] }, 'a deleted task stayed in the list')
})

test('a TaskUpdate naming a status this host does not write keeps the standing the task held', () => {
  const held: TheTaskList = { '1': { subject: 'a task', status: 'in_progress' } }
  assert.equal(afterATaskWasUpdated(held, { task_id: '1', status: 'archived' })['1']?.status, 'in_progress', 'an unknown status overwrote the standing the row already read')
})

test('a TaskUpdate for a task the list does not hold is added, as the host says it is', () => {
  assert.deepEqual(afterATaskWasUpdated(NO_TASKS, { task_id: '9', subject: 'new work' }), { '9': { subject: 'new work', status: 'pending' } }, 'an update for an unknown id was dropped, so the row loses a task the host keeps')
})

test('a TodoWrite writes the whole list, each task under its place, with activeForm read before content', () => {
  const written = afterAToDoListWasWritten(NO_TASKS, [
    { content: 'the first thing', activeForm: 'doing the first thing', status: 'completed' },
    { content: 'the second thing', status: 'in_progress' },
    { status: 'pending' },
  ])
  assert.deepEqual(written, {
    '0': { subject: 'doing the first thing', status: 'completed' },
    '1': { subject: 'the second thing', status: 'in_progress' },
  }, 'the list a TodoWrite wrote is not the list the host made, or an entry with no words was kept')
})

test('a TodoWrite that is no list leaves the list the session held', () => {
  const held: TheTaskList = { '1': { subject: 'a task', status: 'pending' } }
  assert.deepEqual(afterAToDoListWasWritten(held, { todos: [] }), held, 'a write this fold cannot read emptied the list')
})

test('the list is posted in the order it keeps, each task by its words and standing', () => {
  const list: TheTaskList = { a: { subject: 'first', status: 'completed' }, b: { subject: 'second', status: 'in_progress' } }
  assert.deepEqual(theTasksToPost(list), [
    { subject: 'first', status: 'completed' },
    { subject: 'second', status: 'in_progress' },
  ], 'the posted list is not the list the session keeps, in its own order')
})
