import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { theRecordAtTheEnd, type AnEnd } from './the_facts_at_an_end.ts'
import { theDigestOf, theRefusalOfACommit, type WhatAKilledRunLeft } from './tell_a_member_what_its_relaunch_killed.ts'

const ENDED_AT = 1_794_998_400_000
const STARTED_AT = ENDED_AT - MINUTE_MS
const THE_TREE = '/work/a-tree'
const OTHER_TREE = '/work/another-tree'
const A_FILE = 'src/a_slice/a_file.ts'

/** The bytes a test's file holds, and the digest of them. */
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

/** An end over one tree holding one file written by the killed command, unless a test says otherwise. */
const anEnd = (different: Partial<AnEnd> = {}): AnEnd => ({
  member: 'a_member',
  at_ms: ENDED_AT,
  group: 4_242,
  trees: [THE_TREE],
  processes: {
    commandsIn: () => ({ commands: [{ pid: 11, command_line: 'node --test a_runner.mjs', start_ticks: '900' }] }),
    isTheLaunchesOwn: () => false,
  },
  tree_reads: {
    dirtyIn: () => ({ paths: [A_FILE] }),
    bytesIn: () => bytesOf('if (false) return\n'),
    modifiedIn: () => STARTED_AT + 1,
  },
  theStartMs: () => STARTED_AT,
  ...different,
})

test('a command the launch started is not the member\'s, and is not in the record', () => {
  const record = theRecordAtTheEnd(
    anEnd({
      processes: {
        commandsIn: () => ({
          commands: [
            { pid: 11, command_line: 'node --test a_runner.mjs', start_ticks: '900' },
            { pid: 12, command_line: 'martha-relay --serve', start_ticks: '890' },
          ],
        }),
        isTheLaunchesOwn: (one) => one.pid === 12,
      },
    }),
  )
  assert.deepEqual(record.running.map((one) => one.command_line), ['node --test a_runner.mjs'])
})

test('a command the machine cannot date leaves the list unreadable, and nothing is refused on it', () => {
  const record = theRecordAtTheEnd(anEnd({ theStartMs: () => null }))
  assert.ok(record.running_unreadable !== undefined)
  assert.deepEqual(record.leftovers, [])
  assert.equal(theRefusalOfACommit(record, [{ path: A_FILE, digest: theDigestOf(bytesOf('if (false) return\n')) }]), undefined)
})

test('a process list the kernel will not give is told as unreadable, and nothing is refused', () => {
  const record = theRecordAtTheEnd(anEnd({ processes: { commandsIn: () => ({ unreadable: 'this kernel has no /proc' }), isTheLaunchesOwn: () => false } }))
  assert.equal(record.running_unreadable, 'this kernel has no /proc')
  assert.deepEqual(record.leftovers, [])
})

test('a file written after its command started is recorded as what the killed run left, and the commit is refused', () => {
  const record = theRecordAtTheEnd(anEnd())
  assert.equal(record.leftovers.length, 1)
  assert.equal(record.leftovers[0]?.digest, theDigestOf(bytesOf('if (false) return\n')))
  assert.rejects
  assert.ok(theRefusalOfACommit(record, [{ path: A_FILE, digest: theDigestOf(bytesOf('if (false) return\n')) }]) !== undefined)
})

test('a file written before its command started is kept as dirty and told, and the commit is not refused', () => {
  const record = theRecordAtTheEnd(anEnd({ tree_reads: { ...anEnd().tree_reads, modifiedIn: () => STARTED_AT - 1 } }))
  assert.deepEqual(record.leftovers, [])
  assert.equal(record.dirty.length, 1)
})

test('a differing path whose bytes cannot be read is left out of both lists', () => {
  const record = theRecordAtTheEnd(anEnd({ tree_reads: { ...anEnd().tree_reads, bytesIn: () => undefined } }))
  assert.deepEqual(record.dirty, [])
  assert.deepEqual(record.leftovers, [])
})

test('two trees are told with their own names, and one tree needs none', () => {
  const one = theRecordAtTheEnd(anEnd())
  assert.equal(one.dirty[0]?.worktree, undefined)
  const two = theRecordAtTheEnd(anEnd({ trees: [THE_TREE, OTHER_TREE] }))
  assert.deepEqual(two.dirty.map((file) => file.worktree), [THE_TREE, OTHER_TREE])
})

test('a tree git will not answer for is told as unreadable, and the other tree is still read', () => {
  const record = theRecordAtTheEnd(
    anEnd({
      trees: [THE_TREE, OTHER_TREE],
      tree_reads: {
        ...anEnd().tree_reads,
        dirtyIn: (tree) => (tree === OTHER_TREE ? { unreadable: 'the tree is gone' } : { paths: [A_FILE] }),
      },
    }),
  )
  assert.equal(record.dirty_unreadable, 'the tree is gone')
  assert.equal(record.dirty.length, 1)
})

test('an end over a record whose leftover still holds its bytes carries it over (rule 5)', () => {
  const killed = theRecordAtTheEnd(anEnd())
  const later = theRecordAtTheEnd(
    anEnd({
      at_ms: ENDED_AT + MINUTE_MS,
      processes: { commandsIn: () => ({ commands: [] }), isTheLaunchesOwn: () => false },
      replaced: killed satisfies WhatAKilledRunLeft,
    }),
  )
  assert.equal(later.leftovers.length, 1)
  assert.ok(theRefusalOfACommit(later, [{ path: A_FILE, digest: theDigestOf(bytesOf('if (false) return\n')) }]) !== undefined)
})
