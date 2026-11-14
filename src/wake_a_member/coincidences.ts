// The coincidences of wake_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { A_ROLE_A_TEST_CREW_DECLARES } from '../declare_crew/coincidences.ts'
import { THE_KIND_OF_A_PARK } from '../park_and_wake_a_member/coincidences.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: PARKED_PLACE, file: 'wake_a_member/wake_a_member.node-test.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'wake_a_member/wake_a_member.ts', reason: THE_KIND_OF_A_PARK },
  { value: SUPERVISOR, file: 'wake_a_member/wake_a_member.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
]
