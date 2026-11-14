// The coincidences of crew_files_directory: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { STAGING_PREFIX } from './crew_files_directory.ts'

/** Why each store's glue holds its own staging prefix (#289 part b). */
export const MACHINE_GLUE_HOLDS_ITS_OWN = 'machine glue imports only the host contract and its own files, so each store\'s glue holds its own staging prefix'

export const COINCIDENCES: readonly Exception[] = [
  { value: STAGING_PREFIX, file: 'crew_files_directory/crew_files_directory.ts', reason: MACHINE_GLUE_HOLDS_ITS_OWN },
]
