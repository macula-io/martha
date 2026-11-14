// The coincidences of hand_a_crew_message_to_its_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_WHOLE_CREW, THE_WHOLE_CREW_ADDRESSEE } from '../keep_the_crew_channel/coincidences.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WHOLE_CREW, file: 'hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.node-test.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
]
