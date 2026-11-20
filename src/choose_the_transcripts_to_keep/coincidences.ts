// The coincidences of choose_the_transcripts_to_keep: words its own file spells like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree,
// never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { REDACTED as THE_NIGHTLYS_REDACTION } from '../land_a_package_on_a_throwaway_repository/the_kept_record.ts'
import { OWN_WRITES_SUFFIX } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/**
 * Why `'.jsonl'` is written by literal here (#289 part b): a host writes a session as JSON lines, and that suffix is the
 * host's own; the constant of that word is the suffix of the launcher's own-writes records, which is a different file
 * for a different reader.
 */
const THE_HOSTS_TRANSCRIPT_SUFFIX = 'Claude Code\'s own suffix for a session transcript; the constant of that word is the suffix of the launcher\'s own-writes records'

/**
 * Why `'[the token, redacted]'` is written by literal here: it is what a reader of a kept transcript finds where a token
 * was. The nightly's record keeps the same words for the same reason, in its own log, and the two are never read
 * together; a kept transcript is the owner's to read, not the nightly's.
 */
const A_TOKEN_STANDS_REDACTED = 'the words a reader of a kept transcript finds where a token was; the nightly\'s own log writes the same words for its own reader'

export const COINCIDENCES: readonly Exception[] = [
  { value: OWN_WRITES_SUFFIX, file: 'choose_the_transcripts_to_keep/choose_the_transcripts_to_keep.ts', reason: THE_HOSTS_TRANSCRIPT_SUFFIX },
  { value: THE_NIGHTLYS_REDACTION, file: 'choose_the_transcripts_to_keep/choose_the_transcripts_to_keep.ts', reason: A_TOKEN_STANDS_REDACTED },
]
