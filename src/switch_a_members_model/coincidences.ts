// The coincidences of switch_a_members_model: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { CARRY_A_MODEL } from '../refresh_a_member/the_refresh_flow.ts'

/** Why the crew's model place and an order's model key stay apart (martha#289). */
export const TWO_MODEL_WORDS = 'the folder a crew keeps its model records in and the key an order carries a model under are two meanings spelled alike, each defined once in its own slice'

export const COINCIDENCES: readonly Exception[] = [
  { value: CARRY_A_MODEL, file: 'switch_a_members_model/switch_a_members_model.ts', reason: TWO_MODEL_WORDS },
  { value: CARRY_A_MODEL, file: 'switch_a_members_model/the_switch_tools.ts', reason: `the argument the switch tool takes the model in, as its own schema declares it; ${TWO_MODEL_WORDS}` },
]
