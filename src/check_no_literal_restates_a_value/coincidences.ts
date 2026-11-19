// The coincidences of check_no_literal_restates_a_value: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the check itself as a syntax tree,
// never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { EDIT_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

/** Why `'Edit'` is written by literal in a planted case's expected line (martha#776). */
const AN_EXPECTED_LINE_OF_A_PLANTED_CASE = 'a line a planted case expects the check to print, spelling the record key its own fixture wrote; built from the tool\'s constant instead, the fixture would hold the value it is judged against'

export const COINCIDENCES: readonly Exception[] = [
  { value: EDIT_TOOL, file: 'check_no_literal_restates_a_value/the_planted_cases.ts', reason: AN_EXPECTED_LINE_OF_A_PLANTED_CASE },
]
