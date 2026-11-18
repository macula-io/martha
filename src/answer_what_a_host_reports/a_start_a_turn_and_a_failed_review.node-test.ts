// A session's start, a turn, and a review the host saw fail, answered by the entry (martha#541, packages 2-4, 1b).
//
// This exists because 1b moves these three answers out of the Claude Code adapter and into the entry every host
// reaches. The adapter's own tests drive them through the relay and would still pass if the answer stayed in the
// adapter; these drive the entry alone, in the contract's words, with a host this file makes up. So a member the entry
// does not really answer fails here by name, and nothing in this file can lean on Claude Code's own tables.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools, TheStartLine } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { holdingTheEnds } from '../end_a_running_turn/hold_the_end.ts'
import { PATH_OF_SOURCE } from '../take_in_a_turn/take_in_a_turn.ts'
import type { TurnSource } from '../host_contract/host_contract.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { reviewSpawnsRemembered, type TheReportTheHostWrites, type TheReviewSpawns } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { answersOver, type TheAnswersOfOneLaunch } from './answer_what_a_host_reports.ts'

/** A host this file makes up: its own names for the envelope it writes when an agent fails. */
const A_MADE_UP_REPORT: TheReportTheHostWrites = {
  notification: 'agent-report',
  status: 'state',
  tool_use: 'call',
  summary: 'words',
  failed: 'gave-up',
}
const THE_REVIEWER_MODEL = 'the-reviewer'
const THE_RESOLVED_MODEL = 'the-reviewer-as-it-ran'
const THE_REVIEWS_CALL = 'call-1'
const THE_CREW_TEXT = 'You are a member of this crew.'
const THE_START_LINE = 'Your package has one act sent with no outcome.'
/** What the made-up launch hands every session it starts, and what the crew's start line carries. */
const HANDED_AT_START: readonly TurnSource[] = ['server_instructions']
const THE_LINE_CARRIES: TurnSource = 'package_contract'

/** The made-up host's envelope for a failed agent, naming `call`. */
const theEnvelopeFor = (call: string): string =>
  [
    `<${A_MADE_UP_REPORT.notification}>`,
    `<${A_MADE_UP_REPORT.tool_use}>${call}</${A_MADE_UP_REPORT.tool_use}>`,
    `<${A_MADE_UP_REPORT.status}>${A_MADE_UP_REPORT.failed}</${A_MADE_UP_REPORT.status}>`,
    `<${A_MADE_UP_REPORT.summary}>the account is at its limit</${A_MADE_UP_REPORT.summary}>`,
    `</${A_MADE_UP_REPORT.notification}>`,
  ].join('\n')

/** What the entry told the owner's row and the member. */
interface Told {
  readonly rows: string[]
  readonly member: string[]
}

/** The crew's answers this file needs, each one a value a case can set. */
interface TheCrewSays {
  /** The session a clear was told in, for the session id the crew is waiting for. */
  readonly predecessors?: Readonly<Record<string, string>>
  readonly line?: TheStartLine | null
}

function aCrew(says: TheCrewSays): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    theContractInForce: async () => undefined,
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => says.line ?? null,
    ends: holdingTheEnds(),
    thePredecessorOf: async (session_id) => says.predecessors?.[session_id] ?? null,
    theSpendInForce: async () => undefined,
    noteTheCallCounted: async () => undefined,
    theReviewModelOfTheCall: async () => null,
    theReviewModel: async () => THE_REVIEWER_MODEL,
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async () => undefined,
  }
}

interface AnEntry {
  readonly answers: TheAnswersOfOneLaunch
  readonly told: Told
  readonly reviews: TheReviewSpawns
}

