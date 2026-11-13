// The refresh flow as a member's session meets it (martha#255): the tool that writes the handover, the question the
// mod asks, and the one act it is answered with.
//
// Nothing here decides anything of its own: the tool writes what the core says to write, where the core says, and the
// question is answered by the flow. The crew's own store is the real one on this disk (../crew_files_directory), so the
// handover read back is the file a launched member would have left, and the stamp is the host's own.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import { CREW_REFRESH } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { CREW_ROWS_PLACE, openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { beginSession, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { HANDOVERS_PLACE, CREW_HANDOVER_WRITTEN, CREW_REFRESH_DECLINED, WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { HANDOVER_LIMIT_PERCENT, REFRESH_MARGIN_PERCENT, keepTheFlow, aFlowStarting, refreshesPlace, theFlowOf } from '../refresh_a_member/refresh_a_member.ts'
import { crewToolsOver, CREW_TOOL_NAMES, type CrewTools } from './a_crews_tools.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-refresh-tool-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

/**
 * The question the mod puts to the launcher (martha#255): the host's own usage, the turn that just ended and the
 * answer it ended on. A session's start is the empty turn, which is the one reading of it there is.
 */
const questionOf = (percent: number, cost_usd: number | null, turn_id: string, answer: string): Record<string, unknown> => ({
  usage: { context: { percent }, cost: { usd: cost_usd } },
  turn_id,
  answer,
})

/** An in-memory session store, so a session is a real one this launch took in. */
const aSessionStore = (): SessionRecordStore => {
  const held = new Map<string, Parameters<SessionRecordStore['write']>[1]>()
  return { read: (id) => held.get(id), write: (id, session) => void held.set(id, session) }
}

/** What a crew the test makes varies from the next: the sessions it took in, and what its declaration switches on. */
interface ACrewOptions {
  /** Every session this launcher took in, the first is the one a test drives unless it names another. */
  readonly sessions?: readonly string[]
  /** Whether the declaration switches the after-a-task trigger on, which is off unless it says so. */
  readonly refresh_between_tasks?: boolean
  /** Whether the crew has a member whose role is `supervisor`: the one a flow's own lines go to. */
  readonly supervisor?: boolean
}

/** One crew the test made: its member's tools, where its own store is, and the session that member's launcher holds. */
interface ACrew {
  readonly tools: CrewTools
  readonly home: string
  readonly crew: string
  readonly clock: { at: number }
  /** The crew's channel as the store holds it: what the flow said, and to whom. */
  readonly saidInTheChannel: () => Promise<readonly { readonly message: { readonly to: unknown; readonly text: string } }[]>
  /** A session's first question, which is where its thresholds are measured from. */
  readonly openTheSession: (session: string, percent: number) => Promise<string>
  /** What the mod asks at a turn's end, one turn after the last write, as a real launcher does. */
  readonly ask: (session: string, percent: number, answer?: string) => Promise<string>
  /** A report of the member's own progress, one turn after the last write. */
  readonly report: (task: string, step: number, of: number) => Promise<void>
}

