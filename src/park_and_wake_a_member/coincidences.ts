// The coincidences of park_and_wake_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { A_ROLE_A_TEST_CREW_DECLARES } from '../declare_crew/coincidences.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { PARKED_PLACE } from './park_and_wake_a_member.ts'

/** Why a reader of a park names its kind by literal (martha#319): a union's tag is a type, and the place is another word. */
export const THE_KIND_OF_A_PARK = 'the tag of the ThePark union, which TypeScript narrows on by literal; the crew\'s park place is named the same word and is not this'

export const COINCIDENCES: readonly Exception[] = [
  { value: PARKED_PLACE, file: 'park_and_wake_a_member/park_and_wake_a_member.node-test.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'park_and_wake_a_member/park_and_wake_a_member.ts', reason: THE_KIND_OF_A_PARK },
  { value: SUPERVISOR, file: 'park_and_wake_a_member/park_and_wake_a_member.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
]
