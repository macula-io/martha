// The coincidences of open_the_crew_in_tmux: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { KITTY } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'

/** Why `crew` is spelt here: the owner's verb the strip under a member's window runs. */
const THE_STRIPS_VERB = "the owner's verb the strip under a member's window runs (`martha crew`, martha#572); the channel's word for every member is another value"

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WHOLE_CREW, file: 'open_the_crew_in_tmux/the_commands_tmux_runs.ts', reason: THE_STRIPS_VERB },
  { value: THE_WHOLE_CREW, file: 'open_the_crew_in_tmux/the_commands_tmux_runs.node-test.ts', reason: `${THE_STRIPS_VERB}, and a test crew's id` },
  {
    value: KITTY,
    file: 'open_the_crew_in_tmux/open_the_crew_in_tmux.node-test.ts',
    reason: "the terminal a declaration names, as the owner types it, which attach refuses; the kitty opener's program is another value",
  },
]
