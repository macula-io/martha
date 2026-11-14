// A member's running turn ended so its handover can run (martha#311), as the member's session meets it: the beat the
// mod asks on while the turn runs, the end it is answered with, the outcome the mod reports back, and what the ledger,
// the flow and the Supervisor are left with.
//
// The crew's own store is the real one on this disk, as in ./the_refresh_flow_answers_the_session.node-test.ts, and the
// clock is the test's, so every minute named in a test is the minute the flow reads.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { CREW_ROWS_PLACE, openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { readLedger, REFRESH_FORCED, type ActAnnouncedRow, type ActConcludedRow, type LedgerRow } from '../log_ledger/log_ledger.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { OWNER_DIALOGS_FIELD } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { beginSession, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { A_TOOL_WAS_STILL_RUNNING, CARRY_A_TEXT, CARRY_THE_CLEAR, CARRY_THE_END, THE_REFRESH_ASK, THE_TURN_ENDED } from '../refresh_a_member/the_refresh_flow.ts'
import { A_TOOL_WHILE_THE_END_IS_HELD } from '../refresh_a_member/hold_the_end.ts'
import { CREW_HANDOVER_WRITTEN, WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { FORCED_ENDS, HANDOVER_LIMIT_PERCENT, refreshesPlace, theFlowOf, type ARefresh } from '../refresh_a_member/refresh_a_member.ts'
import { crewToolsOver } from './a_crews_tools.ts'

const HOST_MODELS = ['opus', 'fable']
const MEMBER = 'builder'
const SESSION = 'a-session'
const SUCCESSOR = 'b-session'
/** The package the member holds, when a test gives it one: its ledger is where an end is announced. */
const PACKAGE = 'macula-io/martha#1'
/** The running turn every beat in these tests is about. */
const THE_TURN = 'the-long-turn'
/** A share past the limit, below the whole of it: what starts a flow without ending a turn at once. */
const PAST_THE_LIMIT = HANDOVER_LIMIT_PERCENT + 1

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-end-the-turn-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** What a crew a test makes varies by: its ceiling, whether the member holds a package, and a ledger that refuses. */
interface ACrewOptions {
  readonly ceiling_minutes: number
  readonly holds?: string
  readonly ledger_refuses?: boolean
}

let crewsSoFar = 0

/**
 * A crew of one member and a Supervisor, its handover asked for at minute 0 behind a turn that keeps running. Every
 * question is put at the minute a test names, measured from that ask.
 */
async function aMemberHandingOver(options: ACrewOptions) {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'the-crew-files')
  const real = rowStreamsDirectory(join(home, CREW_ROWS_PLACE))
  const rows = options.ledger_refuses === true ? { ...real, append: async () => Promise.reject(new Error('the store keeps nothing')) } : real
  const clock = { at: 1_000 }
  mkdirSync(root, { recursive: true })
  mkdirSync(join(home, 'row'), { recursive: true })
  mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), 'the test could not open Martha\'s state')
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents, models: HOST_MODELS })
  assert.ok(declared.declared, 'the test could not declare a crew')
  declareTheSupervisorAndTheCeiling(root, options.ceiling_minutes)
  const records = sessionRecordsInMemory()
  const sessions = new Map([SESSION, SUCCESSOR].map((id) => [id, beginSession(records, id)] as const))
  const ledger = { clock: { now: () => clock.at }, stores: { rows } }
  const beats = dashboardRowsIn(join(home, 'row'))
  const tools = crewToolsOver({ member: MEMBER, ledger, beats, root, documents, stores: { crew: crewFilesDirectory(crew) }, stamps: handoverStampsIn(crew), sessions: { of: (id) => sessions.get(id) } })
  const place = refreshesPlace({ stores: { crew: crewFilesDirectory(crew) } })
  assert.ok(!('refusal' in place), 'the crew store refused the flow place')

  /** The order the mod is answered with, for the question put at `minute` after the ask. */
  const ask = async (minute: number, question: Readonly<Record<string, unknown>>, session = SESSION): Promise<Record<string, unknown>> => {
    clock.at = asked_at + minute * MINUTE_MS
    const answered = await tools.answer(THE_REFRESH_ASK, { usage: { context: { percent: PAST_THE_LIMIT }, cost: { usd: null } }, turn_id: THE_TURN, answer: '', ...question }, session)
    assert.ok('answer' in answered, `the flow refused the question: ${'refused' in answered ? answered.refused : ''}`)
    return JSON.parse(answered.answer) as Record<string, unknown>
  }

  // The session opens low, and its next turn is past the limit: the flow asks for the handover, at minute 0.
  const opened = await tools.answer(THE_REFRESH_ASK, { usage: { context: { percent: 10 }, cost: { usd: null } }, turn_id: '', answer: '' }, SESSION)
  assert.ok('answer' in opened, 'the session\'s first question was refused')
  if (options.holds !== undefined) beats.change(MEMBER, (row) => (row === null ? null : { ...row, holds: options.holds ?? '' }))
  clock.at += MINUTE_MS
  const asked_at = clock.at
  const started = await tools.answer(THE_REFRESH_ASK, { usage: { context: { percent: PAST_THE_LIMIT }, cost: { usd: null } }, turn_id: 'the-asking-turn', answer: '' }, SESSION)
  assert.ok('answer' in started && (JSON.parse(started.answer) as { carry: string }).carry === CARRY_A_TEXT, 'the flow did not ask for the handover')

  return {
    tools,
    beats,
    /** A beat while the turn runs. */
    beat: (minute: number, over: Readonly<Record<string, unknown>> = {}) => ask(minute, { turn_running: 1, ...over }),
    /** The held turn's own end, which is the end's outcome: the abort landed, or the turn ended first. */
    ended: (minute: number) => ask(minute, { turn_id: THE_TURN, answer: '' }),
    /** A turn's end, carrying what the turn answered. */
    turnEnded: (minute: number, answer = '', turn_id = THE_TURN) => ask(minute, { turn_id, answer }),
    /** A new session's first question. */
    opens: (minute: number, session: string) => ask(minute, { turn_id: '' }, session),
    /** The member writes its handover, naming what it holds. */
    writesItsHandover: async () => {
      const written = await tools.answer(WRITE_MY_HANDOVER_TOOL, { content: `first rules; what runs; ${options.holds ?? 'no package'}` }, SESSION)
      assert.deepEqual(written, { answer: CREW_HANDOVER_WRITTEN }, 'the handover could not be written')
    },
    flow: (): ARefresh => {
      const read = theFlowOf(place, MEMBER)
      assert.ok(read !== undefined && !('refusal' in read), 'the flow cannot be read')
      return read
    },
    minute: (n: number) => asked_at + n * MINUTE_MS,
    ledgerRows: async (): Promise<readonly LedgerRow[]> => await readLedger({ clock: ledger.clock, stores: { rows: real } }, PACKAGE),
    linesToTheSupervisor: async () => (await readTheChannel(ledger)).filter((said) => JSON.stringify(said.message.to) === JSON.stringify([SUPERVISOR])),
  }
}

