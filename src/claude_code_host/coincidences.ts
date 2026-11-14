// The coincidences of claude_code_host: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { A_STORE_THE_CONTRACT_NAMES } from '../host_contract/coincidences.ts'
import { THE_REPOSITORYS_OWN_NAME } from '../keep_martha_state_outside_the_checkout/coincidences.ts'
import { CREW_ROWS_PLACE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/coincidences.ts'
import { ANY_JSON_FILE } from '../launch_a_claude_code_member/coincidences.ts'
import { RELAY_JOURNAL_SUFFIX } from '../launch_a_claude_code_member/keep_the_relays_journal.ts'
import { CARRY_A_MODEL } from '../refresh_a_member/the_refresh_flow.ts'

/**
 * Why `model` is written by literal in five files that are not about the order (martha#315): each names a field of
 * something else, and the order's carry word is a different word that happens to be spelled the same. The host's Agent
 * schema names its own argument; the request body the stand-in host reads carries the model under its own key.
 */
export const THE_HOSTS_OWN_MODEL_FIELD = 'the host\'s own name for the argument that carries a model, in the Agent schema it declares and in the request body it sends: recorded host data, not the word an order carries a model under'

/**
 * Why three launch and refresh tests write `clear` as a literal (martha#255 r=2):
 * it is the word the host records in a `session_started` event whose session began
 * with `/clear` — recorded data, not the order a launcher answers, and the same
 * spelling by coincidence in exactly the sense this list is for.
 */
export const THE_HOSTS_WORD_FOR_A_CLEAR = 'the host\'s own word in the session_started event it records, for a session that began with /clear: recorded data, not the order a launcher answers'

export const COINCIDENCES: readonly Exception[] = [
  { value: CARRY_A_MODEL, file: 'claude_code_host/claude_code_host.node-test.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'claude_code_host/claude_code_host.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  // #289 part (b), by Uranus's ruling: one entry per file and word.
  { value: RELAY_JOURNAL_SUFFIX, file: 'claude_code_host/settings_that_turn_hooks_off.ts', reason: ANY_JSON_FILE },
  { value: THE_WHOLE_CREW, file: 'claude_code_host/claude_code_host.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
  { value: STATE_ROOT_NAME, file: 'claude_code_host/claude_code_host.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: CREW_ROWS_PLACE, file: 'claude_code_host/claude_code_host.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
]
