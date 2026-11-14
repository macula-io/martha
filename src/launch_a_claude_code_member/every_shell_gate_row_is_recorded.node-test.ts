// Every row that claims the shell gate is reached by what the Claude Code
// launcher records (martha#121).
//
// The shell gate refuses only what a session's record holds. So this drives
// the launcher's own answers (./answer_the_relay.ts) with every event the
// recorded host declares: each session start source, each prompt origin kind,
// and the result of each kind of tool, on a launch whose approved config holds
// a hook and a server the recorded mesh tree does not bind. It collects every
// path the records hold and hands them to the coverage check, which names each
// shell-gate row none of them reached. There is no list of rows let off: a row
// is reached, or the registry stops promising the gate for it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { SOLO_MEMBERS, soloDeclaration } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { recordAStandingItem } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { shellGateRowsNothingRecords } from '../check_every_path_is_gated/check_every_path_is_gated.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_TOOL_RESULT_ROWS, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import {
  CLAUDE_CODE_EMITTED_SESSION_EVENTS,
  CLAUDE_CODE_PROMPT_ORIGIN_KINDS,
} from '../claude_code_host/recorded_claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { MESH_TOOLS_THAT_RUN } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { RECORDED_RING_ANSWERS } from '../read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { CLAUDE_SERVERS, CLAUDE_SETTINGS, startedWithOf, type StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { GIT, GITHUB_CLI, HISTORY_SUBCOMMANDS } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { PATH_OF_SOURCE } from '../take_in_a_turn/take_in_a_turn.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'
import { recordOf, sessionRecordsIn, sessionRecordStreamOf } from '../session_records_in_rows/session_records_in_rows.ts'

/** The user-scope places the recording names, under a home the tests run in (martha#154). */
const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, '.claude', CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

/** A launch's approved config that holds every kind of thing a launch can hand the model at start. */
const CARRIED = {
  [CLAUDE_SETTINGS]: bytes({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo from the checkout' }] }] } }),
  [CLAUDE_SERVERS]: bytes({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } }),
}

/** How the host names a server's tool: `mcp__<server>__<tool>`. */
const MESH_SERVER_TOOL = (own: string): string => `mcp__macula__${own}`
const ANOTHER_SERVER_TOOL = 'mcp__probe__fetch_page'

/** A place outside every checkout the test makes: what a file tool reads there is not the approved tree's. */
const OUTSIDE_THE_TREE = tmpdir()

/** The commands that decide a command's rows: any command, the GitHub CLI, and each history read of git. */
const COMMANDS: readonly string[] = ['ls', GITHUB_CLI, ...HISTORY_SUBCOMMANDS.map((history) => `${GIT} ${history}`)]

/**
 * One call of every built-in tool the host's table names (martha#127), with
 * each input that decides its row: a file or a search outside the tree, and
 * every kind of command.
 */
const BUILT_IN_CALLS: readonly Readonly<Record<string, unknown>>[] = Object.entries(CLAUDE_CODE_TOOL_RESULT_ROWS).flatMap(
  ([tool, row]) => {
    if (row.reads === 'a_command') return COMMANDS.map((command) => ({ tool, [row.field]: command }))
    if (row.reads === 'a_source' || row.reads === 'an_agents_answer') return [{ tool }]
    return [{ tool, [row.field]: OUTSIDE_THE_TREE }]
  },
)

/** A member's places, under one directory the test removes: a checkout with no launch config, and its rows. */
function placeOf(t: TestContext): { readonly home: string; readonly checkout: string; readonly rows: string } {
  const home = mkdtempSync(join(tmpdir(), 'martha-121-reach-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

/**
 * The crew a member of a solo crew holds, with one standing item recorded (martha#317): what the crew hands a session
 * at its start is a source the record takes in, so the drive starts its sessions with a crew that hands one.
 */
async function aCrewThatHandsAStandingItem(place: { readonly home: string; readonly checkout: string; readonly rows: string }): Promise<CrewTools> {
  // A solo crew's table grants assign_work to the owner alone, so each of its members keeps the items (#316's answer).
  const member = SOLO_MEMBERS[0].name
  mkdirSync(join(place.checkout, DECLARATION_DIRECTORY))
  writeFileSync(join(place.checkout, DECLARATION_DIRECTORY, DECLARATION_FILE), JSON.stringify(soloDeclaration('an owner')))
  mkdirSync(join(place.home, 'beats'), { mode: 0o700 })
  const ledger = { clock: { now: () => 0 }, stores: { rows: rowStreamsDirectory(place.rows) } }
  const recorded = await recordAStandingItem(ledger, { kind: 'held', id: 'a-package', item: 'a pull request', reason: 'a demo', until: 'the demo is over' }, member)
  assert.ok('told' in recorded, 'refused' in recorded ? recorded.refused : '')
  return crewToolsOver({
    member,
    ledger,
    beats: dashboardRowsIn(join(place.home, 'beats')),
    root: place.checkout,
    documents: { read: async (path) => readFileSync(path, 'utf8') },
    stores: { crew: crewFilesDirectory(join(place.home, 'crew-store')) },
  })
}

/** Drives the relay with every declared event, each in a session of its own; returns every recorded path. */
async function pathsTheLauncherRecords(t: TestContext): Promise<readonly string[]> {
  const place = placeOf(t)
  const rows = rowStreamsDirectory(place.rows)
  const crew = await aCrewThatHandsAStandingItem(place)
  const relay: MemberRelay = memberRelay({
    records: sessionRecordsIn(rows),
    launch: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithTheSwitchesOfTheAdapter(),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel(CARRIED),
    // No settings file in the test's home, so the watch finds nothing and every event reaches its row.
    hookSettings: hookSettingsWatch({
      user: join(place.home, '.claude', 'settings.json'),
      home: place.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(place.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({ launcher_env: { HOME: place.home }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home) }),
    crew,
    stopMember: () => {},
  })

  const sessions: string[] = []
  const session = async (name: string): Promise<string> => {
    const id = `${name}-${sessions.length}`
    sessions.push(id)
    await relay.answer('session_started', { session_id: id, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
    return id
  }

  for (const source of CLAUDE_CODE_EMITTED_SESSION_EVENTS) {
    const id = `start-${source}`
    sessions.push(id)
    await relay.answer('session_started', { session_id: id, source, hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  }
  for (const kind of CLAUDE_CODE_PROMPT_ORIGIN_KINDS) {
    for (const carries of [{}, { command: 'review' }, { isMeta: true }]) {
      const id = await session(`prompt-${kind}`)
      await relay.answer('prompt_submitted', { session_id: id, text: 'hello', origin: { kind }, ...carries })
    }
  }
  // A ring tool's own result is driven from the recorded host answer (martha#247), so the row that reads a
  // sender out of it is reached with one; a result the host never produces would stop the member instead.
  const calls = [
    ...MESH_TOOLS_THAT_RUN.map((own) => ({ call: { tool: MESH_SERVER_TOOL(own), ...RECORDED_RING_ANSWERS[own]?.tool_input }, answer: RECORDED_RING_ANSWERS[own]?.tool_call_answer })),
    { call: { tool: ANOTHER_SERVER_TOOL }, answer: undefined },
    ...BUILT_IN_CALLS.map((call) => ({ call, answer: undefined })),
  ]
  for (const { call, answer } of calls) {
    const id = await session(`tool-${String(call.tool)}`)
    await relay.answer('tool_answered', { session_id: id, call, answer })
  }

  const lasts = await Promise.all(sessions.map(async (id) => (await rows.read(sessionRecordStreamOf(id))).at(-1)))
  const recorded = lasts.flatMap((last) => (last === undefined ? [] : recordOf(last.row).ingested.map((ingest) => ingest.path)))
  return [...new Set(recorded)]
}

test('every row that claims the shell gate is reached by what the Claude Code launcher records', async (t) => {
  assert.deepEqual(shellGateRowsNothingRecords(await pathsTheLauncherRecords(t)), [])
})

test('the drive is not vacuous: without what the launch hands the model at start, A7 and A11 are named', async (t) => {
  const recorded = await pathsTheLauncherRecords(t)
  const handed = [PATH_OF_SOURCE.checkout_hook, PATH_OF_SOURCE.server_instructions]
  const named = shellGateRowsNothingRecords(recorded.filter((path) => !handed.includes(path))).map((gap) => gap.path)
  assert.ok(handed.every((row) => named.includes(row)), named.join(', '))
})

test('the drive is not vacuous: without the standing items the crew hands the model at start, A20 is named', async (t) => {
  const recorded = await pathsTheLauncherRecords(t)
  const named = shellGateRowsNothingRecords(recorded.filter((path) => path !== PATH_OF_SOURCE.standing_items)).map((gap) => gap.path)
  assert.ok(named.includes(PATH_OF_SOURCE.standing_items), named.join(', '))
})

/** What these launches started the host with: the arguments and environment the adapter's declaration names (martha#135). */
function startedWithTheSwitchesOfTheAdapter(): StartedWith {
  return startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env)
}
