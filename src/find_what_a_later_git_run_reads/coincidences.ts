// The coincidences of find_what_a_later_git_run_reads: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The tag of a read that has stopped, a union member TypeScript narrows on: the parser says a line ended a section,
  // it never names the act that stops a member, though both spell the same word.
  { value: STOP, file: 'find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts', reason: 'the tag of a read that stopped, a union member TypeScript narrows on; the tree\'s word is the act that stops a member' },
]
