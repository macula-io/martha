// The coincidences of refresh_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_OWNERS_FILES_MODEL_KEY_IS_NOT_THESE } from '../put_the_owners_model_back/coincidences.ts'
import { THE_MODEL_KEY } from '../put_the_owners_model_back/the_owners_settings_file.ts'
import { REFRESH_FIELD } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** Why the two `'refresh'` constants stay apart (#289 part b). */
export const TWO_REFRESH_WORDS = 'a row\'s refresh field and the folder of refresh records are two meanings spelled alike, each defined once in its own slice'

export const COINCIDENCES: readonly Exception[] = [
  // The same spelling for the key a restore may touch in the owner's settings file (martha#359), in two files that mean
  // something else by it.
  { value: THE_MODEL_KEY, file: 'refresh_a_member/the_refresh_flow.ts', reason: `the word an order carries a model under, which this file holds as CARRY_A_MODEL; ${THE_OWNERS_FILES_MODEL_KEY_IS_NOT_THESE}` },
  { value: REFRESH_FIELD, file: 'refresh_a_member/refresh_a_member.ts', reason: TWO_REFRESH_WORDS },
]
