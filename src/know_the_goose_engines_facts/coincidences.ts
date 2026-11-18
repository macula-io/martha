// The coincidences of know_the_goose_engines_facts: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289, #437). Read by the restated-values check as a syntax tree,
// never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'

export const COINCIDENCES: readonly Exception[] = [
  // ENGINE_PLACES names files in the Goose engine's source tree as that tree spells them: `crates/goose/src/config/` is
  // the engine's own config module. The constant is git's config file, which no part of reading the engine touches.
  { value: CONFIG, file: 'know_the_goose_engines_facts/the_engines_facts_in_its_source.ts', reason: 'the config folder in ENGINE_PLACES is the Goose engine\'s own config module, named as its source tree names it; the constant holds git\'s config file (martha#541)' },
]
