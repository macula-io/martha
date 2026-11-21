// The coincidences of the relay's hooks: words its own files spell like a constant held elsewhere, meaning the same
// thing by them, and unable to import it (martha#289). A hooks module runs with no Node and may import only its own
// files, so an ask the launcher answers is spelled here by literal, as this module spells every ask it makes. Read by
// the restated-values check as a syntax tree, never run.

import type { Exception } from '../../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { THE_WAKE_ASK } from '../../wake_an_idle_member/wake_an_idle_member.ts'

/** Why an ask's name is written by literal in a hooks module: the module cannot import the slice that owns it. */
const THE_ASKS_NAME_A_HOOKS_MODULE_CANNOT_IMPORT = 'the name of an ask the launcher answers, spelled in a hooks module that may import only its own files (martha#959)'

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WAKE_ASK, file: 'claude_code_relay/hooks/crew_waking_an_idle_member.ts', reason: THE_ASKS_NAME_A_HOOKS_MODULE_CANNOT_IMPORT },
]
