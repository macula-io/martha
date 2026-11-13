// The exceptions a run applies, to the checkout and to nothing else (martha#256).
//
// The defect this proves: every exception declared in the checkout was held against the tree `--root` named,
// so a planted repository — which holds none of the checkout's files — made the list read as stale and the
// run end 2, "could not look", where a range test required a finding. The list is about this checkout.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { exceptionsThatApply } from './the_exceptions_that_apply.ts'

/** The checkout this file runs in: `src/check_no_literal_restates_a_value` two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

/** An entry a reviewer would have written, so the test does not depend on the list the checkout carries. */
const DECLARED: readonly Exception[] = [{ value: 'a-planted-word', file: 'a_place/a_place.ts', reason: 'planted by this test' }]

test('an exception declared in the checkout is not held against another tree (martha#256)', () => {
  assert.deepEqual(exceptionsThatApply(join(CHECKOUT, '..', 'another-tree'), CHECKOUT, DECLARED), [])
})

test('an exception declared in the checkout applies to the checkout itself (martha#256)', () => {
  assert.deepEqual(exceptionsThatApply(CHECKOUT, CHECKOUT, DECLARED), DECLARED)
})

test('the checkout is recognised however its path is spelled (martha#256)', () => {
  assert.deepEqual(exceptionsThatApply(join(CHECKOUT, '.'), CHECKOUT, DECLARED), DECLARED)
  assert.deepEqual(exceptionsThatApply(CHECKOUT, join(CHECKOUT, '.'), DECLARED), DECLARED)
})
