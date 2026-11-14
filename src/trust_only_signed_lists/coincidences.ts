// The coincidences of trust_only_signed_lists: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { TREE_HASH } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'

/** Why `'sha512'` is written by literal for an ssh signature (#289 part b). */
export const SSHS_OWN_HASH_NAME = 'ssh\'s name for the hash a signature uses (SSH_SHA512) and the hash of a recorded tree (TREE_HASH) are two meanings spelled alike, each defined once in its own slice'

export const COINCIDENCES: readonly Exception[] = [
  { value: TREE_HASH, file: 'trust_only_signed_lists/ssh_signature.ts', reason: SSHS_OWN_HASH_NAME },
]
