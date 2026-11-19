// The coincidences of load_the_hosts_markdown: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'

/**
 * Why a CLAUDE_CONFIG_DIR the test makes up may be spelled `config`: the folder is the host's own config directory,
 * named after what it holds, and git's config file — the value the constant holds — is not read here at all.
 */
export const THE_CONFIG_DIR_IS_A_FIXTURE = 'a CLAUDE_CONFIG_DIR the test makes up, spelled config for the folder it stands for; git\'s config file, which the constant holds, is not read here'

export const COINCIDENCES: readonly Exception[] = [
  { value: CONFIG, file: 'load_the_hosts_markdown/settings_env_reaching_servers.node-test.ts', reason: THE_CONFIG_DIR_IS_A_FIXTURE },
]
