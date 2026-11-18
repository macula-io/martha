// The coincidences of refresh_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { REFRESH_FIELD } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { TWO_MODEL_WORDS } from '../switch_a_members_model/coincidences.ts'
import { MODEL_PLACE } from '../switch_a_members_model/switch_a_members_model.ts'

/** Why the two `'refresh'` constants stay apart (#289 part b). */
export const TWO_REFRESH_WORDS = 'a row\'s refresh field and the folder of refresh records are two meanings spelled alike, each defined once in its own slice'

export const COINCIDENCES: readonly Exception[] = [
  { value: MODEL_PLACE, file: 'refresh_a_member/the_refresh_flow.ts', reason: TWO_MODEL_WORDS },
  { value: REFRESH_FIELD, file: 'refresh_a_member/refresh_a_member.ts', reason: TWO_REFRESH_WORDS },
]
