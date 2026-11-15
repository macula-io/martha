// What a run left behind, as the scan reads it (martha#472): every case here is a reading the kernel could give, handed
// in, so the rule is pinned without a process of the test's own. That a record a run really wrote is named when this
// machine's kernel is read is read_a_kernel_and_a_home/a_member_a_run_left_behind.node-test.ts's, which starts a child
// and runs the gate over the real /proc.

import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import type { MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { NOT_OURS } from '../read_a_kernel_and_a_home/launch_records_under_a_state_root.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../read_a_kernel_and_a_home/read_a_kernel_and_a_home.ts'
import { itFails, NOT_A_LAUNCH, theLinesOf, whatARunLeft, type RecordsOfAProject, type WhatTheScanReads } from './the_leftovers_a_run_left.ts'

const OWNERS_HOME = '/home/synthetic'
const RUN_HOME = '/tmp/martha-forgot'
const READERS_NAMESPACE = 'pid:[4026531836]'
const PROJECT = '/tmp/martha-forgot/.local/state/martha/2f1c'
const RECORDS = join(PROJECT, THE_PLACES_A_STATE_ROOT_KEEPS.records_place)

const record = (over: Partial<MemberLaunch> = {}): MemberLaunch => ({
  member_name: 'Jupiter',
  node_id: 'a'.repeat(64),
  pid: 4133978,
  process_started_at: '3f2a1b4c-0000-4000-8000-000000000000/230362097',
  pid_namespace: READERS_NAMESPACE,
  ...over,
})

/** The rows one project's records directory holds, as the store hands them back: each row under its own key. */
const rowsOf = (...launches: readonly MemberLaunch[]): readonly RecordsOfAProject[] => [
  { where: RECORDS, rows: launches.map((launch) => ({ key: launch.member_name, row: launch })) },
]

/** The kernel as one case needs it: one process, its environment and identity, and the records its home holds. */
function theKernel(over: Partial<WhatTheScanReads> & { readonly env?: Record<string, string> } = {}): WhatTheScanReads {
  const { env = { HOME: RUN_HOME }, ...rest } = over
  return {
    pids: [4133978],
    environmentOf: () => ({ env }),
    namespaceOf: () => READERS_NAMESPACE,
    ownPidOf: () => 4133978,
    identityOf: () => '3f2a1b4c-0000-4000-8000-000000000000/230362097',
    recordsUnder: () => ({ projects: rowsOf(record()) }),
    owners_home: OWNERS_HOME,
    readers_namespace: READERS_NAMESPACE,
    realPathOf: (path) => {
      try {
        return realpathSync(path)
      } catch {
        return null
      }
    },
    ...rest,
  }
}

test('a member running under a run\'s home is named by its name, its start time and its pid (martha#472)', () => {
  const found = whatARunLeft(theKernel())
  assert.deepEqual(theLinesOf(found), [
    'Jupiter started 3f2a1b4c-0000-4000-8000-000000000000/230362097 still runs (pid 4133978) under a home no session of yours uses: /tmp/martha-forgot',
  ])
  assert.equal(itFails(found[0]!), true)
})

test('a member under the owner\'s own home is the owner\'s crew and is never named (martha#472)', () => {
  const slash = whatARunLeft(theKernel({ env: { HOME: `${OWNERS_HOME}/` } }))
  assert.deepEqual(slash, [])
  // And the same home reached through a link is the same home.
  const home = mkdtempSync(join(tmpdir(), 'martha-472-home-'))
  try {
    const link = join(tmpdir(), `martha-472-link-${process.pid}`)
    symlinkSync(home, link)
    assert.deepEqual(whatARunLeft(theKernel({ env: { HOME: link }, owners_home: home })), [])
  } finally {
    removeTheTree(home)
  }
})

test('a pid that now belongs to another process is not the member the record names (martha#472)', () => {
  assert.deepEqual(whatARunLeft(theKernel({ identityOf: () => 'another-boot/1' })), [])
})

test('a member in another pid namespace is matched by the namespace and the pid it has there (martha#472)', () => {
  const inner = record({ pid_namespace: 'pid:[4026532111]', pid: 42 })
  const found = whatARunLeft(
    theKernel({
      namespaceOf: () => 'pid:[4026532111]',
      // The last NSpid entry is the pid inside the member's own namespace; the pid /proc shows is another.
      ownPidOf: () => 42,
      recordsUnder: () => ({ projects: rowsOf(inner) }),
    }),
  )
  assert.equal(found.length, 1)
  assert.equal(found[0]?.kind, 'left_behind')

  // The outer pid is what /proc shows; matching on it would name nothing.
  const wrong = whatARunLeft(theKernel({ namespaceOf: () => 'pid:[4026532111]', ownPidOf: () => 4133978, recordsUnder: () => ({ projects: rowsOf(inner) }) }))
  assert.deepEqual(wrong, [])
})

test('a record written before the namespace was kept binds only inside the reader\'s own namespace (martha#472)', () => {
  const older: MemberLaunch = { member_name: 'Jupiter', node_id: 'a'.repeat(64), pid: 4133978, process_started_at: '3f2a1b4c-0000-4000-8000-000000000000/230362097' }
  assert.equal(whatARunLeft(theKernel({ recordsUnder: () => ({ projects: rowsOf(older) }) })).length, 1)
  const elsewhere = whatARunLeft(theKernel({ namespaceOf: () => 'pid:[4026532111]', recordsUnder: () => ({ projects: rowsOf(older) }) }))
  assert.deepEqual(elsewhere, [], 'a bare pid from another namespace is not this process')
})

test('a records directory this reader cannot vouch for is a line, and fails the gate (martha#472)', () => {
  const found = whatARunLeft(theKernel({ recordsUnder: () => ({ cannot_tell: `${RECORDS} ${NOT_OURS}` }) }))
  assert.deepEqual(theLinesOf(found), [`cannot tell whether 4133978 outlives its run: ${RECORDS} ${NOT_OURS}`])
  assert.equal(itFails(found[0]!), true)
})

test('a records directory holding a row that is not a launch is a line, and fails the gate (martha#472)', () => {
  const found = whatARunLeft(theKernel({ recordsUnder: () => ({ projects: [{ where: RECORDS, rows: [{ key: 'Jupiter', row: { member_name: 'Jupiter' } }] }] }) }))
  assert.deepEqual(theLinesOf(found), [`cannot tell whether 4133978 outlives its run: ${RECORDS} ${NOT_A_LAUNCH}`])
  assert.equal(itFails(found[0]!), true)
})

test('a member is named from any project the home\'s state root holds (martha#472)', () => {
  const other: RecordsOfAProject = { where: '/tmp/martha-forgot/.local/state/martha/9a04/launches', rows: [] }
  const found = whatARunLeft(theKernel({ recordsUnder: () => ({ projects: [other, ...rowsOf(record())] }) }))
  assert.equal(found.length, 1, 'one project without records says nothing about the one that holds them')
  assert.equal(found[0]?.kind, 'left_behind')
})

test('a home whose state root holds no records names nobody (martha#472)', () => {
  assert.deepEqual(whatARunLeft(theKernel({ recordsUnder: () => ({ projects: [] }) })), [])
})

test('a process whose environment cannot be read is said and counted, and does not fail the gate (martha#472)', () => {
  const found = whatARunLeft(theKernel({ environmentOf: () => ({ cannot_tell: 'EACCES' }) }))
  assert.deepEqual(theLinesOf(found), ['process 4133978 could not be read (EACCES), so a member of yours cannot be ruled out among it'])
  assert.equal(itFails(found[0]!), false, 'an unreadable environment is evidence of nothing')
})

test('a process with no home is not placed, and nothing is said of it (martha#472)', () => {
  assert.deepEqual(whatARunLeft(theKernel({ env: {} })), [])
})
