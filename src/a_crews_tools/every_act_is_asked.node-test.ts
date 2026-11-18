// Every act a crew's table can grant is asked by the handlers that take it (martha#607).
//
// This exists so a list cannot promise a gate that no code runs. The crew's acts are the declaration's table
// (../declare_crew's ACTS), granted to roles, and a tool that takes one refuses a member whose role the table does not
// grant it. Each row below drives one handler that reads a grant through the crew tool that reaches it, as a member of
// a role the table does not grant and as one it does; a handler that stops asking fails its row by name.
//
// The ledger after the rows names every crew tool, as the acts it asks or as ungated with the reason. A tool the crew
// registers that the ledger does not name fails by name, so a new tool cannot arrive without saying whether it gates.
// What this cannot see: a tool the ledger calls ungated that later grows a gate, which only review of its line catches,
// and a gate reached outside the crew's tools (the `martha` command's owner-only acts).
//
// This is a speed bump, said plainly (docs/publish-gate.md, "Who may act"): a member runs as the owner's OS user and can
// edit the table itself. The check keeps the table and the handlers honest with each other, nothing more.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { ACTS, APPROVE_LANDING, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, HOLD_REVIEWS, OFFER_OWNER_ASKS, RESTART_MEMBER, declareCrew, type Act } from '../declare_crew/declare_crew.ts'
import { NO_MODEL_NAMED } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { VERIFY_RANGE_TOOL } from '../check_a_range_before_the_owner_says_yes/the_verify_range_tool.ts'
import { LOG_A_MILESTONE_TOOL, NOTE_WHAT_BECAME_TOOL, WHAT_WAS_SENT_TOOL } from '../keep_the_ledger/the_ledger_tools.ts'
import { KEEP_THE_CONTRACT_TOOL } from '../keep_the_package_contract/the_contract_tools.ts'
import { OWNER_TODO_ADD_TOOL, OWNER_TODO_DONE_TOOL } from '../keep_the_owners_todo_list/the_todo_tools.ts'
import { STANDING_ADD_TOOL, STANDING_CLOSE_TOOL, STANDING_TOOL } from '../keep_the_supervisors_standing_items/the_standing_tools.ts'
import { FAST_FORWARD_TOOL, LAND_BATCH_TOOL } from '../land_passed_work_as_one_batch/the_landing_tools.ts'
import { PARK_A_MEMBER_TOOL, WAKE_A_MEMBER_TOOL } from '../park_and_wake_a_member/the_park_tools.ts'
import { LIST_ASKS_TOOL, QUEUE_ASK_TOOL, SETTLE_ASKS_TOOL, TAKE_ASKS_TOOL } from '../queue_the_owners_asks/the_ask_tools.ts'
import { WHO_IS_FREE_TOOL } from '../see_who_is_free/who_is_free_tool.ts'
import { UNHELD_WORK_TOOL } from '../find_the_unheld_work/unheld_work_tool.ts'
import { RESTART_A_MEMBER_TOOL } from '../stop_and_restart_a_member/the_restart_tool.ts'
import { LIFECYCLE_PLACE, type StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { REPORT_PROGRESS_TOOL } from '../report_where_the_work_stands/report_progress_tool.ts'
import { SEE_THE_CREW_TOOL } from '../see_the_crew/the_see_the_crew_tool.ts'
import { SAY_TO_THE_CREW_TOOL } from '../send_a_crew_message/say_to_the_crew_tool.ts'
import { READ_THE_RECEIPTS_TOOL } from '../show_what_a_message_became/the_receipts_tool.ts'
import { RETURN_TO_YOUR_OWN_MODEL_TOOL, SWITCH_YOUR_MODEL_TOOL } from '../switch_a_members_model/the_switch_tools.ts'
import { WRITE_MY_HANDOVER_SCHEMA } from '../write_my_handover/the_handover_tool.ts'
import { WORKTREE_FINISH_TOOL, WORKTREE_OPEN_TOOL } from '../open_and_finish_a_worktree/the_worktree_tools.ts'
import { WAIT_FOR_CI_TOOL } from '../wait_for_ci/the_ci_wait_tool.ts'
import { CREW_TOOL_NAMES, REFRESH_THIS_SESSION, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-every-act-'))
after(() => removeTheTree(home))
mkdirSync(join(home, 'row'))
mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })

// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'
const GRANTED = 'Lead'
const UNGRANTED = 'Builder1'
const ANOTHER = 'Builder2'
const BUILDER_ROLE = 'builder'
/**
 * The crew, its table built for one row: `act` granted to the granted role alone, and every other act to the ungranted
 * role alone. A handler that read another act's grant would then let the ungranted member through, or refuse the granted
 * one, and its row fails (martha#607 r=2).
 */
const teamFor = (act: Act) => ({
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: GRANTED, role: SUPERVISOR, model: 'model-a' },
    { name: UNGRANTED, role: BUILDER_ROLE, model: 'model-b' },
    { name: ANOTHER, role: BUILDER_ROLE, model: 'model-b' },
  ],
  mode: { name: 'team', roles: [SUPERVISOR, BUILDER_ROLE], may: Object.fromEntries(ACTS.map((one) => [one, [one === act ? SUPERVISOR : BUILDER_ROLE]])) },
  channel_read_seconds: 30,
})
const documentsFor = (act: Act) => ({
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return JSON.stringify(teamFor(act))
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
})

/** Processes that run nothing: a granted call that gets past its grant fails here, never on a real git or gh. */
const NOTHING_RUNS = 'this test runs no process'
const processes = {
  run: async () => ({ exit_code: 1, stdout: '', stderr: NOTHING_RUNS }),
  runNow: () => ({ exit_code: 1, stdout: '', stderr: NOTHING_RUNS }),
  identityOf: () => null,
  signalGroup: () => assert.fail('no row signals a process'),
} as unknown as NonNullable<Parameters<typeof crewToolsOver>[0]['processes']>

const crew = keepTheCrewsFilesAsDirectories(join(home, 'the-crew-store'))
const rows = rowStreamsDirectory(join(home, CREW_ROWS_PLACE))

/** Where a restart is asked: no member is running, so a granted restart is told so and nothing is signalled. */
const lifecycle: StoppingHost = {
  stores: { lifecycle: crew.place(LIFECYCLE_PLACE), rows },
  launches: () => [],
  processes: { identityOf: () => null, signalGroup: () => assert.fail('no row signals a process') },
  clock: { now: () => 1_000 },
  wait: async () => assert.fail('no row waits for a member'),
}

/**
 * A member's tools under the table built for `act`. The acting tools read the declaration the launcher parsed, as a
 * launch hands it; the others read it from documents. Both are the same table.
 */
async function theToolsOf(member: string, act: Act): Promise<CrewTools> {
  const documents = documentsFor(act)
  const settings = await declareCrew(documents, root, NO_MODEL_NAMED)
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => 1_000 }, stores: { rows } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew },
    processes,
    settings,
    lifecycle,
  })
}

/** One handler that reads a grant (its slice and file), the act it reads, and the crew tool call that reaches it. */
interface ARow {
  readonly act: Act
  readonly handler: string
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
}

const PACKAGE = 'synthetic-owner/synthetic-repo#1'
const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const RANGE = { path: root, base: BASE, tip: TIP, packages: [PACKAGE] }

/**
 * Every handler that reads a grant from the table today, each through every crew tool that reaches it. A member that
 * acts on another (park, wake, restart) acts on ANOTHER, so no row is refused for acting on itself.
 */
