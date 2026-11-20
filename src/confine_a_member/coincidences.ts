// The coincidences of confine_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'

export const COINCIDENCES: readonly Exception[] = [
  // systemctl's own verb for ending a unit, which the live test's cleanup runs; a member's stop is spelled the same.
  { value: STOP, file: 'confine_a_member/a_member_runs_in_its_scope.node-test.ts', reason: 'the verb systemctl ends a unit with, not what a member is asked to do' },
]
