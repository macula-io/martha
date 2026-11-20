// The coincidences of refuse_a_member_writing_owner_memory: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { WORKTREES } from '../declare_crew/declare_crew.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'

/**
 * Why a test names git's `config` subcommand by literal (martha#315, martha#359): it makes a throwaway repository and
 * sets its identity, and the constant of that name is the file a git directory keeps its settings in, which the test
 * neither reads nor writes.
 */
export const A_TOOLS_OWN_SUBCOMMAND = 'a tool\'s own `config` subcommand (git\'s, npm\'s, opencode\'s), in a test or a probe that drives it; the constant of that name is the file a git directory keeps its settings in'

/** Why `'worktrees'` is written by literal inside a git directory (#289 part b). */
const GITS_OWN_WORKTREES_FOLDER = 'git\'s own folder for linked worktrees inside a git directory; the constant of that word is the crew\'s house rule for where worktrees go'

/** Why ssh's `config` is written by literal (martha#987): the file ssh reads under ~/.ssh, whose ProxyCommand runs a
 * program; the constant of that word is the file a git directory keeps its settings in. */
const SSHS_OWN_CONFIG_FILE = 'ssh\'s own config file under ~/.ssh; the constant of that word is the file a git directory keeps its settings in'

export const COINCIDENCES: readonly Exception[] = [
  { value: WORKTREES, file: 'refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.node-test.ts', reason: GITS_OWN_WORKTREES_FOLDER },
  { value: CONFIG, file: 'refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts', reason: SSHS_OWN_CONFIG_FILE },
  { value: CONFIG, file: 'refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.node-test.ts', reason: SSHS_OWN_CONFIG_FILE },
]
