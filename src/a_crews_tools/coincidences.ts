// The coincidences of a_crews_tools: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { WHOLE_FILE_CONTENT } from '../claude_code_host/claude_code_file_tools.ts'
import { THE_WHOLE_CREW, THE_WHOLE_CREW_ADDRESSEE } from '../keep_the_crew_channel/coincidences.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { CARRY_A_MODEL } from '../refresh_a_member/the_refresh_flow.ts'

/**
 * Why the handover's one argument is named by literal (martha#255): it is the
 * argument the host's Write call takes, and the constant holding it sits in the
 * host glue, which a slice may not import (prove_the_core keeps that boundary).
 * The word is too common to define again: defining it would make every `content`
 * in the tree stale at once, and a member's tool call is not worth that.
 */
const THE_ARGUMENT_OF_A_WRITE = 'the host\'s own name for the argument that holds a whole file, which lives in the host glue a slice may not import'

export const COINCIDENCES: readonly Exception[] = [
  { value: WHOLE_FILE_CONTENT, file: 'a_crews_tools/a_crews_tools.ts', reason: `the one argument the handover tool takes; ${THE_ARGUMENT_OF_A_WRITE}` },
  // The park test reads back the state a marker holds, and checks that the old single tool's argument is gone
  // (martha#343). Both spell the word the crew's park place is named with, and neither is that place.
  { value: PARKED_PLACE, file: 'a_crews_tools/the_park_tool_keeps_the_marker.node-test.ts', reason: 'the state a park marker reads back as, and the argument the one tool used to take; the crew\'s park place is named the same word and is not this' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/the_model_tools_answer_the_crew.node-test.ts', reason: 'the arguments the switch tool takes, as its own schema declares them' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/a_crews_tools.ts', reason: 'the argument the two model tools take and read back, as their own schemas declare it; the order\'s carry word is a different word spelled the same' },
  { value: PARKED_PLACE, file: 'a_crews_tools/a_crews_tools.ts', reason: 'the word a park\'s answer says a member is now in, in the line the member is told; the constant of that name is the place a crew keeps a park marker in' },
  { value: THE_WHOLE_CREW, file: 'a_crews_tools/a_crews_tools.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
]