const ROWS: readonly ARow[] = [
  { act: 'assign_work', handler: 'check_a_range_before_the_owner_says_yes/the_verify_range_tool', tool: VERIFY_RANGE_TOOL.name, args: RANGE },
  { act: 'assign_work', handler: 'find_the_unheld_work/unheld_work_tool', tool: UNHELD_WORK_TOOL.name, args: {} },
  { act: 'assign_work', handler: 'keep_the_owners_todo_list/the_todo_tools', tool: OWNER_TODO_ADD_TOOL.name, args: { text: 'say yes to the landing' } },
  { act: 'assign_work', handler: 'keep_the_owners_todo_list/the_todo_tools', tool: OWNER_TODO_DONE_TOOL.name, args: { id: 'an-act' } },
  { act: 'assign_work', handler: 'keep_the_package_contract/the_contract_tools', tool: KEEP_THE_CONTRACT_TOOL.name, args: { package: PACKAGE } },
  { act: 'assign_work', handler: 'keep_the_supervisors_standing_items/the_standing_tools', tool: STANDING_ADD_TOOL.name, args: { package: PACKAGE, text: 'watch it' } },
  { act: 'assign_work', handler: 'keep_the_supervisors_standing_items/the_standing_tools', tool: STANDING_CLOSE_TOOL.name, args: { package: PACKAGE } },
  { act: 'assign_work', handler: 'nudge_the_supervisor/nudge_the_supervisor', tool: LOG_A_MILESTONE_TOOL.name, args: { package: PACKAGE, event: 'resume', note: 'go on' } },
  { act: 'assign_work', handler: 'see_who_is_free/who_is_free_tool', tool: WHO_IS_FREE_TOOL.name, args: {} },
  { act: APPROVE_LANDING, handler: 'land_passed_work_as_one_batch/the_owners_yes_to_a_landing', tool: FAST_FORWARD_TOOL.name, args: RANGE },
  { act: 'resume_parked_work', handler: 'park_and_wake_a_member/park_and_wake_a_member', tool: PARK_A_MEMBER_TOOL.name, args: { member: ANOTHER, reason: 'waiting' } },
  { act: 'resume_parked_work', handler: 'park_and_wake_a_member/park_and_wake_a_member', tool: WAKE_A_MEMBER_TOOL.name, args: { member: ANOTHER, reason: 'back' } },
  { act: OFFER_OWNER_ASKS, handler: 'queue_the_owners_asks/queue_the_owners_asks', tool: TAKE_ASKS_TOOL.name, args: {} },
  { act: OFFER_OWNER_ASKS, handler: 'queue_the_owners_asks/queue_the_owners_asks', tool: SETTLE_ASKS_TOOL.name, args: {} },
  { act: RESTART_MEMBER, handler: 'stop_and_restart_a_member/restart_a_member', tool: RESTART_A_MEMBER_TOOL.name, args: { member: ANOTHER, reason: 'stalled' } },
]

/** What a tool says that is a refusal for the grant: every handler's refusal opens with the caller's name and "may not". */
const refusedForTheGrant = (member: string, said: { readonly answer: string } | { readonly refused: string }): boolean =>
  ('refused' in said ? said.refused : said.answer).includes(`${member} may not`)

const wordsOf = (said: { readonly answer: string } | { readonly refused: string }): string => ('answer' in said ? said.answer : said.refused)

for (const row of ROWS) {
  test(`#607: ${row.handler}, through ${row.tool}, refuses a role the table does not grant ${row.act}, and not one it grants`, async () => {
    const ungranted = await (await theToolsOf(UNGRANTED, row.act)).answer(row.tool, row.args, `session-${UNGRANTED}`)
    assert.ok(refusedForTheGrant(UNGRANTED, ungranted), `${row.handler} let ${UNGRANTED} take ${row.act} through ${row.tool}: ${wordsOf(ungranted)}`)
    const granted = await (await theToolsOf(GRANTED, row.act)).answer(row.tool, row.args, `session-${GRANTED}`)
    assert.ok(!refusedForTheGrant(GRANTED, granted), `${row.handler} refused ${GRANTED}, whose role the table grants ${row.act}: ${wordsOf(granted)}`)
  })
}

/** What a crew tool asks of the table: the acts its handler refuses an ungranted role, or why it asks none. */
type ALedgerLine = { readonly asks: readonly Act[] } | { readonly ungated: string }

