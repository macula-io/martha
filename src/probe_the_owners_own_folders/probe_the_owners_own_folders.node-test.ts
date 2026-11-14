// The rows about the owner's own folders, held to the two rules every probe:launch row keeps (martha#443): an
// absence is claimed only beside a proof that the host ran (#188), and no row starts the model with one turn (#223).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { absencesWithoutAHostProof } from '../probe_launch_hosts/an_absence_row_proves_the_host_ran.ts'
import { rowsWithoutRoomToFinish } from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { OWNER_SCOPE_PROBES, SYNCED_PROBES, TRASH_PROBE } from './probe_the_owners_own_folders.ts'

const ROWS = [TRASH_PROBE, ...SYNCED_PROBES, ...OWNER_SCOPE_PROBES]

test('every row about the owner\'s own folders claims an absence only beside a proof that the host ran (#188, martha#443)', () => {
  for (const rows of [SYNCED_PROBES, OWNER_SCOPE_PROBES]) assert.notDeepEqual(rows, [], 'the rows are read')
  assert.deepEqual(absencesWithoutAHostProof(ROWS), [])
})

test('no row about the owner\'s own folders asks the model to answer in one turn (martha#223, martha#443)', () => {
  assert.deepEqual(rowsWithoutRoomToFinish(ROWS), [])
})