let crewsSoFar = 0
async function aCrewOfTools(member: string, options: ACrewOptions = {}): Promise<ACrew> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'the-crew-files')
  const rows = rowStreamsDirectory(join(home, CREW_ROWS_PLACE))
  const clock = { at: 1_000 }
  mkdirSync(root, { recursive: true })
  mkdirSync(join(home, 'row'), { recursive: true })
  mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  if (options.refresh_between_tasks === true || options.supervisor === true) switchOnInTheDeclaration(root, options)
  const records = aSessionStore()
  const held = new Map((options.sessions ?? ['a-session']).map((id) => [id, beginSession(records, id)] as const))
  const ledger = { clock: { now: () => clock.at }, stores: { rows } }
  const tools = crewToolsOver({
    member,
    ledger,
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(crew) },
    stamps: handoverStampsIn(crew),
    sessions: { of: (id) => held.get(id) },
  })
  /** The act of the next question, one turn later than the last write: a beat the row store takes as the newest. */
  const answerWith = async (session: string, percent: number, answer: string, at_start: boolean): Promise<string> => {
    clock.at += 60_000
    const answered = await tools.answer(THE_REFRESH_ASK, questionOf(percent, null, at_start ? '' : `t-${clock.at}`, answer), session)
    assert.ok('answer' in answered, `the flow refused the question: ${'refused' in answered ? answered.refused : ''}`)
    return (JSON.parse(answered.answer) as { readonly carry: string }).carry
  }
  return {
    tools,
    home,
    crew,
    clock,
    saidInTheChannel: async () => (await readTheChannel(ledger)) as readonly { readonly message: { readonly to: unknown; readonly text: string } }[],
    openTheSession: (session, percent) => answerWith(session, percent, '', true),
    ask: (session, percent, answer = '') => answerWith(session, percent, answer, false),
    report: async (task, step, of) => {
      clock.at += 1_000
      const answered = await tools.answer('report_progress', { task, step, of }, 'a-session')
      assert.ok('answer' in answered, `a report was refused: ${'refused' in answered ? answered.refused : ''}`)
    },
  }
}

/** The declaration as a test needs it to read: the after-a-task trigger on, or a member whose role is `supervisor`. */
function switchOnInTheDeclaration(root: string, options: ACrewOptions): void {
  const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const declared = JSON.parse(readFileSync(file, 'utf8')) as { members: { name: string; role: string }[]; mode: { roles: string[] }; house_rules?: Record<string, unknown> }
  if (options.supervisor === true) {
    declared.members = [...declared.members, { name: SUPERVISOR, role: SUPERVISOR }]
    declared.mode.roles = [...declared.mode.roles, SUPERVISOR]
  }
  if (options.refresh_between_tasks === true) declared.house_rules = { ...(declared.house_rules ?? {}), refresh_between_tasks: true }
  writeFileSync(file, `${JSON.stringify(declared, null, 2)}\n`)
}

/** What the row this crew keeps for its member reads as now. */
function theRowOf(member: string, home: string) {
  return dashboardRowsIn(join(home, 'row')).read(member)
}

test('#255: write_my_handover is one of the crew’s tools, and its answer is the file the host wrote and stamped', async () => {
  assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(WRITE_MY_HANDOVER_TOOL), 'the handover tool is not one the crew registers')
  const { tools, crew, clock } = await aCrewOfTools('builder')
  const answered = await tools.answer(WRITE_MY_HANDOVER_TOOL, { content: 'first rules\nwhat runs' }, 'a-session')
  assert.deepEqual(answered, { answer: CREW_HANDOVER_WRITTEN })
  const place = { stores: { crew: crewFilesDirectory(crew) } }.stores.crew.place(HANDOVERS_PLACE)
  assert.ok(!('refusal' in place), 'the crew store refused the handovers place')
  const written = place.read(`HANDOVER_${new Date(clock.at).toISOString().slice(0, 10)}_builder.md`)
  assert.ok(written !== undefined && !('refusal' in written), 'the tool wrote no handover file')
  assert.ok(written.text.includes('first rules'), 'the handover written is not the text the member gave')
  const stamp = handoverStampsIn(crew).read(join(place.path, `HANDOVER_${new Date(clock.at).toISOString().slice(0, 10)}_builder.md`))
  assert.ok(stamp !== undefined && !('refusal' in stamp), 'the handover was written and not stamped')
})

test('#255: a handover that carries no text is refused rather than written, so nothing clears on it', async () => {
  const { tools } = await aCrewOfTools('builder')
  const answered = await tools.answer(WRITE_MY_HANDOVER_TOOL, { content: '   ' }, 'a-session')
  assert.ok('refused' in answered, 'an empty handover was accepted')
})

