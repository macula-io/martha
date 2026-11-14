// The coincidences of nudge_the_supervisor: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The dashboard's own word for a parked member (martha#320). It is the row's state, and shares its spelling with
  // PARKED_PLACE, the name of the place a crew keeps its park markers in: the two are different names for different
  // things, and a park is read by both — the marker and the row the member itself wrote.
  { value: PARKED_PLACE, file: 'nudge_the_supervisor/nudge_the_supervisor.ts', reason: 'the dashboard row\'s state, not the place a crew keeps its park markers in' },
  { value: PARKED_PLACE, file: 'nudge_the_supervisor/nudge_the_supervisor.node-test.ts', reason: 'the dashboard row\'s state, not the place a crew keeps its park markers in' },
]
