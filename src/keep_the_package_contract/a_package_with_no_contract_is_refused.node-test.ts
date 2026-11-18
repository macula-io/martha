// A package with no contract is refused its first call, in a solo crew and in a team crew (martha#597).
//
// The rule is ../refuse_calls_outside_the_package_contract's and the wiring is ../a_crews_tools's; this file pins the
// two crew shapes the owner can declare, because the rule must not depend on which one is in force. It is also why the
// refusal is not in the launcher: a launch refusal needs an escape for the member that may keep a contract, and in a
// solo crew every member may, so a launch gate would bite in a team crew and not in a solo one. Here both are refused
// on the first working call, and the five calls that let someone save the work and fix the package stay open.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { answerToolCall, type ApprovedLaunch, type ToolCallAnswer } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { beginSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OFFER_OWNER_ASKS, OWNER } from '../declare_crew/declare_crew.ts'
import { SOLO_MODE } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { KEEP_THE_CONTRACT_TOOL } from '../keep_the_package_contract/the_contract_tools.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { PARK_A_MEMBER } from '../park_and_wake_a_member/the_park_tools.ts'
import { REPORT_WHERE_THE_WORK_STANDS, SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
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

/**
 * What the gate answers for a call, in the crew's shape: the crew is asked for the contract this member holds, and the
 * gate is handed its answer, as the relay hands it on every call.
 */
async function theAnswer(place: { readonly crew: CrewTools; readonly launch: ApprovedLaunch }, tool: string, input: Readonly<Record<string, unknown>>, session_id: string): Promise<ToolCallAnswer> {
  const contract = await place.crew.theContractInForce({ tool, input }, names)
  return answerToolCall({
    names,
    tool,
    input,
    session: beginSession({ read: () => undefined, write: () => {} }, session_id),
    policy: { may_send_executable_text: [] },
    launch: place.launch,
    host: thisMachine,
    contract,
  })
}

/** The words of a refusal, which a call that runs does not have. */
const theRefusalIn = (answer: ToolCallAnswer): string => {
  assert.notEqual(answer, undefined, 'the call was allowed; it must be refused')
  return (answer as { readonly deny: string }).deny
}

for (const [shape, solo] of [[SOLO_MODE, true], ['team', false]] as const) {
  test(`#597: in a ${shape} crew, a member holding a package with no contract is refused its first call, and the calls that end it stay open`, async (t) => {
    const place = aPlaceWith(t, solo)
    // The report is one of the five that run, and it is the call that names the package on the member's row.
    const reported = await place.crew.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'the work', step: 0, of: 1, package: PACKAGE }, 'session-1')
    assert.ok('answer' in reported, 'refused' in reported ? reported.refused : '')

    // The first working call — an act or not — is refused, and the words name the tool that records a contract.
    for (const [tool, input] of [
      [CLAUDE_CODE_SHELL_TOOL, { command: 'npm test' }],
      [CLAUDE_CODE_SHELL_TOOL, { command: 'git push origin main' }],
      ['Read', { file_path: 'a-file' }],
    ] as const) {
      const said = theRefusalIn(await theAnswer(place, tool, input, 'session-1'))
      assert.match(said, /has no contract recorded, so none of its work runs until one is kept/)
      assert.match(said, new RegExp(`keeps it with ${KEEP_THE_CONTRACT_TOOL.name}`))
    }

    // The four that end a package, and the tool that records a contract, still run — under the names this host uses.
    for (const own_name of [WRITE_MY_HANDOVER_TOOL, SAY_TO_THE_CREW, REPORT_WHERE_THE_WORK_STANDS, PARK_A_MEMBER, KEEP_THE_CONTRACT_TOOL.name]) {
      assert.equal(await theAnswer(place, `mcp__martha__${own_name}`, {}, 'session-1'), undefined, own_name)
    }
  })
}
