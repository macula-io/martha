// Every planted case prints exactly the lines it requires, on its own real range (martha#289).
//
// The same table `--self-test` runs in CI. A case here fails by its own name, so a
// range reader that stops seeing a value, a marker the check stops holding, or a
// finding that names the wrong constant is red where it happened.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PLANTED_CASES, printedFor } from './the_planted_cases.ts'

for (const planted of PLANTED_CASES) {
  test(`planted: ${planted.what}`, () => {
    assert.deepEqual(printedFor(planted), planted.prints)
  })
}
