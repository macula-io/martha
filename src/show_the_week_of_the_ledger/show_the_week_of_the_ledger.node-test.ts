// The words `martha week` is used with (martha#308): no week, or exactly one named, and never a switch. The figures are
// ../a_week_of_the_ledger's; this pins only what the command's own parser takes.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { weekOf } from './show_the_week_of_the_ledger.ts'

const WEEK = 'week'

test('week is taken alone, or with one week named, and no other way', () => {
  assert.deepEqual(weekOf(WEEK, [WEEK]), { act: WEEK, args: [] }, 'no week named is a way the command is used')
  assert.deepEqual(weekOf(WEEK, [WEEK, '2026-W47']), { act: WEEK, args: ['2026-W47'] }, 'one week named is a way the command is used')
  assert.equal(weekOf(WEEK, [WEEK, '2026-W47', 'extra']), undefined, 'a second word after the week was taken')
  assert.equal(weekOf(WEEK, [WEEK, '']), undefined, 'an empty word was taken as a week')
  assert.equal(weekOf(WEEK, [WEEK, '--wat']), undefined, 'a switch was taken as a week')
})
