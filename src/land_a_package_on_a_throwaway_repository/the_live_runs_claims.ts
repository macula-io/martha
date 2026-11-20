// The live run's crew claims (martha#639 section 6, the first four rows): the builder handed off, the handoff arrived, the
// reviewer gave a verdict, and the verdict arrived. Each is read from that member's own transcript, as JSON lines, one
// record at a time: a tool call by its name and input, a turn by its role and text. Never a grep of one serialised
// shape (the live run's finding 2: a Read result carried line numbers the expected shape did not).
//
// One member's lines never stand in for the other's: the builder's call is read only in the builder's transcript, and
// the handoff's arrival only in the reviewer's. A record the host marks as a subagent's (`isSidechain`) is not the
// member's own, and a request blob repeats the conversation rather than recording it, so neither counts.

import { ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { FRAME_OPENING } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { shapeOf, VALUE_SHAPES } from '../read_a_crew_line/crew_lines.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'

/** The live run's one package: its name, its range, and the two members who work it. */
export interface TheLiveRun {
  readonly package: string
  readonly range: string
  readonly builder: string
  readonly reviewer: string
}

/** The rows of section 6 this module proves, by the name a failure is reported under. */
export const HANDOFF_SAID = 'the builder handed off'
export const HANDOFF_ARRIVED = 'the handoff arrived'
export const VERDICT_SAID = 'the reviewer gave a verdict'
export const VERDICT_ARRIVED = 'the verdict arrived'

/** The live run's package has no CI: its lines say so with the ids shape's own word for it (crew_lines.ts). */
export const NO_CI_RUN = 'none:paths'
/** The one round a live run runs, the verdict it expects, and the changes that verdict requires. */
export const THE_ROUND = '1'
/**
 * The verdict word is the crew's own, never spelled here: the passing word, which the VERDICT shape lists first
 * (crew_lines.ts). The claims tests write the live run's lines out with it, so a shape that reordered its words fails them.
 */
const VERDICT_WORDS = shapeOf('VERDICT')?.parts.find((part) => 'oneOf' in part)
export const THE_VERDICT: string = VERDICT_WORDS !== undefined && 'oneOf' in VERDICT_WORDS ? (VERDICT_WORDS.oneOf[0] ?? '') : ''
export const NONE_REQUIRED = '0'

/** The values the live run's lines carry, by key. */
const LIVE_RUN_VALUES: Readonly<Record<string, string>> = { r: THE_ROUND, ci: NO_CI_RUN, req: NONE_REQUIRED }

/** The record type the host gives a request blob. */
const REQUEST_BLOB = 'api-request-blob'

/**
 * The exact line a member sends on the live run's package for `verb`, built from the verb's shape: its parts in order,
 * then the keys a line on a range shows. A shape this live run cannot fill throws: the definition moved, and the live run's
 * claims must move with it.
 */
export function theLiveRunsLine(verb: string, liveRun: TheLiveRun): string {
  const shape = shapeOf(verb)
  if (shape === undefined) throw new Error(`${verb} is not a line a member sends`)
  const words = shape.parts.map((part) => {
    if ('word' in part) return part.word
    if ('oneOf' in part) {
      if (!part.oneOf.includes(THE_VERDICT)) throw new Error(`${verb} takes none of ${part.oneOf.join('|')} the live run expects`)
      return THE_VERDICT
    }
    return part.value === 'package' ? liveRun.package : liveRun.range
  })
  const keys = shape.shown.range.map((key) => {
    const value = LIVE_RUN_VALUES[key]
    if (value === undefined) throw new Error(`${verb} shows ${key}, which the live run gives no value`)
    return `${key}=${value}`
  })
  return [verb, ...words, ...keys].join(' ')
}

/** One record of a transcript, as far as these claims read it. */
export interface TheRecord {
  readonly type?: unknown
  readonly isSidechain?: unknown
  readonly timestamp?: unknown
  readonly message?: { readonly role?: unknown; readonly content?: unknown }
}

/** A line a member said or was handed, and when the host wrote it. */
interface Seen {
  readonly firstLine: string
  readonly at: number
}

/** A turn handed to the member, with who it is from. */
interface Handed extends Seen {
  readonly from: string
}

/**
 * The member's own records: every line of the transcript parsed, but a request blob and a subagent's record. A line
 * that is not JSON throws: a transcript the live run cannot read is never read as one holding nothing.
 */
export function theMembersRecords(text: string): readonly TheRecord[] {
  const records: TheRecord[] = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      throw new Error(`line ${index + 1} of the transcript is not JSON`)
    }
    if (typeof record !== 'object' || record === null) throw new Error(`line ${index + 1} of the transcript is not a record`)
    const read = record as TheRecord
    if (read.type === REQUEST_BLOB || read.isSidechain === true) continue
    records.push(read)
  }
  return records
}

const firstLineOf = (text: string): string => text.split('\n')[0] ?? ''

