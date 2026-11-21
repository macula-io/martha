// The coincidences of trust_only_signed_lists: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { TREE_HASH } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { ROSTER_FILE } from '../say_where_the_crew_keeps_things/say_where_the_crew_keeps_things.ts'

/** Why `'crew'` is written by literal in a signed list (#289 part b). */
const A_FIELD_OF_A_SIGNED_LIST = 'a field a signed list document carries, named as its signature covers it'

/** Why a fixture file is called `roster.json` (martha#985): a signed list document of the `martha_roster` kind, a name
 * this test picked for its own document, never the `<crew>/roster.json` the crew's own roster is kept as. */
const A_SIGNED_LISTS_OWN_DOCUMENT = 'a signed list document this test names for itself, of the kind martha_roster; never the crew\'s own roster file'

/** Why `'sha512'` is written by literal for an ssh signature (#289 part b). */
export const SSHS_OWN_HASH_NAME = 'ssh\'s name for the hash a signature uses (SSH_SHA512) and the hash of a recorded tree (TREE_HASH) are two meanings spelled alike, each defined once in its own slice'

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_WHOLE_CREW, file: 'trust_only_signed_lists/trust_only_signed_lists.ts', reason: A_FIELD_OF_A_SIGNED_LIST },
  { value: THE_WHOLE_CREW, file: 'trust_only_signed_lists/trust_only_signed_lists.node-test.ts', reason: A_FIELD_OF_A_SIGNED_LIST },
  { value: TREE_HASH, file: 'trust_only_signed_lists/ssh_signature.ts', reason: SSHS_OWN_HASH_NAME },
  { value: ROSTER_FILE, file: 'trust_only_signed_lists/trust_only_signed_lists.node-test.ts', reason: A_SIGNED_LISTS_OWN_DOCUMENT },
]
