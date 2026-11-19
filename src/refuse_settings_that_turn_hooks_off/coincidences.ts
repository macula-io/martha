// The coincidences of refuse_settings_that_turn_hooks_off: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { ANY_JSON_FILE } from '../launch_a_claude_code_member/coincidences.ts'
import { RELAY_JOURNAL_SUFFIX } from '../keep_the_relays_journal/keep_the_relays_journal.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The drop-in folder holds any .json file the host reads, not the relay's own journal.
  { value: RELAY_JOURNAL_SUFFIX, file: 'refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts', reason: ANY_JSON_FILE },
]
