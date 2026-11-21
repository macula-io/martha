// The coincidences of keep_crew_memory: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { HOST_ANSWER_TIMEOUT_MS } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: HOST_ANSWER_TIMEOUT_MS, file: 'keep_crew_memory/keep_crew_memory.ts', reason: "how long the relay waits for mcl-rag's answer over the mesh (martha#1016), not how long the host takes to answer the relay" },
]