test('#255: a session past the limit is answered with the handover prompt, and its row says where it began', async () => {
  const { tools, home, clock } = await aCrewOfTools('builder')
  // The session's own start is where it began, and every threshold is measured from there: a session that opens at
  // 75% is never refreshed into the same 75% (#470), so the test opens it low and grows it past the limit.
  const opened = await tools.answer(THE_REFRESH_ASK, questionOf(10, 0.1, '', ''), 'a-session')
  assert.ok('answer' in opened, 'the flow refused the session’s first question')
  clock.at += 5_000
  const answered = await tools.answer(THE_REFRESH_ASK, questionOf(HANDOVER_LIMIT_PERCENT + 5, 0.4, 't-1', ''), 'a-session')
  assert.ok('answer' in answered, `the flow refused the question: ${'refused' in answered ? answered.refused : ''}`)
  const act = JSON.parse(answered.answer) as { readonly carry?: unknown }
  assert.equal(act.carry, 'submit', `the flow answered ${JSON.stringify(act)} rather than a prompt`)
  const row = theRowOf('builder', home)
  assert.ok(row !== null, 'the question wrote no row')
  assert.equal(row.host.contextPercent, HANDOVER_LIMIT_PERCENT + 5, 'the row does not carry the context the session reported')
  assert.equal(row.refresh?.phase, 'handing_over', 'the row does not say a refresh is in flight')
})

test('#255: a member whose session began above the limit is not asked on its first report (#470)', async () => {
  const { tools } = await aCrewOfTools('builder')
  const question = questionOf(HANDOVER_LIMIT_PERCENT + 5, null, '', '')
  const first = await tools.answer(THE_REFRESH_ASK, question, 'a-session')
  assert.ok('answer' in first)
  assert.deepEqual(JSON.parse(first.answer), { carry: 'none' })
})

test('#255: crew_refresh asks for a refresh, and the next question is answered with the handover prompt', async () => {
  const { tools } = await aCrewOfTools('builder')
  const asked = await tools.answer(CREW_REFRESH, { reason: 'the owner is moving me off a large context' }, 'a-session')
  assert.ok('answer' in asked, `crew_refresh refused the ask: ${'refused' in asked ? asked.refused : ''}`)
  const answered = await tools.answer(THE_REFRESH_ASK, questionOf(5, null, 't-2', ''), 'a-session')
  assert.ok('answer' in answered)
  const act = JSON.parse(answered.answer) as { readonly carry?: unknown; readonly text?: unknown }
  assert.equal(act.carry, 'submit', 'a refresh someone asked for was not asked')
})

test('#255: the clear is told with the session it was told in, so its successor inherits that one', async () => {
  const { tools, crew, clock } = await aCrewOfTools('builder')
  const place = refreshesPlace({ stores: { crew: crewFilesDirectory(crew) } })
  assert.ok(!('refusal' in place), 'the crew store refused the flow place')
  const flow = aFlowStarting({ trigger: 'at_the_limit', reason: 'its context reached the handover limit', at: clock.at, started_at_percent: 10, percent: 80, asked_on: '', refreshed_at: [] })
  assert.equal(keepTheFlow(place, 'builder', flow), undefined)
  assert.equal(await tools.thePredecessorOf('a-session'), null, 'the session the clear was told in was named its own successor')
  const answered = await tools.answer(WRITE_MY_HANDOVER_TOOL, { content: 'a handover naming no package' }, 'a-session')
  assert.deepEqual(answered, { answer: CREW_HANDOVER_WRITTEN })
  const moved = await tools.answer(THE_REFRESH_ASK, questionOf(80, null, 't-3', CREW_HANDOVER_WRITTEN), 'a-session')
  assert.ok('answer' in moved)
  assert.deepEqual(JSON.parse(moved.answer), { carry: 'clear' })
  const after = theFlowOf(place, 'builder')
  assert.ok(after !== undefined && !('refusal' in after), 'the flow the clear left cannot be read')
  assert.equal(after.phase, 'clearing')
  assert.equal(after.clear_from, 'a-session')
  assert.equal(await tools.thePredecessorOf('a-new-session'), 'a-session')
})

