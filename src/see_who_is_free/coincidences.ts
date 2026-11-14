// The coincidences of see_who_is_free: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_KIND_OF_A_PARK } from '../park_and_wake_a_member/coincidences.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'

export const COINCIDENCES: readonly Exception[] = [
  // Who is free reads a park by its kind (martha#319): `parked` is the tag of the ThePark union, which TypeScript
  // narrows on and which no constant can stand in for, and the crew's park place is named the same word and is not it.
  { value: PARKED_PLACE, file: 'see_who_is_free/see_who_is_free.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'see_who_is_free/see_who_is_free.node-test.ts', reason: THE_KIND_OF_A_PARK },
]
