// What the launcher is doing, for the run that waits on it (martha#240).
//
// This exists so a run can tell a host waiting on a tool from a host that has stopped. The terminal and the model's
// requests alone cannot: between a tool call and the next request the host may show nothing for the whole silence
// budget while it is provably working, and a hosted runner that waits on a tool reds as a hung host (runs 42752345298
// and 42747883703, both attempt 1, both green on attempt 2 on the same head).
//
// The launcher writes a line when it receives an event and a line when it answers it, each with the event, the call's
// id and tool where the body carries them, and its time. Two lines give three stretches — the launcher deciding, the
// tool running, the launcher answering — and a run that goes quiet in one of them can name which. The journal also
// keeps the calls the launcher allowed and has not seen answered, so an open tool is not read as silence
// (../launch_a_claude_code_member/wait_while_the_host_keeps_showing.ts reads all of it).
//
// A launcher also notes what it did on no event of the host's, where a run has nowhere else to read it (martha#430): a
// telling that did not reach a member leaves the member's channel store's own refusal in the journal, so the one thing
// the member's half of it did is written down rather than swallowed.
//
// It is kept with Martha's own per-project state, one file per launch under RELAY_JOURNAL_PLACE, rewritten whole under
// a staging name. Only the last JOURNAL_EVENTS_KEPT lines are kept, beside a count of every line ever written, so a
// long run cannot grow the file and a reader still sees it move. A launch writes an empty journal as it is made, so a
// run never reads the launch before it, and files past JOURNAL_LAUNCHES_KEPT are pruned at the same moment.
//
// One rule is applied here rather than by the reader. The relay races the launcher's answer against RELAY_DEADLINE_MS
// and, when the deadline wins, denies the call itself (../claude_code_relay/hooks/register.ts) and the tool never runs.
// The launcher's late allow still arrives, so an allow written more than the deadline after its call's receipt is
// written as the deny the host took, with GAVE_UP_BEFORE_ALLOW as its reason, and the call never opens: a journal that
// called it an allow would say a tool is out when nothing is.
//
// Residual, stated: the relay's own clock starts when it posts the request, and the receipt line is stamped when the
// request reaches the launcher, so for that transit a call can pass this check and still have lost the relay's race. On
// a unix socket that is microseconds against 30 000 ms, and the most it costs is that one call left open.
//
// A journal that cannot be written is not a fault of the member: the write is swallowed and the last journal on disk
// stands, so the run reads an older one and its silence budget still ends it.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'

