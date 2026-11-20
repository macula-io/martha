// The coincidences of ring_the_owner: words its own files spell like a constant held elsewhere, each with its reason
// (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { HOST_TERMINAL } from '../drive_the_recorded_host/drive_the_recorded_host.ts'
import { TMUX_PASSTHROUGH_OPENING } from './ring_the_owner.ts'

export const COINCIDENCES: readonly Exception[] = [
  // The test that pins the passthrough's bytes spells them as tmux's manual does (martha#843): built from the constant it
  // pins, it would pass whatever the constant said.
  { value: TMUX_PASSTHROUGH_OPENING, file: 'ring_the_owner/ring_the_owner.node-test.ts', reason: "tmux's passthrough opening spelled from tmux's manual, the expected bytes the slice's constant is held to" },
  // The real-tmux cases attach a client as a terminal does (martha#843). The recorded host's terminal is the same common
  // name and is not this client.
  { value: HOST_TERMINAL, file: 'ring_the_owner/the_ring_on_the_live_runs_tmux.node-test.ts', reason: "the TERM of a recorded tmux client the test attaches; the recorded host's own terminal shares the common name and is not this client" },
]
