// The coincidences of find_a_committed_conflict_marker: words its own files spell like a constant held elsewhere, each
// with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { DIVIDER } from './find_a_committed_conflict_marker.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The test writes the marker lines out by hand: a text built from DIVIDER would follow a wrong constant and pin
  // nothing, so a divider dropped or misspelled in the finder goes red only because the test spells it itself.
  {
    value: DIVIDER,
    file: 'find_a_committed_conflict_marker/find_a_committed_conflict_marker.node-test.ts',
    reason: 'a planted conflict marker, written by hand so the finder is pinned against git\'s own spelling, never against itself',
  },
]
