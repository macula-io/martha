// What the crew answers for a package whose contract the ledger cannot read back (martha#513 slice 2, martha#601 row 111).
//
// The rule is the slice's (../refuse_calls_outside_the_package_contract) and the wiring is the crew's
// (./the_contract_a_member_is_held_to): this file pins the third case. An unreadable row answers no contract at all,
// for an act as for any other call, so the call runs with nothing to notice (row 111, removed). And a call that is no
// act reads no contract at all.
//
// It keeps its own state: a broken row is a fact about one package's ledger, and a test that plants one must not leave
// it where another test's package reads.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OFFER_OWNER_ASKS } from '../declare_crew/declare_crew.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { noteTheContract } from '../log_ledger/log_ledger.ts'
import { REPORT_WHERE_THE_WORK_STANDS, SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-contract-unreadable-'))
after(() => removeTheTree(home))
mkdirSync(join(home, 'row'))
mkdirSync(join(home, CREW_ROWS_PLACE), { mode: STREAM_DIRECTORY_MODE })

// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'
const BUILDER = 'Builder1'
const PACKAGE = 'synthetic-owner/repo#7'
const names = claudeCodeToolNames

const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: SUPERVISOR, role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: {
    name: 'team',
    roles: [SUPERVISOR, 'builder'],
    may: { ...Object.fromEntries(ACTS.map((act) => [act, [SUPERVISOR]])), [OFFER_OWNER_ASKS]: [SUPERVISOR], assign_work: [SUPERVISOR] },
  },
  channel_read_seconds: 30,
}
const documents = {
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return JSON.stringify(team)
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
}

/// The ledger this file keeps a broken row in, and the crew that reads it: both this file's own.
const ledger = { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } }
const beats = dashboardRowsIn(join(home, 'row'))

const theToolsOf = (member: string): CrewTools =>
  crewToolsOver({
    member,
    ledger,
    beats,
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, `store-${member}`)) },
  })

/** A call the gate would hand the contract: a shell command, which the act table reads by its own words. */
const aCall = (command: string) => ({ tool: CLAUDE_CODE_SHELL_TOOL, input: { command } })

/** A crew whose member holds the package, with a contract row the ledger cannot read back already in its stream. */
const aCrewWithAnUnreadableContract = async (): Promise<CrewTools> => {
  const tools = theToolsOf(BUILDER)
  await tools.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'the work', step: 0, of: 1, package: PACKAGE }, 'session-builder')
  await noteTheContract(ledger, { package: PACKAGE, member: SUPERVISOR, version: 1, digest: 'not-a-real-digest', block: ['this block is no contract'] })
  return tools
}

test('a call that is no act reads no contract at all, so an unreadable one cannot cost it', async () => {
  const tools = await aCrewWithAnUnreadableContract()
  assert.equal(await tools.theContractInForce(aCall('npm test'), names), undefined)
  assert.equal(await tools.theContractInForce({ tool: 'Read', input: { file_path: 'x' } }, names), undefined)
  // A handover is never an act, so it is never read against a contract: the one call a member cannot lose.
  assert.equal(await tools.theContractInForce({ tool: WRITE_MY_HANDOVER_TOOL, input: { content: 'my handover' } }, names), undefined)
})

test('#601 row 111: a contract row the ledger cannot read back answers no contract for an act either, so the act runs unnoticed', async () => {
  const tools = await aCrewWithAnUnreadableContract()
  assert.equal(await tools.theContractInForce(aCall('git push origin main'), names), undefined)
})
