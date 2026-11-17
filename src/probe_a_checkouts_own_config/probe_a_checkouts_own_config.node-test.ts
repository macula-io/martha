// The rows about a checkout's own config, held to the two rules every probe:launch row keeps (martha#443): an
// absence is claimed only beside a proof that the host ran (#188), and no row starts the model with one turn (#223).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { absencesWithoutAHostProof } from '../probe_launch_hosts/an_absence_row_proves_the_host_ran.ts'
import { rowsWithoutRoomToFinish } from '../declare_a_launch_probe/declare_a_launch_probe.ts'
import { PROBES } from './probe_a_checkouts_own_config.ts'

test('every row about a checkout\'s own config claims an absence only beside a proof that the host ran (#188, martha#443)', () => {
  assert.notDeepEqual(PROBES, [], 'the rows are read')
  assert.deepEqual(absencesWithoutAHostProof(PROBES), [])
})

test('no row about a checkout\'s own config asks the model to answer in one turn (martha#223, martha#443)', () => {
  assert.deepEqual(rowsWithoutRoomToFinish(PROBES), [])
})