function anEntry(t: TestContext, says: TheCrewSays = {}): AnEntry {
  const home = mkdtempSync(join(tmpdir(), 'martha-541-1b-entry-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  const told: Told = { rows: [], member: [] }
  const reviews = reviewSpawnsRemembered()
  const answers = answersOver({
    records: sessionRecordsIn(rowStreamsDirectory(rows)),
    launch: { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home, approved_fingerprints: [] },
    machine: thisMachine,
    binder: bindNothing,
    handed_at_start: HANDED_AT_START,
    crew: aCrew(says),
    crew_text: THE_CREW_TEXT,
    reviews,
    failed_review_report: A_MADE_UP_REPORT,
    told: { theRow: (line) => void told.rows.push(line), theMember: async (line) => void told.member.push(line) },
  })
  return { answers, told, reviews }
}

/** The inbound paths a session's record holds, in the order it took them in. */
const pathsIn = (answers: TheAnswersOfOneLaunch, session_id: string): readonly string[] => {
  const named = answers.named(session_id)
  assert.equal(typeof named, 'object', `the entry holds no session ${session_id}: ${String(named)}`)
  return typeof named === 'object' ? named.gate.ingested.map((ingestion) => ingestion.path) : []
}

test('#541 1b: a fresh start is kept with what the launch hands it, and answered with the crew text and the start line', async (t) => {
  const { answers } = anEntry(t, { line: { line: THE_START_LINE, taken_in: [THE_LINE_CARRIES] } })

  const answer = await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.deepEqual(answer, { taken: `${THE_CREW_TEXT}\n\n${THE_START_LINE}` })
  assert.deepEqual(pathsIn(answers, 'session-a'), [PATH_OF_SOURCE.server_instructions, PATH_OF_SOURCE.package_contract])
})

test('#541 1b: a second start of a session the entry holds is taken and wipes nothing it kept (martha#255)', async (t) => {
  const { answers } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  await answers.aTurnArrived('session-a', { text: 'a ring', arrival: { source: 'ring' } })

  const again = await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.deepEqual(again, { taken: '' }, 'a second start was handed the crew text again, so it was started again')
  assert.deepEqual(pathsIn(answers, 'session-a'), [PATH_OF_SOURCE.server_instructions, PATH_OF_SOURCE.ring])
})

test('#541 1b: a start the crew says it refreshed inherits the predecessor\'s record, whatever outcome the host reported', async (t) => {
  const { answers } = anEntry(t, { predecessors: { 'session-b': 'session-a' } })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  await answers.aTurnArrived('session-a', { text: 'a ring', arrival: { source: 'ring' } })

  await answers.aSessionStarted({ session_id: 'session-b', outcome: 'fresh' })

  assert.ok(pathsIn(answers, 'session-b').includes(PATH_OF_SOURCE.ring), 'the refreshed session started clean, so the clear wiped what its predecessor took in')
})

test('#541 1b: a turn for a session the entry never started is refused by name, and one it holds is kept', async (t) => {
  const { answers } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const refused = await answers.aTurnArrived('session-z', { text: 'hello', arrival: { source: 'owner_typed' } })
  const kept = await answers.aTurnArrived('session-a', { text: 'hello', arrival: { source: 'owner_typed' } })

  assert.match('refused' in refused ? refused.refused : '', /no start of session session-z was taken/)
  assert.deepEqual(kept, { kept: 1 })
  assert.equal(pathsIn(answers, 'session-a').at(-1), PATH_OF_SOURCE.owner_typed)
})

test('#541 1b: a turn for a session the crew refreshed is kept before the host\'s own start of it arrives', async (t) => {
  const { answers } = anEntry(t, { predecessors: { 'session-b': 'session-a' } })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const kept = await answers.aTurnArrived('session-b', { text: 'resume', arrival: { source: 'owner_typed' } })

  assert.deepEqual(kept, { kept: 1 })
  assert.deepEqual(pathsIn(answers, 'session-b'), [PATH_OF_SOURCE.server_instructions, PATH_OF_SOURCE.server_instructions, PATH_OF_SOURCE.owner_typed])
})

test('#541 1b: a review the host saw fail is named on the row and to the member, once, for a session the entry holds', async (t) => {
  const { answers, told, reviews } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  reviews.remember(THE_REVIEWS_CALL, THE_REVIEWER_MODEL)
  reviews.resolved(THE_REVIEWS_CALL, THE_RESOLVED_MODEL)
  const report = { session_id: 'session-a', text: theEnvelopeFor(THE_REVIEWS_CALL), origin_kind: A_MADE_UP_REPORT.notification }

  await answers.aReviewTheHostSawFail(report)
  await answers.aReviewTheHostSawFail(report)

  const line = `review on ${THE_RESOLVED_MODEL}: the account is at its limit`
  assert.deepEqual(told, { rows: [line], member: [line] })
})

test('#541 1b: a review reported for a session the entry does not hold names nothing', async (t) => {
  const { answers, told, reviews } = anEntry(t)
  reviews.remember(THE_REVIEWS_CALL, THE_REVIEWER_MODEL)
  reviews.resolved(THE_REVIEWS_CALL, THE_RESOLVED_MODEL)

  await answers.aReviewTheHostSawFail({ session_id: 'session-z', text: theEnvelopeFor(THE_REVIEWS_CALL), origin_kind: A_MADE_UP_REPORT.notification })

  assert.deepEqual(told, { rows: [], member: [] }, 'a report for a session the member never took a turn in named a review failed')
  assert.notEqual(reviews.theSpawn(THE_REVIEWS_CALL), undefined, 'the review was forgotten for a report that named nothing')
})

test('#541 1b: a turn whose origin is not the host\'s report names nothing, whatever its text says', async (t) => {
  const { answers, told, reviews } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  reviews.remember(THE_REVIEWS_CALL, THE_REVIEWER_MODEL)
  reviews.resolved(THE_REVIEWS_CALL, THE_RESOLVED_MODEL)

  await answers.aReviewTheHostSawFail({ session_id: 'session-a', text: theEnvelopeFor(THE_REVIEWS_CALL), origin_kind: 'typed-by-the-owner' })

  assert.deepEqual(told, { rows: [], member: [] }, 'a turn the engine never stamped as its report named a review failed')
})