/** The member's session records, kept in memory for one test. */
function sessionRecordsInMemory(): SessionRecordStore {
  const held = new Map<string, Parameters<SessionRecordStore['write']>[1]>()
  return { read: (id) => held.get(id), write: (id, session) => void held.set(id, session) }
}

/** The declaration with a member whose role is `supervisor`, and the ceiling the test names. */
function declareTheSupervisorAndTheCeiling(root: string, ceiling_minutes: number): void {
  const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const declared = JSON.parse(readFileSync(file, 'utf8')) as { members: { name: string; role: string }[]; mode: { roles: string[] } }
  declared.members = [...declared.members, { name: SUPERVISOR, role: SUPERVISOR }]
  declared.mode.roles = [...declared.mode.roles, SUPERVISOR]
  writeFileSync(file, `${JSON.stringify({ ...declared, handover_ceiling_minutes: ceiling_minutes }, null, 2)}\n`)
}

/** The ledger's rows of an end: the acts announced, and the outcomes concluded. */
const announced = (rows: readonly LedgerRow[]): readonly ActAnnouncedRow[] => rows.filter((row): row is ActAnnouncedRow => 'act' in row)
const concluded = (rows: readonly LedgerRow[]): readonly ActConcludedRow[] => rows.filter((row): row is ActConcludedRow => 'outcome' in row)

