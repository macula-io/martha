// The `who_is_free` tool over a real crew store (martha#319 package A): who may ask, the park read from the marker a
// member's own park tool wrote, and a member's report read back as the time it last reported.
//
// The decisions are the slice's (../see_who_is_free); this file pins the wiring, so a tool that read the wrong store, the
// wrong asker or no report at all fails here by name.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { FreeRow } from '../see_who_is_free/see_who_is_free.ts'
import { THE_ACT_IT_NEEDS, WHO_IS_FREE } from '../see_who_is_free/who_is_free_tool.ts'
import { PARK_A_MEMBER, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-who-is-free-'))
after(() => removeTheTree(home))
// The row store writes into a directory the launcher makes; it makes none itself.
mkdirSync(join(home, 'row'))

// A made-up project root: this repository is public, so no real path appears here.
const root = '/crew-project'
const LEAD = 'Lead'
const BUILDER = 'Builder1'
const REVIEWER = 'Reviewer1'
const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: LEAD, role: 'supervisor', model: 'model-a' },
    { name: BUILDER, role: 'builder', model: 'model-b' },
    { name: REVIEWER, role: 'reviewer' },
  ],
  mode: { name: 'team', roles: ['supervisor', 'builder', 'reviewer'], may: { ...Object.fromEntries(ACTS.map((act) => [act, ['supervisor']])), approve_landing: [OWNER] } },
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

/** Each member's tools over one shared crew store, as three launches of one crew would hold them. */
function theToolsOf(member: string): CrewTools {
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, 'rows')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(join(home, 'crew')) },
  })
}

const answerOf = (said: { readonly answer: string } | { readonly refused: string }): string => {
  assert.ok('answer' in said, `the tool refused: ${'refused' in said ? said.refused : ''}`)
  return said.answer
}

test('a member whose role is not allowed assign_work is refused, and the refusal names the act', async () => {
  const said = await theToolsOf(BUILDER).answer(WHO_IS_FREE, {}, 'session-builder')
  assert.ok('refused' in said, 'a builder does not choose who takes work')
  assert.match(said.refused, new RegExp(`${BUILDER} may not ask who is free: the declaration allows ${THE_ACT_IT_NEEDS} to supervisor`))
})

test('the Supervisor reads a report as the time it last reported, and a park from the marker the member kept', async () => {
  clock.at = 1_000
  answerOf(await theToolsOf(BUILDER).answer('report_progress', { task: 'build', step: 1, of: 3, package: 'macula-io/martha#319' }, 'session-builder'))
  answerOf(await theToolsOf(REVIEWER).answer('report_progress', { task: 'review', step: 1, of: 1 }, 'session-reviewer'))
  clock.at = 21_000

  const rows = JSON.parse(answerOf(await theToolsOf(LEAD).answer(WHO_IS_FREE, {}, 'session-lead'))) as FreeRow[]
  const builder = rows.find((row) => row.member === BUILDER)
  assert.deepEqual(rows.map((row) => row.member), [LEAD, BUILDER, REVIEWER], 'one row per declared member, in its order')
  assert.equal(builder?.reported_ago, 20_000, 'the report was kept as the time the member last reported')
  assert.equal(builder?.model, 'model-b', 'a member whose host named no model shows the model it is declared with')

  assert.match(answerOf(await theToolsOf(LEAD).answer(WHO_IS_FREE, { member: BUILDER }, 'session-lead')), /^no: Builder1 is in the middle of macula-io\/martha#319 \(working, 1\/3\)\. Fit instead: Reviewer1\.$/)
  assert.equal(answerOf(await theToolsOf(LEAD).answer(WHO_IS_FREE, { member: REVIEWER }, 'session-lead')), `yes: ${REVIEWER} may take a package now.`)

  answerOf(await theToolsOf(REVIEWER).answer(PARK_A_MEMBER, { reason: 'told to wind down' }, 'session-reviewer'))
  assert.match(answerOf(await theToolsOf(LEAD).answer(WHO_IS_FREE, { member: REVIEWER }, 'session-lead')), /^no: Reviewer1 is parked: told to wind down\./, 'the park its own tool kept is read back from the store')
})