test('#255: a handover written before the flow asked is sent back, not cleared', async () => {
  const { tools, crew, clock } = await aCrewOfTools('builder')
  const place = refreshesPlace({ stores: { crew: crewFilesDirectory(crew) } })
  assert.ok(!('refusal' in place))
  // The member writes its handover first, then a flow asks for one: the file predates the ask, so it is not this
  // flow's handover and nothing is cleared on it.
  assert.deepEqual(await tools.answer(WRITE_MY_HANDOVER_TOOL, { content: 'an old handover' }, 'a-session'), { answer: CREW_HANDOVER_WRITTEN })
  const flow = aFlowStarting({ trigger: 'after_a_task', reason: 'its task finished', at: clock.at + 1_000, started_at_percent: 10, percent: 80, asked_on: '', refreshed_at: [] })
  assert.equal(keepTheFlow(place, 'builder', flow), undefined)
  const answered = await tools.answer(THE_REFRESH_ASK, questionOf(80, null, 't-4', CREW_HANDOVER_WRITTEN), 'a-session')
  assert.ok('answer' in answered)
  const act = JSON.parse(answered.answer) as { readonly carry?: unknown }
  assert.equal(act.carry, 'submit', 'a stale handover cleared the session rather than being sent back')
  const after = theFlowOf(place, 'builder')
  assert.ok(after !== undefined && !('refusal' in after))
  assert.equal(after.sent_back, 1)
})

// The three findings of Mercurius's r=1 on PR 331, each as the reviewer drove it: a finished task is asked once
// whatever ended the flow, a decline is held by the share it was taken at, and the Supervisor is told once.

test('#255: a decline after a task holds the ask back on that task, turn after turn (r=1 R1)', async () => {
  const crew = await aCrewOfTools('builder', { refresh_between_tasks: true })
  assert.equal(await crew.openTheSession('a-session', 10), 'none')
  await crew.report('task x', 1, 1)
  assert.equal(await crew.ask('a-session', 40), 'submit', 'the finished task did not ask')
  assert.equal(await crew.ask('a-session', 40, `${CREW_REFRESH_DECLINED} a change in hand`), 'none', 'the decline was not taken')
  // The row is rewritten by every question, so a name that moved with it would ask again on the same finished task.
  assert.equal(await crew.ask('a-session', 41, 'a turn that only answered'), 'none', 'the same finished task was asked again after a decline')
  assert.equal(await crew.ask('a-session', 45), 'none', 'the same finished task was asked again on a later turn')
})

test('#255: a decline after a task holds until another task finishes past the share it declined at (r=1 R2, design test 7)', async () => {
  const crew = await aCrewOfTools('builder', { refresh_between_tasks: true })
  assert.equal(await crew.openTheSession('a-session', 10), 'none')
  await crew.report('task x', 1, 1)
  assert.equal(await crew.ask('a-session', 40), 'submit')
  assert.equal(await crew.ask('a-session', 40, `${CREW_REFRESH_DECLINED} a change in hand`), 'none')
  await crew.report('task y', 1, 1)
  assert.equal(await crew.ask('a-session', 45), 'none', 'asked again inside the margin above the share it declined at')
  assert.equal(await crew.ask('a-session', 40 + REFRESH_MARGIN_PERCENT + 1), 'submit', 'a finished task past the margin above the decline did not ask')
})

test('#255: a successor is not asked on the finished report its predecessor already answered (r=1 R1, P3)', async () => {
  const crew = await aCrewOfTools('builder', { refresh_between_tasks: true, sessions: ['a-session', 'b-session'] })
  assert.equal(await crew.openTheSession('a-session', 10), 'none')
  await crew.report('task x', 1, 1)
  assert.equal(await crew.ask('a-session', 40), 'submit')
  assert.deepEqual(await crew.tools.answer(WRITE_MY_HANDOVER_TOOL, { content: 'first rules; what runs' }, 'a-session'), { answer: CREW_HANDOVER_WRITTEN })
  assert.equal(await crew.ask('a-session', 41, CREW_HANDOVER_WRITTEN), 'clear')
  assert.equal(await crew.openTheSession('b-session', 5), 'submit', 'the successor was not resumed from its handover')
  // The row still shows the predecessor's finished task, and the flow file outlives the clear: the successor's first
  // flow reads the report its predecessor was asked on, rather than handing over again into the same work.
  assert.equal(await crew.ask('b-session', 25, 'read my handover, carrying on'), 'none', 'the successor was asked on its predecessor\'s finished task')
})

