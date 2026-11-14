// The coincidences of carry_taint_across_a_refresh: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_HOSTS_WORD_FOR_A_CLEAR } from '../claude_code_host/coincidences.ts'
import { CARRY_THE_CLEAR } from '../refresh_a_member/the_refresh_flow.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The same spelling in recorded host data (martha#255 r=2): three tests replay what the host recorded, and its word
  // for a session that began with /clear is its own.
  { value: CARRY_THE_CLEAR, file: 'carry_taint_across_a_refresh/carry_taint_across_a_refresh.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
]
