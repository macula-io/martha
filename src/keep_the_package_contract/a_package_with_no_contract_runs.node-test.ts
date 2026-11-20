// A package with no contract runs its calls, in a solo crew and in a team crew (martha#601 row 109, which removed
// martha#597's refusal).
//
// The wiring is ../a_crews_tools's: a member holding a package with no contract version is handed no contract, so the
// gate lets its calls through and nothing is noticed against one. This file pins the two crew shapes the owner can
// declare, because the answer must not depend on which one is in force.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { answerToolCall, type ApprovedLaunch, type ToolCallAnswer } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { beginSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OFFER_OWNER_ASKS, OWNER, SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { REPORT_WHERE_THE_WORK_STANDS, SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'

const names = claudeCodeToolNames
const BUILDER = 'Builder1'
const PACKAGE = 'synthetic-owner/repo#7'
// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'

/** A declaration of this crew in one of its two shapes: a solo crew, whose acts are the owner's, or a team crew's. */
const aDeclaration = (solo: boolean): string =>
  JSON.stringify({
    version: DECLARATION_VERSION,
    owner: 'Ann',
    members: solo ? [{ name: BUILDER, role: 'builder' }] : [
      { name: SUPERVISOR, role: SUPERVISOR },
      { name: BUILDER, role: 'builder' },
    ],
    mode: {
      name: solo ? SOLO_MODE : 'team',
      roles: solo ? ['builder'] : [SUPERVISOR, 'builder'],
      may: { ...Object.fromEntries(ACTS.map((act) => [act, solo ? [OWNER] : [SUPERVISOR]])), [OFFER_OWNER_ASKS]: solo ? [OWNER] : [SUPERVISOR], assign_work: solo ? [OWNER] : [SUPERVISOR] },
    },
    channel_read_seconds: 30,
  })

/** A crew place of this test's own: its declaration, its streams, its dashboard rows, and a launch with no config. */
function aPlaceWith(t: TestContext, solo: boolean): { readonly crew: CrewTools; readonly launch: ApprovedLaunch } {
  const home = mkdtempSync(join(tmpdir(), `martha-no-contract-${solo ? SOLO_MODE : 'team'}-`))
  t.after(() => removeTheTree(home))
  const declaration = aDeclaration(solo)
  mkdirSync(join(home, 'row'))
  mkdirSync(join(home, CREW_ROWS_PLACE), { mode: STREAM_DIRECTORY_MODE })
  const documents = {
    read: async (path: string): Promise<string> => {
      if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return declaration
      throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
    },
  }
  const crew = crewToolsOver({
    member: BUILDER,
    ledger: { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, 'crew-store')) },
  })
  const launch: ApprovedLaunch = { host: CLAUDE_CODE, launch_dir: home, stop_dir: home, approved_fingerprints: [] }
  return { crew, launch }
}

/** What the gate answers for a call, and what the crew hands for the notice: the contract this member holds, if any. */
async function theAnswer(place: { readonly crew: CrewTools; readonly launch: ApprovedLaunch }, tool: string, input: Readonly<Record<string, unknown>>, session_id: string): Promise<{ readonly answer: ToolCallAnswer; readonly contract: unknown }> {
  const contract = await place.crew.theContractInForce({ tool, input }, names)
  const answer = answerToolCall({
    names,
    tool,
    input,
    session: beginSession({ read: () => undefined, write: () => {} }, session_id),
    policy: { may_send_executable_text: [] },
    launch: place.launch,
    host: thisMachine,
  })
  return { answer, contract }
}

for (const [shape, solo] of [[SOLO_MODE, true], ['team', false]] as const) {
  test(`#601 row 109: in a ${shape} crew, a member holding a package with no contract runs its calls, and is handed no contract to be noticed against`, async (t) => {
    const place = aPlaceWith(t, solo)
    // The report is the call that names the package on the member's row.
    const reported = await place.crew.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'the work', step: 0, of: 1, package: PACKAGE }, 'session-1')
    assert.ok('answer' in reported, 'refused' in reported ? reported.refused : '')

    // A working call, an act or not, runs, and the crew hands no contract for it: there is nothing to notice.
    for (const [tool, input] of [
      [CLAUDE_CODE_SHELL_TOOL, { command: 'npm test' }],
      [CLAUDE_CODE_SHELL_TOOL, { command: 'git push origin main' }],
      ['Read', { file_path: 'a-file' }],
    ] as const) {
      assert.deepEqual(await theAnswer(place, tool, input, 'session-1'), { answer: undefined, contract: undefined }, `${tool} ${JSON.stringify(input)}`)
    }
  })
}
