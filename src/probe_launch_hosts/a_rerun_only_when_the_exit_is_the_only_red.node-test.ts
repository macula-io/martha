// A row is made again only when the host's exit is the attempt's ONLY red (martha#223 r=2).
// The first version reran on the exit code alone and judged only the last attempt: an attempt
// whose write got through and then exited 1 was thrown away, and a clean second attempt turned
// the row green — hiding an intermittent failure of the deny rules, which is the defect these
// rows exist to find. These tests hold the decision to the judged lines, not to the exit code.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { onlyTheExitFailed } from './probe_hosts.ts'

/** A gated write row: its marker must be there and the host must have exited cleanly. */
const gated = { what: 'a gated write row', expected: { OWNER_SCOPE_WRITE_DENIED: true }, host_ok: true as const }

test('an attempt whose only red is the exit is made again (martha#223 r=2)', () => {
  assert.equal(onlyTheExitFailed(gated, { markers: { OWNER_SCOPE_WRITE_DENIED: true }, status: 1 }), true)
})

test('an attempt whose marker failed is the row\'s answer and is not made again, whatever the exit (martha#223 r=2)', () => {
  assert.equal(onlyTheExitFailed(gated, { markers: { OWNER_SCOPE_WRITE_DENIED: false }, status: 1 }), false)
  assert.equal(onlyTheExitFailed(gated, { markers: { OWNER_SCOPE_WRITE_DENIED: false }, status: 0 }), false)
})

test('a row that does not claim a clean exit is never made again (martha#223 r=2)', () => {
  const markerOnly = { what: 'a row about a marker', expected: { RAN: true } }
  assert.equal(onlyTheExitFailed(markerOnly, { markers: { RAN: false }, status: 1 }), false)
})

test('a run that could not be made at all is not made again by this rule (martha#223 r=2)', () => {
  assert.equal(onlyTheExitFailed(gated, 'could not run: ENOENT'), false)
})
