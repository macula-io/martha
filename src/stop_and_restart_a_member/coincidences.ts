// The coincidences of stop_and_restart_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { RESTART_ANSWER_DEADLINE_MS, STOP_GRACE_MS } from './stop_and_restart_a_member.ts'

/**
 * Why the stop grace is ten seconds of its own (martha#441): it is crew-code's grace for a member's group to end once
 * asked. The launcher's wait for the host's save is the same ten seconds and a different wait, and neither is the other.
 */
const A_GROUPS_GRACE_TO_END = 'how long a member\'s group has to end once asked, which is crew-code\'s grace; the launcher\'s wait for the host\'s save is the same ten seconds and a different wait'

/**
 * Why a restart's answer deadline is two minutes of its own (martha#441): a restart is answered only once the member is
 * started again, and a launch prepares a tree. The silence a run's host is given is the same two minutes and bounds
 * something else.
 */
const A_RESTARTS_ANSWER_IS_A_LAUNCH_LONG = 'how long a restart\'s asker waits for the launcher, which waits for the end and a whole launch; the silence a run\'s host is given is the same two minutes and bounds a quiet, not a launch'

export const COINCIDENCES: readonly Exception[] = [
  { value: PARKED_PLACE, file: 'stop_and_restart_a_member/list_the_members.ts', reason: 'the state martha ls shows a parked member in, and the kind a park read answers with (martha#312); the crew\'s park place is named the same word and is not this' },
  { value: PARKED_PLACE, file: 'stop_and_restart_a_member/stop_and_restart_a_member.node-test.ts', reason: 'the state martha ls shows a parked member in, and the kind a park read answers with, as the test expects them (martha#312); the crew\'s park place is named the same word and is not this' },
  // Two waits this slice owns, each the same length as a wait of another slice's and not the same wait (martha#441).
  { value: STOP_GRACE_MS, file: 'stop_and_restart_a_member/stop_and_restart_a_member.ts', reason: A_GROUPS_GRACE_TO_END },
  { value: RESTART_ANSWER_DEADLINE_MS, file: 'stop_and_restart_a_member/stop_and_restart_a_member.ts', reason: A_RESTARTS_ANSWER_IS_A_LAUNCH_LONG },
]
