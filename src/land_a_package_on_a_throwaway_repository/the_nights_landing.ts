// The night's landing claims (martha#639 section 6, rows 5 to 7): the landing asked the owner, the owner said yes, and
// it landed. The ask is read from the builder's own transcript, record by record (a `verify_range` call on the night's
// range, its result's question, and an `ask_the_owner` call carrying that question word for word); the yes and the
// landing from the crew's own rows, as the run copies them out of the container: the owner_asks stream and the
// package's ledger. Every word the rows are matched by is the producer's own constant, never spelled again here.
//
// GitHub's side of "it landed" (main holds the tip, the pull request reads merged) is the run's bash, which reads the
// API; this module proves only what the crew recorded.

import { ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { OWNERS_QUESTION_LEAD_IN, VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import type { StoredRow } from '../host_contract/host_contract.ts'
import { theOwnersYesTo } from '../land_passed_work_as_one_batch/the_owners_yes_to_a_landing.ts'
import type { LedgerRow } from '../log_ledger/log_ledger.ts'
import { ASK_QUEUED, ASKS_SETTLED, QUEUE_ASK } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { theMembersRecords, type TheNight, type TheRecord } from './the_nights_claims.ts'

/** The rows of section 6 this module proves, by the name a failure is reported under. */
export const LANDING_ASKED = 'the landing asked the owner'
export const OWNER_SAID_YES = 'the owner said yes'
export const IT_LANDED = 'it landed'

type Block = Readonly<Record<string, unknown>>

/** Each content block of the records of `role`, with the record it is in. */
const theBlocks = (records: readonly TheRecord[], role: string): readonly { readonly record: TheRecord; readonly block: Block }[] =>
  records.flatMap((record) => {
    const content = record.message?.content
    if (record.message?.role !== role || !Array.isArray(content)) return []
    return (content as readonly Block[]).map((block) => ({ record, block }))
  })

/** When a record was written, or NaN when it carries no time the night can order by. */
const whenOf = (record: TheRecord): number => (typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN)

/** The input of a call to the tool `name`, or undefined for any other block. */
function theCallTo(block: Block, name: string): Block | undefined {
  if (block['type'] !== 'tool_use' || typeof block['name'] !== 'string' || ownNameOfCalledTool(block['name']) !== name) return undefined
  const input = block['input']
  return typeof input === 'object' && input !== null ? (input as Block) : undefined
}

/** A tool result's text: the string the host wrote, or its text blocks joined. */
function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const texts = (content as readonly Block[]).filter((part) => part['type'] === 'text' && typeof part['text'] === 'string')
  return texts.length === 0 ? undefined : texts.map((part) => part['text'] as string).join('')
}

/** The question a verify_range answer hands the member: the line after its lead-in, or undefined when it has none. */
function theQuestionIn(text: string): string | undefined {
  const lines = text.split('\n')
  const at = lines.indexOf(OWNERS_QUESTION_LEAD_IN)
  return at === -1 ? undefined : lines[at + 1]
}

/**
 * Each question verify_range handed the builder on a range from `base`, with when its answer was written, in the
 * transcript's order: on the night's range only when `tip` is given, on any tip from the base when it is not.
 */
function theVerifiedQuestions(records: readonly TheRecord[], base: string, tip?: string): readonly { readonly question: string; readonly at: number }[] {
  const ids = new Set(theBlocks(records, 'assistant').flatMap(({ block }) => {
    const input = theCallTo(block, VERIFY_RANGE)
    return input !== undefined && input['base'] === base && (tip === undefined || input['tip'] === tip) && typeof block['id'] === 'string' ? [block['id']] : []
  }))
  return theBlocks(records, 'user').flatMap(({ record, block }) => {
    if (block['type'] !== 'tool_result' || !ids.has(block['tool_use_id'] as string)) return []
    const question = theQuestionIn(resultText(block['content']) ?? '')
    return question !== undefined && question !== '' ? [{ question, at: whenOf(record) }] : []
  })
}

/** Whether the builder queued `question` word for word after `after`. */
const queuedAfter = (records: readonly TheRecord[], question: string, after: number): boolean =>
  theBlocks(records, 'assistant').some(({ record, block }) => theCallTo(block, QUEUE_ASK)?.['ask'] === question && whenOf(record) > after)

/** The id of the first ask queued with exactly `question`: its position in the owner_asks stream. */
const theAskOf = (asks: readonly StoredRow[], question: string): number | undefined =>
  asks.find(({ row }) => row['kind'] === ASK_QUEUED && row['question'] === question)?.position

/** When the owner's yes to ask `id` was settled, or undefined when no settle lists it as yes. */
function theYesTo(asks: readonly StoredRow[], id: number): number | undefined {
  const settled = asks.find(({ row }) => row['kind'] === ASKS_SETTLED && Array.isArray(row['yes']) && (row['yes'] as readonly unknown[]).includes(id))
  const at = settled?.row['at']
  return typeof at === 'number' ? at : undefined
}

/** When the push of `tip` was announced in the package's ledger, or undefined when it never was. */
function thePushOf(ledger: readonly LedgerRow[], tip: string): number | undefined {
  for (const row of ledger) {
    if (row.kind === 'act_announced' && row.act.kind === 'push' && row.act.what.includes(tip)) return row.at
  }
  return undefined
}

/** The rows the night's landing is read from. */
export interface TheLandingRecord {
  readonly builderTranscript: string
  readonly asks: readonly StoredRow[]
  readonly ledger: readonly LedgerRow[]
  /** When the night printed the owner's attach command, ms: the owner could say yes only after it (section 6). */
  readonly attachPrintedAt: number
}

/** The ask the landing was asked under: its question and its id, or why there is none, as `<row>: <why>`. */
function theAskedLanding(night: TheNight, base: string, tip: string, record: TheLandingRecord): { readonly id: number } | string {
  const records = theMembersRecords(record.builderTranscript)
  const [verified] = theVerifiedQuestions(records, base, tip)
  if (verified === undefined) return `${LANDING_ASKED}: no ${VERIFY_RANGE} answer on ${night.range} in ${night.builder}'s transcript hands the owner a question`
  if (!queuedAfter(records, verified.question, verified.at)) {
    return `${LANDING_ASKED}: ${night.builder} never queued ${JSON.stringify(verified.question)} with ${QUEUE_ASK} after ${VERIFY_RANGE} answered`
  }
  const id = theAskOf(record.asks, verified.question)
  return id === undefined ? `${LANDING_ASKED}: the owner's asks hold no ask queued as ${JSON.stringify(verified.question)}` : { id }
}

/**
 * The first of rows 5 to 7 the builder's transcript and the crew's rows do not show, as `<row>: <why>`, or undefined
 * when all three hold. The yes must be settled after the owner's attach command was printed, and before the push was
 * announced.
 */
export function whichLandingClaimFails(night: TheNight, record: TheLandingRecord): string | undefined {
  const [base, tip] = night.range.split('..')
  if (base === undefined || tip === undefined) return `the night's range '${night.range}' is not <base>..<tip>`
  const asked = theAskedLanding(night, base, tip, record)
  if (typeof asked === 'string') return asked
  const yes = theYesTo(record.asks, asked.id)
  if (yes === undefined) return `${OWNER_SAID_YES}: no settle of the owner's asks lists ask ${String(asked.id)} as yes`
  const pushed = thePushOf(record.ledger, tip)
  if (pushed === undefined) return `${IT_LANDED}: ${night.package}'s ledger announces no push of ${tip}`
  if (!(yes < pushed)) return `${OWNER_SAID_YES}: the yes to ask ${String(asked.id)} was settled at ${String(yes)}, not before the push at ${String(pushed)}`
  if (!(yes > record.attachPrintedAt)) {
    return `${OWNER_SAID_YES}: the yes to ask ${String(asked.id)} was settled at ${String(yes)}, not after the owner's attach command was printed at ${String(record.attachPrintedAt)}`
  }
  const note = `${base}..${tip} on ${theOwnersYesTo(asked.id)}`
  if (!record.ledger.some((row) => row.kind === 'package_landed' && row.note === note)) return `${IT_LANDED}: ${night.package}'s ledger holds no package_landed row noting '${note}'`
  return undefined
}

/**
 * Whether the builder has queued the landing's ask (section 2 step 7), before the tip is known: a verify_range answer on
 * a range from `base` handed a question, the builder queued it word for word after that answer, and the owner's asks
 * hold it. Any other ask the crew queued first is not it (Saturnus, #639 PR 821 r=2). Undefined when it is queued, the
 * reason, as `<row>: <why>`, when it is not.
 */
export function whyTheLandingIsNotAsked(base: string, builder: string, record: Pick<TheLandingRecord, 'builderTranscript' | 'asks'>): string | undefined {
  const records = theMembersRecords(record.builderTranscript)
  const verified = theVerifiedQuestions(records, base)
  if (verified.length === 0) return `${LANDING_ASKED}: no ${VERIFY_RANGE} answer on a range from ${base} in ${builder}'s transcript hands the owner a question yet`
  const queued = verified.some(({ question, at }) => queuedAfter(records, question, at) && theAskOf(record.asks, question) !== undefined)
  return queued ? undefined : `${LANDING_ASKED}: the owner's asks hold no ask ${builder} queued as a ${VERIFY_RANGE} answer's question yet`
}