import { RELAY_DEADLINE_MS, type RelayEvent } from '../claude_code_relay/hooks/relay_protocol.ts'
import { projectStateDirectory, STATE_FILE_MODE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The directory inside Martha's state that holds the launcher's journals, one file per launch. */
export const RELAY_JOURNAL_PLACE = 'relay-journal'

/**
 * Where a launch keeps its journals, as a run watching it derives it: the project's state under the state home the run
 * handed the launcher — its own XDG_STATE_HOME — so a run reads the path the launcher was given, and the two cannot
 * drift into a run that reads no journal without a word (martha#240 r=1).
 */
export function relayJournalDirectory(state_home: string, checkout: string): string {
  return join(projectStateDirectory(join(state_home, STATE_ROOT_NAME), checkout), RELAY_JOURNAL_PLACE)
}

/** The extension of one launch's journal. */
export const RELAY_JOURNAL_SUFFIX = '.json'

/** How many of the launcher's lines are kept: enough to show a run moving, few enough that the file stays small. */
export const JOURNAL_EVENTS_KEPT = 32

/** How many launches' journals are kept: the newest, so a project's state does not grow with every launch it had. */
export const JOURNAL_LAUNCHES_KEPT = 64

/** A file being written before it is renamed into place, as every state file here is. */
const STAGING_PREFIX = '.staging-'

/** Why a late allow is written as a deny: the sentence the host's own deny would have carried. */
export const GAVE_UP_BEFORE_ALLOW = 'the relay gave up before this allow'

/** What the launcher answered an event with, as the journal keeps it. */
export type JournalAnswer = 'allow' | 'deny' | 'taken' | 'refused' | 'stopped'

/**
 * Whether a line says the launcher received the event, answered it, or is about something it did on no event of the
 * host's at all — a telling that did not reach a member has no event to hang on.
 */
export type JournalPhase = 'received' | 'answered' | 'noted'

/** One line of a launch's journal: an event the launcher received, the answer it gave it, or a thing it noted itself. */
export interface JournalLine {
  /** When the line was written, on the launcher's clock. */
  readonly at: string
  readonly phase: JournalPhase
  readonly event: string
  /** The host's own id for the call, when the body carries one. */
  readonly tool_use_id?: string
  /** The tool the event names, when it names one. */
  readonly tool?: string
  /** What the launcher answered, on an answer line. */
  readonly answer?: JournalAnswer
  /** Why it answered that, where the answer carries a reason. */
  readonly why?: string
}

/** A call the launcher allowed and has not seen answered: what a run is waiting on, not silence. */
export interface OpenCall {
  readonly tool_use_id: string
  readonly tool: string
  readonly at: string
}

/** What a reader of one launch's journal sees: how far it has got, what is open, and the last lines it kept. */
export interface RelayJournalRead {
  /** The launch this journal belongs to. */
  readonly launch: string
  /** Every line the launcher has ever written: more than last time is the launcher working. */
  readonly written: number
  readonly open: readonly OpenCall[]
  /** The lines kept, oldest first. */
  readonly events: readonly JournalLine[]
}

/** What a reader sees when there is no journal to read: a launch that never got as far as writing one. */
export const NO_JOURNAL: RelayJournalRead = { launch: '', written: 0, open: [], events: [] }

/** The journal one launch writes: a line when it receives an event, one when it answers it, and one it chose to note. */
export interface RelayJournal {
  /** The event arrived, before it queues: the line is stamped on this journal's own clock, like every other line. */
  received(event: RelayEvent, body: unknown): JournalEntry
  /**
   * Something the launcher did on no event of the host's, where a run has nowhere else to read it: what happened, under
   * `event`'s name, why, and — when it is about one of the host's calls — the call's own id (martha#430). A member not
   * being told is the case this exists for: the store refused the line, so the journal is the only place that says the
   * member's half of it did not happen, and which review's call it was about.
   */
  noted(event: string, why: string, tool_use_id?: string): void
}

/** The receipt of one event, answered once. */
export interface JournalEntry {
  /** The answer the launcher is about to send, written before it goes back. */
  answered(answer: JournalAnswer, why: string | undefined): void
}

/** Whether a value is an object a body can be read from. */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A word the body carries, or undefined when it carries none. */
const textIn = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** The body's call, as the journal names it: the host's id for it and the tool, where the body carries them. */
function callIn(body: unknown): { readonly tool_use_id?: string; readonly tool?: string } {
  const call = isRecord(body) ? body['call'] : undefined
  const tool_use_id = isRecord(call) ? textIn(call['tool_use_id']) : undefined
  const tool = isRecord(call) ? textIn(call['tool']) : undefined
  return { ...(tool_use_id === undefined ? {} : { tool_use_id }), ...(tool === undefined ? {} : { tool }) }
}

/** Which receipt an answer belongs to: the event and the call, which is what pairs a line with its receipt. */
const keyOf = (event: string, tool_use_id: string | undefined): string => `${event}|${tool_use_id ?? ''}`

/** An event received and not yet answered, as the launcher holds it until the answer is decided. */
interface Receipt {
  readonly key: string
  readonly at: number
}

/** What one launch's journal holds between writes. */
interface Writing {
  written: number
  readonly events: JournalLine[]
  readonly open: Map<string, OpenCall>
  readonly receipts: Receipt[]
}

/** The state file's text: the launch, every line ever written, the open calls, and the lines kept. */
function textOf(launch: string, writing: Writing): string {
  return `${JSON.stringify(
    {
      launch,
      written: writing.written,
      open: [...writing.open.values()],
      events: writing.events.slice(-JOURNAL_EVENTS_KEPT),
    },
    null,
    2,
  )}\n`
}

/** Writes `text` as `name` under `directory`: staged beside it, then renamed into place. */
function keepJournalFile(directory: string, name: string, text: string): void {
  const staged = join(directory, `${STAGING_PREFIX}${randomUUID()}`)
  fs.writeFileSync(staged, text, { mode: STATE_FILE_MODE, flag: 'wx' })
  fs.chmodSync(staged, STATE_FILE_MODE)
  fs.renameSync(staged, join(directory, name))
}

/** Removes the journals of the launches past the newest `JOURNAL_LAUNCHES_KEPT`, by the time each was last written. */
function pruneOldJournals(directory: string): void {
  let names: string[]
  try {
    names = fs.readdirSync(directory).filter((name) => name.endsWith(RELAY_JOURNAL_SUFFIX))
  } catch {
    return
  }
  if (names.length <= JOURNAL_LAUNCHES_KEPT) return
  const lastWritten = (path: string): number => {
    try {
      return fs.statSync(path).mtimeMs
    } catch {
      return 0
    }
  }
  const byLastWritten = names
    .map((name) => ({ name, path: join(directory, name), last: lastWritten(join(directory, name)) }))
    .sort((one, other) => other.last - one.last || one.name.localeCompare(other.name))
  for (const { path } of byLastWritten.slice(JOURNAL_LAUNCHES_KEPT)) {
    try {
      fs.rmSync(path)
    } catch {
      // A journal another launch is writing is left where it is: it is pruned once it stops.
    }
  }
}

/** Takes the receipt an answer belongs to off the launcher's list, saying when the event arrived. */
function takeReceipt(writing: Writing, key: string): number | undefined {
  const held = writing.receipts.findIndex((receipt) => receipt.key === key)
  if (held === -1) return undefined
  const arrived = writing.receipts[held]?.at
  writing.receipts.splice(held, 1)
  return arrived
}

/**
 * Whether the relay had already given up on this allow before the launcher wrote it: the relay's own deadline ran out,
 * the hook denied the call, and the tool never ran (the header's rule).
 */
const tooLate = (answer: JournalAnswer, received_at: number | undefined, now: number): boolean =>
  answer === 'allow' && received_at !== undefined && now - received_at > RELAY_DEADLINE_MS

/** Whether this answer leaves a call for a run to wait on: an allow the relay gave up on leaves none. */
const opensACall = (answer: JournalAnswer, tool_use_id: string | undefined, late: boolean): boolean =>
  answer === 'allow' && !late && tool_use_id !== undefined

/** The answer line, with a late allow written as the deny the host took. */
function answerLineOf(
  event: string,
  call: { readonly tool_use_id?: string; readonly tool?: string },
  answer: JournalAnswer,
  why: string | undefined,
  received_at: number | undefined,
  now: number,
): JournalLine {
  const late = tooLate(answer, received_at, now)
  const reason = late ? GAVE_UP_BEFORE_ALLOW : why
  return { at: isoOf(now), phase: 'answered', event, ...call, answer: late ? 'deny' : answer, ...(reason === undefined ? {} : { why: reason }) }
}

/** A time on the launcher's clock, as the journal writes it. */
const isoOf = (at: number): string => new Date(at).toISOString()

/**
 * The journal one launch keeps in `directory`, on the clock `now` gives (martha#240).
 *
 * The journal is written before the launch starts anything, so a run reading this directory reads this launch's file.
 * Every write is complete or absent, and a write that fails is swallowed: the journal is a run's evidence, not a rule
 * the member is stopped by, and the last journal on disk still ends the run by its silence budget.
 */
export function relayJournalKeptIn(directory: string, launch: string, now: () => number = Date.now): RelayJournal {
  const name = `${launch}${RELAY_JOURNAL_SUFFIX}`
  const writing: Writing = { written: 0, events: [], open: new Map(), receipts: [] }
  const keep = (): void => {
    try {
      keepJournalFile(directory, name, textOf(launch, writing))
    } catch {
      // Stated in the header: a journal that cannot be written leaves the last one on disk, and the wait still ends.
    }
  }
  const write = (line: JournalLine): void => {
    writing.written += 1
    writing.events.push(line)
    keep()
  }
  pruneOldJournals(directory)
  keep()
  return {
    noted: (event, why, tool_use_id) => write({ at: isoOf(now()), phase: 'noted', event, why, ...(tool_use_id === undefined ? {} : { tool_use_id }) }),
    received: (event, body) => {
      const at = now()
      const call = callIn(body)
      const key = keyOf(event, call.tool_use_id)
      writing.receipts.push({ key, at })
      // The tool returned when the relay posts its answer, which is this line: the call is no longer the run's wait.
      if (event === 'tool_answered' && call.tool_use_id !== undefined) writing.open.delete(call.tool_use_id)
      write({ at: isoOf(at), phase: 'received', event, ...call })
      return {
        answered: (answer, why) => {
          const received_at = takeReceipt(writing, key)
          const now_at = now()
          const late = tooLate(answer, received_at, now_at)
          if (call.tool_use_id !== undefined && opensACall(answer, call.tool_use_id, late)) {
            writing.open.set(call.tool_use_id, { tool_use_id: call.tool_use_id, tool: call.tool ?? '', at: isoOf(now_at) })
          }
          write(answerLineOf(event, call, answer, why, received_at, now_at))
        },
      }
    },
  }
}

const isLine = (value: unknown): value is JournalLine => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const line = value as Record<string, unknown>
  return typeof line['at'] === 'string' && (line['phase'] === 'received' || line['phase'] === 'answered' || line['phase'] === 'noted') && typeof line['event'] === 'string'
}