const theEndOf = (turn_id: string) => ({ carry: CARRY_THE_END, turn_id })
const NOTHING = { carry: 'none' }

// --- the stall clock (design §3) ----------------------------------------------------------------------------------

test('#311: ceiling 40, a beat at minute 30 with the turn still running neither abandons the flow nor ends the turn (mutant: judge the stall on the beat)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 40 })
  assert.deepEqual(await member.beat(30), NOTHING, 'a beat inside the ceiling was answered with an act')
  assert.equal(member.flow().phase, 'handing_over', 'the beat abandoned the flow at minute 30 while its turn ran')
})

test('#311: ceiling 40, the end ordered at minute 40 ends its turn at 41, the handover is answered at 45: the flow clears (mutant: drop the restart)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 40 })
  assert.deepEqual(await member.beat(40), theEndOf(THE_TURN), 'the turn was not ended at the ceiling')
  assert.deepEqual(await member.ended(41), NOTHING, 'the ended turn\'s own end was answered with an act')
  assert.equal(member.flow().phase, 'handing_over', 'the ended turn\'s own end abandoned the flow the end was for')
  assert.deepEqual([member.flow().forced?.ends, member.flow().at], [1, member.minute(41)], 'the end did not count once, from the turn\'s end')
  await member.writesItsHandover()
  assert.deepEqual(await member.turnEnded(45, CREW_HANDOVER_WRITTEN, 'the-handover-turn'), { carry: CARRY_THE_CLEAR }, 'a handover written after the end did not clear')
})

test('#311 placement ruling: a subagent\'s turn ending neither concludes the end nor drops its hold (mutant: drop on any turn end)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 40 })
  assert.deepEqual(await member.beat(40), theEndOf(THE_TURN))
  assert.deepEqual(await member.turnEnded(40, '', 'a-subagent-turn'), NOTHING)
  assert.notEqual(member.flow().ending, undefined, 'a subagent\'s turn ending concluded the end held on the main turn')
  assert.equal(member.tools.ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a subagent\'s turn ending dropped the hold')
  assert.deepEqual(await member.ended(40), NOTHING)
  assert.equal(member.tools.ends.deniesACall(SESSION), undefined, 'the held turn\'s own end left its hold in place')
})

test('#311 ruling D: an end due while a tool runs is held, rides on that tool\'s answer, and the turn\'s end concludes it (mutants: carry while in flight; hold after the answer)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  member.tools.ends.aCallAllowed(SESSION, 'a-long-tool')
  assert.deepEqual(await member.beat(10), NOTHING, 'the end was ordered while a tool was in flight')
  assert.notEqual(member.flow().ending, undefined, 'the end held behind a tool was not announced')
  assert.equal(member.tools.ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a call started while the end was held')
  assert.equal(member.tools.ends.aCallAnswered(SESSION, 'a-long-tool'), THE_TURN, 'the end did not ride on the last tool\'s answer')
  assert.deepEqual(await member.ended(11), NOTHING)
  assert.deepEqual([member.flow().ending, member.flow().forced?.ends], [undefined, 1], 'the held turn\'s end did not conclude and count the end')
})

test('#311: a handover written after the window passed, with no end at all, is still judged (mutant: judge the stall before the answer)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 60 })
  await member.writesItsHandover()
  assert.deepEqual(await member.turnEnded(45, CREW_HANDOVER_WRITTEN), { carry: CARRY_THE_CLEAR }, 'the window threw away a handover that was written')
})