/** Every tool the crew registers, gated or not, and why. */
const EVERY_CREW_TOOL: Readonly<Record<string, ALedgerLine>> = {
  [REPORT_PROGRESS_TOOL.name]: { ungated: "reports the caller's own progress, onto its own row" },
  [LOG_A_MILESTONE_TOOL.name]: { asks: ['assign_work'] },
  [WHAT_WAS_SENT_TOOL.name]: { ungated: 'reads what the caller itself sent' },
  [NOTE_WHAT_BECAME_TOOL.name]: { ungated: "records how the caller's own announced act ended" },
  [KEEP_THE_CONTRACT_TOOL.name]: { asks: ['assign_work'] },
  [SEE_THE_CREW_TOOL.name]: { ungated: "reads the crew's pane; its nudges part shows to whom theNudgesGoTo names, the reader the milestone row pins" },
  [WHO_IS_FREE_TOOL.name]: { asks: ['assign_work'] },
  [UNHELD_WORK_TOOL.name]: { asks: ['assign_work'] },
  [SAY_TO_THE_CREW_TOOL.name]: { ungated: "sends a message; the receiving side's delivery gate decides what it may do" },
  [READ_THE_RECEIPTS_TOOL.name]: { ungated: 'reads what became of messages the caller sent' },
  [PARK_A_MEMBER_TOOL.name]: { asks: ['resume_parked_work'] },
  [WAKE_A_MEMBER_TOOL.name]: { asks: ['resume_parked_work'] },
  [RESTART_A_MEMBER_TOOL.name]: { asks: [RESTART_MEMBER] },
  [SWITCH_YOUR_MODEL_TOOL.name]: { ungated: "switches the caller's own model, among those the declaration names" },
  [RETURN_TO_YOUR_OWN_MODEL_TOOL.name]: { ungated: 'returns the caller to its own declared model' },
  [WRITE_MY_HANDOVER_SCHEMA.name]: { ungated: "writes the caller's own handover" },
  [REFRESH_THIS_SESSION]: { ungated: "refreshes the caller's own session" },
  [VERIFY_RANGE_TOOL.name]: { asks: ['assign_work'] },
  [LAND_BATCH_TOOL.name]: { ungated: 'pushes an integration branch, never a default branch; moving the default branch is the fast-forward, which asks approve_landing' },
  [FAST_FORWARD_TOOL.name]: { asks: [APPROVE_LANDING] },
  [WORKTREE_OPEN_TOOL.name]: { ungated: "opens a worktree under the declaration's worktree place, for the caller's own work" },
  [WORKTREE_FINISH_TOOL.name]: { ungated: "removes a worktree on a branch Martha's own naming made; a convenience, not a guard (martha#256)" },
  [OWNER_TODO_ADD_TOOL.name]: { asks: ['assign_work'] },
  [OWNER_TODO_DONE_TOOL.name]: { asks: ['assign_work'] },
  [QUEUE_ASK_TOOL.name]: { ungated: 'queues a question for the owner; taking and settling asks are gated' },
  [LIST_ASKS_TOOL.name]: { ungated: "reads the owner's waiting asks" },
  [TAKE_ASKS_TOOL.name]: { asks: [OFFER_OWNER_ASKS] },
  [SETTLE_ASKS_TOOL.name]: { asks: [OFFER_OWNER_ASKS] },
  [STANDING_ADD_TOOL.name]: { asks: ['assign_work'] },
  [STANDING_CLOSE_TOOL.name]: { asks: ['assign_work'] },
  [STANDING_TOOL.name]: { ungated: 'reads the standing items' },
  [WAIT_FOR_CI_TOOL.name]: { ungated: 'reads CI runs; it changes nothing' },
}

test('#607: the ledger names every tool the crew registers, and no tool the crew does not', () => {
  const ledgered = Object.keys(EVERY_CREW_TOOL)
  const missing = CREW_TOOL_NAMES.filter((name) => !ledgered.includes(name))
  const extra = ledgered.filter((name) => !(CREW_TOOL_NAMES as readonly string[]).includes(name))
  assert.deepEqual(missing, [], `tool ${missing.join(', ')} is in the crew's tools and not in the ledger: say which acts it asks, or why it asks none`)
  assert.deepEqual(extra, [], `the ledger names ${extra.join(', ')}, which the crew does not register`)
})

/**
 * The acts no tool asks because the core asks them itself, each read where it decides something: a grant to a role
 * decides who holds reviews, so a launch (../start_the_member_on_its_host), a switch (../switch_a_members_model) and
 * each review call (../run_reviews_on_the_review_model) read it, and `declare_crew.node-test.ts` and
 * `run_reviews_on_the_review_model.node-test.ts` pin each reading. An act with neither a tool nor an entry here still
 * fails below, which is what this check is for.
 */
const ASKED_BY_THE_CORE: readonly string[] = [HOLD_REVIEWS]

test("#607: every act the table can grant is asked by some tool, and a tool asks only acts the table has", () => {
  const asked = new Set(Object.values(EVERY_CREW_TOOL).flatMap((line) => ('asks' in line ? line.asks : [])))
  for (const act of ACTS) assert.ok(asked.has(act) || ASKED_BY_THE_CORE.includes(act), `act ${act} is asked by no tool and read by nothing`)
  for (const act of asked) assert.ok((ACTS as readonly string[]).includes(act), `a tool says it asks ${act}, which is not an act the table has`)
})

test('#607: every act a tool says it asks has a row that drives that tool, and every row is a tool the ledger says asks it', () => {
  for (const [tool, line] of Object.entries(EVERY_CREW_TOOL)) {
    if (!('asks' in line)) continue
    for (const act of line.asks) assert.ok(ROWS.some((row) => row.tool === tool && row.act === act), `tool ${tool} says it asks ${act}, and no row drives it`)
  }
  for (const row of ROWS) {
    const line = EVERY_CREW_TOOL[row.tool]
    assert.ok(line !== undefined && 'asks' in line && line.asks.includes(row.act), `a row drives ${row.tool} for ${row.act}, which the ledger does not say it asks`)
  }
})