const isOpenCall = (value: unknown): value is OpenCall => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const call = value as Record<string, unknown>
  return typeof call['tool_use_id'] === 'string' && typeof call['tool'] === 'string' && typeof call['at'] === 'string'
}

/**
 * What a journal's text says, or NO_JOURNAL when it is not one: a file a reader cannot use is a file that tells it
 * nothing, and the run falls back to the terminal and the requests alone.
 */
export function readRelayJournal(text: string): RelayJournalRead {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return NO_JOURNAL
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return NO_JOURNAL
  const kept = value as Record<string, unknown>
  const { launch, written, open, events } = kept
  if (typeof launch !== 'string' || typeof written !== 'number' || !Array.isArray(open) || !Array.isArray(events)) return NO_JOURNAL
  return {
    launch,
    written,
    open: open.filter(isOpenCall),
    events: events.filter(isLine),
  }
}

/** One file's journal, or NO_JOURNAL when it is missing or unreadable. */
export function readTheRelayJournalAt(path: string): RelayJournalRead {
  try {
    return readRelayJournal(fs.readFileSync(path, 'utf8'))
  } catch {
    return NO_JOURNAL
  }
}

/** Every launch's journal in `directory`, or none when the directory cannot be read. */
const journalNamesIn = (directory: string): readonly string[] => {
  try {
    return fs.readdirSync(directory).filter((name) => name.endsWith(RELAY_JOURNAL_SUFFIX))
  } catch {
    return []
  }
}

