// The coincidences of keep_what_a_session_spent: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The crew's usage stream is named by the same word the crew channel addresses everyone by. A stored row's stream path
  // carries it (`usage/crew`), so it must not move if the channel's word ever does.
  { value: THE_WHOLE_CREW, file: 'keep_what_a_session_spent/keep_what_a_session_spent.ts', reason: 'the word the stream of sessions holding no package is stored under, which a channel\'s recipient word must never move' },
]
