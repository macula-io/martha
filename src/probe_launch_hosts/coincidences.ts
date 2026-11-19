// The coincidences of probe_launch_hosts: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { HOST_ANSWER_TIMEOUT_MS } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The timeout a test gives the host it runs itself (martha#441): a bound on a host that must finish on its own, not
  // the launcher's wait for one answer from a host it launched.
  { value: HOST_ANSWER_TIMEOUT_MS, file: 'probe_launch_hosts/stop_a_host_that_outlives_the_run.node-test.ts', reason: 'a test\'s timeout for a host it runs itself and expects to finish; the tree\'s half minute is the launcher\'s wait for a host answer' },
]
