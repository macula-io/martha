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
import { sessionRecordsIn, type SessionRecords } from '../session_records_in_rows/session_records_in_rows.ts'
import { agentRunsKept, answersOver, type TheAnswersOfOneLaunch } from './answer_what_a_host_reports.ts'

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
  /** The session ids the crew's start line was built for, in order (martha#658). */
  readonly asked?: string[]
  /** Every start the crew was told of, in order: the session's id, and whether its start was taken (martha#658). */
  readonly starts?: { session: string; taken: boolean }[]
  /** The crew's state a turn is handed (martha#984), or a read that throws when it is an Error. */
  readonly crew_state?: TheStartLine | null | Error
}

function aCrew(says: TheCrewSays): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    theContractInForce: async () => undefined,
    startSweeping: () => () => {},
    theLineToHandAtStart: async (session_id) => {
      says.asked?.push(session_id)
      return says.line ?? null
    },
    theCrewStateOfATurn: async () => {
      if (says.crew_state instanceof Error) throw says.crew_state
      return says.crew_state ?? null
    },
    noteTheStart: (session_id, taken) => void says.starts?.push({ session: session_id, taken }),
    ends: holdingTheEnds(),
    thePredecessorOf: async (session_id) => says.predecessors?.[session_id] ?? null,
    theSpendInForce: async () => undefined,
    noteTheCallCounted: async () => undefined,
    theReviewModelOfTheCall: async () => null,
    theReviewModel: async () => THE_REVIEWER_MODEL,
    noteTheCallsAnswer: () => undefined,
    noteTheWorkInHand: () => {},
    refusesTheSubagent: async () => undefined,
  }
}

/** The sessions whose next flush, or next check, of their record fails once, as a full disk would refuse it. */
interface FailingOnce {
  readonly flush: Set<string>
  readonly check: Set<string>
}

/** The record `records` keeps, but a session named in `failing` has its next flush or check refused, once. */
function recordsFailingOnce(records: SessionRecords, failing: FailingOnce): SessionRecords {
  const once = async (sessions: Set<string>, session_id: string, work: () => Promise<void>): Promise<void> => {
    if (sessions.delete(session_id)) throw Object.assign(new Error('the disk is full'), { code: 'ENOSPC' })
    return work()
  }
  return {
    load: (session_id) => records.load(session_id),
    get store() {
      return records.store
    },
    flush: (session_id) => once(failing.flush, session_id, () => records.flush(session_id)),
    check: (session_id) => once(failing.check, session_id, () => records.check(session_id)),
  }
}

interface AnEntry {
  readonly answers: TheAnswersOfOneLaunch
  readonly told: Told
  readonly reviews: TheReviewSpawns
  readonly failing: FailingOnce
}

