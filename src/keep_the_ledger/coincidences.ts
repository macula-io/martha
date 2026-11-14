// The coincidences of keep_the_ledger: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { LAND } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'

export const COINCIDENCES: readonly Exception[] = [
  // A member trying to log the landing (martha#320). The test asks the ledger to refuse three spellings of it, and the
  // third is also the name of the branch prefix a landing pushes from: the same word, and neither is the other.
  { value: LAND, file: 'keep_the_ledger/keep_the_ledger.node-test.ts', reason: 'a milestone spelling the ledger must refuse, not the branch prefix a landing pushes from' },
]