test('#311: a new session while an end is pending drops it and judges the stall from the ask', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 40 })
  assert.deepEqual(await member.beat(40), theEndOf(THE_TURN))
  await member.opens(41, SUCCESSOR)
  assert.equal(member.flow().ending, undefined, 'the pending end was held across a new session')
  assert.equal(member.flow().forced, undefined, 'an end a new session cut off was spent as if a tool had blocked it')
  assert.equal(member.flow().phase, 'abandoned', 'the stall was not judged from the ask once the pending end was dropped')
})

// --- the ledger, and who is told (design §5) ----------------------------------------------------------------------

test('#311: an end that ended leaves one announced and one concluded row, spends one end, and tells the Supervisor once (mutant: count on announcement)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10, holds: PACKAGE })
  assert.deepEqual(await member.beat(10), theEndOf(THE_TURN))
  assert.deepEqual(await member.ended(10), NOTHING)
  // The Supervisor's line is an outward act of the package too, so the end's own rows are told apart by what they say.
  const rows = await member.ledgerRows()
  assert.equal(announced(rows).filter((row) => row.act.kind === REFRESH_FORCED).length, 1, 'the end was not announced once')
  const ends = concluded(rows).filter((row) => row.outcome.detail === THE_TURN_ENDED)
  assert.deepEqual(ends.map((row) => row.outcome.succeeded), [true], 'the end that ended was not concluded once, as done')
  assert.equal(member.flow().forced?.ends, 1, 'the end that ended did not spend exactly one')
  assert.equal((await member.linesToTheSupervisor()).length, 1, 'the Supervisor was not told once of the end')
})

test('#311 placement ruling: an end ordered at once is held from the beat\'s own answer, so a call that arrives before the abort is denied (mutant: hold only while a tool runs)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  assert.deepEqual(await member.beat(10), theEndOf(THE_TURN))
  assert.equal(member.tools.ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a call approved between the beat\'s answer and the abort would run into the abort')
})

test('#311: an end whose outcome never arrives stays open, and the successor is told to check it (mutant: conclude on announcement)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10, holds: PACKAGE })
  assert.deepEqual(await member.beat(10), theEndOf(THE_TURN))
  // The launcher dies here: no outcome is ever reported. The handover runs anyway, and the session is cleared.
  await member.writesItsHandover()
  assert.deepEqual(await member.turnEnded(11, CREW_HANDOVER_WRITTEN, 'the-handover-turn'), { carry: CARRY_THE_CLEAR })
  const resumed = await member.opens(12, SUCCESSOR)
  assert.equal(resumed['carry'], CARRY_A_TEXT, 'the successor was not resumed')
  assert.ok(String(resumed['text']).includes(REFRESH_FORCED), `the successor's resume prompt does not name the end left open: ${String(resumed['text'])}`)
})

test('#311 ruling D: an end the mod still holds a ceiling later is concluded as blocked by a tool, spends one end, keeps the window and tells nobody (mutants: leave it open; do not count it)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10, holds: PACKAGE })
  const before = member.flow().at
  assert.deepEqual(await member.beat(10), theEndOf(THE_TURN))
  // A tool hangs: the mod holds the end and never reports an outcome. One ceiling on, the end has expired.
  assert.deepEqual(await member.beat(20), NOTHING, 'a second end was ordered on the beat the first one expired')
  const outcomes = concluded(await member.ledgerRows()).map((row) => [row.outcome.succeeded, row.outcome.detail])
  assert.deepEqual(outcomes, [[false, A_TOOL_WAS_STILL_RUNNING]], 'the expired end was not concluded as blocked by a running tool')
  assert.deepEqual([member.flow().forced, member.flow().at, member.flow().ending], [{ ends: 1, last_at: member.minute(20) }, before, undefined], 'the expired end was not spent, or moved the window')
  assert.equal(member.tools.ends.deniesACall(SESSION), undefined, 'an expired end still denied every call')
  assert.equal((await member.linesToTheSupervisor()).length, 0, 'the Supervisor was told of an end that did not happen')
})

