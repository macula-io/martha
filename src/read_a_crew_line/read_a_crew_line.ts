// Reading the first line of a message a member sent, when it is a HANDOFF or a VERDICT (martha#253, slice 4).
//
// This exists so a hand-off or a verdict that a member sends is checked as it is sent, and a broken one comes back to
// the sender naming the field that is wrong instead of sitting unnoticed in a channel. A line that reads adds its row
// to the package's ledger: a HANDOFF as an outward act, a VERDICT as the verdict it gave — a kind no member's own
// milestone can be (martha#350). What this does not
// do is check the range or the CI against GitHub: that is #256.
//
// The shapes are not written here: they are read from ./crew_lines.ts, the one definition the role cards are
// generated from, so what a member is taught and what this accepts cannot drift apart.

import { noteMilestone, sendOutwardAct, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { CREW_VERBS, VALUE_SHAPES, shapeOf, type LineShape, type Part, type ValueName } from './crew_lines.ts'

/** A line that read: its verb, the package it names, and the words and keys it carried. */
export interface CrewLineRead {
  readonly verb: string
  readonly package: string
  readonly words: readonly string[]
  readonly keys: Readonly<Record<string, string>>
  /** The judgement a VERDICT carries, and nothing for a HANDOFF. */
  readonly verdict?: 'PASS' | 'FAIL'
}

/** What reading a message's first line came to. */
export type LineReading =
  | { readonly line: null }
  | { readonly line: CrewLineRead }
  | { readonly refused: string }

const isCrewLine = (first_word: string): boolean => CREW_VERBS.includes(first_word)

/**
 * Reads the first line of `text`, when that line starts with a verb a member sends. Text that starts with no such
 * verb is not a crew line and is not refused: most messages are just messages.
 */
export function readACrewLine(text: string): LineReading {
  const first = (text.split('\n')[0] ?? '').trim()
  // A `| prose` tail follows the keys, in the words of the design; the keys never hold a space, so the tail is cut off.
  const withoutProse = first.split(' | ')[0] ?? ''
  const tokens = withoutProse.split(/\s+/).filter((token) => token !== '')
  const verb = tokens[0] ?? ''
  if (!isCrewLine(verb)) return { line: null }
  const shape = shapeOf(verb)
  if (shape === undefined) return { line: null }
  return readTheParts(shape, tokens.slice(1))
}

/** The words in the order the shape names them, then the keys, each checked against its own value's shape. */
function readTheParts(shape: LineShape, tokens: readonly string[]): LineReading {
  const rest = [...tokens]
  const words: string[] = []
  for (let part_index = 0; part_index < shape.parts.length; part_index += 1) {
    const part = shape.parts[part_index]
    if (part === undefined) break
    // A key that stands in place of this part (a `doc=` where the range would be) is read by the keys below.
    if (Object.values(shape.inPlaceOf).includes(part_index) && isAKeyOf(shape, rest[0])) break
    const token = rest.shift()
    if (token === undefined) return { refused: `${shape.verb}: ${nameOfPart(part)} is missing.` }
    const refused = checkPart(shape.verb, part, token)
    if (refused !== undefined) return { refused }
    words.push(token)
  }
  return readTheKeys(shape, rest, words)
}

/** The keys after the words: each one the shape declares, at least those it requires, and each of the value's shape. */
function readTheKeys(shape: LineShape, tokens: readonly string[], words: readonly string[]): LineReading {
  const keys: Record<string, string> = {}
  for (const token of tokens) {
    const refused = readAKey(shape, token, keys)
    if (refused !== undefined) return { refused }
  }
  const missing = shape.required.find((key) => keys[key] === undefined)
  if (missing !== undefined) return { refused: `${shape.verb}: ${missing} is missing.` }
  const package_name = words[0] ?? ''
  const verdict = words.find((word) => word === 'PASS' || word === 'FAIL')
  return { line: { verb: shape.verb, package: package_name, words, keys, ...(verdict === undefined ? {} : { verdict: verdict as 'PASS' | 'FAIL' }) } }
}

/** One `key=value` token, kept when its key is the shape's and its value the shape of that key; or why not. */
function readAKey(shape: LineShape, token: string, into: Record<string, string>): string | undefined {
  const [key, ...value_parts] = token.split('=')
  const value = value_parts.join('=')
  if (key === undefined || value === '' || value_parts.length === 0) return `${shape.verb}: ${JSON.stringify(token)} is not key=value.`
  const named = shape.keys[key]
  if (named === undefined) return `${shape.verb}: ${key} is not a field of this line (they are ${Object.keys(shape.keys).join(', ')}).`
  const refused = checkValue(shape.verb, key, named, value)
  if (refused !== undefined) return refused
  into[key] = value
  return undefined
}

const isAKeyOf = (shape: LineShape, token: string | undefined): boolean => token !== undefined && Object.hasOwn(shape.inPlaceOf, token.split('=')[0] ?? '')

/** What a part is called when a line is missing it. */
const nameOfPart = (part: Part): string => ('word' in part ? part.word : 'oneOf' in part ? part.oneOf.join(' or ') : part.name)

/** Whether a token is the part's word, one of its words, or a value of its shape; or why not, naming the field. */
function checkPart(verb: string, part: Part, token: string): string | undefined {
  if ('word' in part) return part.word === token ? undefined : `${verb}: expected ${part.word}, read ${JSON.stringify(token)}.`
  if ('oneOf' in part) {
    return part.oneOf.includes(token) ? undefined : `${verb}: expected ${part.oneOf.join(' or ')}, read ${JSON.stringify(token)}.`
  }
  return checkValue(verb, part.name, part.value, token)
}

/** Whether a value's text is the shape its name declares; or why not, naming the field and the shape. */
function checkValue(verb: string, name: string, value: ValueName, text: string): string | undefined {
  const shape = VALUE_SHAPES[value]
  return shape.matches.test(text) ? undefined : `${verb}: ${name} is not ${shape.what}; read ${JSON.stringify(text)}.`
}

/** Adds the row a line adds to its package's ledger: a HANDOFF as an outward act, a VERDICT as the verdict it gave. */
export async function keepTheLinesRow(host: LedgerHost, member: string, line: CrewLineRead): Promise<void> {
  if (line.verb === 'VERDICT') {
    await noteMilestone(host, { package: line.package, member, milestone: 'verdict_given', note: saidOf(line) })
    return
  }
  // The line is one a member sent on the crew channel: the act it announces is that line, and its conclusion is the
  // read itself, kept here so a refreshed member finds the hand-off it sent already counted.
  await sendOutwardAct(host, { package: line.package, member, act: { kind: 'handoff', what: saidOf(line) } }, async () => 'read as a crew line and added to this package\'s ledger')
}

/**
 * The line as it was written: its verb, the words in their order (the package, a verdict's PASS or FAIL, and the
 * range), then the keys. The note the row keeps is itself a crew line, so it reads back with `readACrewLine` and the
 * range a VERDICT passed is not lost on the way into the ledger (martha#256).
 */
const saidOf = (line: CrewLineRead): string => [line.verb, ...line.words, ...Object.entries(line.keys).map(([key, value]) => `${key}=${value}`)].join(' ')
