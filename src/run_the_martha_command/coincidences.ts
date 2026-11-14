// The coincidences of run_the_martha_command: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { THE_TAG_OF_NOTHING_TO_APPROVE } from '../approve_a_checkouts_config/coincidences.ts'
import { THE_REPOSITORYS_OWN_NAME } from '../keep_martha_state_outside_the_checkout/coincidences.ts'
import { STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { EMPTY_DIRECTORY_NAME } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { HOST_ANSWER_TIMEOUT_MS } from '../launch_a_claude_code_member/host_runs_the_relay.ts'
import { A_TOOLS_OWN_SUBCOMMAND } from '../refuse_a_member_writing_owner_memory/coincidences.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: CONFIG, file: 'run_the_martha_command/run_the_martha_command.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'run_the_martha_command/run_the_martha_command.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: STATE_ROOT_NAME, file: 'run_the_martha_command/run_the_martha_command.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: EMPTY_DIRECTORY_NAME, file: 'run_the_martha_command/run_the_martha_command.ts', reason: THE_TAG_OF_NOTHING_TO_APPROVE },
  // A test's bound on one act of the command under test (martha#441): an act it holds may start a member, and it must
  // still end. The tree's half minute is the launcher's wait for a host answer, which this test never drives.
  { value: HOST_ANSWER_TIMEOUT_MS, file: 'run_the_martha_command/every_act_is_held_to_the_floor.node-test.ts', reason: 'how long one act of the command under test may take; the tree\'s half minute is the launcher\'s wait for a host answer, which this test never drives' },
]
