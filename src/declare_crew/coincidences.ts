// The coincidences of declare_crew: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_CHANNEL_READ_ASK } from '../a_crews_tools/a_crews_tools.ts'
import { CARRY_A_MODEL } from '../refresh_a_member/the_refresh_flow.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { OWNER, ROLE_TEXTS_DIRECTORY } from './declare_crew.ts'

/** Why `'owner'` is written by literal in the declaration (#289 part b). */
const A_FIELD_OF_THE_DECLARATION = 'a field of the crew declaration, as its schema names it and as a refusal names the field'

/** Why a role name is written by literal in a test crew (#289 part b). */
export const A_ROLE_A_TEST_CREW_DECLARES = 'the role a test crew declares; a role is the declaration\'s own word, and the constant of that word is the role report_progress reads'

/** Why `model` is written by literal for the declaration (martha#315): it is the key a member's own model is declared under. */
const THE_DECLARATIONS_MODEL_KEY = 'the key a member\'s own model is declared under, in the declaration this repository writes'

export const COINCIDENCES: readonly Exception[] = [
  // A coincidence of names (martha#312): the declaration's own field, as v0.1.0's file lacks it, is not the launcher's ask.
  { value: THE_CHANNEL_READ_ASK, file: 'declare_crew/declare_crew.node-test.ts', reason: 'the declaration field a crew file names, which the launcher\'s ask happens to share' },
  // The declaration's mode holds a `roles` field, the list of the crew's role names; `roles/` is the directory each
  // role's text sits in (martha#306). One English word names the field and the folder, and the field reader is not a
  // path: it is excused here, and a copy of the word anywhere else still fails.
  { value: ROLE_TEXTS_DIRECTORY, file: 'declare_crew/declare_crew.ts', reason: 'the declaration\'s mode.roles field, a list of role names, and not the roles/ directory a role\'s text sits in' },
  { value: CARRY_A_MODEL, file: 'declare_crew/declare_crew.ts', reason: THE_DECLARATIONS_MODEL_KEY },
  { value: THE_CHANNEL_READ_ASK, file: 'declare_crew/declare_crew.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: OWNER, file: 'declare_crew/declare_crew.node-test.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: OWNER, file: 'declare_crew/declare_crew.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: SUPERVISOR, file: 'declare_crew/declare_crew.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
]
