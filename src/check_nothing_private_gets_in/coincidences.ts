// The coincidences of check_nothing_private_gets_in: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { THE_REPOSITORYS_OWN_NAME } from '../keep_martha_state_outside_the_checkout/coincidences.ts'
import { STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { FINE_GRAINED_TOKEN_PREFIX } from '../keep_the_owners_todo_list/token_prefixes.ts'
import { SK_ED25519 } from '../trust_only_signed_lists/ssh_signature.ts'

/** Why an ssh key type is written by literal among the public addresses (#289 part b). */
const A_KEY_TYPE_IS_A_PUBLIC_ADDRESS = 'a key type listed as a public address that posted text may carry; the constant of that word is the type the signature reader accepts'

/**
 * Why the test states GitHub's token kinds by literal (martha#904 r=1): a test that read the prefixes from the list it
 * pins would lose the dropped one along with its own case, so a mutant that drops it would survive.
 */
const A_TOKEN_KIND_STATED_ON_ITS_OWN = "GitHub's own token kinds, stated apart from the list the scan reads, so a prefix dropped from that list fails by the kind it leaves out"

export const COINCIDENCES: readonly Exception[] = [
  { value: STATE_ROOT_NAME, file: 'check_nothing_private_gets_in/check_nothing_private_gets_in.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: STATE_ROOT_NAME, file: 'check_nothing_private_gets_in/declared.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: SK_ED25519, file: 'check_nothing_private_gets_in/declared.ts', reason: A_KEY_TYPE_IS_A_PUBLIC_ADDRESS },
  { value: FINE_GRAINED_TOKEN_PREFIX, file: 'check_nothing_private_gets_in/check_nothing_private_gets_in.node-test.ts', reason: A_TOKEN_KIND_STATED_ON_ITS_OWN },
]