const newestJournalIn = (directory: string): string | undefined => {
  const lastWritten = (name: string): number => {
    try {
      return fs.statSync(join(directory, name)).mtimeMs
    } catch {
      return 0
    }
  }
  return journalNamesIn(directory).map((name) => ({ name, last: lastWritten(name) })).sort((one, other) => other.last - one.last || one.name.localeCompare(other.name))[0]?.name
}

/**
 * The journal of the launch running in `directory`: its newest file, or NO_JOURNAL when it holds none. A project with
 * one member has one journal, which is that launch's. A project with more than one member has one journal per launch,
 * and the newest is the closest a run can get: the launcher names a journal by a launch id the run is never given
 * (martha#253). Where a run only needs to know whether any launch has written at all, `anyJournalHasALine` asks the
 * project rather than its newest file.
 */
export function readTheNewestRelayJournal(directory: string): RelayJournalRead {
  const name = newestJournalIn(directory)
  return name === undefined ? NO_JOURNAL : readTheRelayJournalAt(join(directory, name))
}

/**
 * Whether any launch in `directory` has written a line (martha#253). A project can hold more than one member — two
 * members of one crew share a checkout and its journal directory — and a launch writes its journal before it starts
 * anything, so the newest file can belong to a member that started beside the one a run is watching and has written
 * nothing yet. Whether a run read a journal at all is a question about the project, not about the newest file.
 */
export function anyJournalHasALine(directory: string): boolean {
  return journalNamesIn(directory).some((name) => readTheRelayJournalAt(join(directory, name)).written > 0)
}

/** One stretch a run can be waiting in, as the journal shows it: the launcher deciding, the tool, or the launcher answering. */
export type Stretch =
  | { readonly kind: 'deciding'; readonly key: string; readonly of: string }
  | { readonly kind: 'answering'; readonly key: string; readonly of: string }
  | { readonly kind: 'tool'; readonly key: string; readonly of: string; readonly at: string }

/** Which event a receipt answers with: the launcher's own phase, as a person reading a red would name it. */
const phaseOf = (event: string): 'deciding' | 'answering' => (event === 'tool_answered' ? 'answering' : 'deciding')

/**
 * What the run is waiting in, or undefined when the launcher holds nothing open (martha#240).
 *
 * A line the launcher received and has not answered is the stretch the launcher is in, and the oldest one first: the
 * events are answered one at a time, so the head of that queue is what everything behind it waits for. With nothing
 * pending, a call the launcher allowed and has not seen answered is the tool's stretch.
 */
export function stretchOfTheJournal(journal: RelayJournalRead): Stretch | undefined {
  const answered = new Set<string>()
  for (const line of journal.events) {
    if (line.phase === 'answered') answered.add(keyOf(line.event, line.tool_use_id))
  }
  for (const line of journal.events) {
    if (line.phase !== 'received' || answered.has(keyOf(line.event, line.tool_use_id))) continue
    const key = `pending|${keyOf(line.event, line.tool_use_id)}`
    // The launcher deciding a call is named by the tool it is deciding; the launcher answering one, by the event it is
    // answering, because the tool is the host's by then and the launcher's own work is what a run is waiting on.
    return phaseOf(line.event) === 'answering'
      ? { kind: 'answering', key, of: line.event }
      : { kind: 'deciding', key, of: line.tool ?? line.event }
  }
  const oldest = [...journal.open].sort((one, other) => one.at.localeCompare(other.at))[0]
  return oldest === undefined ? undefined : { kind: 'tool', key: `tool|${oldest.tool_use_id}`, of: oldest.tool, at: oldest.at }
}
