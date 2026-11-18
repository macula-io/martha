import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  NAMED_IN_A_TELLING,
  nothingWasLeft,
  theCommandsOf,
  theDigestOf,
  theKeptText,
  theRecordIn,
  theRefusalOfACommit,
  theTellingOf,
  type WhatAKilledRunLeft,
} from './tell_a_member_what_its_relaunch_killed.ts'

/** A record, with whatever this test wants different about it. */
const aRecord = (different: Partial<WhatAKilledRunLeft> = {}): WhatAKilledRunLeft => ({
  member: 'a_member',
  at_ms: 1794998400000,
  running: [],
  leftovers: [],
  ...different,
})

const aLeftover = { path: 'src/a_slice/a_file.ts', digest: 'a7f3' }

test('a record that left nothing says nothing', () => {
  assert.equal(nothingWasLeft(aRecord()), true)
  assert.equal(theTellingOf(aRecord()), undefined)
})

test('the telling names the commands that were running and the files that differed', () => {
  const told = theTellingOf(
    aRecord({ running: [{ command_line: 'node run_the_mutants.mjs src/' }], leftovers: [aLeftover] }),
  )
  assert.ok(told !== undefined)
  assert.match(told, /node run_the_mutants\.mjs src\//)
  assert.match(told, /src\/a_slice\/a_file\.ts/)
  assert.match(told, /was cut short/)
})

test('a file in a worktree is told with its worktree, so two trees with one path cannot be confused', () => {
  const told = theTellingOf(aRecord({ leftovers: [{ ...aLeftover, worktree: '/work/worktrees/a' }] }))
  assert.ok(told !== undefined)
  assert.match(told, /\/work\/worktrees\/a: src\/a_slice\/a_file\.ts/)
})

test(`the telling names ${NAMED_IN_A_TELLING} and counts the rest, so a long list is still read`, () => {
  const commands = Array.from({ length: NAMED_IN_A_TELLING + 2 }, (_, at) => ({ command_line: `cmd_${at}` }))
  const told = theTellingOf(aRecord({ running: commands }))
  assert.ok(told !== undefined)
  assert.match(told, new RegExp(`cmd_0, .*cmd_${NAMED_IN_A_TELLING - 1}`))
  assert.doesNotMatch(told, new RegExp(`cmd_${NAMED_IN_A_TELLING}\\b`))
  assert.match(told, /and 2 more/)
})

test('a command listed twice is told once', () => {
  assert.deepEqual(
    theCommandsOf(aRecord({ running: [{ command_line: 'same' }, { command_line: 'same' }] })),
    ['same'],
  )
})

test('commands that could not be read are told as such, never as "nothing was running"', () => {
  const told = theTellingOf(aRecord({ running_unreadable: 'this kernel has no /proc' }))
  assert.ok(told !== undefined)
  assert.match(told, /could not be read \(this kernel has no \/proc\)/)
})

test('files that could not be read are told as such too', () => {
  const told = theTellingOf(aRecord({ leftovers_unreadable: 'no worktree could be asked' }))
  assert.ok(told !== undefined)
  assert.match(told, /could not be read/)
})

test('a commit carrying the recorded bytes is refused, by path and by the command that was running', () => {
  const record = aRecord({ running: [{ command_line: 'node run_the_mutants.mjs' }], leftovers: [aLeftover] })
  const refused = theRefusalOfACommit(record, [{ path: aLeftover.path, digest: aLeftover.digest }])
  assert.ok(refused !== undefined)
  assert.match(refused, /this commit carries what a killed run left: src\/a_slice\/a_file\.ts/)
  assert.match(refused, /node run_the_mutants\.mjs/)
})

test('a file edited again after the kill has other bytes and is committed', () => {
  const record = aRecord({ leftovers: [aLeftover] })
  assert.equal(theRefusalOfACommit(record, [{ path: aLeftover.path, digest: 'other' }]), undefined)
})

test('a commit that carries nothing recorded is not looked at', () => {
  const record = aRecord({ leftovers: [aLeftover] })
  assert.equal(theRefusalOfACommit(record, [{ path: 'src/elsewhere/another.ts', digest: aLeftover.digest }]), undefined)
})

test('two worktrees holding one path are told apart by the worktree', () => {
  const record = aRecord({ leftovers: [{ ...aLeftover, worktree: 'one' }] })
  assert.equal(theRefusalOfACommit(record, [{ path: aLeftover.path, worktree: 'two', digest: aLeftover.digest }]), undefined)
  assert.ok(theRefusalOfACommit(record, [{ path: aLeftover.path, worktree: 'one', digest: aLeftover.digest }]) !== undefined)
})

test('a record read back is the record that was kept', () => {
  const record = aRecord({
    running: [{ command_line: 'node x.mjs' }],
    leftovers: [aLeftover],
    running_unreadable: 'why not',
  })
  assert.deepEqual(theRecordIn(theKeptText(record)), { record })
})

test('a record that does not parse is unreadable, which is not the same as empty', () => {
  const read = theRecordIn('{ not json')
  assert.ok('unreadable' in read)
  assert.equal(nothingWasLeft({ member: 'x', at_ms: 0, running: [], leftovers: [] }), true)
})

test('a record of another shape is unreadable, never read as "nothing was left"', () => {
  for (const text of [
    '{"member":"x"}',
    '{"member":"x","at_ms":"soon","running":[],"leftovers":[]}',
    '{"member":"x","at_ms":1,"running":[{"nope":1}],"leftovers":[]}',
    '{"member":"x","at_ms":1,"running":[],"leftovers":[{"path":"p"}]}',
    '{"member":"x","at_ms":1,"running":[],"leftovers":[],"running_unreadable":7}',
    'null',
  ]) {
    const read = theRecordIn(text)
    assert.ok('unreadable' in read, `${text} was read as a record`)
  }
})

test('the digest is taken over the bytes, so the same bytes always answer the same', () => {
  const bytes = new TextEncoder().encode('if (false) return\n')
  assert.equal(theDigestOf(bytes), theDigestOf(new TextEncoder().encode('if (false) return\n')))
  assert.notEqual(theDigestOf(bytes), theDigestOf(new TextEncoder().encode('if (true) return\n')))
})
