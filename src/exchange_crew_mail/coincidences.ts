// The coincidences of exchange_crew_mail: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { HOST_ANSWER_TIMEOUT_MS } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'

export const COINCIDENCES: readonly Exception[] = [
  {
    value: HOST_ANSWER_TIMEOUT_MS,
    file: 'exchange_crew_mail/the_mail_tools.ts',
    reason: 'how long the relay waits for one sealed mail call on the mesh (martha#1016), not how long the launcher waits for the host to answer; the two waits are alike in length and in nothing else',
  },
]