test('#255: a successor taken past the limit hands over on the task its predecessor was asked about (r=3 R1′, P4)', async () => {
  const crew = await aCrewOfTools('builder', { refresh_between_tasks: true, sessions: ['a-session', 'b-session'] })
  assert.equal(await crew.openTheSession('a-session', 10), 'none')
  await crew.report('task x', 1, 1)
  assert.equal(await crew.ask('a-session', 40), 'submit')
  assert.deepEqual(await crew.tools.answer(WRITE_MY_HANDOVER_TOOL, { content: 'first rules; what runs' }, 'a-session'), { answer: CREW_HANDOVER_WRITTEN })
  assert.equal(await crew.ask('a-session', 41, CREW_HANDOVER_WRITTEN), 'clear')
  assert.equal(await crew.openTheSession('b-session', 5), 'submit', 'the successor was not resumed from its handover')
  // The same row and the same flow file as P3, and the successor is past the limit: the limit answers over the past ask
  // rather than holding it back, so a member that grew to 90% hands over instead of holding forever on older work.
  assert.equal(await crew.ask('b-session', HANDOVER_LIMIT_PERCENT + 20, 'read my handover, carrying on'), 'submit', 'a successor past the limit was held on its predecessor\'s finished task')
})

test('#255: a refresh someone asked for that is declined is abandoned, and the Supervisor is told once (r=1 R3)', async () => {
  const crew = await aCrewOfTools('builder', { supervisor: true })
  assert.ok('answer' in (await crew.tools.answer(CREW_REFRESH, { reason: 'the owner is moving me off a large context' }, 'a-session')))
  assert.equal(await crew.ask('a-session', 30), 'submit', 'the ask someone made did not start a flow')
  assert.equal(await crew.ask('a-session', 30, `${CREW_REFRESH_DECLINED} a change in hand`), 'none')
  const said = await crew.saidInTheChannel()
  assert.equal(said.length, 1, `the Supervisor was not told once, it was told ${said.length} times`)
  assert.deepEqual(said[0]?.message.to, [SUPERVISOR], 'the line did not go to the crew\'s supervisor')
  assert.ok(said[0]?.message.text.includes('builder'), 'the line does not name the member')
  // A second turn in the same state sends nothing more: one line per flow, not one per ask.
  assert.equal(await crew.ask('a-session', 31), 'none')
  assert.equal((await crew.saidInTheChannel()).length, 1, 'a second ask sent the Supervisor another line')
})

test('#255: a decline at the limit is said once, and a later decline at the limit says nothing more (r=1 R3)', async () => {
  const crew = await aCrewOfTools('builder', { supervisor: true })
  assert.equal(await crew.openTheSession('a-session', 10), 'none')
  assert.equal(await crew.ask('a-session', HANDOVER_LIMIT_PERCENT + 1), 'submit', 'a session past the limit did not hand over')
  assert.equal(await crew.ask('a-session', HANDOVER_LIMIT_PERCENT + 1, `${CREW_REFRESH_DECLINED} it cannot reach a safe point at all`), 'none')
  const said = await crew.saidInTheChannel()
  assert.equal(said.length, 1, `the Supervisor was not told once at the limit, it was told ${said.length} times`)
  assert.deepEqual(said[0]?.message.to, [SUPERVISOR])
  assert.ok(said[0]?.message.text.includes(`${HANDOVER_LIMIT_PERCENT}%`), 'the line does not say the member is at its limit')
  // The member is asked again on the next finished task, as the design has it, and declines again: the Supervisor is
  // told once, not once per ask.
  await crew.report('task x', 1, 1)
  assert.equal(await crew.ask('a-session', HANDOVER_LIMIT_PERCENT + 2), 'submit', 'a finished task past the limit did not ask again')
  assert.equal(await crew.ask('a-session', HANDOVER_LIMIT_PERCENT + 2, `${CREW_REFRESH_DECLINED} it cannot reach a safe point at all`), 'none')
  assert.equal((await crew.saidInTheChannel()).length, 1, 'the second decline at the limit sent another line')
})
