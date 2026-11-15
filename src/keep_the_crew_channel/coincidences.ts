// The coincidences of keep_the_crew_channel: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_WHOLE_CREW } from './crew_channel.ts'

/** Why one test spells the whole-crew word out (martha#468): a stored row carries it, and an import would agree with any
 * spelling of the constant — a pin that followed the constant could not say a row on disk still opens. */
const THE_WORD_AS_A_STORED_ROW_CARRIES_IT = 'the word as a stored row carries it'

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WHOLE_CREW, file: 'keep_the_crew_channel/crew_channel.node-test.ts', reason: THE_WORD_AS_A_STORED_ROW_CARRIES_IT },
]
