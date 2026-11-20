// Reading the first line of a message a member sent, when it is a HANDOFF or a VERDICT (martha#253, slice 4).
//
// This exists so a hand-off or a verdict that a member sends is checked as it is sent, and a line that does not read is
// taken as prose: the message is sent anyway, and the sender is told in one line which field did not read (martha#601).
// A line that reads adds its row to the package's ledger: a HANDOFF as an outward act, a VERDICT as the verdict it gave —
// a kind log_a_milestone cannot write (martha#350). What this does not do is check the range or the CI against GitHub:
// that is #256, and it does not check the sender either: under the owner's reset of 2026-11-11 a roster name is enough
// (../send_a_crew_message), so a member that sends a VERDICT line writes that row under its own name.
//
// The shapes are not written here: they are read from ./crew_lines.ts, the one definition the role cards are
// generated from, so what a member is taught and what this accepts cannot drift apart.

import { noteMilestone, noteMilestoneOnce, sendOutwardAct, WORK_PACKAGE, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { CREW_VERBS, VALUE_SHAPES, shapeOf, type LineShape, type Part, type ValueName } from './crew_lines.ts'
import { crewVerbOf, readAShorthandLine } from './the_other_crew_verbs.ts'

/** A line that read: its verb, the package it names, and the words and keys it carried. */
export interface CrewLineRead {
  readonly verb: string
  readonly package: string
  readonly words: readonly string[]
  readonly keys: Readonly<Record<string, string>>
  /** The judgement a VERDICT carries, and nothing for a HANDOFF. */
  readonly verdict?: 'PASS' | 'FAIL'
  /** Every package or name a line of crew-code's other verbs is about, one per issue of a list (martha#980). */
  readonly targets?: readonly string[]
}

/**
 * What reading a message's first line came to: the line, when the whole of it read; otherwise prose, with the field that
 * did not read named in one line for the sender (martha#601). Nothing is refused.
 */
export interface LineReading {
  /** The line, when it read whole; null when the message goes as prose. */
  readonly line: CrewLineRead | null
  /** The field that did not read, when the message goes as prose: one line, and the row still records the message. */
  readonly notice?: string
}

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

/** Every crew line of a message, read, and one notice for each that did not read (martha#980). */
export interface EveryLineRead {
  readonly lines: readonly CrewLineRead[]
  readonly notices: readonly string[]
}

/**
 * Reads every line of `text` that counts as a crew line, as crew-code's shorthand reads a message: a line whose first
 * word is one of its fourteen verbs, ASK, YES and NO only when they carry a kind, a key or a package. A HANDOFF or a
 * VERDICT is read as readACrewLine reads it; the other verbs by crew-code's grammar (./the_other_crew_verbs.ts). A line
 * that does not read goes as prose with one notice, which names its line number when the message has more than one.
 */
export function readEveryCrewLine(text: string): EveryLineRead {
  const all = text.split('\n')
  const lines: CrewLineRead[] = []
  const notices: string[] = []
  all.forEach((line, index) => {
    const verb = crewVerbOf(line)
    if (verb === undefined) return
    const read = isCrewLine(verb) ? readACrewLine(line) : theOtherLineRead(verb, line)
    if (read.line !== null) lines.push(read.line)
    if (read.notice !== undefined) notices.push(all.length > 1 ? `line ${String(index + 1)}: ${read.notice}` : read.notice)
  })
  return { lines, notices }
}

/** A line of crew-code's other verbs, as a CrewLineRead: the target as written, then its words, its keys and its targets. */
function theOtherLineRead(verb: string, line: string): LineReading {
  const read = readAShorthandLine(line)
  if ('problem' in read) return { line: null, notice: tookItAsProse(verb, read.problem) }
  const written = (line.split('|')[0] ?? '').trim().split(/\s+/)[1] ?? ''
  return { line: { verb, package: read.line.targets[0] ?? written, words: [written, ...read.line.words], keys: read.line.keys, targets: read.line.targets } }
}

/** One line saying which field did not read, and that the message goes as prose (martha#601). */
const tookItAsProse = (verb: string, what: string): string => `${verb}: ${what}, so the line was read as prose.`

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
    if (token === undefined) return { line: null, notice: tookItAsProse(shape.verb, `${nameOfPart(part)} is missing`) }
    const notice = checkPart(shape.verb, part, token)
    if (notice !== undefined) return { line: null, notice }
    words.push(token)
  }
  return readTheKeys(shape, rest, words)
}

