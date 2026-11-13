// The Supervisor's standing items survive a refresh (martha#317, design test 5).
//
// One session records a hold and a ruling with the crew's own tool. A fresh launch of the same member — what a
// refresh, a restart or a clear leaves — starts a session through the launcher's own answer to its start, and is handed
// both, with the session's record holding the inbound path the line came on (A19), so the shell gate stands behind
// what it was handed. A member the table does not let assign work is handed none of them, and its record holds no A19.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import { STANDING_ADD, STANDING_HEADING } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { ownerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { recordOf, SESSION_RECORD_STREAM, sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { PATH_OF_SOURCE } from '../take_in_a_turn/take_in_a_turn.ts'
import { memberRelay } from './answer_the_relay.ts'
import { dashboardRowsIn } from './dashboard_rows_in_state.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'

const NOW = Date.UTC(2026, 10, 13, 9, 0, 0)

/** A team whose table lets the owner and the lead assign work, and a builder who may not. */
const A_TEAM = {
  version: DECLARATION_VERSION,
  owner: 'an owner',
  members: [
    { name: 'Supervisor', role: 'lead' },
    { name: 'Pallas', role: 'builder' },
  ],
  mode: { name: 'team', roles: ['lead', 'builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, 'lead']])) },
  channel_read_seconds: 30,
}

/** A crew's place: a checkout holding the declaration, its rows, its dashboard and its files. */
function aCrewPlace(t: TestContext): { readonly home: string; readonly checkout: string; readonly rows: string } {
  const home = mkdtempSync(join(tmpdir(), 'martha-317-refresh-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(join(checkout, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(join(checkout, DECLARATION_DIRECTORY, DECLARATION_FILE), JSON.stringify(A_TEAM))
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'streams')
  mkdirSync(rows, { mode: 0o700 })
  mkdirSync(join(home, 'beats'), { mode: 0o700 })
  return { home, checkout, rows }
}

/** The tools `member` holds in one launch over the place: a new call is a new launch, as after a refresh. */
function aLaunchOf(place: ReturnType<typeof aCrewPlace>, member: string): CrewTools {
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => NOW }, stores: { rows: rowStreamsDirectory(place.rows) } },
    beats: dashboardRowsIn(join(place.home, 'beats')),
    root: place.checkout,
    documents: { read: async (path) => readFileSync(path, 'utf8') },
    stores: { crew: crewFilesDirectory(join(place.home, 'crew-store')) },
  })
}

/** Starts session `id` through the launcher's own answer, with `crew` its tools; answers what it was handed and the paths its record holds. */
async function aSessionStarts(place: ReturnType<typeof aCrewPlace>, crew: CrewTools, id: string): Promise<{ readonly handed: string; readonly paths: readonly string[] }> {
  const rows = rowStreamsDirectory(place.rows)
  const relay = memberRelay({
    records: sessionRecordsIn(rows),
    launch: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: [],
    hookSettings: hookSettingsWatch({
      user: join(place.home, 'no-user-settings'),
      home: place.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(place.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({
      launcher_env: { HOME: place.home },
      member_env: { HOME: place.home },
      home: place.home,
      launch_dir: place.checkout,
      settings_files: [],
      user_scope: { markdown_kinds: RECORDED_HOST.markdown_kinds, output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER, reported_output_styles_dir: join(place.home, 'config', CLAUDE_CODE_OUTPUT_STYLES_FOLDER) },
    }),
    crew,
    stopMember: () => {},
  })
  const answered = await relay.answer('session_started', { session_id: id, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.ok(answered.answered, answered.answered ? '' : answered.stopping)
  const handed = answered.answered && 'handed' in answered.body ? String(answered.body.handed) : ''
  const last = (await rows.read(`${SESSION_RECORD_STREAM}${id}`)).at(-1)
  return { handed, paths: last === undefined ? [] : recordOf(last.row).ingested.map((ingest) => ingest.path) }
}

/** The Supervisor's first session records a hold and a ruling, through the tool a member calls. */
async function theFirstSessionRecords(place: ReturnType<typeof aCrewPlace>): Promise<void> {
  const first = aLaunchOf(place, 'Supervisor')
  const hold = await first.answer(STANDING_ADD, { kind: 'held', id: 'martha-353', item: 'PR 353', reason: 'lands after the demo', until: '2026-11-20' }, 'the-session-before')
  assert.ok('answer' in hold, 'refused' in hold ? hold.refused : '')
  const ruling = await first.answer(STANDING_ADD, { kind: 'decided', id: 'martha-319', rule: 'two packages', date: '2026-11-13', words: 'do them all' }, 'the-session-before')
  assert.ok('answer' in ruling, 'refused' in ruling ? ruling.refused : '')
}

test('across a refresh, the next Supervisor session is handed what the last one recorded, and takes it in on A19', async (t) => {
  const place = aCrewPlace(t)
  await theFirstSessionRecords(place)

  const started = await aSessionStarts(place, aLaunchOf(place, 'Supervisor'), 'the-session-after')
  assert.match(started.handed, new RegExp(`^${STANDING_HEADING} \\(2\\)`))
  assert.match(started.handed, /- HELD martha-353: PR 353\. Why: lands after the demo\. Until: 2026-11-20\./)
  assert.match(started.handed, /- DECIDED, recorded by Supervisor: 2026-11-13 "do them all" \(martha-319\): two packages\./)
  assert.ok(started.paths.includes(PATH_OF_SOURCE.standing_items), `the record holds ${started.paths.join(', ')}`)
})

test('a member whose role the table does not let assign work is handed none of them, and takes nothing in on A19 (mutant: hand to every role)', async (t) => {
  const place = aCrewPlace(t)
  await theFirstSessionRecords(place)

  const started = await aSessionStarts(place, aLaunchOf(place, 'Pallas'), 'a-builders-session')
  assert.ok(!started.handed.includes(STANDING_HEADING), started.handed)
  assert.ok(!started.handed.includes('martha-353'), started.handed)
  assert.ok(!started.paths.includes(PATH_OF_SOURCE.standing_items), `the record holds ${started.paths.join(', ')}`)
})

test('a Supervisor session with nothing standing is handed no standing items, and takes nothing in on A19', async (t) => {
  const place = aCrewPlace(t)
  const started = await aSessionStarts(place, aLaunchOf(place, 'Supervisor'), 'a-quiet-start')
  assert.equal(started.handed, '')
  assert.ok(!started.paths.includes(PATH_OF_SOURCE.standing_items), `the record holds ${started.paths.join(', ')}`)
})