test('#311 ruling D: two ends held past their ceilings give the flow up and tell the Supervisor once (mutant: do not count an expiry)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  for (const [ordered, expired] of [[10, 20], [30, 40]] as const) {
    assert.deepEqual(await member.beat(ordered), theEndOf(THE_TURN), `no end at minute ${ordered}`)
    assert.deepEqual(await member.beat(expired), NOTHING, `the end ordered at minute ${ordered} was not left to expire`)
  }
  assert.equal(member.flow().forced?.ends, FORCED_ENDS, 'the expired ends were not both spent')
  assert.deepEqual(await member.beat(50), NOTHING)
  assert.equal(member.flow().phase, 'abandoned', 'a flow behind a hung tool was never given up')
  assert.equal((await member.linesToTheSupervisor()).length, 1, 'the Supervisor was not told once of the give-up')
})

test('#311: a ledger that will not keep the announcement gives no end order (mutant: send the order anyway)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10, holds: PACKAGE, ledger_refuses: true })
  assert.deepEqual(await member.beat(10), NOTHING, 'the turn was ended with no row saying so')
  assert.equal(member.flow().ending, undefined, 'an end was held as pending though none was ordered')
})

test('#311: a member that holds no package gets no second end while the first awaits its outcome (mutant: key the hold on the ledger row)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  assert.deepEqual(await member.beat(10), theEndOf(THE_TURN))
  assert.deepEqual(await member.beat(11), NOTHING, 'a second end was ordered while the first awaited its outcome')
})

// --- when an end is due, as the row says it (design §2) -----------------------------------------------------------

test('#311: never while the owner has a dialog open on the member\'s row (mutant: read the row\'s state)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  member.beats.change(MEMBER, (row) => (row === null ? null : { ...row, [OWNER_DIALOGS_FIELD]: [{ key: 'a-dialog', kind: 'permission', reads: 'may it run this?' }] }))
  assert.deepEqual(await member.beat(10), NOTHING, 'the turn was ended under a dialog the owner had open')
})

test('#311: two ends a ceiling apart, then the flow is given up, the Supervisor told once more, and no new flow on that turn (mutant: restart a flow on the same turn)', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  for (const minute of [10, 20]) {
    assert.deepEqual(await member.beat(minute), theEndOf(THE_TURN), `no end at minute ${minute}`)
    assert.deepEqual(await member.ended(minute), NOTHING)
  }
  assert.deepEqual(await member.beat(29), NOTHING, 'the flow was given up before the last end had its ceiling')
  assert.deepEqual(await member.beat(30), NOTHING)
  assert.deepEqual([member.flow().phase, member.flow().gave_up_on], ['abandoned', THE_TURN], 'the flow was not given up on the turn it waited behind')
  assert.equal((await member.linesToTheSupervisor()).length, FORCED_ENDS + 1, 'the Supervisor was not told once per end and once for the give-up')
  assert.deepEqual(await member.beat(31), NOTHING, 'a new flow started on the turn it was given up on')
  assert.deepEqual(await member.beat(31), NOTHING)
  assert.equal((await member.linesToTheSupervisor()).length, FORCED_ENDS + 1, 'the give-up was said more than once')
  assert.equal((await member.turnEnded(32, '', 'another-turn'))['carry'], CARRY_A_TEXT, 'another turn did not start a new flow')
})

test('a beat while the end is held behind a running tool keeps the hold, and the end still rides on that tool\'s answer', async () => {
  const member = await aMemberHandingOver({ ceiling_minutes: 10 })
  member.tools.ends.aCallAllowed(SESSION, 'a-long-tool')
  assert.deepEqual(await member.beat(10), NOTHING, 'the end was ordered while a tool was in flight')
  // Only the end of the turn the order names drops the hold; a beat asks while that turn still runs.
  assert.deepEqual(await member.beat(11), NOTHING, 'the next beat did something')
  assert.equal(member.tools.ends.deniesACall(SESSION), A_TOOL_WHILE_THE_END_IS_HELD, 'a beat dropped the hold behind a running tool')
  assert.equal(member.tools.ends.aCallAnswered(SESSION, 'a-long-tool'), THE_TURN, 'after a beat, the end did not ride on the tool\'s answer')
})
