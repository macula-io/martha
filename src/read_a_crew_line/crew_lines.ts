// The one definition of the lines a crew member sends about a package (martha#253, slice 4).
//
// This exists so the shapes a member is taught and the shapes the reader accepts cannot drift apart: the text the
// role cards teach is generated from these definitions, and a test parses every line that text teaches. The order is
// the one the crew sends today — crew-code's PROTOCOL, `VERDICT <package> PASS|FAIL <range> r=<N> ci=<ids> req=<N>` —
// with no change; r=1 of this design had put PASS|FAIL after the range, and the crew's own lines on this package
// showed the design, not the review, had it right.
//
// A line is a verb, the words after it in a fixed order, and then `key=value` pairs. A key that a verb does not name
// is answered by its name, so a line with a stray key is never half-read.

import { WORK_PACKAGE } from '../log_ledger/log_ledger.ts'

/** A value a line carries, with the shape that value must have. */
export type ValueName = 'package' | 'range' | 'url' | 'number' | 'ids'

/** How a card writes a value's placeholder: the words the crew's own lines use. */
export const placeholderOf = (value: ValueName): string =>
  ({ package: '<org/repo#n>', range: '<base40>..<tip40>', url: '<url>', number: '<N>', ids: '<run ids>' })[value]

/** The shapes of a value: the fourty hex digits of a commit, a run id list, and the ledger's own package name. */
export const VALUE_SHAPES: Readonly<Record<ValueName, { readonly what: string; readonly matches: RegExp }>> = {
  package: { what: 'a package, owner/repo#n', matches: WORK_PACKAGE },
  range: { what: 'a range, <base40>..<tip40>, each forty hex digits', matches: /^[0-9a-f]{40}\.\.[0-9a-f]{40}$/ },
  url: { what: 'a URL', matches: /^https?:\/\/\S+$/ },
  number: { what: 'a whole number, at least 1', matches: /^[1-9][0-9]*$/ },
  ids: { what: 'run ids, comma separated, or none:paths', matches: /^(?:[0-9]+(?:,[0-9]+)*|none:paths)$/ },
}

/** One part of a line after its verb: a word the line always carries, one of a few words, or a value. */
export type Part =
  | { readonly word: string }
  | { readonly oneOf: readonly string[] }
  | { readonly value: ValueName; readonly name: string }

/** One line's shape: its verb, its parts in order, and the keys that follow them. */
export interface LineShape {
  readonly verb: string
  readonly parts: readonly Part[]
  /** The keys a line of this verb may carry, each naming a value's shape. */
  readonly keys: Readonly<Record<string, ValueName>>
  /** The keys every line of this verb carries. */
  readonly required: readonly string[]
  /** A key that stands in place of a part, by the part's index: a design has a URL where a range would be. */
  readonly inPlaceOf: Readonly<Record<string, number>>
  /** The keys a card shows for a line on a range, and for one on a design, in the order a line carries them. */
  readonly shown: { readonly range: readonly string[]; readonly design: readonly string[] }
}

const PACKAGE: Part = { value: 'package', name: 'package' }
const RANGE: Part = { value: 'range', name: 'range' }

/** The two lines a member sends about a package, and nothing else: BLOCKED, FILED and LIVE stay out until needed. */
export const CREW_LINES: readonly LineShape[] = [
  {
    verb: 'HANDOFF',
    parts: [PACKAGE, RANGE],
    keys: { r: 'number', ci: 'ids', doc: 'url' },
    required: ['r'],
    inPlaceOf: { doc: 1 },
    shown: { range: ['r', 'ci'], design: ['doc', 'r'] },
  },
  {
    verb: 'VERDICT',
    parts: [PACKAGE, { oneOf: ['PASS', 'FAIL'] }, RANGE],
    keys: { r: 'number', ci: 'ids', req: 'number', doc: 'url' },
    required: ['r'],
    inPlaceOf: { doc: 2 },
    shown: { range: ['r', 'ci', 'req'], design: ['doc', 'r', 'req'] },
  },
]

/** The verbs a member sends, as a line's own first word. */
export const CREW_VERBS: readonly string[] = CREW_LINES.map((line) => line.verb)

/** The line a verb's shape names, or undefined when the word is not one a member sends. */
export const shapeOf = (verb: string): LineShape | undefined => CREW_LINES.find((line) => line.verb === verb)

/**
 * The lines a role card teaches, generated from the definitions above: one for a range and one for a design, per
 * verb. Nothing here is written out a second time; a card that quotes a shape quotes this text.
 */
export function linesACardTeaches(): readonly { readonly line: string; readonly says: string }[] {
  const taught: { line: string; says: string }[] = []
  for (const shape of CREW_LINES) {
    const what = shape.verb === 'VERDICT' ? 'a review round closed' : 'a package handed over'
    const words = ['<org/repo#n>', ...shape.parts.slice(1).map(textOfPart)]
    taught.push({ line: [shape.verb, ...words, ...shape.shown.range.map((key) => `${key}=${placeholderOf(shape.keys[key] ?? 'number')}`)].join(' '), says: `${what} on a range` })
    const designWords = words.slice(0, shape.inPlaceOf['doc'])
    taught.push({ line: [shape.verb, ...designWords, ...shape.shown.design.map((key) => `${key}=${placeholderOf(shape.keys[key] ?? 'number')}`)].join(' '), says: `${what} on a design` })
  }
  return taught
}

/** One part as a card writes it: the word itself, one of the words joined by `|`, or the value's name in brackets. */
const textOfPart = (part: Part): string => ('word' in part ? part.word : 'oneOf' in part ? part.oneOf.join('|') : placeholderOf(part.value))
