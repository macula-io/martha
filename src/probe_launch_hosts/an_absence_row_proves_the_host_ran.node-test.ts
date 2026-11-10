// A probe:launch row whose claim is that something did NOT happen is satisfied by a
// host that never ran: it touched nothing, exactly as the row says it would not
// (martha#188). These tests hold the file to the other half of such a row -- a
// claim that the host DID reach the point under test -- and judge every real row
// against a run in which the host exited early having touched nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { absencesWithoutAHostProof, judgeRow, type RowClaims, type RowRun } from './an_absence_row_proves_the_host_ran.ts'
import { ALL_PROBES } from './probe_hosts.ts'

/** A run in which the host quit on the config before it reached anything: nothing touched, and not a clean exit. */
const anEarlyExit = (row: RowClaims): RowRun => ({
  markers: Object.fromEntries(Object.keys(row.expected).map((name) => [name, false])),
  status: 1,
})

/** The rows in this file whose claim is that something did not happen. */
const absenceRows = ALL_PROBES.filter((row) => Object.values(row.expected).includes(false))

test('no probe:launch row claims an absence without also proving the host ran (#188)', () => {
  assert.deepEqual(absencesWithoutAHostProof(ALL_PROBES), [])
})

test('a host that exited early having touched nothing fails every row whose claim is an absence, by name (#188)', () => {
  assert.ok(absenceRows.length > 0, 'this file has rows whose claim is an absence')
  for (const row of absenceRows) {
    const failed = judgeRow(row, anEarlyExit(row)).filter((line) => line.failed)
    assert.ok(
      failed.some((line) => line.text.startsWith(`${row.what}:`)),
      `the early exit was not named against the row: ${row.what} -> ${JSON.stringify(judgeRow(row, anEarlyExit(row)))}`,
    )
  }
})

test('a marker the host writes carries a row over an exit that was not clean, so the row does not flake on the model (#188)', () => {
  const row: RowClaims = { what: 'a row proved by a marker the host writes', expected: { RAN: true, DID_NOT: false } }
  const lines = judgeRow(row, { markers: { RAN: true, DID_NOT: false }, status: 1 })
  assert.deepEqual(lines.filter((line) => line.failed), [])
})

test('a row whose only claims are absences is named, and one that proves the host ran is not (#188)', () => {
  const alone: RowClaims = { what: 'an absence that travels alone', expected: { DID_NOT: false } }
  const beside: RowClaims = { what: 'an absence beside a marker the host writes', expected: { DID_NOT: false, RAN: true } }
  const onTheExit: RowClaims = { what: 'an absence beside the host\'s clean exit', expected: { DID_NOT: false }, host_ok: true }
  assert.deepEqual(absencesWithoutAHostProof([alone, beside, onTheExit]), [alone.what])
})

test('a row that claims a clean exit is failed by one, and says so (#188)', () => {
  const row: RowClaims = { what: 'a row that claims a clean exit', expected: { DID_NOT: false }, host_ok: true }
  const failed = judgeRow(row, { markers: { DID_NOT: false }, status: 3 }).filter((line) => line.failed)
  assert.deepEqual(failed.map((line) => line.text), [`${row.what}: the host exited CLAIMED cleanly but exited 3`])
})