/** When a record was written, or NaN when it carries no time the live run can order by. */
const whenOf = (record: TheRecord): number => (typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN)

/** What a content block says to the crew: the text of a `say_to_the_crew` call, or undefined for any other block. */
function theSayIn(block: Record<string, unknown> | undefined): string | undefined {
  if (block?.['type'] !== 'tool_use' || typeof block['name'] !== 'string') return undefined
  if (ownNameOfCalledTool(block['name']) !== SAY_TO_THE_CREW) return undefined
  const text = (block['input'] as Record<string, unknown> | undefined)?.['text']
  return typeof text === 'string' ? text : undefined
}

/** Every `say_to_the_crew` call in the records, by the first line of what it says. */
function theSays(records: readonly TheRecord[]): readonly Seen[] {
  const blocks = records.flatMap((record) => {
    const content = record.message?.content
    if (record.message?.role !== 'assistant' || !Array.isArray(content)) return []
    return (content as readonly Record<string, unknown>[]).map((block) => ({ record, block }))
  })
  const said: Seen[] = []
  for (const { record, block } of blocks) {
    const text = theSayIn(block)
    if (text !== undefined) said.push({ firstLine: firstLineOf(text), at: whenOf(record) })
  }
  return said
}

/** A user turn's text: the string the host wrote, or its text blocks joined. */
function turnText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const texts = (content as readonly Record<string, unknown>[]).filter((block) => block?.['type'] === 'text' && typeof block['text'] === 'string')
  return texts.length === 0 ? undefined : texts.map((block) => block['text'] as string).join('')
}

/** A text matched as itself inside a pattern. */
const asWritten = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The frame a crew message is handed in, `framed()`'s `<opening><position>] <sender>: <text>`, its opening the
 * carrier's own constant; a test reads a turn the carrier itself framed, so the two cannot drift apart unseen.
 */
const FRAMED = new RegExp(`^${asWritten(FRAME_OPENING)}[1-9][0-9]*\\] ([^:\\n]+): ([\\s\\S]*)$`)

/** Every crew message handed to the member as a turn, by its sender and the first line of what it says. */
function theHanded(records: readonly TheRecord[]): readonly Handed[] {
  const handed: Handed[] = []
  for (const record of records) {
    if (record.message?.role !== 'user') continue
    const text = turnText(record.message.content)
    if (text === undefined) continue
    const framed = FRAMED.exec(text)
    if (framed === null) continue
    handed.push({ from: framed[1] ?? '', firstLine: firstLineOf(framed[2] ?? ''), at: whenOf(record) })
  }
  return handed
}

/** The first of `seen` that says `line` after `after`, by the host's own times. */
const firstSaying = <T extends Seen>(seen: readonly T[], line: string, after: number): T | undefined =>
  seen.find((one) => one.firstLine === line && one.at > after)

/**
 * The first of the four rows that the two transcripts do not show, as `<row>: <why>`, or undefined when all four hold.
 * Each row must come after the one before it, by the times the host wrote.
 */
export function whichCrewClaimFails(liveRun: TheLiveRun, builderTranscript: string, reviewerTranscript: string): string | undefined {
  if (!VALUE_SHAPES.package.matches.test(liveRun.package)) return `the live run's package '${liveRun.package}' is not ${VALUE_SHAPES.package.what}`
  if (!VALUE_SHAPES.range.matches.test(liveRun.range)) return `the live run's range '${liveRun.range}' is not ${VALUE_SHAPES.range.what}`
  const handoff = theLiveRunsLine('HANDOFF', liveRun)
  const verdict = theLiveRunsLine('VERDICT', liveRun)
  const builder = theMembersRecords(builderTranscript)
  const reviewer = theMembersRecords(reviewerTranscript)

  const handedOff = firstSaying(theSays(builder), handoff, Number.NEGATIVE_INFINITY)
  if (handedOff === undefined) return `${HANDOFF_SAID}: no ${SAY_TO_THE_CREW} call in ${liveRun.builder}'s transcript opens with '${handoff}'`
  const arrived = firstSaying(
    theHanded(reviewer).filter((one) => one.from === liveRun.builder),
    handoff,
    handedOff.at,
  )
  if (arrived === undefined) return `${HANDOFF_ARRIVED}: no turn from ${liveRun.builder} in ${liveRun.reviewer}'s transcript opens with '${handoff}' after the builder's call`
  const gave = firstSaying(theSays(reviewer), verdict, arrived.at)
  if (gave === undefined) return `${VERDICT_SAID}: no ${SAY_TO_THE_CREW} call in ${liveRun.reviewer}'s transcript opens with '${verdict}' after the handoff arrived`
  const back = firstSaying(
    theHanded(builder).filter((one) => one.from === liveRun.reviewer),
    verdict,
    gave.at,
  )
  if (back === undefined) return `${VERDICT_ARRIVED}: no turn from ${liveRun.reviewer} in ${liveRun.builder}'s transcript opens with '${verdict}' after the reviewer's call`
  return undefined
}
