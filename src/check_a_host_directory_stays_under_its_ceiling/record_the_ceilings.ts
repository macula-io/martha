// Recording the ceilings package.json already holds, lowered to what the tree
// measures.
//
// `--record` is the one command that writes the map, and it only ever brings a
// number down (martha#322). The check fails any ceiling it would bring down
// (martha#341), so a shrink records its new ceiling in the change that made it. A raise is a hand edit to package.json, which the
// diff and the review show, and so is a new directory's first ceiling: a command
// that invented one would let a new adapter be born at any size. package.json is
// written back as the JSON it already is, with every other key where it was, so a
// record run reads as the numbers it changed.

/** One ceiling the run brought down. */
export interface Lowering {
  readonly directory: string
  readonly from: number
  readonly to: number
}

/** `package.json`'s text with each ceiling lowered, and the ceilings it lowered. */
export interface Recorded {
  readonly text: string
  readonly lowered: readonly Lowering[]
}

/** The part of package.json this reads and writes. */
interface WithCeilings {
  readonly martha?: Readonly<Record<string, unknown>> & { readonly hostCeilings?: Record<string, number> }
}

/**
 * Whether a ceiling stands above its directory's count: what a record run lowers,
 * and what the check fails (martha#341). One predicate for both, so the check
 * fails exactly when a record run would write.
 */
export const standsAbove = (ceiling: number, counted: number): boolean => counted < ceiling

/** Each ceiling `text` holds, brought down to `code` where the count is lower, and the ones brought down. */
const loweredOf = (held: Record<string, number>, code: Readonly<Record<string, number>>): Recorded['lowered'] =>
  Object.entries(held)
    .filter(([directory, ceiling]) => code[directory] !== undefined && standsAbove(ceiling, code[directory]))
    .map(([directory, ceiling]) => ({ directory, from: ceiling, to: code[directory] ?? ceiling }))

/** `text` with `hostCeilings` replaced by `next`, every other key where it was. */
const withCeilings = (text: string, next: Record<string, number>): string => {
  const manifest = JSON.parse(text) as WithCeilings
  const martha = { ...(manifest.martha ?? {}), hostCeilings: next }
  return `${JSON.stringify({ ...manifest, martha }, null, 2)}\n`
}

/** `package.json`'s text with every ceiling brought down to `code`, and nothing else changed. */
export function withLoweredCeilings(text: string, code: Readonly<Record<string, number>>): Recorded {
  const held = (JSON.parse(text) as WithCeilings).martha?.hostCeilings ?? {}
  const lowered = loweredOf(held, code)
  if (lowered.length === 0) return { text, lowered }
  const next: Record<string, number> = {}
  for (const [directory, ceiling] of Object.entries(held)) next[directory] = Math.min(ceiling, code[directory] ?? ceiling)
  return { text: withCeilings(text, next), lowered }
}
