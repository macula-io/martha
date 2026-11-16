// The coincidences of write_my_handover: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { WHOLE_FILE_CONTENT } from '../claude_code_host/claude_code_file_tools.ts'

/**
 * Why the handover's one argument is named by literal (martha#255), here since #443 part 5 moved the tool out of the
 * tools slice: it is the argument the host's Write call takes, and the constant holding it sits in the host glue, which
 * a slice may not import (prove_the_core keeps that boundary). The word is too common to define again: defining it
 * would make every `content` in the tree stale at once, and a member's tool call is not worth that.
 */
const THE_ARGUMENT_OF_A_WRITE = 'the host\'s own name for the argument that holds a whole file, which lives in the host glue a slice may not import'

export const COINCIDENCES: readonly Exception[] = [
  { value: WHOLE_FILE_CONTENT, file: 'write_my_handover/the_handover_tool.ts', reason: `the one argument the handover tool takes; ${THE_ARGUMENT_OF_A_WRITE}` },
]
