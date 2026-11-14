// The coincidences of host_contract: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/coincidences.ts'

/** Why a store's name is written by literal in a test of the host contract (#289 part b). */
export const A_STORE_THE_CONTRACT_NAMES = 'the name of a store the host contract declares, listed as the host holds them; the constant of that word is a folder of the crew\'s state'

/** Why `'owner'` is written by literal as a turn's origin (#289 part b). */
export const THE_OWNER_AS_A_TURNS_ORIGIN = 'a member of the TurnOrigin union, compared at run time; the constant of that word is the role of the crew\'s owner'

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WHOLE_CREW, file: 'host_contract/host_contract.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
  { value: CREW_ROWS_PLACE, file: 'host_contract/host_contract.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
]
