// The petname a mesh node id carries (martha#251).
//
// A mesh server's `mesh_hello` answer names the member's own id twice — `node_id`
// and `citizen_did` — and, beside them, a `petname`: a short human-readable label
// the server derives from that id alone (`src/petname.ts` of @macula-io/mcp, the
// same at 0.51.0 and 0.51.2). The strict shell gate admits an answer only when
// every leaf in it is something this launch supplied or can compute, so a petname
// the gate cannot compute would send every hello answer to B2 and #251's fix would
// never reach a member.
//
// This is that computation, copied faithfully from the pinned server: three word
// lists of forty, and sha256 over the lowercased id, taking four 16-bit groups for
// the two adjectives, the noun and a four-digit suffix. The recording beside this
// file pins the copy to the server itself (./recorded_petnames.json, taken from the
// installed module by ../record_mesh_answers), so a release that reorders a word
// list or changes the digest turns a test red instead of quietly costing a member
// its shell.
//
// What it is not: a name anybody chose. Nobody can steer a petname except by
// choosing an id, and the id this gate admits is 64 hex characters and nothing
// else, so the label a member's answer carries is not a channel for words.

import { createHash } from 'node:crypto'

/**
 * How a recorded id is written down, so the recording keeps nobody's identity and no
 * bare 64-hex run (../check_nothing_private_gets_in refuses one in a public tree,
 * whatever it is): 64 copies of one hex digit, or the sha256 of a written-down name.
 */
export type RecordedId = { readonly repeat: string } | { readonly sha256_of: string }

/** The node id a recorded pair names. */
export function recordedNodeId(recorded: RecordedId): string {
  return 'sha256_of' in recorded
    ? createHash('sha256').update(recorded.sha256_of).digest('hex')
    : recorded.repeat.repeat(64)
}

/** Mood words, in the server's order: `ADJECTIVES_A` of its `src/petname.ts`. */
const ADJECTIVES_A: readonly string[] = [
  'bold', 'bouncy', 'brave', 'breezy', 'calm', 'cheerful', 'clever', 'curious',
  'daring', 'eager', 'elegant', 'fierce', 'gentle', 'graceful', 'humble', 'jolly',
  'jovial', 'keen', 'kind', 'lively', 'lucky', 'mellow', 'merry', 'nimble',
  'noble', 'plucky', 'proud', 'quiet', 'quirky', 'radiant', 'silly', 'sleepy',
  'spry', 'sturdy', 'tranquil', 'upbeat', 'vivid', 'wise', 'witty', 'zealous',
]

/** Colour words, in the server's order: `ADJECTIVES_B` of its `src/petname.ts`. */
const ADJECTIVES_B: readonly string[] = [
  'amber', 'azure', 'bronze', 'coral', 'crimson', 'cyan', 'emerald', 'golden',
  'green', 'indigo', 'ivory', 'jade', 'lavender', 'lilac', 'magenta', 'maroon',
  'mauve', 'navy', 'olive', 'orange', 'peach', 'pink', 'plum', 'purple',
  'red', 'rust', 'ruby', 'sage', 'salmon', 'scarlet', 'sienna', 'silver',
  'slate', 'tan', 'teal', 'turquoise', 'violet', 'yellow', 'blue', 'copper',
]

/** Animal words, in the server's order: `NOUNS` of its `src/petname.ts`. */
const NOUNS: readonly string[] = [
  'antelope', 'badger', 'beetle', 'bison', 'cricket', 'dolphin', 'eagle', 'elk',
  'falcon', 'ferret', 'flamingo', 'fox', 'gazelle', 'gecko', 'hare', 'heron',
  'ibex', 'iguana', 'lynx', 'marten', 'mongoose', 'moose', 'narwhal', 'orca',
  'otter', 'owl', 'panther', 'pelican', 'penguin', 'rabbit', 'raven', 'salamander',
  'seal', 'sparrow', 'tiger', 'toucan', 'walrus', 'weasel', 'wolf', 'wombat',
]

/** The four-digit group's modulus: the server's `10_000`. */
const SUFFIX_OF_A_PETNAME = 10_000

/**
 * The label the pinned server derives from `node_id`, e.g. `calm_teal_otter_0413`.
 *
 * The id is lowercased first, as the server does, so an id that arrives in mixed
 * case maps to the same label as its lowercase form.
 */
export function petnameOf(node_id: string): string {
  const digest = createHash('sha256').update(node_id.toLowerCase()).digest()
  const first = digest.readUInt16BE(0) % ADJECTIVES_A.length
  const second = digest.readUInt16BE(2) % ADJECTIVES_B.length
  const noun = digest.readUInt16BE(4) % NOUNS.length
  const suffix = String(digest.readUInt16BE(6) % SUFFIX_OF_A_PETNAME).padStart(4, '0')
  return `${ADJECTIVES_A[first]}_${ADJECTIVES_B[second]}_${NOUNS[noun]}_${suffix}`
}