/** The keys after the words: each one the shape declares, at least those it requires, and each of the value's shape. */
function readTheKeys(shape: LineShape, tokens: readonly string[], words: readonly string[]): LineReading {
  const keys: Record<string, string> = {}
  for (const token of tokens) {
    const notice = readAKey(shape, token, keys)
    if (notice !== undefined) return { line: null, notice }
  }
  const missing = shape.required.find((key) => keys[key] === undefined)
  if (missing !== undefined) return { line: null, notice: tookItAsProse(shape.verb, `${missing} is missing`) }
  const package_name = words[0] ?? ''
  const verdict = words.find((word) => word === 'PASS' || word === 'FAIL')
  return { line: { verb: shape.verb, package: package_name, words, keys, ...(verdict === undefined ? {} : { verdict: verdict as 'PASS' | 'FAIL' }) } }
}

/** One `key=value` token, kept when its key is the shape's and its value the shape of that key; or the line that did not read. */
function readAKey(shape: LineShape, token: string, into: Record<string, string>): string | undefined {
  const [key, ...value_parts] = token.split('=')
  const value = value_parts.join('=')
  if (key === undefined || value === '' || value_parts.length === 0) return tookItAsProse(shape.verb, `${JSON.stringify(token)} is not key=value`)
  const named = shape.keys[key]
  if (named === undefined) return tookItAsProse(shape.verb, `${key} is not a field of this line (they are ${Object.keys(shape.keys).join(', ')})`)
  const notice = checkValue(shape.verb, key, named, value)
  if (notice !== undefined) return notice
  into[key] = value
  return undefined
}

const isAKeyOf = (shape: LineShape, token: string | undefined): boolean => token !== undefined && Object.hasOwn(shape.inPlaceOf, token.split('=')[0] ?? '')

/** What a part is called when a line is missing it. */
const nameOfPart = (part: Part): string => ('word' in part ? part.word : 'oneOf' in part ? part.oneOf.join(' or ') : part.name)

/** Whether a token is the part's word, one of its words, or a value of its shape; or the line naming the field that did not read. */
function checkPart(verb: string, part: Part, token: string): string | undefined {
  if ('word' in part) return part.word === token ? undefined : tookItAsProse(verb, `expected ${part.word}, read ${JSON.stringify(token)}`)
  if ('oneOf' in part) {
    return part.oneOf.includes(token) ? undefined : tookItAsProse(verb, `expected ${part.oneOf.join(' or ')}, read ${JSON.stringify(token)}`)
  }
  return checkValue(verb, part.name, part.value, token)
}

/** Whether a value's text is the shape its name declares; or the line naming the field and the shape it did not have. */
function checkValue(verb: string, name: string, value: ValueName, text: string): string | undefined {
  const shape = VALUE_SHAPES[value]
  return shape.matches.test(text) ? undefined : tookItAsProse(verb, `${name} is not ${shape.what}; read ${JSON.stringify(text)}`)
}

/**
 * Adds the row a line adds to its package's ledger: a HANDOFF as an outward act, a VERDICT as the verdict it gave, and,
 * as crew-code keeps them (martha#980), a LIVE as the release it shipped and a LAND as a checkpoint, once for each
 * package it names, and once (martha#983): said again, or logged by hand too, in the same round, it is the row already
 * kept. The other lines keep no row: crew-code keeps none for them, or Martha keeps that fact elsewhere.
 */
export async function keepTheLinesRow(host: LedgerHost, member: string, line: CrewLineRead): Promise<void> {
  if (line.verb === 'VERDICT') {
    await noteMilestone(host, { package: line.package, member, milestone: 'verdict_given', note: saidOf(line) })
    return
  }
  const milestone = MILESTONE_OF_A_LINE[line.verb]
  if (milestone !== undefined) {
    for (const named of (line.targets ?? []).filter((target) => WORK_PACKAGE.test(target))) await noteMilestoneOnce(host, { package: named, member, milestone, note: saidOf(line) })
    return
  }
  if (line.verb !== 'HANDOFF') return
  // The line is one a member sent on the crew channel: the act it announces is that line, and its conclusion is the
  // read itself, kept here so a refreshed member finds the hand-off it sent already counted.
  await sendOutwardAct(host, { package: line.package, member, act: { kind: 'handoff', what: saidOf(line) } }, async () => 'read as a crew line and added to this package\'s ledger')
}

/** The milestone a line of crew-code's other verbs keeps, by its verb: only these two keep one. */
const MILESTONE_OF_A_LINE: Readonly<Record<string, 'release_shipped' | 'checkpoint_reached'>> = { LIVE: 'release_shipped', LAND: 'checkpoint_reached' }

/**
 * The line as it was written: its verb, the words in their order (the package, a verdict's PASS or FAIL, and the
 * range), then the keys. The note the row keeps is itself a crew line, so it reads back with `readACrewLine` and the
 * range a VERDICT passed is not lost on the way into the ledger (martha#256).
 */
const saidOf = (line: CrewLineRead): string => [line.verb, ...line.words, ...Object.entries(line.keys).map(([key, value]) => `${key}=${value}`)].join(' ')
