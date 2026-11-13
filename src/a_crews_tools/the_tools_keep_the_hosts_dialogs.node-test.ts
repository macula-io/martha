// A member's own report never costs the owner a dialog the host has open, and never brings back one the owner answered
// (martha#363, found by its end-to-end run on the recorded host).
//
// Two writers write one member's row: the crew's tools write what the member reports, and the launcher writes the
// dialogs the host raises (../say_what_the_host_is_asking). A dialog is the host's word and is never the row's beat, so
// neither writer may refuse it, and a change one of them makes is applied to the row the other left (martha#380).
//
// Each test has a store of its own: the two writers share one row and one clock, and a directory kept across tests
// would carry one test's beats into the next.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { WhatTheHostSaid } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import { theOwnersScreen } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import { BEAT_INTERVAL_MS, OWNER_DIALOGS_FIELD, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theKeyOfAPermission, whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { THE_MODEL_REPORT_ASK, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-tools-dialogs-'))
after(() => removeTheTree(home))

// A made-up project root: this repository is public, so no real path appears here.
const root = '/crew-project'
const BUILDER = 'Builder1'
const SESSION = 'session-builder'
const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: 'Lead', role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: { name: 'team', roles: [SUPERVISOR, 'builder'], may: { ...Object.fromEntries(ACTS.map((act) => [act, [SUPERVISOR]])), approve_landing: [OWNER] } },
  channel_read_seconds: 30,
}
const declaration = JSON.stringify(team)
const documents = {
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return declaration
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
}

const A_CALL = { id: 'toolu_1', tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'touch made.txt' } }
const THE_DIALOGS_KEY = theKeyOfAPermission('', CLAUDE_CODE_SHELL_TOOL, {}, 'toolu_1')

/** One member on disk: its row's store, the session's tools and its launcher's screen, over one clock. */
interface AMemberOnDisk {
  readonly clock: { at: number }
  /** The session's own tools, so a test can drive a writer that is not a report (martha#380 r=2). */
  readonly tools: CrewTools
  /** The member reports a step, a clock later than anything written before it. */
  theMemberReports(step: number): Promise<void>
  /** One thing the host said, heard by the member's launcher. */
  theHostSaid(said: WhatTheHostSaid, at: number): void
  /** The row the store holds. */
  theRow(): DashboardRow
  /** The keys of the dialogs the row holds, in the order it keeps them. */
  theDialogs(): readonly string[]
}

/** A member with a row of its own: the two writers this package is about, over the same store. */
function aMemberOnDisk(t: { after(fn: () => void): void }): AMemberOnDisk {
  const place = mkdtempSync(join(home, 'member-'))
  t.after(() => removeTheTree(place))
  const clock = { at: 1_000 }
  const beats = dashboardRowsIn(place)
  /** One session's tools, held across its reports as a launch holds them. */
  const tools = crewToolsOver({
    member: BUILDER,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(place, CREW_ROWS_PLACE)) } },
    beats,
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(place, 'the-crew-store')) },
  })
  const theLauncher = theOwnersScreen({
    beats,
    member: BUILDER,
    bells: { bell: false, notify: false },
    onTheOwnersTerminal: false,
    write: () => {},
  })
  const theRow = (): DashboardRow => {
    const row = beats.read(BUILDER)
    assert.ok(row !== null, 'the store holds the member\'s row')
    return row
  }
  return {
    clock,
    tools,
    async theMemberReports(step: number): Promise<void> {
      clock.at += 1_000
      const said = await tools.answer('report_progress', { task: 'build', step, of: 3 }, SESSION)
      assert.ok('answer' in said, `the report was refused: ${'refused' in said ? said.refused : ''}`)
    },
    theHostSaid: (said, at) => theLauncher.heard(SESSION, said, at),
    theRow,
    theDialogs: () => (theRow()[OWNER_DIALOGS_FIELD] ?? []).map((dialog) => dialog.key),
  }
}

