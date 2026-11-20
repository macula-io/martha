// The crew's transcripts block (martha#931 B): how many launches' transcripts Martha keeps, and how many megabytes one
// transcript, and one launch's transcripts together, may hold. They were TRANSCRIPTS_LAUNCHES_KEPT and the two byte
// bounds in ../choose_the_transcripts_to_keep; the declaration's `transcripts` block now names them, and a declaration
// that names none reads those values. The parse lives here, beside declare_crew, which hands it the block's raw value
// and its own refusal.

/** The declaration's key for the block. */
export const TRANSCRIPTS = 'transcripts'

/** The fields the block may name; each is optional. */
export const TRANSCRIPTS_KEYS = ['launches_kept', 'megabytes_kept'] as const

/** One megabyte, in the bytes a transcript is measured in. */
export const MEGABYTE = 1024 * 1024

/** The crew's transcript bounds, in the units the declaration names them in. */
export interface CrewTranscripts {
  /** How many launches' transcripts are kept: the newest, one directory each; older ones are pruned. */
  readonly launches_kept: number
  /** The most one transcript, and one launch's transcripts together, may hold, in whole megabytes. */
  readonly megabytes_kept: number
}

/** What the crew reads when the declaration names no transcripts block: the bounds Martha kept by before #931. */
export const TRANSCRIPTS_WHEN_UNNAMED: CrewTranscripts = Object.freeze({ launches_kept: 64, megabytes_kept: 16 })

/** The byte bound one transcript, and one launch, is held to. */
export const bytesKeptOf = (transcripts: CrewTranscripts): number => transcripts.megabytes_kept * MEGABYTE

/** How a field of the block is refused: the field, dotted under the block, and why. */
export type RefuseATranscriptsField = (field: string, why: string) => never

/**
 * The block as the declaration names it, field by field over TRANSCRIPTS_WHEN_UNNAMED. Each is a whole number, at least
 * 1: a crew that keeps no launch, or no byte of one, has turned keeping off, which is not what this block is for.
 */
export function transcriptsOf(value: unknown, refuse: RefuseATranscriptsField): CrewTranscripts {
  if (value === undefined) return TRANSCRIPTS_WHEN_UNNAMED
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse(TRANSCRIPTS, `is not an object of ${TRANSCRIPTS_KEYS.join(', ')}`)
  const block = value as Readonly<Record<string, unknown>>
  const unknown = Object.keys(block).find((key) => !(TRANSCRIPTS_KEYS as readonly string[]).includes(key))
  if (unknown !== undefined) return refuse(`${TRANSCRIPTS}.${unknown}`, `is not a field here (they are ${TRANSCRIPTS_KEYS.join(', ')})`)
  const field = (key: (typeof TRANSCRIPTS_KEYS)[number], unit: string): number => {
    const read = block[key]
    if (read === undefined) return TRANSCRIPTS_WHEN_UNNAMED[key]
    if (typeof read !== 'number' || !Number.isSafeInteger(read) || read < 1) return refuse(`${TRANSCRIPTS}.${key}`, `is not a whole number of ${unit}, at least 1`)
    return read
  }
  return Object.freeze({ launches_kept: field('launches_kept', 'launches'), megabytes_kept: field('megabytes_kept', 'megabytes') })
}
