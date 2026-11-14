// The coincidences of watch_waits: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: PARKED_PLACE, file: 'watch_waits/watch_waits.ts', reason: 'the dashboard row\'s state, read where a chain ends; not the place a crew keeps its park markers in' },
  { value: PARKED_PLACE, file: 'watch_waits/watch_waits.node-test.ts', reason: 'the dashboard row\'s state, not the place a crew keeps its park markers in' },
]
