// The coincidences of wake_an_idle_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { A_ROLE_A_TEST_CREW_DECLARES } from '../declare_crew/coincidences.ts'
import { THE_WAKE_ASK } from '../claude_code_relay/hooks/crew_waking_an_idle_member.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'

/** Why the ask's name is written twice: the hooks module that makes the ask may import only its own files, so the slice
 * that answers it cannot be its source, and the two spellings are one value held in two places (martha#959). */
const THE_ASKS_NAME_A_HOOKS_MODULE_CANNOT_IMPORT = 'the name of an ask the launcher answers, spelled in a hooks module that may import only its own files (martha#959)'

export const COINCIDENCES: readonly Exception[] = [
  { value: SUPERVISOR, file: 'wake_an_idle_member/wake_an_idle_member.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
  { value: THE_WAKE_ASK, file: 'wake_an_idle_member/wake_an_idle_member.ts', reason: THE_ASKS_NAME_A_HOOKS_MODULE_CANNOT_IMPORT },
]
