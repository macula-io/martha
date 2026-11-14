// The coincidences of read_the_gate_mode: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { STRICT_GATE } from '../declare_crew/declare_crew.ts'

/**
 * Why the gate's reading holds the old field's name by literal (martha#321): ../declare_crew imports that module,
 * so importing the constant back would make the declaration read its own fields before they are initialized — which
 * is the failure this entry exists instead of. The word is the declaration's own field, read off a file an earlier
 * release wrote.
 */
const THE_OLD_GATE_FIELD = 'the declaration\'s own old gate field, read to keep a file an earlier release wrote declaring; the constant lives in declare_crew, which imports the module that reads it, so importing it back would read the declaration\'s fields before they are initialized'

export const COINCIDENCES: readonly Exception[] = [
  // The gate's one old reading (martha#321): the field a file an earlier release wrote still declares by. The slice
  // that reads it cannot import the constant, because declare_crew imports the slice.
  { value: STRICT_GATE, file: 'read_the_gate_mode/read_the_gate_mode.ts', reason: THE_OLD_GATE_FIELD },
]