function anEntry(t: TestContext, says: TheCrewSays = {}, also: { readonly note?: (line: string) => void } = {}): AnEntry {
  const home = mkdtempSync(join(tmpdir(), 'martha-541-1b-entry-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  const told: Told = { rows: [], member: [] }
  const reviews = reviewSpawnsRemembered()
  const failing: FailingOnce = { flush: new Set(), check: new Set() }
  const answers = answersOver({
    records: recordsFailingOnce(sessionRecordsIn(rowStreamsDirectory(rows)), failing),
    launch: { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home, approved_fingerprints: [] },
    machine: thisMachine,
    binder: bindNothing,
    handed_at_start: HANDED_AT_START,
    crew: aCrew(says),
    crew_text: THE_CREW_TEXT,
    reviews,
    failed_review_report: A_MADE_UP_REPORT,
    told: { theRow: (line) => void told.rows.push(line), theMember: async (line) => void told.member.push(line), takeTheLineBack: () => {} },
    // The tool call's places (PR 2), which no case here calls: no agent, a policy that sends nothing, names as called.
    agents: agentRunsKept(),
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: (called) => called },
    refusesAWriteToTheOwnersSettings: () => undefined,
    refusesAWriteToTheOwnersMemory: () => undefined,
    ...also,
  })
  return { answers, told, reviews, failing }
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

test('#658: the crew builds the start line for the host\'s own session id, and is told that start was taken', async (t) => {
  const says: TheCrewSays = { line: { line: THE_START_LINE, taken_in: [THE_LINE_CARRIES] }, asked: [], starts: [] }
  const { answers } = anEntry(t, says)

  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.deepEqual(says.asked, ['session-a'], 'the crew built the line for a session other than the one the host started')
  assert.deepEqual(says.starts, [{ session: 'session-a', taken: true }], 'the start taken was not noted to the crew, so its beats were never marked handed')
})

test('#658: a refused start is noted as refused, so the hand that start read is dropped unmarked', async (t) => {
  const says: TheCrewSays = { line: { line: THE_START_LINE, taken_in: [] }, starts: [] }
  const entry = anEntry(t, says)
  entry.failing.flush.add('session-a')

  const refused = await entry.answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.ok('refused' in refused, 'a start whose record could not be kept was answered taken')
  assert.deepEqual(says.starts, [{ session: 'session-a', taken: false }], 'a refused start was noted as taken, so its beats would never be handed again')
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

/** A session the entry started, whose record then could not be kept for a turn: the reason the entry gave. */
async function aSessionBrokenByAKeep(entry: AnEntry, session_id: string): Promise<string> {
  await entry.answers.aSessionStarted({ session_id, outcome: 'fresh' })
  entry.failing.flush.add(session_id)
  const answer = await entry.answers.aTurnArrived(session_id, { text: 'a ring', arrival: { source: 'ring' } })
  assert.ok('refused' in answer, 'a turn whose record could not be kept was answered kept')
  return answer.refused
}

test('#541 1b: a session whose record could not be kept is refused a new start, with that reason, and no record is begun', async (t) => {
  const entry = anEntry(t)
  const why = await aSessionBrokenByAKeep(entry, 'session-a')

  // The disk takes the record again from here, so only the entry's own memory of the break can refuse this start.
  const again = await entry.answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.deepEqual(again, { refused: why }, 'a session this launch can no longer vouch for was started again from a clean record, dropping what it took in')
  assert.equal(entry.answers.holds('session-a'), false, 'the refused start began a record for the session')
})

test('#541 1b: a turn in a session whose record could not be kept is refused with that reason, not as one never started (martha#593)', async (t) => {
  const entry = anEntry(t)
  const why = await aSessionBrokenByAKeep(entry, 'session-a')

  const next = await entry.answers.aTurnArrived('session-a', { text: 'hello', arrival: { source: 'owner_typed' } })

  assert.deepEqual(next, { refused: why }, 'the owner was not told why the session stopped being answered for')
})

test('#541 1b: a record that can no longer be vouched for breaks its session, so the next turn is refused with that reason (martha#593)', async (t) => {
  const entry = anEntry(t)
  await entry.answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  const session = entry.answers.named('session-a')
  assert.equal(typeof session, 'object', 'the entry holds no session it just started')
  entry.failing.check.add('session-a')

  const why = typeof session === 'object' ? await entry.answers.vouchFor(session) : session
  assert.equal(typeof why, 'string', 'a record the store could not check was vouched for')

  assert.equal(entry.answers.brokenBecause('session-a'), why, 'the session stayed live after its record was found untrustworthy')
  assert.deepEqual(await entry.answers.aTurnArrived('session-a', { text: 'hello', arrival: { source: 'owner_typed' } }), { refused: why })
})

const THE_CREW_STATE = 'Standing items (1): hold the landing for the owner.'
const THE_STATE_CARRIES: TurnSource = 'state_of_the_crew'

test("martha#984: the crew's state a turn is handed is taken in on its own source before it is answered (mutant: handed without the take-in)", async (t) => {
  const { answers } = anEntry(t, { crew_state: { line: THE_CREW_STATE, taken_in: [THE_STATE_CARRIES] } })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.equal(await answers.theCrewStateToHand('session-a'), THE_CREW_STATE)
  assert.deepEqual(pathsIn(answers, 'session-a'), [PATH_OF_SOURCE.server_instructions, PATH_OF_SOURCE.state_of_the_crew])
})

test("martha#984: no crew state hands nothing and takes nothing in; a session the entry does not hold is handed nothing, and the crew is not asked", async (t) => {
  const { answers } = anEntry(t, { crew_state: null })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  assert.equal(await answers.theCrewStateToHand('session-a'), undefined)
  assert.deepEqual(pathsIn(answers, 'session-a'), [PATH_OF_SOURCE.server_instructions])

  const stranger = anEntry(t, { crew_state: new Error('the crew was asked for a session the launch does not hold') })
  assert.equal(await stranger.answers.theCrewStateToHand('session-x'), undefined)
})

test("martha#984: a crew state whose record could not be kept, or that the crew could not read, is not handed, and says why in a note (mutant: handed when the keep failed)", async (t) => {
  const notes: string[] = []
  const entry = anEntry(t, { crew_state: { line: THE_CREW_STATE, taken_in: [THE_STATE_CARRIES] } }, { note: (line: string) => void notes.push(line) })
  await entry.answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  entry.failing.flush.add('session-a')
  assert.equal(await entry.answers.theCrewStateToHand('session-a'), undefined, "the crew's state was handed though its record was not kept")

  const unread = anEntry(t, { crew_state: new Error('the standing stream is gone') }, { note: (line: string) => void notes.push(line) })
  await unread.answers.aSessionStarted({ session_id: 'session-b', outcome: 'fresh' })
  assert.equal(await unread.answers.theCrewStateToHand('session-b'), undefined)
  assert.equal(notes.length, 2, notes.join('\n'))
  assert.ok(notes[0]?.startsWith("the crew's state was not handed: "), String(notes[0]))
  assert.equal(notes[1], "the crew's state could not be read (the standing stream is gone)")
})

test("martha#984: a state handed once is not handed again while it is unchanged; a changed one is, and a new start of the session hands it again", async (t) => {
  const says: { crew_state: TheStartLine } = { crew_state: { line: THE_CREW_STATE, taken_in: [THE_STATE_CARRIES] } }
  const { answers } = anEntry(t, says)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  assert.equal(await answers.theCrewStateToHand('session-a'), THE_CREW_STATE)
  assert.equal(await answers.theCrewStateToHand('session-a'), undefined, 'the unchanged state was handed again')

  const CHANGED = 'Standing items (2): hold the landing for the owner; await the review.'
  says.crew_state = { line: CHANGED, taken_in: [THE_STATE_CARRIES] }
  assert.equal(await answers.theCrewStateToHand('session-a'), CHANGED)

  // A compaction is a start of the same session: the conversation no longer holds the copy.
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'same_id' })
  assert.equal(await answers.theCrewStateToHand('session-a'), CHANGED, 'a new start of the session was not handed the state again')
})
