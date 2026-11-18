// The coincidences of stand_in_for_an_openai_model: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never
// run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'

/** Why the stand-in's `stop` is not the crew's word for stopping a member: it is the chat completions API's finish reason. */
const THE_APIS_FINISH_REASON = "the chat completions API's own finish reason for a turn that ended with text, as the engine's OpenAI provider reads it; the crew's stop word stops a member"

export const COINCIDENCES: readonly Exception[] = [
  { value: STOP, file: 'stand_in_for_an_openai_model/the_openai_stand_in.ts', reason: THE_APIS_FINISH_REASON },
]
