// A finished turn settles the member's row (martha#1000, gap 8 of #957), as a session's own launcher writes it.
//
// This drives the launcher's own answers — the refresh question a session asks at a turn's end, and the ask the mod
// makes for the host's task list — so what it reads is the row a launched member's owner would see.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { handoverStampsIn, keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { CREW_ROWS_PLACE, openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { beginSession, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { TASKS_FIELD, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { crewToolsOver, type CrewTools } from './a_crews_tools.ts'
import { THE_TASKS_ASK } from './a_sessions_own_tab.ts'

const documents = { read: (path: string) => readFile(path, 'utf8') }
const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['opus', 'fable'] }
const MEMBER = 'Vesta'
const SESSION = 'a-session'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-1000-tab-'))
after(() => removeTheTree(homeOfAll))

/** A session store the launcher took a session in through, so a session is a real one this launch holds. */
const aSessionStore = (): SessionRecordStore => {
  const held = new Map<string, Parameters<SessionRecordStore['write']>[1]>()
  return { read: (id) => held.get(id), write: (id, session) => void held.set(id, session) }
}

/** One member's place: its row store, its crew's store, and a session of its own. */
interface ATab {
  readonly tools: CrewTools
  readonly clock: { at: number }
  readonly row: () => Promise<DashboardRow>
  /** The mod's question at a turn's end, answered by the launcher, at a moment after the last write. */
  readonly aTurnEnds: (answer?: string, turn_running?: boolean) => Promise<void>
}

let tabsSoFar = 0
async function aMemberSessionsTab(): Promise<ATab> {
  tabsSoFar += 1
  const home = join(homeOfAll, `tab-${tabsSoFar}`)
  const root = join(home, 'checkout')
  mkdirSync(root, { recursive: true })
  mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })
  mkdirSync(join(home, 'row'), { recursive: true })
  const rows = rowStreamsDirectory(join(home, CREW_ROWS_PLACE))
  const clock = { at: 1_000 }
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  const records = aSessionStore()
  const sessions: Map<string, ReturnType<typeof beginSession>> = new Map([[SESSION, beginSession(records, SESSION)]])
  const beats = dashboardRowsIn(join(home, 'row'))
  const ledger = { clock: { now: () => clock.at }, stores: { rows } }
  const tools = crewToolsOver({
    member: MEMBER,
    ledger,
    beats,
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'the-crew-files')) },
    stamps: handoverStampsIn(join(home, 'the-crew-files')),
    sessions: { of: (id) => sessions.get(id) },
  })
  const row = async (): Promise<DashboardRow> => {
    const held = beats.read(MEMBER)
    assert.ok(held !== null, 'the launcher wrote no row for this member')
    return held
  }
  return {
    tools,
    clock,
    row,
    aTurnEnds: async (answer = '', turn_running = false) => {
      clock.at += MINUTE_MS
      const asked = await tools.answer(THE_REFRESH_ASK, {
        usage: { startedAt: 0, context: { percent: 10 }, cost: { usd: null } },
        turn_id: `t-${clock.at}`,
        answer,
        ...(turn_running ? { turn_running: 1 } : {}),
      }, SESSION)
      assert.ok('answer' in asked, `the launcher refused the question: ${'refused' in asked ? asked.refused : ''}`)
    },
  }
}

test('#1000: the task list the mod posts is written onto the row, and the member\'s own progress is left alone', async () => {
  const tab = await aMemberSessionsTab()
  const answered = await tab.tools.answer(THE_TASKS_ASK, { tasks: [{ subject: 'write the tests', status: 'in_progress' }, { subject: 'push', status: 'pending' }] }, SESSION)
  assert.ok('answer' in answered, `the launcher refused the task list: ${'refused' in answered ? answered.refused : ''}`)
  const row = await tab.row()
  assert.deepEqual(row[TASKS_FIELD], [
    { subject: 'write the tests', status: 'in_progress' },
    { subject: 'push', status: 'pending' },
  ], 'the launcher\'s row does not carry the task list the session posted')
  assert.deepEqual(row.progress, { step: 0, of: 1 }, 'a task list moved the member\'s own reported progress')
  assert.equal(row.waits, null, 'a task list invented a wait the member never declared')
})

test('#1000: a turn that ends with nothing in hand settles the member to idle', async () => {
  const tab = await aMemberSessionsTab()
  await tab.aTurnEnds('the work is done')
  assert.equal((await tab.row()).state, 'idle', 'a finished turn that holds nothing did not settle to idle')
})

test('#1000: work in hand settles to waiting, and a review in flight to reviewing', async () => {
  const tab = await aMemberSessionsTab()
  await tab.tools.noteTheWorkInHand(SESSION, { background_tasks: [{ id: 'agent-1', type: 'subagent', description: 'chasing a flaky test', agent_type: 'general-purpose' }], session_crons: 0 })
  await tab.aTurnEnds('still going')
  assert.equal((await tab.row()).state, 'waiting', 'a finished turn with work in hand did not settle to waiting')
  await tab.tools.noteTheWorkInHand(SESSION, { background_tasks: [{ id: 'agent-2', type: 'subagent', description: 'reviewing PR 981', agent_type: 'Explore' }], session_crons: 0 })
  await tab.aTurnEnds('the review is running')
  assert.equal((await tab.row()).state, 'reviewing', 'a finished turn with a review in flight did not settle to reviewing')
})

test('#1000: a closing question the member may put to its owner settles the row to needs-you', async () => {
  const tab = await aMemberSessionsTab()
  await tab.aTurnEnds('shall I land it?')
  assert.equal((await tab.row()).state, 'needs-you', 'a turn that ended on a question for the owner did not read as needing the owner')
})

test('#1000: a question inside a running turn changes nothing of the member\'s state', async () => {
  const tab = await aMemberSessionsTab()
  await tab.aTurnEnds('a report', false)
  const before = await tab.row()
  await tab.aTurnEnds('shall I land it?', true)
  const after = await tab.row()
  assert.equal(after.state, before.state, 'a beat while the turn ran settled a state the member had not finished writing')
})
