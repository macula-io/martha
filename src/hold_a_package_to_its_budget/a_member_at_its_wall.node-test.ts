// The wall, through the real relay (martha#513, slice 3).
//
// The budget is well tested on its own (./hold_a_package_to_its_budget), and so is the gate's order
// (../answer_a_tool_call). What neither proves is that the relay ever asks: a launcher that read the spend and forgot
// to hand it to the gate, or that let a call run without counting it, would leave both suites green and a member free
// to spend past its package. These three hold each half: a call that runs is counted, the next one is refused at the
// wall, and the handover still runs when nothing else will — under the name Claude Code calls it by.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import {
  CLAUDE_CODE_HOOK_SWITCHES,
  CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  CLAUDE_CODE_OWNERS_MARKDOWN,
  RECORDED_HOST,
} from '../claude_code_host/recorded_claude_code_host.ts'
import { CLAUDE_CODE, CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { hookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { sourcesALaunchHandsTheModel } from '../install_the_mesh_server_for_claude_code/what_a_launch_hands_the_model.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { holdingTheEnds } from '../end_a_running_turn/hold_the_end.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { noteTheContract, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { theRowWithNothingSaid } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { memberRelay, type MemberRelay, type RelayReply } from '../answer_the_relay/answer_the_relay.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'

import { theBudgetOver } from './the_budget_tools.ts'
import { theSpendCounts } from './the_spend_stream.ts'
import { theContractOfABlock } from '../keep_the_package_contract/the_contract_in_a_brief.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

const SESSION = 'the-session'
// Synthetic names, never a real one: this repository is public.
const HELD_PACKAGE = 'synthetic-owner/repo#17'
const MEMBER = 'member-one'

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-513-wall-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** The ledger the crew's rows are kept in. */
const ledgerOf = (places: Places): LedgerHost => ({ clock: { now: () => 0 }, stores: { rows: rowStreamsDirectory(places.rows) } })

/** Keeps a contract of `budget` as the package's first version, as the Supervisor's tool would. */
async function keepABudget(ledger: LedgerHost, budget: string): Promise<void> {
  const block = [
    'goal: a package is held to what it may spend',
    'acceptance: the budget stops the member | ci: CI',
    'allowed: push, handoff',
    `budget: ${budget}`,
    'done: the tip is green',
  ]
  const read = theContractOfABlock(block)
  assert.ok('ok' in read, 'refused' in read ? read.refused : '')
  await noteTheContract(ledger, { package: HELD_PACKAGE, member: 'Supervisor', version: 1, digest: read.ok.digest, block })
}

/** The row that says this member holds the package, as its own beat leaves it. */
const holdingThePackage = () => ({ ...theRowWithNothingSaid(), member: MEMBER, session: SESSION, at: 0, holds: HELD_PACKAGE })

/**
 * A crew whose crew refuses nothing, over the real budget: what a test reads is whether the relay asks it and what the
 * relay does with the answer, not the crew's own rules.
 */
function aCrewWithABudget(ledger: LedgerHost): CrewTools {
  const budget = theBudgetOver({ member: MEMBER, ledger, beats: { read: () => holdingThePackage() } })
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    ends: holdingTheEnds(),
    thePredecessorOf: async () => null,
    theSpendInForce: (session_id) => budget.theSpendInForce(session_id),
    noteTheCallCounted: (session_id, own_name) => budget.noteTheCallCounted(session_id, own_name),
    theReviewModelOfTheCall: async () => null,
    theReviewModel: async () => null,
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async () => undefined,
  } as CrewTools & { readonly places?: Places }
}

/** The receipts the launcher takes for a call that will run: a denied call may leave none. */
function theReceiptsTaken(allowed: string[]): SignedRuns {
  return {
    callAllowed: (tool) => void allowed.push(tool),
    callAnswered: () => undefined,
    run: async () => ({ refused: 'this test runs no signed shape' }),
  }
}

/** The relay for one member, over a crew's own tools and the receipts a call would take. */
function relayFor(places: Places, crew: CrewTools, signed_runs: SignedRuns): MemberRelay {
  return memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, CLAUDE_FOLDER, USER_SETTINGS_FILE),
      home: places.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(places.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({
      launcher_env: { HOME: places.home },
      member_env: { HOME: places.home },
      home: places.home,
      launch_dir: places.checkout,
      settings_files: [],
      user_scope: userScopeFor(places.home),
    }),
    crew,
    signed_runs,
    stopMember: () => {},
  })
}

async function startedOn(relay: MemberRelay): Promise<void> {
  const reply = await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(reply.answered, true, 'the session was not started, so no call could be judged')
}

const call = (tool: string) => ({ session_id: SESSION, call: { tool, tool_use_id: `toolu_${tool}` } })

/** The denial a reply carries, or undefined when the call ran: a reply that stopped the member carries none. */
const theDenyIn = (reply: RelayReply): string | undefined => ('body' in reply ? (reply.body as { deny?: string }).deny : undefined)

test('a call the relay lets run is one more tool call counted against its package', async (t) => {
  const places = placesOf(t)
  const ledger = ledgerOf(places)
  await keepABudget(ledger, '10 tool calls')
  const allowed: string[] = []
  const relay = relayFor(places, aCrewWithABudget(ledger), theReceiptsTaken(allowed))
  await startedOn(relay)

  const reply = await relay.answer('tool_called', call('Read'))
  assert.equal(reply.answered, true)
  assert.equal(theDenyIn(reply), undefined, 'a call with budget left was refused')
  assert.deepEqual(allowed, ['Read'], 'the call did not run')
  assert.deepEqual(await theSpendCounts(ledger, HELD_PACKAGE), { 'tool calls': 1 }, 'the call that ran was not counted')
})

test('at the wall the relay refuses the next call, and the handover runs under the name Claude Code calls it by', async (t) => {
  const places = placesOf(t)
  const ledger = ledgerOf(places)
  await keepABudget(ledger, '1 tool calls')
  const allowed: string[] = []
  const relay = relayFor(places, aCrewWithABudget(ledger), theReceiptsTaken(allowed))
  await startedOn(relay)

  // The one call the budget allows, counted as it runs.
  assert.equal(theDenyIn(await relay.answer('tool_called', call('Read'))), undefined)

  const refused = theDenyIn(await relay.answer('tool_called', call('Bash')))
  assert.ok(refused !== undefined, 'a call past the budget was allowed to run')
  assert.match(refused, /1 of 1 tool calls/)
  assert.deepEqual(allowed, ['Read'], 'a receipt was taken for a call that never ran')

  // The handover, as it arrives from the crew's server: the wall keeps it open.
  const handover = theDenyIn(await relay.answer('tool_called', call('mcp__martha__write_my_handover')))
  assert.equal(handover, undefined, 'the handover was refused at the wall, which would trap the member')
})

test('the budget the relay asks is the package its member holds, and no other package pays for it', async (t) => {
  const places = placesOf(t)
  const ledger = ledgerOf(places)
  await keepABudget(ledger, '1 tool calls')
  const relay = relayFor(places, aCrewWithABudget(ledger), theReceiptsTaken([]))
  await startedOn(relay)

  await relay.answer('tool_called', call('Read'))
  assert.deepEqual(await theSpendCounts(ledger, HELD_PACKAGE), { 'tool calls': 1 })
  assert.deepEqual(await theSpendCounts(ledger, 'synthetic-owner/repo#18'), {}, 'another package paid for this one')
})
