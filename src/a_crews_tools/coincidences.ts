// The coincidences of a_crews_tools: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { CLAUDE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { HOST_ANSWER_TIMEOUT_MS } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { CARRY_A_MODEL } from '../refresh_a_member/the_refresh_flow.ts'
import { KEEP_THE_PACKAGE_CONTRACT } from '../keep_the_package_contract/keep_the_package_contract.ts'
import { LONGEST_MESSAGE } from '../send_a_crew_message/send_a_crew_message.ts'
import { RESTART_A_MEMBER } from '../stop_and_restart_a_member/the_restart_tool.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The park test reads back the state a marker holds, and checks that the old single tool's argument is gone
  // (martha#343). Both spell the word the crew's park place is named with, and neither is that place.
  { value: PARKED_PLACE, file: 'a_crews_tools/the_park_tool_keeps_the_marker.node-test.ts', reason: 'the state a park marker reads back as, and the argument the one tool used to take; the crew\'s park place is named the same word and is not this' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/the_model_tools_answer_the_crew.node-test.ts', reason: 'the arguments the switch tool takes, as its own schema declares them' },
  // A test's bound on another process's step, and a figure its own clock makes (martha#441): each is the same number as
  // a value the tree defines and neither is that value.
  { value: HOST_ANSWER_TIMEOUT_MS, file: 'a_crews_tools/a_switch_leaves_the_owners_default_alone.node-test.ts', reason: 'how long a step of another process may take before a test calls it stuck; the tree\'s half minute is a launch\'s wait for a host answer, which this test does not drive' },
  { value: LONGEST_MESSAGE, file: 'a_crews_tools/the_who_is_free_tool_answers_the_supervisor.node-test.ts', reason: 'the elapsed time a report is given, as two beats of the test\'s own clock make it; the tree\'s twenty thousand is the longest text one message may carry' },
  // The rows of every_act_is_asked name each handler by its slice and file (martha#607). Two slices are named for the
  // tool they serve, so the folder name spells the tool's name, and is a path, not the tool.
  { value: KEEP_THE_PACKAGE_CONTRACT, file: 'a_crews_tools/every_act_is_asked.node-test.ts', reason: "a slice's folder, in the path that names a handler; the tool is the row's tool field" },
  { value: RESTART_A_MEMBER, file: 'a_crews_tools/every_act_is_asked.node-test.ts', reason: "a file in a handler's path, stop_and_restart_a_member/restart_a_member; the tool is the row's tool field" },
  // A folder of the test's own, standing in for the owner's config directory and named for the host it belongs to
  // (martha#541). The command a launch starts is a program on PATH, never this folder, though both spell the same word.
  { value: CLAUDE, file: 'a_crews_tools/a_switch_leaves_the_owners_default_alone.node-test.ts', reason: "a stand-in folder the test keeps the owner's settings in, named for the host; the command a launch starts is a program on PATH and is not this folder" },
  { value: CLAUDE, file: 'a_crews_tools/the_model_tools_answer_the_crew.node-test.ts', reason: "a stand-in folder the test keeps the owner's settings in, named for the host; the command a launch starts is a program on PATH and is not this folder" },
]
