// A member's own report never costs the owner a dialog the host has open, and never brings back one the owner answered
// (martha#363, found by its end-to-end run on the recorded host).
//
// Two processes write one member's row: the crew's tools write what the member reports, and the launcher writes the
// dialogs the host raises (../tell_the_owner_a_session_waits). The tools keep the row as their session last left it, so a
// report rewrote the whole row from that copy, and a permission the owner had not yet answered vanished from it the next
// time the member reported or the host sent its figures. The dialogs are the launcher's word, so every write the tools
// make carries the dialogs the store holds now, never the ones its own copy held.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
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
import { OWNER_DIALOGS_FIELD, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { takeAnOwnerDialog, theKeyOfAPermission, whatTheOwnerIsShown, type RaisingADialog } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { crewToolsOver } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-tools-dialogs-'))
after(() => removeTheTree(home))
// The row store writes into a directory the launcher makes; it makes none itself.
mkdirSync(join(home, 'row'))

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

const clock = { at: 1_000 }
const beats = dashboardRowsIn(join(home, 'row'))
/** One session's tools, held across its reports as a launch holds them. */
const tools = crewToolsOver({
  member: BUILDER,
  ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } },
  beats,
  root,
  documents,
  stores: { crew: crewFilesDirectory(join(home, 'the-crew-store')) },
})

const A_PERMISSION: RaisingADialog = { kind: 'permission', agent: '', tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'touch made.txt' }, uses: 'toolu_1' }

/** The member reports, a step later than anything written before it. */
async function theMemberReports(step: number): Promise<void> {
  clock.at += 1_000
  const said = await tools.answer('report_progress', { task: 'build', step, of: 3 }, SESSION)
  assert.ok('answer' in said, `the report was refused: ${'refused' in said ? said.refused : ''}`)
}

/** The launcher, in its own process, writes what the host said about the owner's screen onto the stored row. */
function theLauncherWrites(event: Parameters<typeof takeAnOwnerDialog>[1]): void {
  const row = beats.read(BUILDER)
  assert.ok(row !== null, 'the member has reported, so the store holds its row')
  assert.ok(beats.keep(takeAnOwnerDialog(row, event)).kept, 'the store kept the launcher\'s write')
}

const theRow = (): DashboardRow => {
  const row = beats.read(BUILDER)
  assert.ok(row !== null, 'the store holds the member\'s row')
  return row
}

test('a report keeps the dialog the launcher opened, and never brings back one it closed', async () => {
  await theMemberReports(0)

  clock.at += 1_000
  theLauncherWrites({ change: 'opened', at: clock.at, raised: A_PERMISSION })
  await theMemberReports(1)
  assert.deepEqual(
    theRow()[OWNER_DIALOGS_FIELD]?.map((dialog) => dialog.key),
    [theKeyOfAPermission('', CLAUDE_CODE_SHELL_TOOL, {}, 'toolu_1')],
    'the member\'s report rewrote the row without the permission the owner has not answered',
  )
  assert.equal(whatTheOwnerIsShown(theRow()).state, 'needs-you')

  clock.at += 1_000
  theLauncherWrites({ change: 'closed', at: clock.at, key: theKeyOfAPermission('', CLAUDE_CODE_SHELL_TOOL, {}, 'toolu_1') })
  await theMemberReports(2)
  assert.equal(theRow()[OWNER_DIALOGS_FIELD], undefined, 'the member\'s report brought back a dialog the owner had answered')
  assert.equal(theRow().progress.step, 2, 'the member\'s own report is still what the row says')
})
