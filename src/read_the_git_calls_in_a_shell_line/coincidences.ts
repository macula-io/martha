// The coincidences of read_the_git_calls_in_a_shell_line: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { SYSTEM_TEMPORARY_DIRECTORY } from '../host_contract/host_contract.ts'

/** Why `'/tmp'` is written by literal in the sample shell line a test reads as words (martha#289). */
const A_PATH_IN_A_SAMPLE_SHELL_LINE =
  'a path written into a sample shell line that a test reads as words, where the reader looks for git and never for a directory; the constant of that word is this machine\'s own temporary directory'

export const COINCIDENCES: readonly Exception[] = [
  { value: SYSTEM_TEMPORARY_DIRECTORY, file: 'read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.node-test.ts', reason: A_PATH_IN_A_SAMPLE_SHELL_LINE },
]
