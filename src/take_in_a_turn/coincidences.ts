// The coincidences of take_in_a_turn: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { OWNER } from '../declare_crew/declare_crew.ts'
import { THE_OWNER_AS_A_TURNS_ORIGIN } from '../host_contract/coincidences.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: OWNER, file: 'take_in_a_turn/take_in_a_turn.node-test.ts', reason: THE_OWNER_AS_A_TURNS_ORIGIN },
]
