// The coincidences of tell_the_member_a_line: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The program's own name, which Martha signs a line of its own with in the crew channel (martha#390). The crew's
  // state directory is named after the program and is not what this word means here.
  { value: STATE_ROOT_NAME, file: 'tell_the_member_a_line/tell_the_member_a_line.ts', reason: 'the program\'s own name, which Martha signs a line of its own with in the crew channel (martha#390): the state directory is named after the program and is not what this word means here' },
]
