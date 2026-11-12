// A tool the mod posts is answered by the core's slice, unchanged (martha#254 test 11).
//
// The mod that runs inside a member's session registers the crew's tools and knows nothing about what they do: it
// posts the call on the launcher's socket and hands the answer back. So this test posts over that socket, as the mod
// does, and reads what came back: the slice's own words for a tool it registers, and a refusal naming any name it
// does not.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { RELAY_ORIGIN, TOOL_ANSWER_PATH, toolCallBody } from '../claude_code_relay/hooks/relay_protocol.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'
import { BEAT_INTERVAL_MS } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { sessionRecordsIn } from './session_records_in_rows.ts'
import { dashboardRowsIn } from './dashboard_rows_in_state.ts'
import { memberRelay } from './answer_the_relay.ts'
import { serveTheRelay } from './serve_the_relay.ts'
import { shortRelayRoot } from './short_relay_root.ts'
import { removeTheTree } from './relay_copy.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'

const MEMBER = 'Pallas'
const SESSION = 'session-254'

/** A crew place a test owns: a checkout with a declaration, the crew's streams and its dashboard rows. */
function aCrewPlace(t: TestContext): { readonly home: string; readonly checkout: string; readonly rows: string; readonly dashboard: string } {
  const home = mkdtempSync(join(tmpdir(), 'martha-254-tools-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(join(checkout, '.crew'), { recursive: true })
  writeFileSync(join(checkout, '.crew', 'crew.json'), JSON.stringify({
    version: 1,
    owner: 'the-owner',
    members: [{ name: MEMBER, role: 'builder' }],
    mode: { name: 'solo', roles: ['builder'], may: { assign_work: ['owner'], approve_landing: ['owner'], resume_parked_work: ['owner'] } },
    channel_read_seconds: 30,
  }))
  const rows = join(home, 'crews', 'a-key', 'rows')
  const dashboard = join(home, 'crews', 'a-key', 'row')
  mkdirSync(rows, { recursive: true, mode: 0o700 })
  mkdirSync(dashboard, { recursive: true, mode: 0o700 })
  return { home, checkout, rows, dashboard }
}

/** The crew's tools over a test's place, at a clock the test reads. */
function toolsIn(place: { readonly home: string; readonly checkout: string; readonly rows: string; readonly dashboard: string }, now: () => number): CrewTools {
  return crewToolsOver({
    member: MEMBER,
    ledger: { clock: { now }, stores: { rows: rowStreamsDirectory(place.rows) } },
    beats: dashboardRowsIn(place.dashboard),
    root: place.checkout,
    documents: { read: async (path) => readFileSync(path, 'utf8') },
    stores: { crew: crewFilesDirectory(join(place.rows, 'crew')) },
  })
}

test('a tool call posted by the mod is answered by the core\'s slice, and the row moves (test 11)', async (t) => {
  const place = aCrewPlace(t)
  const crew = toolsIn(place, () => 1_000)
  const socket_path = join(shortRelayRoot(t), 'relay.sock')
  const server = await serveTheRelay(
    memberRelay({
      records: sessionRecordsIn(rowStreamsDirectory(place.rows)),
      launch: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [] },
      policy: { may_send_executable_text: [] },
      names: { ownNameOf: ownNameOfCalledTool },
      started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
      binder: bindNothing,
      handed_at_start: sourcesALaunchHandsTheModel({}),
      hookSettings: hookSettingsWatch({
        user: join(place.home, '.claude', 'settings.json'),
        home: place.home,
        approved: undefined,
        managed: { ...RECORDED_MANAGED, dir: join(place.home, 'managed') },
        switches: CLAUDE_CODE_HOOK_SWITCHES,
        markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
      }),
      ownerMemory: ownerMemoryPlaces({ launcher_env: { HOME: place.home }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home) }),
      crew,
      stopMember: () => {},
    }),
    socket_path,
  )
  t.after(() => server.close())

  const mine = await crew.answer('report_progress', { task: 'Build the crew store', step: 2, of: 6, package: 'macula-io/martha#254' }, SESSION)
  assert.ok('answer' in mine, 'the slice answers the report')

  const posted = await post(socket_path, TOOL_ANSWER_PATH, toolCallBody(SESSION, 'report_progress', { task: 'Build the crew store', step: 2, of: 6, package: 'macula-io/martha#254' }))
  assert.equal(posted.status, 200, posted.text)
  assert.deepEqual(JSON.parse(posted.text), mine, 'what the mod posts is answered with the slice\'s own words, unchanged')

  const row = dashboardRowsIn(place.dashboard).read(MEMBER)
  assert.equal(row?.task, 'Build the crew store', 'the row the answer reports is on disk')
  assert.equal(row?.session, SESSION, 'and it names the session the call came from')
})

