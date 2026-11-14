// The coincidences of launch_a_claude_code_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_HOSTS_WORD_FOR_A_CLEAR } from '../claude_code_host/coincidences.ts'
import { THE_REPOSITORYS_OWN_NAME } from '../keep_martha_state_outside_the_checkout/coincidences.ts'
import { STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CARRY_THE_CLEAR } from '../refresh_a_member/the_refresh_flow.ts'
import { A_TOOLS_OWN_SUBCOMMAND } from '../refuse_a_member_writing_owner_memory/coincidences.ts'
import { CONFIG } from '../refuse_a_member_writing_owner_memory/git_config_a_later_run_reads.ts'

/** Why `'.json'` is written by literal in a filter (#289 part b). */
export const ANY_JSON_FILE = 'a filter on any JSON file; the constant of that word is the suffix of the relay\'s journal'

export const COINCIDENCES: readonly Exception[] = [
  { value: CARRY_THE_CLEAR, file: 'launch_a_claude_code_member/a_refresh_is_not_wiped_by_the_clear.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  { value: CARRY_THE_CLEAR, file: 'launch_a_claude_code_member/launch_a_claude_code_member.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  // A host sends the calling plugin's own name as an origin's name (martha#343), and the relay's plugin is called
  // Martha. The crew's state directory is named the same word and means nothing here: this fixture stands in for a
  // real host's event, and the test reads only the origin's kind.
  { value: STATE_ROOT_NAME, file: 'launch_a_claude_code_member/a_prompt_the_relay_takes_in_is_raised.node-test.ts', reason: 'the plugin name a host puts in an origin, not the crew state directory name: the words are the same and the meanings are not' },
  // A git subcommand, in a test that makes a throwaway repository (martha#315). The constant of that name is the file a
  // git directory keeps its configuration in, which this test neither reads nor writes.
  { value: CONFIG, file: 'launch_a_claude_code_member/a_switch_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'launch_a_claude_code_member/a_switch_does_not_move_the_owners_default.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  // The same git subcommand, in the permission-prompt run's throwaway repository (martha#363).
  { value: CONFIG, file: 'launch_a_claude_code_member/a_permission_prompt_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  // The same git subcommand, in the recorded end's throwaway repository (martha#311): martha init reads its owner there.
  { value: CONFIG, file: 'launch_a_claude_code_member/an_end_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'launch_a_claude_code_member/own_writes_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'launch_a_claude_code_member/run_nothing_a_checkout_planted.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: STATE_ROOT_NAME, file: 'launch_a_claude_code_member/drive_the_recorded_host.ts', reason: THE_REPOSITORYS_OWN_NAME },
]