test('a report keeps the dialog the launcher opened, and never brings back one it closed', async (t) => {
  const member = aMemberOnDisk(t)
  await member.theMemberReports(0)

  member.clock.at += 1_000
  member.theHostSaid({ said: 'permission', call: A_CALL }, member.clock.at)
  await member.theMemberReports(1)
  assert.deepEqual(member.theDialogs(), [THE_DIALOGS_KEY], 'the member\'s report rewrote the row without the permission the owner has not answered')
  assert.equal(whatTheOwnerIsShown(member.theRow()).state, 'needs-you')

  member.clock.at += 1_000
  member.theHostSaid({ said: 'answered', call: A_CALL }, member.clock.at)
  await member.theMemberReports(2)
  assert.equal(member.theRow()[OWNER_DIALOGS_FIELD], undefined, 'the member\'s report brought back a dialog the owner had answered')
  assert.equal(member.theRow().progress.step, 2, 'the member\'s own report is still what the row says')
})

test('#380 both directions: a dialog written after a report keeps the report, and its own beat', async (t) => {
  const member = aMemberOnDisk(t)
  await member.theMemberReports(0)
  const reported = member.theRow()

  member.clock.at += 1_000
  member.theHostSaid({ said: 'permission', call: A_CALL }, member.clock.at)
  const withDialog = member.theRow()
  assert.equal(withDialog.progress.step, reported.progress.step, 'the launcher dropped the member\'s own report')
  assert.equal(withDialog.task, reported.task, 'and what the member said it was doing')
  assert.equal(withDialog.state, reported.state, 'and the state the member reported')
  assert.equal(withDialog.at, reported.at, 'a dialog is not a beat, and does not move the row\'s')
  assert.equal(whatTheOwnerIsShown(withDialog).state, 'needs-you', 'the row reads what the host is asking')
})

test('#380 P2: a beat in the same millisecond leaves the dialog that opens in it on the row', async (t) => {
  const member = aMemberOnDisk(t)
  await member.theMemberReports(0)
  const reported = member.theRow()

  member.theHostSaid({ said: 'permission', call: A_CALL }, reported.at)
  assert.deepEqual(member.theDialogs(), [THE_DIALOGS_KEY], 'a beat taken at the dialog\'s own time refused it, and the owner is never asked')
  assert.equal(whatTheOwnerIsShown(member.theRow()).state, 'needs-you')
})

test('#380 r=2: a heartbeat keeps the dialog the launcher opened', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const member = aMemberOnDisk(t)
  await member.theMemberReports(0)

  member.clock.at += 1_000
  member.theHostSaid({ said: 'permission', call: A_CALL }, member.clock.at)
  member.clock.at += 1_000
  const stop = member.tools.startBeating()
  t.mock.timers.tick(BEAT_INTERVAL_MS)
  stop()
  assert.equal(member.theRow().at, member.clock.at, 'the heartbeat landed')
  assert.deepEqual(member.theDialogs(), [THE_DIALOGS_KEY], 'the heartbeat wrote the tools\' own copy of the row, and dropped the dialog the launcher opened after it')
})

test('#380 r=2: a model report keeps the dialog the launcher opened', async (t) => {
  const member = aMemberOnDisk(t)
  await member.theMemberReports(0)

  member.clock.at += 1_000
  member.theHostSaid({ said: 'permission', call: A_CALL }, member.clock.at)
  member.clock.at += 1_000
  const noted = await member.tools.answer(THE_MODEL_REPORT_ASK, { model: 'opus' }, SESSION)
  assert.ok('answer' in noted, `the model report was refused: ${'refused' in noted ? noted.refused : ''}`)
  assert.equal(member.theRow().host.model, 'opus', 'the model report landed')
  assert.deepEqual(member.theDialogs(), [THE_DIALOGS_KEY], 'the model report wrote the tools\' own copy of the row, and dropped the dialog the launcher opened after it')
})

test('#380 r=2: what a session says about itself keeps the dialog the launcher opened', async (t) => {
  const member = aMemberOnDisk(t)
  await member.theMemberReports(0)

  member.clock.at += 1_000
  member.theHostSaid({ said: 'permission', call: A_CALL }, member.clock.at)
  member.clock.at += 1_000
  const answered = await member.tools.answer(THE_REFRESH_ASK, { usage: { context: { percent: 10 }, cost: { usd: 0.1 } }, turn_id: 't-1', answer: '' }, SESSION)
  assert.ok('answer' in answered, `the refresh question was refused: ${'refused' in answered ? answered.refused : ''}`)
  assert.equal(member.theRow().host.contextPercent, 10, 'what the session said about itself landed')
  assert.deepEqual(member.theDialogs(), [THE_DIALOGS_KEY], 'the refresh question wrote the tools\' own copy of the row, and dropped the dialog the launcher opened after it')
})