test('the heartbeat of a member that has reported nothing says idle, never working (test 7, r=1 R2)', (t) => {
  const place = aCrewPlace(t)
  const crew = toolsIn(place, () => 1_000)
  t.mock.timers.enable({ apis: ['setInterval'] })
  const stop = crew.startBeating()
  t.after(() => stop())

  assert.equal(dashboardRowsIn(place.dashboard).read(MEMBER), null, 'nothing is written before the first beat')

  t.mock.timers.tick(BEAT_INTERVAL_MS)
  const beat = dashboardRowsIn(place.dashboard).read(MEMBER)
  assert.equal(beat?.state, 'idle', 'a member that has reported nothing reads idle, so a live member can read idle')
  assert.equal(beat?.task, '', 'and it claims no task')
  assert.equal(beat?.session, '', 'and names no session it has not been told')

  const seen = seeTheCrew({ members: [{ name: MEMBER }] }, dashboardRowsIn(place.dashboard).all(), 1_000)
  assert.equal(seen.rows[0]?.state, 'idle', 'so the crew reads the member as idle')
  assert.equal(seen.counts.online, 1, 'and the member is on the crew: its row is fresh')
})

test('a name the crew registers nothing for is refused, naming it (test 11)', async (t) => {
  const place = aCrewPlace(t)
  const crew = toolsIn(place, () => 1_000)
  const socket_path = join(shortRelayRoot(t), 'relay-unknown.sock')
  const server = await serveTheRelay(
    memberRelay({
      records: sessionRecordsIn(rowStreamsDirectory(place.rows)),
      launch: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [] },
      policy: { may_send_executable_text: [] },
      names: { ownNameOf: ownNameOfCalledTool },
      started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
      binder: bindNothing,
      handed_at_start: sourcesALaunchHandsTheModel({}),
      hookSettings: hookSettingsWatch({
        user: join(place.home, '.claude', 'settings.json'),
        home: place.home,
        approved: undefined,
        managed: { ...RECORDED_MANAGED, dir: join(place.home, 'managed') },
        switches: CLAUDE_CODE_HOOK_SWITCHES,
        markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
      }),
      ownerMemory: ownerMemoryPlaces({ launcher_env: { HOME: place.home }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home) }),
      crew,
      stopMember: () => {},
    }),
    socket_path,
  )
  t.after(() => server.close())

  const posted = await post(socket_path, TOOL_ANSWER_PATH, toolCallBody(SESSION, 'run_anything', {}))
  assert.equal(posted.status, 200, posted.text)
  const refused = JSON.parse(posted.text) as { refused?: string }
  assert.match(refused.refused ?? '', /"run_anything" is not a tool this crew registers/, 'the refusal names the tool it does not know')
})

/** Posts a body to a path on a launch's socket, as the mod does. */
function post(socket_path: string, path: string, body: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(`${RELAY_ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, socketPath: socket_path }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    sent.on('error', reject)
    sent.end(JSON.stringify(body))
  })
}

/** The managed settings a test's watch is given, which name nothing: the test is not about them. */
const RECORDED_MANAGED = { ...RECORDED_HOST.managed_settings, dir: '' }

/** The user-scope places the recording names, under the test's home (martha#154), as the other relay tests do. */
function userScopeFor(home: string): OwnerUserScope {
  return {
    markdown_kinds: RECORDED_HOST.markdown_kinds,
    output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
    reported_output_styles_dir: join(home, '.claude', CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
  }
}
