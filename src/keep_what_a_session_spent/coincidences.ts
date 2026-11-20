// The coincidences of keep_what_a_session_spent: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { BILLED_BY_SUBSCRIPTION } from '../declare_crew/declare_crew.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'

/** Why `'subscription'` is spelled here by literal (martha#916). */
export const A_SESSIONS_BILLING_KIND = 'the kind of billing the host reports a session ran on (martha#860 R3), not the credential the crew\'s billing setting hands a member (martha#916)'

export const COINCIDENCES: readonly Exception[] = [
  // The crew's usage stream is named by the same word the crew channel addresses everyone by. A stored row's stream path
  // carries it (`usage/crew`), so it must not move if the channel's word ever does.
  { value: BILLED_BY_SUBSCRIPTION, file: 'keep_what_a_session_spent/the_hosts_usage.ts', reason: A_SESSIONS_BILLING_KIND },
  { value: BILLED_BY_SUBSCRIPTION, file: 'keep_what_a_session_spent/keep_what_a_session_spent.node-test.ts', reason: A_SESSIONS_BILLING_KIND },
  { value: BILLED_BY_SUBSCRIPTION, file: 'keep_what_a_session_spent/the_spend_between.node-test.ts', reason: A_SESSIONS_BILLING_KIND },
  { value: THE_WHOLE_CREW, file: 'keep_what_a_session_spent/keep_what_a_session_spent.ts', reason: 'the word the stream of sessions holding no package is stored under, which a channel\'s recipient word must never move' },
]
