// The coincidences of trust_only_signed_lists: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { TREE_HASH } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { ROSTER_FILE } from '../write_the_crews_roster/write_the_crews_roster.ts'

/** Why `'crew'` is written by literal in a signed list (#289 part b). */
const A_FIELD_OF_A_SIGNED_LIST = 'a field a signed list document carries, named as its signature covers it'

/** Why `'sha512'` is written by literal for an ssh signature (#289 part b). */
export const SSHS_OWN_HASH_NAME = 'ssh\'s name for the hash a signature uses (SSH_SHA512) and the hash of a recorded tree (TREE_HASH) are two meanings spelled alike, each defined once in its own slice'

/** Why `'roster.json'` names a signed list's file here (martha#1016): the signed trust list a test signs, another file than the roster `martha up` keeps in Martha's state under the same name. */
const A_SIGNED_LISTS_FILE = 'the file a signed trust list is written to in a test; the roster martha up keeps in its state shares the name and is another file'

export const COINCIDENCES: readonly Exception[] = [
  { value: ROSTER_FILE, file: 'trust_only_signed_lists/trust_only_signed_lists.node-test.ts', reason: A_SIGNED_LISTS_FILE },
  { value: THE_WHOLE_CREW, file: 'trust_only_signed_lists/trust_only_signed_lists.ts', reason: A_FIELD_OF_A_SIGNED_LIST },
  { value: THE_WHOLE_CREW, file: 'trust_only_signed_lists/trust_only_signed_lists.node-test.ts', reason: A_FIELD_OF_A_SIGNED_LIST },
  { value: TREE_HASH, file: 'trust_only_signed_lists/ssh_signature.ts', reason: SSHS_OWN_HASH_NAME },
]
