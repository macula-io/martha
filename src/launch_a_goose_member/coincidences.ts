// The coincidences of launch_a_goose_member: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree,
// never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'

/**
 * Why the engine's approving mode is written by the same word the owner types at `martha approve`. The constant
 * holds the mode the Goose engine names for the run in which it asks its client about every tool call; the act's
 * word is the command's own verb, and the two are not the same thing however they are spelled (martha#541).
 */
export const THE_ACT_THE_OWNER_TYPES = "the mode the Goose engine asks its client in (martha#541); the act a member's owner types at the command is another value, spelled the same"

/**
 * Why the engine's config folder is written by the same word as git's config file. The folder sits under the
 * engine's own path root and is the engine's config module's; the constant holds git's config file, which no part
 * of a Goose launch reads (martha#541).
 */
const THE_ENGINES_OWN_CONFIG_FOLDER = "the config folder under the engine's path root is the engine's own (martha#541); the constant holds git's config file"

export const COINCIDENCES: readonly Exception[] = [
  { value: CONFIG, file: 'launch_a_goose_member/launch_a_goose_member.ts', reason: THE_ENGINES_OWN_CONFIG_FOLDER },
  // The test spells the engine root's folders as the design table names them, so a reader that drops one fails it.
  { value: CONFIG, file: 'launch_a_goose_member/the_engines_decisions.node-test.ts', reason: THE_ENGINES_OWN_CONFIG_FOLDER },
]
