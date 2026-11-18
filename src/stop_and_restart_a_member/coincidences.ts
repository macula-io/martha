// The coincidences of stop_and_restart_a_member: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { RESTART_ANSWER_DEADLINE_MS } from './stop_and_restart_a_member.ts'

/**
 * Why a restart's answer deadline is two minutes of its own (martha#441): a restart is answered only once the member is
 * started again, and a launch prepares a tree. The silence a run's host is given is the same two minutes and bounds
 * something else.
 */
const A_RESTARTS_ANSWER_IS_A_LAUNCH_LONG = 'how long a restart\'s asker waits for the launcher, which waits for the end and a whole launch; the silence a run\'s host is given is the same two minutes and bounds a quiet, not a launch'

export const COINCIDENCES: readonly Exception[] = [
  { value: PARKED_PLACE, file: 'stop_and_restart_a_member/list_the_members.ts', reason: 'the state martha ls shows a parked member in, and the kind a park read answers with (martha#312); the crew\'s park place is named the same word and is not this' },
  { value: PARKED_PLACE, file: 'stop_and_restart_a_member/stop_and_restart_a_member.node-test.ts', reason: 'the state martha ls shows a parked member in, and the kind a park read answers with, as the test expects them (martha#312); the crew\'s park place is named the same word and is not this' },
  // A wait this slice owns, the same length as a wait of another slice's and not the same wait (martha#441).
  { value: RESTART_ANSWER_DEADLINE_MS, file: 'stop_and_restart_a_member/stop_and_restart_a_member.ts', reason: A_RESTARTS_ANSWER_IS_A_LAUNCH_LONG },
]
