// The coincidences of declare_a_launch_probe: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { RUN_TIMEOUT_MS } from './declare_a_launch_probe.ts'

export const COINCIDENCES: readonly Exception[] = [
  // How long one host run may take before the probe gives up (martha#441), written beside the silence budget a run's
  // host is given. Both are two minutes and neither is the other: one bounds a whole run, the other a host's quiet.
  { value: RUN_TIMEOUT_MS, file: 'declare_a_launch_probe/declare_a_launch_probe.ts', reason: 'how long one host run may take before the probe gives up on it; the run\'s silence budget is the same two minutes and bounds a host\'s quiet, not a whole run' },
]
