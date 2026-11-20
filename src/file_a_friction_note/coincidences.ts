// The coincidences of file_a_friction_note (martha#289): read by the restated-values check, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { FRICTION_LABEL } from './friction_note.ts'

/** Why the label and the place share a word, said once for both files that hold it. */
const THE_LABEL_AND_THE_PLACE =
  'the label an issue is filed under and the place in the crew\'s store the notes are kept in are two things that share a word: one is how the issue is labelled on GitHub, the other where a record lives on this machine, and neither is the other\'s constant'

export const COINCIDENCES: readonly Exception[] = [
  { value: FRICTION_LABEL, file: 'file_a_friction_note/friction_note.ts', reason: THE_LABEL_AND_THE_PLACE },
  { value: FRICTION_LABEL, file: 'file_a_friction_note/the_friction_tool.ts', reason: THE_LABEL_AND_THE_PLACE },
]
