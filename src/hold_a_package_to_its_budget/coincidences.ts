// The coincidences of hold_a_package_to_its_budget: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289, #437, #566). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { SPEND_FIELD } from '../show_dashboard_beat/show_dashboard_beat.ts'

/**
 * Why the stream a package's spend is kept in may spell the dashboard's word (martha#437, martha#566): SPEND_FIELD names
 * the dashboard row's field carrying what a package has spent, while this is the name of the stream the counted calls are
 * kept in. One word for two different things — a row's field, and the first segment of a place rows live — and taking the
 * constant would tie where the count is kept to a name the dashboard may one day change. The stream's name is written
 * where the stream is named, and a reader of either file sees which one they are reading.
 */
const THE_STREAMS_NAME_IS_NOT_THE_ROWS_FIELD = 'the first segment of the stream a package\'s spend is kept in; the dashboard row\'s field of the same word carries what the package spent, and where the count lives must not follow a field name'

export const COINCIDENCES: readonly Exception[] = [
  { value: SPEND_FIELD, file: 'hold_a_package_to_its_budget/the_spend_stream.ts', reason: THE_STREAMS_NAME_IS_NOT_THE_ROWS_FIELD },
]
