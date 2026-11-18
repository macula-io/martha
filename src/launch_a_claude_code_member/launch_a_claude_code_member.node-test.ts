// The launcher answers the relay through the core, fails closed on every event,
// and starts and stops a member whole (#41, on #16's launch gate).
//
// Real directories, a real git checkout, a real Unix socket and real process
// groups: a fake `claude` stands in for the host, and the relay's own hooks
// stand in for the engine's calls. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'
import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { RELAY_COPY_NAME, removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_BASH_RESULT_SHAPES } from '../claude_code_host/claude_code_bash_results.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SHELL_TOOL, CLAUDE_CODE_TOOL_RESULT_ROWS, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { register, type RelayCatch, type RelayEngine, type RelayHook } from '../claude_code_relay/hooks/register.ts'
import { heardRan, RELAY_ORIGIN, RELAY_PATHS, RELAY_SOCKET_VARIABLE, RUN_PATH, type Ran, type Refused, type RelayEvent } from '../claude_code_relay/hooks/relay_protocol.ts'
import { ROW_NOT_DURABLE, type HandoverStamp, type HandoverStampStore, type Row, type RowStore, type TurnSource } from '../host_contract/host_contract.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities, PROC_ROOT } from '../linux_process_identity/process_identity_from_proc.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { fakeNpmRegistry, type FakeRegistry } from '../run_the_nodes_own_npm_alone/fake_npm_registry.ts'
import { recordMeshTree } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import type { MeshTreeRecording } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { CLAUDE_MEMORY_ELSEWHERE, CLAUDE_MEMORY_OFF, fingerprintOf, HOSTS, readLaunchState, startedWithOf, type StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE, streamDirectoryNameOf } from '../row_streams_directory/row_streams_directory.ts'
import { CREW_ROWS_PLACE, CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { STATE_HOME_VARIABLE } from '../refuse_launch_of_unapproved_config/the_crews_state_a_member_is_kept_out_of.ts'
import { crewToolsOver, type CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { ledgerStreamOf } from '../log_ledger/log_ledger.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { POLL_MS, until } from '../drive_the_recorded_host/wait_until_the_event.ts'
import { OWNER_AT_THE_TERMINAL } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { PATH_OF_SOURCE, RECORD_LOST } from '../take_in_a_turn/take_in_a_turn.ts'
import { unplacedToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { handedAtThisStart, memberRelay, NO_SIGNED_RUNS, type MemberRelay, type MemberRelayPlace, type RelayReply } from '../answer_the_relay/answer_the_relay.ts'
import { receiptsInMemory } from '../run_an_owner_signed_command/receipts.ts'
import { signedRunsOf, type SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { resultBuiltFrom, RUN_COMMAND_PREFIX, sha256Of } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import { HOST_TRUST_RECORD_FILE, notACommandThisLauncherCanRun } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { hostAnswers, reportsOutputStyles, refusesTheRelay, type HostAnswers } from '../drive_the_recorded_host/host_stand_in.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FIELD, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, CLAUDE_CODE_SIGN_IN_STORE_VARIABLE, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { CONFIG_DIR_VARIABLE, PLUGIN_DIRS_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { MEMBER_CONFIG_FOLDER, MEMBERS_OWN_SETTINGS, theMembersConfigEnvironment } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { hookSettingsWatch, realPathOf } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { launchClaudeCodeMember } from './launch_a_claude_code_member.ts'
import { NOT_STARTED } from '../end_a_launch/end_a_launch.ts'
import { keepTheLifelineIn, RUN_LIFELINE_FD } from '../end_a_launch_when_its_run_ends/keep_the_lifeline_in.ts'
import { RUN_LIFELINE_VARIABLE, THE_RUN_IS_GONE } from '../end_a_launch_when_its_run_ends/the_run_lifeline.ts'
import { RELAY_PLUGIN_DIR } from '../ask_the_host_what_it_loads/what_the_host_loads.ts'
import { LAUNCHER_RECORD_NAME, type LaunchRecord } from '../sweep_leftover_launch_directories/leftover_relay_directories.ts'
import { MEMBER_PID_FD } from '../start_the_member_on_the_owners_terminal/member_on_the_owners_terminal.ts'
import * as relayCopy from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { makeRelayDirectory, RELAY_DIRECTORY_MODE, RELAY_SOCKET_NAME } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { GAVE_UP_BEFORE_ALLOW, readTheNewestRelayJournal, relayJournalKeptIn, type RelayJournal } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { HOST_EXIT_COMMAND, HOST_TERMINAL } from '../drive_the_recorded_host/drive_the_recorded_host.ts'
import { serveTheRelay } from '../serve_the_relay_to_a_launch/serve_the_relay.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { LOST, recordOf, sessionRecordsIn, sessionRecordStreamOf } from '../session_records_in_rows/session_records_in_rows.ts'
import { releaseMarkFor, releasesIn, RELEASE_STREAM, releaseStreamOf } from '../apply_the_owners_release/apply_the_owners_release.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { RELAY_DEADLINE_MS } from '../claude_code_relay/hooks/relay_protocol.ts'
import { memoryDenyRules, ownerMemoryPlaces, writesTheOwnersMemory, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { CONTACT_POLICY_FILE_UNDER_HOME, MESH_HELLO, RECORDED_MESH_ANSWER_SHAPES, type WhatTheLaunchSupplies } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { RECORDED_RING_ANSWERS } from '../read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { RINGS_AND_RETURNS_THE_ANSWER } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { EDIT_TOOL, NOTEBOOK_EDIT_TOOL, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'
import { THE_REFRESH_THE_MOD_RUNS } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { DEPENDENCIES } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { CLAUDE, CLAUDE_CODE, CLAUDE_FOLDER, MCP_CONFIG_SWITCH } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { GIT_SETTINGS_VARIABLE } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { THE_HOOKS_DIRECTORY_NAME } from '../guard_the_git_a_member_runs/the_guard_of_a_launch.ts'

// --- the run this file is (martha#559) --------------------------------------------

/**
 * The run these tests are: a pipe this process holds open for as long as it exists, however it ends. Every launcher a
 * test starts reads the other end by path (prove_the_core/a_launcher_ends_with_its_run.ts), so a run killed by a shell
 * timeout or by --test-force-exit leaves no launcher, no shell, no terminal and no home behind — which is what let
 * enough of them pile up on one machine that this file stopped reporting there at all.
 */
const RUN_THIS_FILE_IS = keepTheLifelineIn(mkdtempSync(join(tmpdir(), 'martha-cc-run-')))

/** The pipe's path: the end of the run this file is, as a launcher reads it. */
const THE_RUNS_END = RUN_THIS_FILE_IS.path

// Taken down with the process: nothing else is this run's end, so it closes however the run goes.
process.once('exit', () => {
  RUN_THIS_FILE_IS.close()
  removeTheTree(dirname(THE_RUNS_END))
})

/** The user-scope places the recording names, under a home the tests run in (martha#154). */
const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

// --- a member's places ----------------------------------------------------------

/** The managed settings place of a test: the recorded file and drop-in names, in a folder of the place's own. */
const managedSettingsOf = (place: { readonly home: string }) => ({ ...RECORDED_HOST.managed_settings, dir: join(place.home, 'managed') })

interface Place {
  /** The stop directory, standing in for the owner's home. */
  readonly home: string
  /** A git checkout under it, with an approved tool-server config committed. */
  readonly checkout: string
  readonly rows: string
  readonly dashboard: string
  readonly launch_records: string
  readonly relay_root: string
  readonly snapshot_root: string
  /** Where the launcher installs the recorded mesh server trees (martha#65). */
  readonly mesh_servers: string
  /** Where the launcher keeps what it is doing, one file per launch (martha#240). */
  readonly relay_journal: string
  /** Martha's own state root, which a member's file tools may not write (martha#619). */
  readonly state_root: string
  readonly approved: readonly string[]
  /**
   * Told by the helper that starts a member here. The place's own hook then leaves the removal to that member's hook,
   * which is the one that waits for the member to stop (martha#216).
   */
  aMemberStartsHere(): void
  /**
   * Told when the hook that removes the home is registered. A place marked without one would leave its home behind
   * whenever the test body stopped early, so the place's own hook takes the home down itself and fails the test by name
   * (martha#216 r=3).
   */
  aRemovalIsRegistered(): void
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  ).trim()
}

// A tool server pinned to one release: the only shape the launcher starts (martha#49).
// The fake host never starts it.
const SERVERS = JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } })

function placeFor(t: TestContext, servers = SERVERS, files: Readonly<Record<string, string>> = {}): Place {
  const home = mkdtempSync(join(tmpdir(), 'martha-cc-launch-'))
  const relay_root = shortRelayRoot(t)
  // A place no member ran in is removed here. One that a member ran in is removed by that member's own hook, which
  // waits for it to stop first: the home holds the running host's files, and removing it while the host was still
  // writing made a full run go red on teardown alone (martha#216).
  let aMemberStarts = false
  let aRemovalIsRegistered = false
  t.after(async () => {
    if (aMemberStarts && aRemovalIsRegistered) return
    // The removal is the test's own when a member starts here in a process of its own: its hook kills that process,
    // waits for it, and only then removes the home (martha#216 r=2). A place marked with no such hook takes its home
    // down here instead — whatever is still running is killed first — and fails the test by name, since the home would
    // otherwise be left behind by a test body that stopped early (martha#216 r=3). A launcher carries no relay root, so
    // it is found by the place's own name in its command line, which is where its script lives.
    if (aMemberStarts) await killWhateverNamesTheHome(home)
    await theHomeGoes({ home, relay_root })
    if (aMemberStarts) {
      throw new Error(`the place's home went with no removal registered for the member that starts here in a process of its own: a test that marks a place removes it after the process it spawned is gone (martha#216 r=3)`)
    }
  })
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  git(checkout, 'init', '-q', '.')
  writeFileSync(join(checkout, 'README.md'), 'a checkout\n')
  writeFileSync(join(checkout, '.mcp.json'), servers)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')

  const closed = (name: string): string => {
    const dir = join(home, name)
    mkdirSync(dir, { mode: 0o700 })
    return dir
  }
  const approved = [fingerprintOf(readLaunchState({ host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home }, thisMachine))]
  return {
    home,
    checkout,
    rows: closed('row-streams'),
    dashboard: closed('dashboard-rows'),
    launch_records: closed('launches'),
    relay_root,
    snapshot_root: closed('snapshots'),
    mesh_servers: closed('mesh-servers'),
    relay_journal: closed('the-relay-journal'),
    state_root: closed('martha-state'),
    approved,
    aMemberStartsHere: () => {
      aMemberStarts = true
    },
    aRemovalIsRegistered: () => {
      aRemovalIsRegistered = true
    },
  }
}

const launchOf = (place: Place) => ({
  host: CLAUDE_CODE,
  launch_dir: place.checkout,
  stop_dir: place.home,
  approved_fingerprints: place.approved,
})

/** What a launch hands back: a member at work, or the reason none started. */
type ALaunch = Awaited<ReturnType<typeof launchClaudeCodeMember>>

/**
 * A member started in a place, with everything the end of the test owes it: the member is stopped, its exit is waited
 * for, and only then is the place's home removed. The home holds the running host's own files, so removing it while
 * the host was still writing made a full run go red on teardown alone (martha#216).
 */
async function aMemberStartedIn(t: TestContext, place: Place, launch: Parameters<typeof launchClaudeCodeMember>[0]): Promise<ALaunch> {
  const started = await launchClaudeCodeMember(launch)
  // Said after the launch, so a launch that throws leaves the place's own hook to remove it.
  place.aMemberStartsHere()
  place.aRemovalIsRegistered()
  let hasStopped = false
  if (started.started) void started.stopped.then(() => {
    hasStopped = true
  })
  // One hook, in this order: the member is stopped, its exit is waited for, and only then does the place go. Registered
  // first, so it runs before every other hook the test registers, as the place's own removal always did.
  t.after(async () => {
    if (started.started && !hasStopped) started.stop('the test is over')
    if (started.started) await started.stopped
    removeTheTree(place.home)
  })
  return started
}

interface Answering {
  readonly relay: MemberRelay
  readonly stops: string[]
  readonly rows: RowStore
}

function answering(
  place: Place,
  rows: RowStore = rowStreamsDirectory(place.rows),
  handed_at_start: readonly TurnSource[] = [],
  signed_runs?: SignedRuns,
  journal?: RelayJournal,
  gate?: GateMode,
  crew?: CrewTools,
  wordless_answers?: Omit<WhatTheLaunchSupplies, 'input'>,
  crew_text?: string,
): Answering {
  const stops: string[] = []
  const relay = memberRelay({
    records: sessionRecordsIn(rows, releasesIn(rows)),
    launch: launchOf(place),
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithTheSwitchesOfTheAdapter(),
    binder: bindNothing,
    handed_at_start,
    hookSettings: hookSettingsWatch({
      user: join(place.home, USER_SETTINGS),
      home: place.home,
      approved: undefined,
      managed: managedSettingsOf(place),
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({ launcher_env: { HOME: place.home }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home) }),
    ...(signed_runs === undefined ? {} : { signed_runs }),
    ...(journal === undefined ? {} : { journal }),
    ...(gate === undefined ? {} : { gate }),
    ...(crew === undefined ? {} : { crew }),
    ...(wordless_answers === undefined ? {} : { wordless_answers }),
    ...(crew_text === undefined ? {} : { crew_text }),
    stopMember: (why) => void stops.push(why),
  })
  return { relay, stops, rows }
}

const SESSION = 'session-1'

const start = (source: string, session_id = SESSION, more: Record<string, unknown> = {}) => ({
  session_id,
  source,
  hook_event_name: 'SessionStart',
  transcript_path: '/nowhere',
  ...more,
})
const prompt = (kind: string, text = 'hello', session_id = SESSION, more: Record<string, unknown> = {}) => ({ session_id, text, origin: { kind }, ...more })

/** How the record names the owner's own typed turn (#51). */
const OWNER_TYPED = `${PATH_OF_SOURCE.owner_typed}:${OWNER_AT_THE_TERMINAL}`
const call = (tool: string, more: Record<string, unknown> = {}, session_id = SESSION) => ({ session_id, call: { tool, ...more } })

const TAKEN_REPLY: RelayReply = { answered: true, body: { taken: 1 } }

// The crew text a launch composes once and hands at every start (martha#306): the smallest thing that reads as one.
const CREW_TEXT = '## You are builder, the crew\'s builder\n\nThis crew works solo, and its owner is Ada Owner.'

test('#306: the crew text is handed at a session\'s start, and again at the start of a session after a clear', async (t) => {
  const place = placeFor(t)
  const { relay } = answering(place, rowStreamsDirectory(place.rows), [], undefined, undefined, undefined, undefined, undefined, CREW_TEXT)
  assert.deepEqual(await relay.answer('session_started', start('startup')), { answered: true, body: { taken: 1, handed: CREW_TEXT } })
  // A clear starts a session of its own, and that start is handed the crew text again: crew-code told a member to
  // read its card only at a fresh start, and a resumed member then worked with no crew text at all.
  assert.deepEqual(await relay.answer('session_started', start('clear', 'after-the-clear')), { answered: true, body: { taken: 1, handed: CREW_TEXT } })
})

test('#306: with an acts line to hand too, the crew text goes first and the line follows it', () => {
  assert.equal(handedAtThisStart(CREW_TEXT, 'HANDOFF macula-io/martha#306 a..b r=1'), `${CREW_TEXT}\n\nHANDOFF macula-io/martha#306 a..b r=1`)
  assert.equal(handedAtThisStart(CREW_TEXT, null), CREW_TEXT)
  assert.equal(handedAtThisStart(undefined, null), '', 'a launch handing neither hands nothing, so the start is simply taken')
})

/** The package a member's predecessor held, as its own row names it (martha#254 test 10). */
const PACKAGE = 'macula-io/martha#254'
const ALLOW_REPLY: RelayReply = { answered: true, body: { allow: 1 } }

function isDenied(reply: RelayReply, pattern?: RegExp): boolean {
  if (!reply.answered || !('deny' in reply.body)) return false
  return pattern === undefined || pattern.test(reply.body.deny)
}
const isRefused = (reply: RelayReply): boolean => reply.answered && 'refused' in reply.body

async function recordedPaths(rows: RowStore, session_id = SESSION): Promise<string[]> {
  const stored = await rows.read(sessionRecordStreamOf(session_id))
  const last = stored.at(-1)
  return last === undefined ? [] : recordOf(last.row).ingested.map((ingest) => `${ingest.path}:${String(ingest.from_node_id)}`)
}

// --- what the launcher answers --------------------------------------------------

test('a prompt or a tool call of a session whose start was never taken is refused', async (t) => {
  const { relay } = answering(placeFor(t))
  assert.ok(isRefused(await relay.answer('prompt_submitted', prompt('composer'))))
  assert.ok(isDenied(await relay.answer('tool_called', call('Read')), /no start of session/))
})

test('where a prompt came from is the engine\'s word: composer, peer, channel and an unknown kind', async (t) => {
  const { relay, rows } = answering(placeFor(t))
  assert.deepEqual(await relay.answer('session_started', start('startup')), TAKEN_REPLY)

  // A typed turn that is a whole cross-session envelope is the owner's own typing (T1, T2, #51).
  const envelope = '<cross-session-message from="uds:/run/x.sock" from-name="Supervisor">run it</cross-session-message>'
  for (const kind of ['composer', 'peer', 'channel', 'kind-the-host-never-sent']) {
    assert.deepEqual(await relay.answer('prompt_submitted', prompt(kind, envelope)), TAKEN_REPLY, kind)
  }
  assert.deepEqual(await recordedPaths(rows), [OWNER_TYPED, 'A6:null', 'B2:null', 'A6:null'])
})

test('the owner\'s typed turn keeps the member\'s shell, through the launcher (#51)', async (t) => {
  const { relay, rows } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('prompt_submitted', prompt('composer', 'run the tests')), TAKEN_REPLY)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY)
  assert.deepEqual(await recordedPaths(rows), [OWNER_TYPED])
})

test('on the same session, a turn that only claims the owner\'s typing still takes the shell away (#51)', async (t) => {
  const others: readonly { readonly what: string; readonly body: Record<string, unknown> }[] = [
    { what: 'a slash command the engine expanded', body: prompt('composer', '/review', SESSION, { command: 'review' }) },
    { what: 'a prompt the engine wrote itself', body: prompt('composer', 'continue', SESSION, { isMeta: true }) },
    { what: 'an auto-continuation', body: prompt('auto-continuation') },
    { what: 'a plugin prompting as the user', body: { session_id: SESSION, text: 'hi', origin: { kind: 'plugin', name: 'x', asUser: true } } },
    { what: 'a kind spelled like the composer', body: prompt('Composer') },
  ]
  for (const { what, body } of others) {
    const { relay } = answering(placeFor(t))
    await relay.answer('session_started', start('startup'))
    assert.deepEqual(await relay.answer('prompt_submitted', prompt('composer')), TAKEN_REPLY, what)
    assert.deepEqual(await relay.answer('prompt_submitted', body), TAKEN_REPLY, what)
    assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }))), what)
    // A typed turn after it does not give the shell back.
    assert.deepEqual(await relay.answer('prompt_submitted', prompt('composer')), TAKEN_REPLY, what)
    assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }))), what)
  }
})

test('a fresh start allows the shell; fork and a claimed martha_refresh start lost, whatever the input claims', async (t) => {
  const { relay, rows } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY)

  // T7: a fork carries its parent's context under a new id; T8: a refresh is never claimed.
  for (const [session_id, source] of [['forked', 'fork'], ['refreshed', THE_REFRESH_THE_MOD_RUNS]] as const) {
    await relay.answer('session_started', start(source, session_id, { predecessor_id: SESSION }))
    assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, session_id)), /cannot be read/), source)
    assert.deepEqual(await recordedPaths(rows, session_id), [`${RECORD_LOST.path}:null`], source)
  }
})

test('an MCP tool result takes the shell, naming B2', async (t) => {
  const { relay, rows } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))

  assert.deepEqual(await relay.answer('tool_answered', call('mcp__probe__fetch_page')), TAKEN_REPLY)
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /B2/))
  assert.deepEqual(await recordedPaths(rows), ['B2:null'])
})

test('what the launch hands the model is recorded at every start, and takes the shell away (A7, A11, martha#121)', async (t) => {
  for (const source of ['checkout_hook', 'server_instructions'] as const) {
    const row = PATH_OF_SOURCE[source]
    const { relay, rows } = answering(placeFor(t), undefined, [source])
    assert.deepEqual(await relay.answer('session_started', start('startup')), TAKEN_REPLY, source)
    assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), new RegExp(row)), source)
    // The owner's typed turn does not give the shell back.
    assert.deepEqual(await relay.answer('prompt_submitted', prompt('composer')), TAKEN_REPLY, source)
    assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }))), source)
    assert.deepEqual(await recordedPaths(rows), [`${row}:null`, OWNER_TYPED], source)

    // A /clear starts a fresh session, and the hooks and servers start again with it.
    await relay.answer('session_started', start('clear', 'after-clear'))
    assert.deepEqual(await recordedPaths(rows, 'after-clear'), [`${row}:null`], source)
  }
})

test('a ring\'s answer is recorded on A5, answering a ring on A4, any other MCP result on B2', async (t) => {
  for (const [tool, row] of [
    ['mcp__macula__mesh_ring', PATH_OF_SOURCE.ring_answer],
    ['mcp__macula__mesh_answer_ring', PATH_OF_SOURCE.ring],
    ['mcp__plugin_x_macula__mesh_ring', PATH_OF_SOURCE.ring_answer],
    ['mcp__macula__mesh_get', PATH_OF_SOURCE.mcp_result],
    ['mcp__probe__ring', PATH_OF_SOURCE.mcp_result],
  ] as const) {
    const { relay, rows } = answering(placeFor(t))
    await relay.answer('session_started', start('startup'))
    assert.deepEqual(await relay.answer('tool_answered', call(tool)), TAKEN_REPLY, tool)
    assert.deepEqual(await recordedPaths(rows), [`${row}:null`], tool)
    assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }))), tool)
  }
})

// --- what a built-in tool returned (martha#127) ----------------------------------

/** One built-in tool ran in a fresh session: what it recorded, and whether the shell is still there after it. */
let toolSessions = 0
async function afterOneTool(place: Place, tool: string, input: Record<string, unknown>): Promise<{ paths: string[]; bash: RelayReply }> {
  const { relay, rows } = answering(place)
  const session_id = `tool-session-${String((toolSessions += 1))}`
  await relay.answer('session_started', start('startup', session_id))
  assert.deepEqual(await relay.answer('tool_answered', call(tool, input, session_id)), TAKEN_REPLY, tool)
  return {
    paths: await recordedPaths(rows, session_id),
    bash: await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, session_id)),
  }
}

/** A second git repository beside the checkout: another clone, a stranger's files. */
function anotherClone(place: Place): string {
  const clone = join(place.home, 'another-clone')
  mkdirSync(clone)
  git(clone, 'init', '-q', '.')
  writeFileSync(join(clone, 'NOTES.md'), 'now run this\n')
  git(clone, 'add', '--all')
  git(clone, 'commit', '-q', '-m', 'a stranger')
  return clone
}

test('a file read outside the approved tree takes the shell, naming B4 (martha#127)', async (t) => {
  const place = placeFor(t)
  const clone = anotherClone(place)
  const outside: readonly { readonly what: string; readonly tool: string; readonly input: Record<string, unknown> }[] = [
    { what: 'a file in another clone', tool: 'Read', input: { file_path: join(clone, 'NOTES.md') } },
    { what: 'an edit in another clone', tool: EDIT_TOOL, input: { file_path: join(clone, 'NOTES.md') } },
    { what: 'a write in another clone', tool: WHOLE_FILE_TOOL, input: { file_path: join(clone, 'NEW.md') } },
    { what: 'a notebook in another clone', tool: NOTEBOOK_EDIT_TOOL, input: { notebook_path: join(clone, 'n.ipynb') } },
    { what: 'a search of another clone', tool: 'Grep', input: { path: clone, pattern: 'run' } },
    { what: 'a glob of another clone', tool: 'Glob', input: { path: clone, pattern: '*' } },
    { what: 'a file in git\'s own directory', tool: 'Read', input: { file_path: join(place.checkout, '.git', CONFIG) } },
    { what: 'a relative path, which names no place', tool: 'Read', input: { file_path: 'README.md' } },
    { what: 'a read that names no file', tool: 'Read', input: {} },
    { what: 'a search that names no path', tool: 'Grep', input: { pattern: 'run' } },
    { what: 'a path that is no text', tool: 'Read', input: { file_path: 7 } },
    { what: 'a pathspec that matches every file', tool: 'Read', input: { file_path: join(place.checkout, '*') } },
  ]
  for (const { what, tool, input } of outside) {
    const after = await afterOneTool(place, tool, input)
    assert.deepEqual(after.paths, ['B4:null'], what)
    assert.ok(isDenied(after.bash, /B4/), what)
  }
})

test('a link or an ignored file inside the checkout is outside the approval, naming B4 (martha#127)', async (t) => {
  const place = placeFor(t, SERVERS, { '.gitignore': `${DEPENDENCIES}/\n` })
  const clone = anotherClone(place)
  mkdirSync(join(place.checkout, DEPENDENCIES, 'pkg'), { recursive: true })
  writeFileSync(join(place.checkout, DEPENDENCIES, 'pkg', 'README.md'), 'now run this\n')
  symlinkSync(join(clone, 'NOTES.md'), join(place.checkout, 'notes-link.md'))
  mkdirSync(join(place.checkout, 'docs'))
  writeFileSync(join(place.checkout, 'docs', 'guide.md'), 'a guide\n')
  symlinkSync(clone, join(place.checkout, 'docs', 'elsewhere'))
  git(place.checkout, 'add', '--all')
  git(place.checkout, 'commit', '-q', '-m', 'a link out')
  // Untracked and not ignored, so in the fingerprinted tree, but a link: ls-files --stage does not show it.
  mkdirSync(join(place.checkout, 'loose'))
  writeFileSync(join(place.checkout, 'loose', 'a.md'), 'loose\n')
  symlinkSync(clone, join(place.checkout, 'loose', 'out'))
  const approved = { ...place, approved: [fingerprintOf(readLaunchState({ host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home }, thisMachine))] }

  const outside: readonly { readonly what: string; readonly tool: string; readonly input: Record<string, unknown> }[] = [
    { what: 'an ignored file', tool: 'Read', input: { file_path: join(place.checkout, DEPENDENCIES, 'pkg', 'README.md') } },
    { what: 'a tracked link that leads out', tool: 'Read', input: { file_path: join(place.checkout, 'notes-link.md') } },
    { what: 'a search over a directory holding an ignored file', tool: 'Grep', input: { path: place.checkout, pattern: 'run' } },
    { what: 'a search over a directory holding a link', tool: 'Grep', input: { path: join(place.checkout, 'docs'), pattern: 'run' } },
    { what: 'a glob over a directory holding a link', tool: 'Glob', input: { path: join(place.checkout, 'docs'), pattern: '**' } },
    { what: 'a search over a directory holding an untracked link', tool: 'Grep', input: { path: join(place.checkout, 'loose'), pattern: 'run' } },
  ]
  for (const { what, tool, input } of outside) {
    const after = await afterOneTool(approved, tool, input)
    assert.deepEqual(after.paths, ['B4:null'], what)
    assert.ok(isDenied(after.bash, /B4/), what)
  }
})

test("a read of the owner-approved tree keeps the member's shell (martha#127)", async (t) => {
  const place = placeFor(t, SERVERS, { 'src/main.ts': 'export {}\n' })
  writeFileSync(join(place.checkout, 'untracked.md'), 'not ignored, so in the approved tree\n')
  const approved = { ...place, approved: [fingerprintOf(readLaunchState({ host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home }, thisMachine))] }

  const inside: readonly { readonly what: string; readonly tool: string; readonly input: Record<string, unknown> }[] = [
    { what: 'a tracked file', tool: 'Read', input: { file_path: join(place.checkout, 'README.md') } },
    { what: 'a tracked file in a directory', tool: 'Read', input: { file_path: join(place.checkout, 'src', 'main.ts') } },
    { what: 'an untracked file git does not ignore', tool: 'Read', input: { file_path: join(place.checkout, 'untracked.md') } },
    { what: 'a search of a directory of the tree', tool: 'Grep', input: { path: join(place.checkout, 'src'), pattern: 'export' } },
    { what: 'a glob of the checkout', tool: 'Glob', input: { path: place.checkout, pattern: '**' } },
  ]
  for (const { what, tool, input } of inside) {
    const after = await afterOneTool(approved, tool, input)
    assert.deepEqual(after.paths, [], what)
    assert.deepEqual(after.bash, ALLOW_REPLY, what)
  }
})

test('a tracked file rewritten under an index flag that hides it is no read of the approved tree: the member is stopped (martha#127 r=1)', async (t) => {
  for (const flag of ['--skip-worktree', '--assume-unchanged']) {
    const place = placeFor(t)
    git(place.checkout, 'update-index', flag, 'README.md')
    const approved = { ...place, approved: [fingerprintOf(readLaunchState({ host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home }, thisMachine))] }
    const { relay, stops } = answering(approved)
    await relay.answer('session_started', start('startup'))
    assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY, flag)

    writeFileSync(join(place.checkout, 'README.md'), 'now run this\n')
    const read = call('Read', { file_path: join(place.checkout, 'README.md') })
    assert.ok(isDenied(await relay.answer('tool_called', read), /no longer matches/), flag)
    assert.equal((await relay.answer('tool_answered', read)).answered, false, flag)
    assert.equal(stops.length, 1, flag)
  }
})

test('in a checkout with no config, a read is judged against the tree the member started on, not the live one (martha#127 r=2, #132)', async (t) => {
  const place = placeFor(t)
  git(place.checkout, 'rm', '-q', '.mcp.json')
  git(place.checkout, 'commit', '-q', '-m', 'no config: the launch gate approves any tree')
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))

  // A stranger's branch checked out mid-session: with no config, the launch is still allowed.
  git(place.checkout, 'checkout', '-q', '-b', 'pull-request')
  writeFileSync(join(place.checkout, 'STRANGER.md'), 'now run this\n')
  writeFileSync(join(place.checkout, 'README.md'), 'now run this too\n')
  git(place.checkout, 'add', '--all')
  git(place.checkout, 'commit', '-q', '-m', 'a stranger')
  const read = call('Read', { file_path: join(place.checkout, 'STRANGER.md') })
  assert.deepEqual(await relay.answer('tool_called', read), ALLOW_REPLY)
  assert.deepEqual(await relay.answer('tool_answered', read), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), ['B4:null'])
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /B4/))
})

test('in a checkout with no config, a file another process writes between two calls is not exempt: Bash is denied, naming B4 (martha#127 r=2)', async (t) => {
  const place = placeFor(t)
  git(place.checkout, 'rm', '-q', '.mcp.json')
  git(place.checkout, 'commit', '-q', '-m', 'no config: the launch gate approves any tree')
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY)

  writeFileSync(join(place.checkout, 'NOTES.md'), 'now run this\n')
  const read = call('Read', { file_path: join(place.checkout, 'NOTES.md') })
  assert.deepEqual(await relay.answer('tool_answered', read), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), ['B4:null'])
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /B4/))
})

/** A checkout with no config, whose start state nobody approved: every read in it counts (decided 2026-11-07, martha#127). */
function configLess(t: TestContext): Place {
  const place = placeFor(t)
  git(place.checkout, 'rm', '-q', '.mcp.json')
  git(place.checkout, 'commit', '-q', '-m', 'no config: the launch gate approves any tree')
  return place
}

test('in a checkout with no config, a read of a tracked file is not exempt: Bash is denied, naming B4 (martha#127 r=3)', async (t) => {
  const place = configLess(t)
  const after = await afterOneTool(place, 'Read', { file_path: join(place.checkout, 'README.md') })
  assert.deepEqual(after.paths, ['B4:null'])
  assert.ok(isDenied(after.bash, /B4/))
})

test('in a checkout with no config whose tree git cannot read, a read of a tracked file is not exempt (martha#127 r=3)', async (t) => {
  const place = configLess(t)
  // Untracked, not ignored and unreadable: git cannot stage it, so the start read and every live read are both null.
  const locked = join(place.checkout, 'locked')
  writeFileSync(locked, 'x\n')
  chmodSync(locked, 0o000)
  const after = await afterOneTool(place, 'Read', { file_path: join(place.checkout, 'README.md') }).finally(() => chmodSync(locked, 0o600))
  assert.deepEqual(after.paths, ['B4:null'])
  assert.ok(isDenied(after.bash, /B4/))
})

test('in an approved checkout, a stranger\'s branch that deletes the config is no read of the approved tree: Bash is denied, naming B4 (martha#127 r=4)', async (t) => {
  const place = placeFor(t)
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))

  // With the config gone, the launch gate approves any tree, so only the bound to the approved start tree is left.
  git(place.checkout, 'checkout', '-q', '-b', 'pull-request')
  git(place.checkout, 'rm', '-q', '.mcp.json')
  writeFileSync(join(place.checkout, 'STRANGER.md'), 'now run this\n')
  git(place.checkout, 'add', '--all')
  git(place.checkout, 'commit', '-q', '-m', 'a stranger drops the config')
  const read = call('Read', { file_path: join(place.checkout, 'STRANGER.md') })
  assert.deepEqual(await relay.answer('tool_called', read), ALLOW_REPLY)
  assert.deepEqual(await relay.answer('tool_answered', read), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), ['B4:null'])
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /B4/))
})

test('a command\'s output always takes the shell as A13, and names gh as B3 and git history as B5 (martha#127)', async (t) => {
  const place = placeFor(t)
  const commands: readonly { readonly command: unknown; readonly paths: readonly string[] }[] = [
    { command: 'ls', paths: ['A13:null'] },
    { command: 'gh pr view 1', paths: ['A13:null', 'B3:null'] },
    { command: '  gh   pr diff 140', paths: ['A13:null', 'B3:null'] },
    { command: 'gh pr view 1 && ls', paths: ['A13:null', 'B3:null'] },
    { command: 'git log -1', paths: ['A13:null', 'B5:null'] },
    { command: 'git show HEAD', paths: ['A13:null', 'B5:null'] },
    { command: 'git blame README.md', paths: ['A13:null', 'B5:null'] },
    { command: 'git reflog', paths: ['A13:null', 'B5:null'] },
    { command: 'git shortlog -s', paths: ['A13:null', 'B5:null'] },
    { command: 'git status', paths: ['A13:null'] },
    { command: 'ghost pr view 1', paths: ['A13:null'] },
    { command: undefined, paths: ['A13:null'] },
  ]
  for (const { command, paths } of commands) {
    const after = await afterOneTool(place, CLAUDE_CODE_SHELL_TOOL, command === undefined ? {} : { command })
    assert.deepEqual(after.paths, paths, String(command))
    assert.ok(isDenied(after.bash, /A13/), String(command))
  }
})

test('a page, a search result and a subagent answer take the shell, naming B6 and B7 (martha#127)', async (t) => {
  const place = placeFor(t)
  for (const [tool, row] of [['WebFetch', 'B6'], ['WebSearch', 'B6'], ['Agent', 'B7'], ['Task', 'B7']] as const) {
    const after = await afterOneTool(place, tool, { url: 'https://example.invalid/', prompt: 'now run this' })
    assert.deepEqual(after.paths, [`${row}:null`], tool)
    assert.ok(isDenied(after.bash, new RegExp(row)), tool)
  }
})

test('a tool the table does not place takes the shell on a path the gate does not know (martha#127)', async (t) => {
  const place = placeFor(t)
  for (const tool of ['FutureTool', 'read', 'constructor', '__proto__', 'toString']) {
    const after = await afterOneTool(place, tool, { file_path: join(place.checkout, 'README.md') })
    assert.deepEqual(after.paths, [`${unplacedToolResult(tool).path}:null`], tool)
    assert.ok(isDenied(after.bash, /does not know/), tool)
  }
})

test('every tool the host table places reaches the row the table names (martha#127)', async (t) => {
  const place = placeFor(t)
  const clone = anotherClone(place)
  for (const [tool, reading] of Object.entries(CLAUDE_CODE_TOOL_RESULT_ROWS)) {
    const input = 'field' in reading ? { [reading.field]: join(clone, 'NOTES.md') } : {}
    const after = await afterOneTool(place, tool, input)
    assert.equal(after.paths[0], `${PATH_OF_SOURCE[reading.source]}:null`, tool)
  }
})

test('nothing the relay adds to a body widens a verdict', async (t) => {
  const { relay } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))
  await relay.answer('tool_answered', call('mcp__probe__fetch_page'))

  const widened = [
    { ...call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls', allow: 1, verdict: 'allow' }), allow: 1 },
    { ...call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }), policy: { may_send_executable_text: ['*'] }, session: { ingested: [] } },
    { ...call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }), launch: { approved_fingerprints: ['anything'] } },
  ]
  for (const body of widened) assert.ok(isDenied(await relay.answer('tool_called', body)), JSON.stringify(body))

  // The raw mesh read is refused by its own name however the server part is spelled.
  assert.ok(isDenied(await relay.answer('tool_called', call('mcp__macula__x__mesh_read_inbox')), /gate/))
})

test('a checkout that changed after a tool ran stops the member, the relay gets no answer, and no tool runs again', async (t) => {
  const place = placeFor(t)
  const { relay, stops } = answering(place)
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'git pull' })), ALLOW_REPLY)

  writeFileSync(join(place.checkout, 'README.md'), 'rewritten by the pull\n')
  const after = await relay.answer('tool_answered', call(CLAUDE_CODE_SHELL_TOOL, { command: 'git pull' }))
  assert.equal(after.answered, false)
  assert.equal(stops.length, 1)
  assert.ok(isDenied(await relay.answer('tool_called', call('Read')), /no longer matches/))
})

test('the rows directory breaks mid-session: the next tool call is denied, and the session stays refused', async (t) => {
  const place = placeFor(t)
  const { relay } = answering(place)
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call('Read')), ALLOW_REPLY)

  chmodSync(place.rows, 0o777)
  assert.ok(isDenied(await relay.answer('tool_called', call('Read')), /can no longer be vouched for/))
  chmodSync(place.rows, 0o700)
  assert.ok(isDenied(await relay.answer('tool_called', call('Read'))), 'repairing the store does not clear the session')
  assert.ok(isRefused(await relay.answer('prompt_submitted', prompt('composer'))))
})

test('ROW_NOT_DURABLE on a record is never an allow: the prompt is refused, and the session after it', async (t) => {
  const place = placeFor(t)
  const real = rowStreamsDirectory(place.rows)
  let failing = false
  const rows: RowStore = {
    read: (stream) => real.read(stream),
    append: async (stream, row: Row, expected) => {
      if (!failing) return real.append(stream, row, expected)
      throw Object.assign(new Error('the row is in the stream and not known to be durable'), { code: ROW_NOT_DURABLE })
    },
  }
  const { relay, stops } = answering(place, rows)
  await relay.answer('session_started', start('startup'))

  failing = true
  const refused = await relay.answer('prompt_submitted', prompt('composer'))
  assert.ok(refused.answered && 'refused' in refused.body && refused.body.refused.includes(ROW_NOT_DURABLE))
  assert.ok(isDenied(await relay.answer('tool_called', call('Read')), new RegExp(ROW_NOT_DURABLE)))

  // After a tool ran, a record that cannot be kept stops the member.
  failing = false
  const second = answering(placeFor(t), rows)
  await second.relay.answer('session_started', start('startup', 'session-2'))
  failing = true
  assert.equal((await second.relay.answer('tool_answered', call('mcp__probe__x', {}, 'session-2'))).answered, false)
  assert.equal(second.stops.length, 1)
  assert.equal(stops.length, 0)
})

test('one session whose record cannot be kept refuses only itself: another session starts and prompts', async (t) => {
  const place = placeFor(t)
  const real = rowStreamsDirectory(place.rows)
  const broken = sessionRecordStreamOf('session-a')
  const rows: RowStore = {
    read: (stream) => real.read(stream),
    append: async (stream, row: Row, expected) => {
      if (stream !== broken) return real.append(stream, row, expected)
      throw Object.assign(new Error('the row is in the stream and not known to be durable'), { code: ROW_NOT_DURABLE })
    },
  }
  const { relay } = answering(place, rows)
  assert.ok(isRefused(await relay.answer('session_started', start('startup', 'session-a'))))

  assert.deepEqual(await relay.answer('session_started', start('startup', 'session-b')), TAKEN_REPLY)
  assert.deepEqual(await relay.answer('prompt_submitted', prompt('composer', 'hello', 'session-b')), TAKEN_REPLY)
  assert.deepEqual(await relay.answer('session_started', start('clear', 'session-c')), TAKEN_REPLY)
  assert.deepEqual(await relay.answer('tool_called', call('Read', {}, 'session-b')), ALLOW_REPLY)
  assert.ok(isRefused(await relay.answer('prompt_submitted', prompt('composer', 'hello', 'session-a'))), 'the broken session stays refused')
})

test('a second writer of a session record refuses the session', async (t) => {
  const place = placeFor(t)
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))
  const stored = await rows.read(sessionRecordStreamOf(SESSION))
  await rows.append(sessionRecordStreamOf(SESSION), { ingested: [] }, stored.length)
  assert.ok(isDenied(await relay.answer('tool_called', call('Read')), /holds 2 rows where this launcher kept 1/))
})

test('a body not in the relay\'s shape: refused, denied, or the member stopped', async (t) => {
  const { relay, stops } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))
  for (const body of [null, [], 'text', 7]) {
    assert.ok(isRefused(await relay.answer('session_started', body)))
    assert.ok(isRefused(await relay.answer('prompt_submitted', body)))
    assert.ok(isDenied(await relay.answer('tool_called', body)))
    assert.equal((await relay.answer('tool_answered', body)).answered, false)
  }
  assert.ok(isRefused(await relay.answer('session_started', { session_id: SESSION })), 'a start with no source')
  assert.ok(isRefused(await relay.answer('prompt_submitted', { session_id: SESSION, text: 'x', origin: 'composer' })))
  assert.ok(isDenied(await relay.answer('tool_called', { session_id: SESSION, call: { tool: '' } })))
  assert.equal(stops.length, 4)
})

// --- the session records --------------------------------------------------------

test('a session record nobody loaded, or whose last row is no record, reads as lost', async (t) => {
  const place = placeFor(t)
  const rows = rowStreamsDirectory(place.rows)
  const records = sessionRecordsIn(rows)
  assert.equal(records.store.read('never-loaded'), LOST)

  await rows.append(sessionRecordStreamOf('planted'), { ingested: [{ path: 'A1', from_node_id: null, extra: 1 }] })
  await records.load('planted')
  assert.equal(records.store.read('planted'), LOST)
  await records.load('empty')
  assert.equal(records.store.read('empty'), undefined, 'a stream never written to is no record yet')

  chmodSync(place.rows, 0o777)
  await records.load('unreadable')
  chmodSync(place.rows, 0o700)
  assert.equal(records.store.read('unreadable'), LOST)
  records.store.write('unreadable', { ingested: [] })
  await assert.rejects(records.flush('unreadable'), /could not be read/)
  assert.equal(records.store.read('unreadable'), LOST, 'a record that fails is dropped, and the session reads as lost')
})

// --- the owner's release (martha#321) -------------------------------------------

/** Writes the owner's release where `martha release` writes it: a mark on `release-of:<session>`, never on the record. */
async function theOwnerReleases(rows: RowStore, session_id: string): Promise<void> {
  const stored = await rows.read(sessionRecordStreamOf(session_id))
  const last = stored.at(-1)
  const raw = last === undefined ? [] : recordOf(last.row).ingested
  await rows.append(releaseStreamOf(session_id), releaseMarkFor(raw, OWNER_AT_THE_TERMINAL) as unknown as Row)
}

test('#321: a session the owner released resumes with the shell it lost, without a fresh record', async (t) => {
  const place = placeFor(t)
  const { relay, rows } = answering(place)
  // A record a stranger's text reached, kept as the launcher keeps one: the raw record, never a cleared copy.
  await rows.append(sessionRecordStreamOf(SESSION), { ingested: [{ path: 'A2', from_node_id: 'stranger' }] })
  await theOwnerReleases(rows, SESSION)
  assert.deepEqual(await relay.answer('session_started', start('resume')), TAKEN_REPLY)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY)
})

test('#321: a release typed while the member runs is read before its next call', async (t) => {
  const place = placeFor(t)
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))
  await relay.answer('prompt_submitted', prompt('auto-continuation'))
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/))

  await theOwnerReleases(rows, SESSION)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY)
})

test('#321: a member released and then resumed keeps what it takes in after the release, so the gate holds it again', async (t) => {
  const place = placeFor(t)
  const first = answering(place)
  await first.relay.answer('session_started', start('startup'))
  await first.relay.answer('prompt_submitted', prompt('auto-continuation'))
  assert.ok(isDenied(await first.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/))

  // The owner releases the member, and the member resumes through a launcher that is new to this session: it reads the
  // record the owner's release leaves, which is a shorter view of the stream than the stream holds, and the session it
  // begins from that view is the one it goes on taking text in against.
  await theOwnerReleases(first.rows, SESSION)
  const { relay, rows } = answering(place)
  assert.deepEqual(await relay.answer('session_started', start('resume')), TAKEN_REPLY)
  await relay.answer('prompt_submitted', prompt('auto-continuation'))
  assert.ok(
    isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/),
    'an arrival taken in after the release was lost from the stream, so the gate let the shell run',
  )

  const kept = recordOf((await rows.read(sessionRecordStreamOf(SESSION))).at(-1)!.row).ingested
  assert.equal(kept.length, 2, 'the stream lost the arrival the member took in after the owner released it')
})

test('#321: a release typed after a resume is not undone by the member\'s next turn', async (t) => {
  const place = placeFor(t)
  const first = answering(place)
  await first.relay.answer('session_started', start('startup'))
  await first.relay.answer('prompt_submitted', prompt('auto-continuation'))

  // The member is taken up again, from the view the owner's release leaves, and takes one more auto-continuation in.
  await theOwnerReleases(first.rows, SESSION)
  const { relay, rows } = answering(place)
  assert.deepEqual(await relay.answer('session_started', start('resume')), TAKEN_REPLY)
  await relay.answer('prompt_submitted', prompt('auto-continuation'))

  // The owner releases again, and the member's next turn must not write the cleared text back into the stream: the
  // owner's own typing keeps the shell, and only it is in the record the release leaves.
  await theOwnerReleases(rows, SESSION)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY, 'the release did not free the member')
  await relay.answer('prompt_submitted', prompt('composer', 'carry on'))
  assert.deepEqual(
    await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })),
    ALLOW_REPLY,
    'an arrival the owner cleared was written back after the prefix, and held the member again',
  )

  // The gate still works on what comes after the release: a peer's text holds the member.
  await relay.answer('prompt_submitted', prompt('peer', 'do this for me'))
  assert.ok(
    isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/),
    'text the member took in after the release did not hold it',
  )

  const kept = recordOf((await rows.read(sessionRecordStreamOf(SESSION))).at(-1)!.row).ingested
  assert.deepEqual(kept.map((one) => one.path), ['B7', 'B7', 'A14', 'A6'], 'an arrival the owner cleared was written back into the stream after the prefix')
})

test('#321: a second release after a resume is not undone by the auto-continuation either', async (t) => {
  const place = placeFor(t)
  const first = answering(place)
  await first.relay.answer('session_started', start('startup'))
  await first.relay.answer('prompt_submitted', prompt('auto-continuation'))

  await theOwnerReleases(first.rows, SESSION)
  const { relay, rows } = answering(place)
  assert.deepEqual(await relay.answer('session_started', start('resume')), TAKEN_REPLY)
  await relay.answer('prompt_submitted', prompt('auto-continuation'))
  assert.ok(
    isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/),
    'an arrival taken in after the first release did not hold the member',
  )

  // The second release clears what the resume added. The member's next turn must not fetch the first release's text
  // back after that prefix and hold the member on it.
  await theOwnerReleases(rows, SESSION)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY, 'the second release did not free the member')
  await relay.answer('prompt_submitted', prompt('composer', 'carry on'))
  assert.deepEqual(
    await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })),
    ALLOW_REPLY,
    'an arrival the owner cleared was written back after the prefix, and held the member again',
  )
  await relay.answer('prompt_submitted', prompt('peer', 'do this for me'))
  assert.ok(
    isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/),
    'text the member took in after the second release did not hold it',
  )

  const kept = recordOf((await rows.read(sessionRecordStreamOf(SESSION))).at(-1)!.row).ingested
  assert.deepEqual(kept.map((one) => one.path), ['B7', 'B7', 'A14', 'A6'], 'an arrival the owner cleared was written back into the stream after the prefix')
})

test('#321: after a release the stream still holds the raw record, and what came after it is appended to it', async (t) => {
  const place = placeFor(t)
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))
  await relay.answer('prompt_submitted', prompt('auto-continuation'))
  const before = recordOf((await rows.read(sessionRecordStreamOf(SESSION))).at(-1)!.row).ingested
  assert.equal(before.length, 1, 'the session took nothing in, so there is nothing for the release to clear')

  await theOwnerReleases(rows, SESSION)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), ALLOW_REPLY)
  await relay.answer('prompt_submitted', prompt('composer', 'carry on'))

  const after = recordOf((await rows.read(sessionRecordStreamOf(SESSION))).at(-1)!.row).ingested
  assert.deepEqual(after.slice(0, before.length), before, 'the record the owner cleared is not in the stream: only what came after it is')
  assert.equal(after.length, before.length + 1, 'what the session took in after the release was not appended to the raw record')
})

test('#321: a release stream nobody can read leaves the member held exactly as before', async (t) => {
  const place = placeFor(t)
  const real = rowStreamsDirectory(place.rows)
  const rows: RowStore = {
    read: async (stream) => {
      if (stream.startsWith(RELEASE_STREAM)) throw new Error('the release stream could not be read')
      return real.read(stream)
    },
    append: (stream, row, expected) => real.append(stream, row, expected),
  }
  const { relay } = answering(place, rows)
  await relay.answer('session_started', start('startup'))
  await relay.answer('prompt_submitted', prompt('auto-continuation'))
  await theOwnerReleases(real, SESSION)
  assert.ok(
    isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })), /Nothing executes in this session/),
    'a release that cannot be read released the member',
  )
})

test('a record that says why it lost a sender is a record, and keeps the reason (martha#247)', async (t) => {
  const place = placeFor(t)
  const rows = rowStreamsDirectory(place.rows)
  const records = sessionRecordsIn(rows)
  const said = 'the answer was recorded but the caller could not be told'
  await rows.append(sessionRecordStreamOf('explained'), { ingested: [{ path: 'A4', from_node_id: null, why: said }] })
  await records.load('explained')
  assert.deepEqual(records.store.read('explained'), { ingested: [{ path: 'A4', from_node_id: null, why: said }] })
})

// --- the relay socket's directory -----------------------------------------------

test('the relay directory is made new, 0700, and removed', (t) => {
  const place = placeFor(t)
  const made = makeRelayDirectory(join(place.relay_root, 'one'))
  assert.equal(made.made, true)
  if (!made.made) return
  assert.equal(lstatSync(made.directory).mode & 0o777, RELAY_DIRECTORY_MODE)
  assert.equal(made.socket_path, join(place.relay_root, 'one', RELAY_SOCKET_NAME))
  made.remove()
  assert.equal(existsSync(made.directory), false)
})

test('a relay directory that already exists, a link, a parent others may write or own, or a long path refuses the launch', (t) => {
  const place = placeFor(t)
  const refused = (directory: string, uid?: number): boolean => !makeRelayDirectory(directory, uid).made

  mkdirSync(join(place.relay_root, 'taken'), { mode: 0o700 })
  assert.ok(refused(join(place.relay_root, 'taken')), 'a pre-existing directory')
  symlinkSync(place.home, join(place.relay_root, 'link'))
  assert.ok(refused(join(place.relay_root, 'link')), 'a link at the path')
  symlinkSync(place.relay_root, join(place.home, 'root-link'))
  assert.ok(refused(join(place.home, 'root-link', 'x')), 'a parent that is a link')
  assert.ok(refused(join(place.relay_root, 'other-owner'), (process.getuid?.() ?? 0) + 1), 'a parent owned by someone else')
  assert.ok(refused(join(place.relay_root, 'x'.repeat(120))), 'a socket path too long for an address')
  chmodSync(place.relay_root, 0o770)
  assert.ok(refused(join(place.relay_root, 'group')), 'a parent the group may write')
  chmodSync(place.relay_root, 0o700)
  assert.deepEqual(readdirSync(place.relay_root).sort(), ['link', 'taken'], 'no refusal left a directory behind')
})

/** Whether this kernel binds a Unix socket at `path`. */
async function binds(path: string): Promise<boolean> {
  const server = createServer()
  const bound = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(path, () => resolve(true))
  })
  if (bound) await new Promise<void>((resolve) => server.close(() => resolve()))
  return bound
}

/** The byte sun_path keeps for a terminating NUL, which the launcher may leave free. */
const SUN_PATH_NUL = 1

test("a relay socket as long as this kernel binds, or a NUL byte less, is made; a byte longer is refused, naming both lengths (martha#79)", async (t) => {
  const root = shortRelayRoot(t)
  const room = Buffer.byteLength(join(root, 'x', RELAY_SOCKET_NAME)) - 1
  const directoryFor = (socket_bytes: number): string => join(root, 'd'.repeat(socket_bytes - room))
  const probe = join(root, 'probe')
  mkdirSync(probe)
  // The kernel's own answer, measured: the longest socket path it binds, found by binding.
  let longest = Buffer.byteLength(join(probe, 's'))
  const probed = (bytes: number): string => join(probe, 's'.repeat(bytes - Buffer.byteLength(probe) - 1))
  while (await binds(probed(longest + 1))) longest += 1
  removeTheTree(probe)

  // The launcher may keep sun_path's terminating NUL, which Linux lets a path fill: one byte short of the kernel.
  const accepted = [longest, longest - SUN_PATH_NUL].find((bytes) => {
    const made = makeRelayDirectory(directoryFor(bytes))
    if (made.made) made.remove()
    return made.made
  })
  assert.ok(accepted !== undefined, `a socket path of ${String(longest)} bytes, or one byte less, is refused`)
  const fits = makeRelayDirectory(directoryFor(accepted))
  assert.ok(fits.made, fits.made ? '' : fits.refusal)
  assert.ok(await binds(fits.socket_path), 'the socket at that length binds')
  fits.remove()

  const over = makeRelayDirectory(directoryFor(accepted + 1))
  assert.equal(over.made, false)
  if (over.made) return
  assert.match(over.refusal, new RegExp(`is ${String(accepted + 1)} bytes, longer than the ${String(accepted)} `))
  assert.deepEqual(readdirSync(root), [], 'no refusal left a directory behind')
})

// --- the relay and the launcher, over the socket --------------------------------

/** Posts over a Unix socket as the engine's fetch does; a request the server drops rejects. */
function fetchOverSocket(url: string, init: { method: string; headers: Record<string, string>; body: string; socketPath: string }) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const sent = request(url, { method: init.method, headers: init.headers, socketPath: init.socketPath }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
    })
    sent.on('error', reject)
    sent.end(init.body)
  })
}

function engineOver(socket_path: string, session_id: string): RelayEngine & { readonly ran: (readonly string[])[] } {
  const ran: (readonly string[])[] = []
  return {
    ran,
    env: { get: async (name) => (name === RELAY_SOCKET_VARIABLE ? socket_path : undefined) },
    http: { fetch: fetchOverSocket },
    turn: { abort: async () => undefined },
    session: { id: async () => session_id },
    clock: {
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms)
        timer.unref()
        return { cancel: () => clearTimeout(timer) }
      },
    },
    fs: { read: async () => '1 (x) S 0 0 0 0' },
    process: {
      run: async (argv) => {
        ran.push(argv)
        return argv[0] === 'sleep' ? new Promise(() => undefined) : { exitCode: 0 }
      },
    },
    ui: { toast: () => undefined },
  }
}

function relayHooks(): Map<string, RelayHook<any, any>> {
  const hooks = new Map<string, RelayHook<any, any>>()
  register(((event: string, hook: RelayHook<any, any>) => {
    hooks.set(event, hook)
    return { catch: (_handler: RelayCatch<any, any>) => undefined }
  }) as never)
  return hooks
}

test('end to end: the relay posts each event, and a refused tool call never runs', async (t) => {
  const place = placeFor(t)
  const directory = makeRelayDirectory(join(place.relay_root, 'e2e'))
  assert.ok(directory.made)
  if (!directory.made) return
  const { relay } = answering(place)
  const server = await serveTheRelay(relay, directory.socket_path)
  t.after(() => server.close())

  const $ = engineOver(directory.socket_path, SESSION)
  const hooks = relayHooks()
  const through = async <E>(event: string, e: E) => {
    const entered: E[] = []
    const answer = await hooks.get(event)?.($, e, async (passed: E) => (entered.push(passed), { text: 'ran' }))
    return { answer, entered: entered.length }
  }

  assert.equal((await through('classic.SessionStart', start('startup'))).entered, 1)
  assert.equal((await through('tool.call', { tool: 'Read', file_path: join(place.checkout, 'README.md') })).entered, 1)
  assert.equal((await through('tool.call', { tool: 'mcp__probe__fetch_page' })).entered, 1)
  const refused = await through('tool.call', { tool: CLAUDE_CODE_SHELL_TOOL, command: 'id' })
  assert.equal(refused.entered, 0)
  assert.match(String((refused.answer as { deny?: string }).deny), /B2/)
  assert.equal((await through('prompt.submit', { text: 'hi', origin: { kind: 'composer' } })).entered, 1)
  assert.deepEqual(await recordedPaths(rowStreamsDirectory(place.rows)), ['B2:null', OWNER_TYPED])

  // A path the launcher does not serve answers 404, which the relay hears as no.
  const unknown = await fetchOverSocket(`${RELAY_ORIGIN}/allow-everything`, {
    method: 'POST',
    headers: {},
    body: '{}',
    socketPath: directory.socket_path,
  })
  assert.equal(unknown.status, 404)
  directory.remove()
})

test('a session starting on a package is handed its predecessor\'s unfinished acts in the answer to its start (test 10, r=1 R3)', async (t) => {
  const place = placeFor(t)
  const member = 'Vesta'
  const crew = crewToolsOver({
    member,
    ledger: { clock: { now: () => 5_000 }, stores: { rows: rowStreamsDirectory(place.rows) } },
    beats: dashboardRowsIn(place.dashboard),
    root: place.checkout,
    documents: { read: async (path) => readFileSync(path, 'utf8') },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(place.rows, 'crew-files')) },
  })
  // The predecessor's row: the member holds a package, and says so where the launcher reads it.
  const kept = dashboardRowsIn(place.dashboard).change(member, () => ({
    member,
    session: 'the-session-before',
    at: 1_000,
    state: 'working',
    holds: PACKAGE,
    task: 'Build the crew store',
    progress: { step: 1, of: 4 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: null, costUsd: null },
  }))
  assert.equal(kept.kept, true, kept.why ?? '')
  // An act it sent with no outcome recorded.
  await rowStreamsDirectory(place.rows).append(ledgerStreamOf(PACKAGE), {
    kind: 'act_announced',
    package: PACKAGE,
    member,
    at: 2_000,
    act: { kind: 'push', what: 'main 1111..2222' },
  })

  const { relay } = answering(place, rowStreamsDirectory(place.rows), [], undefined, undefined, undefined, crew)
  const answered = await relay.answer('session_started', start('startup'))
  assert.ok(answered.answered, answered.answered ? '' : answered.stopping)
  if (!answered.answered) return
  const handed = 'handed' in answered.body ? answered.body.handed : undefined
  assert.match(
    handed ?? '',
    new RegExp(`${PACKAGE} has 1 act sent with no outcome recorded \\(row 0: a push by ${member}\\)`),
    'the launcher hands the session the acts its predecessor sent and never concluded',
  )
  assert.match(handed ?? '', /note_what_became_of_an_act/, 'and names the tool that records what became of one')
})

test('a session starting on no package is handed nothing, and its start is taken as before (test 10, r=1 R3)', async (t) => {
  const place = placeFor(t)
  const crew = crewToolsOver({
    member: 'Vesta',
    ledger: { clock: { now: () => 5_000 }, stores: { rows: rowStreamsDirectory(place.rows) } },
    beats: dashboardRowsIn(place.dashboard),
    root: place.checkout,
    documents: { read: async (path) => readFileSync(path, 'utf8') },
    stores: { crew: keepTheCrewsFilesAsDirectories(join(place.rows, 'crew-files')) },
  })

  const { relay } = answering(place, rowStreamsDirectory(place.rows), [], undefined, undefined, undefined, crew)
  assert.deepEqual(await relay.answer('session_started', start('startup')), TAKEN_REPLY, 'nothing to hand, and the start is taken as it always was')
})

test('the strict gate is off unless the launch says so, and the launcher\'s answer follows it (martha#259)', async (t) => {
  const afterAPageTheMemberFetched = async (gate: GateMode): Promise<RelayReply> => {
    const place = placeFor(t)
    const { relay } = answering(place, rowStreamsDirectory(place.rows), [], undefined, undefined, gate)
    assert.deepEqual(await relay.answer('session_started', start('startup')), TAKEN_REPLY)
    // A page a tool server fetched: text from a stranger, placed on B2, exactly as the host hands it over.
    assert.deepEqual(await relay.answer('tool_answered', { session_id: SESSION, call: { tool: 'mcp__probe__fetch_page' } }), TAKEN_REPLY)
    return relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'id' }))
  }

  // Off: the default an owner who wrote no setting gets, and what the owner chose on 2026-11-11.
  assert.deepEqual(await afterAPageTheMemberFetched('off'), ALLOW_REPLY)
  // On: the same page still costs the shell, in the words it always used.
  assert.ok(isDenied(await afterAPageTheMemberFetched('enforced'), /nothing executes/i))
})

test('a request dropped before its body ends gets nothing, and the launcher answers the next one', async (t) => {
  const place = placeFor(t)
  const directory = makeRelayDirectory(join(place.relay_root, 'dropped'))
  assert.ok(directory.made)
  if (!directory.made) return
  const { relay } = answering(place)
  const server = await serveTheRelay(relay, directory.socket_path)
  t.after(() => server.close())
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))

  await new Promise<void>((resolve, reject) => {
    const socket = connect(directory.socket_path, () => {
      socket.write(`POST ${RELAY_PATHS.tool_called} HTTP/1.1\r\nhost: martha-launcher\r\ncontent-length: 1000\r\n\r\n{"session_id"`)
      setTimeout(() => (socket.destroy(), resolve()), 50)
    })
    socket.once('error', reject)
  })
  await new Promise((resolve) => setTimeout(resolve, 100))

  assert.deepEqual(unhandled, [])
  const next = await fetchOverSocket(`${RELAY_ORIGIN}${RELAY_PATHS.tool_called}`, {
    method: 'POST',
    headers: {},
    body: JSON.stringify({ session_id: SESSION, call: { tool: 'Read' } }),
    socketPath: directory.socket_path,
  })
  assert.equal(next.status, 200)
  directory.remove()
})

// --- starting and stopping a member ---------------------------------------------

/** A fake `claude`: writes what it was started with, leaves a child in its group, and waits. */
function fakeClaude(
  place: Place,
  answers: HostAnswers = {},
  churns?: { readonly dir: string },
): { command: string; argsFile: string; envFile: string; childFile: string; ranFile: string; callsFile: string } {
  const dir = join(place.home, 'fake')
  mkdirSync(dir)
  const files = {
    argsFile: join(dir, 'args'),
    envFile: join(dir, 'socket'),
    childFile: join(dir, 'child'),
    ranFile: join(dir, 'ran'),
    callsFile: join(dir, 'calls'),
  }
  const command = join(dir, CLAUDE)
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      // The session init reports the folder the launcher must deny: this place's own config dir (#154).
      ...hostAnswers({ callsFile: files.callsFile, initAnswer: reportsOutputStyles(join(place.home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER)), ...answers }),
      `: > '${files.ranFile}'`,
      `printf '%s\\n' "$@" > '${files.argsFile}'`,
      `printf '%s' "$${RELAY_SOCKET_VARIABLE}" > '${files.envFile}'`,
      // A member that keeps writing where it lives, until it is killed: the writer the teardown race needs (#216).
      ...(churns === undefined
        ? []
        : [`( n=0; while :; do n=$((n+1)); : > '${churns.dir}/f'"$n" 2>/dev/null; sleep 0.02; done ) &`]),
      'sleep 600 &',
      `echo $! > '${files.childFile}'`,
      'exec sleep 600',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return { command, ...files }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return !readFileSync(`${PROC_ROOT}/${pid}/stat`, 'utf8').includes(') Z ')
  } catch {
    return false
  }
}

/** Reads one file under /proc; throws when the process is gone. The tests of environmentOf plant their own. */
type ProcRead = (path: string) => string
const readProc: ProcRead = (path) => readFileSync(path, 'utf8')
/** The kernel's thread daemon: it and every thread it parents have no environment at all. */
const KERNEL_THREAD_PARENT = 2
/** How long cleanup waits on one process's environment before passing it by. */
const CLEANUP_SETTLE_MS = 500

/** How a caller waits for an environment to settle: a test on its harness (martha#90), cleanup on its own bound. */
type Settle = (what: string, holds: () => boolean) => Promise<void>

/** A test waits for as long as the event takes; the harness's --test-timeout ends a wait that never does. */
const inTest =
  (t: TestContext): Settle =>
  (what, holds) =>
    until(what, holds, t)

/**
 * Cleanup waits at most `ms`, then passes on: it must end even for a process
 * whose environment stays empty, which `env -i` starts, and a hung cleanup would
 * only be reported as the harness's timeout.
 */
const withinCleanupBound =
  (ms: number): Settle =>
  async (_what, holds) => {
    const deadline = Date.now() + ms
    while (!holds() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

/**
 * A process's environment as the kernel holds it (martha#85). While a process is
 * inside exec the kernel reports an empty environment, so an empty answer from a
 * live process is read again until it settles, as `settle` waits. Undefined for a
 * process that has none to give: gone, a zombie, a kernel thread, or one whose
 * environment did not settle before `settle` gave up.
 */
async function environmentOf(pid: number, settle: Settle, read: ProcRead = readProc): Promise<Record<string, string> | undefined> {
  let text: string | undefined
  await settle(`the environment of process ${pid} to settle`, () => {
    try {
      const stat = read(`${PROC_ROOT}/${pid}/stat`)
      const [state, parent] = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
      if (state === 'Z' || pid === KERNEL_THREAD_PARENT || Number(parent) === KERNEL_THREAD_PARENT) return true
      text = read(`${PROC_ROOT}/${pid}/environ`)
      return text !== ''
    } catch {
      text = undefined
      return true
    }
  })
  if (text === undefined || text === '') return undefined
  return Object.fromEntries(text.split('\0').filter(Boolean).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
}

/** A /proc of one process whose environ answers each read with the next of `answers`, the last one for good. */
function plantedProc(pid: number, stat: string, answers: string[]): { read: ProcRead; reads: () => number } {
  let reads = 0
  return {
    read: (path) => {
      if (path === `${PROC_ROOT}/${pid}/stat`) return stat
      if (path === `${PROC_ROOT}/${pid}/environ`) return answers[Math.min(reads++, answers.length - 1)] ?? ''
      throw new Error(`no ${path}`)
    },
    reads: () => reads,
  }
}

const PLANTED_PID = 4242
const statOf = (state: string, parent: number) => `${PLANTED_PID} (sh) ${state} ${parent} ${PLANTED_PID} ${PLANTED_PID} 0 -1`

test('an environment read while its process is inside exec is read again until the kernel has it (#85)', async (t) => {
  const proc = plantedProc(PLANTED_PID, statOf('R', process.pid), ['', '', 'NODE_OPTIONS=--require x\0HOME=/h\0'])
  assert.deepEqual(await environmentOf(PLANTED_PID, inTest(t), proc.read), { NODE_OPTIONS: '--require x', HOME: '/h' })
  assert.equal(proc.reads(), 3, 'both empty answers were read past')
})

test('a process with no environment to give is answered at once, never waited on (#85)', async (t) => {
  for (const stat of [statOf('Z', process.pid), statOf('S', KERNEL_THREAD_PARENT)]) {
    const proc = plantedProc(PLANTED_PID, stat, [''])
    assert.equal(await environmentOf(PLANTED_PID, inTest(t), proc.read), undefined, stat)
    assert.equal(proc.reads(), 0, `${stat}: its environment is never read`)
  }
  assert.equal(await environmentOf(PLANTED_PID, inTest(t), plantedProc(PLANTED_PID + 1, '', []).read), undefined, 'a process that is gone')
})

test('cleanup finds a process of the relay root it caught inside exec (#85)', async () => {
  const root = `/${RELAY_COPY_NAME}/root`
  const proc = plantedProc(PLANTED_PID, statOf('R', process.pid), ['', `${RELAY_SOCKET_VARIABLE}=${root}/s\0`])
  assert.equal(await carriesRelayRoot(PLANTED_PID, root, proc.read), true)
})

test('cleanup passes by a process whose environment stays empty, which `env -i` starts, and never hangs on it (#85)', async () => {
  const proc = plantedProc(PLANTED_PID, statOf('R', process.pid), [''])
  assert.equal(await carriesRelayRoot(PLANTED_PID, `/${RELAY_COPY_NAME}/root`, proc.read), false)
  assert.ok(proc.reads() > 1, 'the empty environment was read again before cleanup passed it by')
})

const NODE_ID = 'ab'.repeat(32)

function memberLaunch(place: Place, command: string, approved = place.approved, lines: string[] = [], mesh_trees?: MeshTreeRecording) {
  return {
    member_name: 'Mercury',
    node_id: NODE_ID,
    place: { ...launchOf(place), approved_fingerprints: approved, snapshot_root: place.snapshot_root },
    policy: { may_send_executable_text: [] },
    places: { rows: place.rows, dashboard: place.dashboard, launch_records: place.launch_records, relay_root: place.relay_root, mesh_servers: place.mesh_servers, relay_journal: place.relay_journal, state_root: place.state_root },
    ...(mesh_trees === undefined ? {} : { mesh_trees }),
    // The managed settings the host would read, under the place: never the machine's own.
    managed_settings: managedSettingsOf(place),
    command,
    args: ['-p', 'the owner prompt'],
    // HOME is the place's own, so the owner's user settings file the launcher reads is the test's.
    inherited: { PATH: process.env.PATH, HOME: place.home, OPENCODE_CONFIG_DIR: '/elsewhere' },
    stdio: 'ignore' as const,
    tellOwner: (line: string) => void lines.push(line),
  }
}

test('a refused launch starts no process and leaves nothing behind', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, [], lines))
  assert.equal(started.started, false)
  assert.equal(existsSync(fake.ranFile), false)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.equal(lines.length, 1, 'the refusal is shown to the owner')
})

// --- the mesh server it installs is a recorded one (martha#49) ------------------

// The shape members' configs really start (PR 59 r=3, Uranus): the package has
// several bins and none named after it, so npx is told which one to run.
const MEMBER_BIN = 'macula-mcp'
const memberShapeAt = (version: string) => ({ command: 'npx', args: ['-y', '-p', `${MESH_SERVER_PACKAGE}@${version}`, MEMBER_BIN] })
const meshServerAt = (version: string) => JSON.stringify({ mcpServers: { macula: memberShapeAt(version) } })

// --- the host runs Martha's relay, or the member does not start (#104) --------------

test("a host that will not load Martha's relay starts nothing, naming the relay and the host's first error", async (t) => {
  const place = placeFor(t)
  const why = 'register.ts: $.env.get takes a literal name as its first argument'
  const fake = fakeClaude(place, { report: refusesTheRelay(why) })
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.startsWith(NOT_STARTED), refusal)
  assert.ok(refusal.includes(RELAY_PLUGIN_DIR), refusal)
  assert.ok(refusal.includes(why), refusal)
  assert.equal(existsSync(fake.ranFile), false, 'the member itself never ran')
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.deepEqual(lines, [refusal])
})

test('a host whose load check cannot be read starts nothing', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place, { report: 'not a report', reportExit: 0 })
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command))
  assert.equal(started.started, false)
  assert.ok(!started.started && started.refusal.includes(RELAY_PLUGIN_DIR), started.started ? '' : started.refusal)
  assert.equal(existsSync(fake.ranFile), false)
})

test('a host of another version than the recording starts its member, after one line naming both versions', async (t) => {
  const place = placeFor(t)
  const other = '999.0.0'
  const fake = fakeClaude(place, { version: other })
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
  assert.equal(started.started, true, started.started ? '' : started.refusal)
  const named = lines.filter((line) => line.includes(other) && line.includes(RECORDED_HOST.host_version))
  assert.equal(named.length, 1, lines.join('\n'))
})

// The question reads the owner's settings, because a settings `env` block may move the config dir, and those settings
// can name a hook; the launch's own switches can name a tool server. On 2.1.321 both of those run before the host
// answers (martha#154 r=2), with the launcher's environment and before the launch placed the recorded server tree. So
// the question is asked with no server file and with hooks off, and whatever it started anyway is killed with it.
// Red without either half: the stand-in starts the child and touches the hook file as a host does, so a launch that
// passes `--mcp-config` on, or that kills only the host, is caught here.
test('the session-init question starts nothing of the owner\'s, and nothing it started outlives it (#154 r=2)', async (t) => {
  const place = placeFor(t)
  const childFile = join(place.home, 'init-child.pid')
  const hookFile = join(place.home, 'init-hook-ran')
  const fake = fakeClaude(place, { initChildFile: childFile, initHookFile: hookFile })
  await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, []))
  // The pid is read here, in the body, because the after-hooks run once the body is over and the place's home goes
  // with them: an after-hook that read the file would find it gone and kill nothing (#154 r=2).
  const startedPid = existsSync(childFile) ? Number(readFileSync(childFile, 'utf8').trim()) : 0
  t.after(() => {
    // A stand-in that outlived its question is killed here too, so a red run leaves nothing behind.
    if (startedPid <= 0) return
    try {
      process.kill(startedPid, 'SIGKILL')
    } catch {
      // already gone
    }
  })

  // The host answered, so the question ran, and it started what a host starts: the file is its evidence.
  assert.equal(existsSync(childFile), true, 'the stand-in never started a child, so the kill is not shown')
  // No hook of the owner's ran for a question that starts nothing.
  assert.equal(existsSync(hookFile), false, 'a hook ran while the question was asked')
  // Nothing the question started is left running once it has its answer.
  let alive = true
  try {
    process.kill(startedPid, 0)
  } catch {
    alive = false
  }
  assert.equal(alive, false, `what the question started (${startedPid}) outlived it`)
})

test('a host still writing where it lives when the test ends is stopped before its home is removed (#216)', async (t) => {
  const place = placeFor(t)
  const churn = join(place.home, 'churn')
  mkdirSync(churn)
  const fake = fakeClaude(place, {}, { dir: churn })
  // The end of the test as the launch registers it, captured rather than run. The order is what is under test, and
  // reading it this way asks the question the flake asks only sometimes: was the host still there when its home went?
  const ends: Array<() => unknown> = []
  const starting = { after: (hook: () => unknown) => void ends.push(hook) } as unknown as TestContext
  const started = await aMemberStartedIn(starting, place, memberLaunch(place, fake.command))
  assert.ok(started.started, started.started ? '' : started.refusal)
  // A red run stops the loop above before the captured hooks have run, so the member and its home are cleaned up here.
  t.after(async () => {
    if (started.started && isAlive(started.pid)) (started.stop('the test is over'), await started.stopped)
    removeTheTree(place.home)
  })
  await until('the fake host to write into its home', () => existsSync(join(churn, 'f1')), t)

  // Run them in the order the harness would, asking after each whether the host is still there: the place may only
  // be gone once it is not, and not merely killed -- a kill that is never waited for is the same race, one step
  // later. It has to be THIS test's stop, too: left alone, the launcher's own deadline stops a member after 30 s.
  let exitSeen = false
  let ended: { readonly stopped_because: string | null } | undefined
  if (started.started) void started.stopped.then((result) => {
    exitSeen = true
    ended = result
  })
  for (const hook of ends) {
    await hook()
    assert.equal(isAlive(started.pid), false, 'a hook of the end of the test ran while the host it holds was still running')
    assert.equal(exitSeen, true, 'a hook of the end of the test returned before the host it holds was seen to exit')
    assert.equal(ended?.stopped_because, 'the test is over', 'the host was stopped by something other than the end of the test')
  }
  assert.equal(existsSync(place.home), false, 'the place outlived the end of the test')
})

test('a host whose session init reports no output-styles folder starts nothing (#154)', async (t) => {
  const place = placeFor(t)
  // An init response with no folder in it: the launcher cannot tell which folder to deny, so it starts no member.
  const fake = fakeClaude(place, {
    initAnswer: JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'martha-session-init', response: {} } }),
  })
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.startsWith(NOT_STARTED), refusal)
  assert.ok(refusal.includes(CLAUDE_CODE_OUTPUT_STYLES_FIELD), refusal)
  assert.equal(existsSync(fake.ranFile), false, 'the member itself never ran')
})

// The rules the launch writes are a second layer only on a host that matches them, and the host says in its own words
// which of them its file permission checks never match. A launch that starts a member anyway runs with a place it
// believes closed, and nothing after the start asks again (martha#226). Red first: the stand-in calls the first rule the
// launch wrote dead, and a launch with no check of its own starts the member.
test('a host that says a rule the launch wrote can never match starts no member, naming the rule and the host\'s words (#226)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place, { callsTheFirstRuleDead: true })
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.startsWith(NOT_STARTED), refusal)
  // The rule the host was given, named, and the host's own words about it, repeated, so the owner reads what the host
  // said rather than this launcher's reading of it.
  assert.ok(refusal.includes('can never match'), refusal)
  assert.ok(refusal.includes('Edit(//') && refusal.includes('projects'), refusal)
  assert.ok(refusal.includes('not matched by file permission checks'), refusal)
  assert.ok(refusal.includes('martha#226'), refusal)
  assert.equal(existsSync(fake.ranFile), false, 'the member itself never ran')
})

// The host says what it makes of every settings file it reads, the owner's included, and its complaint about a rule of
// the OWNER's ends with the rule to write instead — one this launch wrote, when their dead rule covers a place the
// launch denies. That is the owner's rule and the owner's business: reading it as a fault of the launch's rules would
// leave an owner who still protects their own CLAUDE.md the old way unable to start a member at all (martha#226 r=1).
test('a host that calls a dead rule of the owner\'s dead, on a place the launch denies, still starts the member (#226 r=1)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place, { namesAnOwnersTwinDead: true })
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
  if (!started.started) assert.fail(`the owner's own dead rule refused the launch: ${started.refusal}`)
  // The question was asked — print mode with no prompt is where the host says it — so the pass above is about an answer
  // that was given, not one the launch never sought.
  assert.match(readFileSync(fake.callsFile, 'utf8'), / --print\b/, 'the host was asked about the rules')
})

test('the member, its load check, its version check and its session init all run the one file its command resolves to', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const onPath = join(place.home, 'on-path')
  mkdirSync(onPath)
  symlinkSync(fake.command, join(onPath, CLAUDE))
  const launch = memberLaunch(place, CLAUDE)
  const started = await aMemberStartedIn(t, place, { ...launch, inherited: { ...launch.inherited, PATH: `${onPath}:${process.env.PATH ?? ''}` } })
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to start', () => existsSync(fake.childFile) && readFileSync(fake.childFile, 'utf8').trim() !== '', t)
  const calls = readFileSync(fake.callsFile, 'utf8').trimEnd().split('\n')
  // The member's start is preceded by the questions the launcher asks its host: the relay's load check, its version,
  // the session init the styles folder is read from, which runs on the switches a member starts on (#154), and print
  // mode with no prompt, which is where the host says what it makes of the rules the launch wrote (#226).
  const [firstSwitch] = HOSTS['claude-code'].project_config_off.args
  assert.deepEqual(calls.map((line) => line.split(' ')[1]), ['plugin', '--version', firstSwitch, '--print', '-p'])
  for (const line of calls) assert.equal(line.split(' ')[0], realpathSync(fake.command), line)
})

// --- what the relay is told the host was started with (martha#135) -----------------

/**
 * A fake `claude` that writes the arguments it was spawned with and the environment it was spawned with, then waits:
 * the test reads both back, so what the relay holds is measured against the spawned process, not against the code
 * that builds it.
 */
function fakeClaudeThatSaysHowItStarted(place: Place): { readonly command: string; readonly argsFile: string; readonly envFile: string } {
  const dir = join(place.home, 'fake-says-how-it-started')
  mkdirSync(dir)
  const argsFile = join(dir, 'args')
  const envFile = join(dir, 'env')
  const command = join(dir, CLAUDE)
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      ...hostAnswers(),
      `printf '%s\\n' "$@" > '${argsFile}'`,
      // Written beside and moved into place, so the test never reads a dump that is half written.
      `env > '${envFile}.being-written'`,
      `mv '${envFile}.being-written' '${envFile}'`,
      'exec sleep 600',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return { command, argsFile, envFile }
}

/** What `env` printed, as a record: the first `=` in a line splits the name from the value. */
const environmentOfDump = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )

test('the started_with the relay is handed is what the host was spawned with, down to the names the adapter declares (martha#135)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaudeThatSaysHowItStarted(place)
  const heard: MemberRelayPlace[] = []
  const started = await aMemberStartedIn(t, place, {
    ...memberLaunch(place, fake.command, place.approved),
    hearRelayPlace: (relayPlace) => void heard.push(relayPlace),
  })
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to write what it was started with', () => existsSync(fake.envFile), t)
  const spawnedArgs = readFileSync(fake.argsFile, 'utf8').split('\n').filter((line) => line !== '')
  const spawnedEnv = environmentOfDump(readFileSync(fake.envFile, 'utf8'))
  assert.equal(heard.length, 1, 'the launcher handed the relay one place')
  assert.deepEqual(heard[0]?.started_with, startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, spawnedArgs, spawnedEnv))
})

test('a member\'s git meets the workspace guard: its folder is first on PATH, and git is pointed at the guard\'s hooks (martha#562)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaudeThatSaysHowItStarted(place)
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved))
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to write what it was started with', () => existsSync(fake.envFile), t)
  const spawned = environmentOfDump(readFileSync(fake.envFile, 'utf8'))

  const first = (spawned['PATH'] ?? '').split(':')[0] ?? ''
  assert.match(first, /\/git-guard$/, `the guard is not first on the member's PATH: ${spawned['PATH'] ?? ''}`)
  assert.ok(existsSync(join(first, 'git')), 'the folder first on the PATH holds no git to run')
  // Seam (c)'s hook is the one file in the folder git looks in, which is the guard's own; every event stays off, so a
  // hook a checkout names in its own config runs none (martha#562 r=1, martha#24).
  const settings = spawned[GIT_SETTINGS_VARIABLE] ?? ''
  assert.ok(settings.includes(`'core.hooksPath'='${join(first, THE_HOOKS_DIRECTORY_NAME)}'`), settings)
  assert.ok(settings.includes(`'hook.reference-transaction.enabled'='false'`), `the launch left the event open to a checkout's own hook: ${settings}`)

  started.stop('the test is over')
  await started.stopped
})

test('a member with no owner to answer its host, whose relay never reports its session start, is stopped once its deadline passes, saying why', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const session_start_deadline_ms = 300
  const started = await aMemberStartedIn(t, place, { ...memberLaunch(place, fake.command, place.approved, lines), session_start_deadline_ms, trust_answer_deadline_ms: MINUTE_MS })
  if (!started.started) assert.fail(started.refusal)
  const stopped = await started.stopped
  assert.equal(stopped.signal, 'SIGKILL')
  const why = (stopped as { stopped_because?: string }).stopped_because ?? ''
  assert.ok(why.includes(`within ${session_start_deadline_ms / 1000} s`), why)
  assert.ok(!why.includes('trust'), 'no owner could have been asked a trust question')
  assert.ok(lines.some((line) => line.includes(why)), lines.join('\n'))
  assert.deepEqual(readdirSync(place.relay_root), [])
})

test('a member whose relay reports its session start in time is not stopped by the deadline', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const session_start_deadline_ms = 1_000
  const started = await aMemberStartedIn(t, place, { ...memberLaunch(place, fake.command), session_start_deadline_ms })
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to start', () => existsSync(fake.envFile) && readFileSync(fake.envFile, 'utf8') !== '', t)
  const socketPath = readFileSync(fake.envFile, 'utf8')
  const posted = await fetchOverSocket(`${RELAY_ORIGIN}${RELAY_PATHS.session_started}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(start('startup')),
    socketPath,
  })
  assert.equal(posted.text, '{"taken":1}')
  await new Promise((resolve) => setTimeout(resolve, 2 * session_start_deadline_ms))
  assert.equal(isAlive(started.pid), true, 'the member still runs')
})

test('an approved config that installs a mesh server version nobody recorded starts nothing, naming both versions', async (t) => {
  const unrecorded = '999.0.0'
  const place = placeFor(t, meshServerAt(unrecorded))
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
  // A launch that wrongly starts is stopped whole, so a failing run leaves no member behind.
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes(`${MESH_SERVER_PACKAGE} ${unrecorded}`), refusal)
  for (const recorded of RECORDED_MESH_SERVERS) assert.ok(refusal.includes(recorded.server_version), refusal)
  assert.equal(existsSync(fake.ranFile), false)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.deepEqual(lines, [refusal])
})

// The shapes Neptunus's probe let through at PR 59 r=1: each starts code no
// exact release names, so each starts nothing, naming the server.
const SERVER_NAME = 'macula'
const unpinnedServer = (entry: unknown) => JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } })
const UNPINNED_SHAPES: Record<string, unknown> = {
  'a GitHub spec': { command: 'npx', args: ['-y', 'github:macula-io/macula-mcp'] },
  'a git+https spec': { command: 'npx', args: ['-y', 'git+https://github.com/macula-io/macula-mcp.git'] },
  'an http server': { type: 'http', url: 'https://mesh.example.invalid/mcp' },
  'an sse server': { type: 'sse', url: 'https://mesh.example.invalid/sse' },
  'a shell wrapper': { command: 'sh', args: ['-c', `npx -y "${MESH_SERVER_PACKAGE}"@latest`] },
  'a package named in a variable': { command: 'sh', args: ['-c', 'npx -y "$P"'], env: { P: `${MESH_SERVER_PACKAGE}@latest` } },
  'a global bin': { command: 'macula-mcp', args: [] },
  'the package at latest': { command: 'npx', args: ['-y', `${MESH_SERVER_PACKAGE}@latest`] },
}

// The pin itself is recorded; only its env changes what runs (PR 59 r=2).
const pinnedAt = (env: Record<string, string>) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  return { ...memberShapeAt(recorded.server_version), env }
}
UNPINNED_SHAPES['a recorded pin with a library preloaded'] = pinnedAt({ LD_PRELOAD: '/x.so' })
UNPINNED_SHAPES['a recorded pin with its global prefix changed'] = pinnedAt({ PREFIX: '/x' })

// npx cannot run these: the recorded package has no bin of that name, or
// several bins and none it would pick, so each is refused by name before start.
for (const recorded of RECORDED_MESH_SERVERS) {
  UNPINNED_SHAPES[`${recorded.server_version} with no bin named`] = { command: 'npx', args: ['-y', `${MESH_SERVER_PACKAGE}@${recorded.server_version}`] }
  UNPINNED_SHAPES[`${recorded.server_version} with a bin it does not have`] = {
    command: 'npx',
    args: ['-y', '-p', `${MESH_SERVER_PACKAGE}@${recorded.server_version}`, `${MEMBER_BIN}-not-there`],
  }
}

// The package's other bins are tools, not the server (PR 59 r=4, Neptunus): the
// doctor spawns the commands every MCP client config names, register and
// uninstall rewrite host configs. Each is refused by name.
for (const recorded of RECORDED_MESH_SERVERS) {
  for (const tool of [`${MEMBER_BIN}-doctor`, `${MEMBER_BIN}-register`]) {
    UNPINNED_SHAPES[`${recorded.server_version} started as its tool ${tool}`] = {
      command: 'npx',
      args: ['-y', '-p', `${MESH_SERVER_PACKAGE}@${recorded.server_version}`, tool],
    }
  }
}

for (const [shape, entry] of Object.entries(UNPINNED_SHAPES)) {
  test(`an approved config whose server is ${shape} starts nothing, naming the server`, async (t) => {
    const place = placeFor(t, unpinnedServer(entry))
    const fake = fakeClaude(place)
    const lines: string[] = []
    const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines))
    // A launch that wrongly starts is stopped whole, so a failing run leaves no member behind.
    assert.equal(started.started, false)
    const refusal = started.started ? '' : started.refusal
    assert.ok(refusal.includes(`server ${SERVER_NAME}`), refusal)
    const bin = (entry as { args?: unknown[] }).args?.[3]
    if (typeof bin === 'string' && bin !== MEMBER_BIN) assert.ok(refusal.includes(bin), refusal)
    assert.equal(existsSync(fake.ranFile), false)
    assert.deepEqual(readdirSync(place.relay_root), [])
    assert.deepEqual(readdirSync(place.snapshot_root), [])
    assert.deepEqual(lines, [refusal])
  })
}

// --- the mesh server it starts is the recorded tree (martha#65) -----------------
// A stand-in of a recorded version, with one bin as npx would pick it, served
// on the loopback: the launcher must not reach the real registry in a test.
const RECORDED_MARK = 'the recorded mesh server'
/** What the launcher's environment would load into the mesh server: the stand-in is asked about each. */
const NEVER_REACHES_THE_MESH_SERVER = ['NODE_OPTIONS', 'SOME_ADDON_PREBUILD', RELAY_SOCKET_VARIABLE] as const
/**
 * The only variables the stand-in answers with: the ones a test asks whether
 * they reached the server. Never its whole environment, which is whatever the
 * person running the suite has, secrets included (martha#92).
 * It copies the environment by a spread, the one whole-environment read the
 * recorder lists (prove_the_mesh_server_bytes.ts), and picks from the copy.
 * It answers every name it is asked, null for one it was not started with, so a
 * check on a name it was never asked about fails instead of reading it as absent.
 */
const ASKED_OF_THE_STAND_IN = [...NEVER_REACHES_THE_MESH_SERVER, PLUGIN_DIRS_VARIABLE] as const
const STAND_IN_ANSWER = [
  `const asked = ${JSON.stringify(ASKED_OF_THE_STAND_IN)}`,
  'const started = { ...process.env }',
  'process.stderr.write(JSON.stringify(Object.fromEntries(asked.map((name) => [name, started[name] ?? null]))))',
].join('\n')

async function recordedTreeOf(t: TestContext, version: string): Promise<{ registry: FakeRegistry; recording: MeshTreeRecording }> {
  const registry = await fakeNpmRegistry([
    { name: MESH_SERVER_PACKAGE, version, bin: { 'macula-mcp': 'dist/index.js' }, files: { 'dist/index.js': `console.log('${RECORDED_MARK}')\n${STAND_IN_ANSWER}\n` } },
  ])
  t.after(() => registry.stop())
  const scratch = mkdtempSync(join(tmpdir(), 'martha-65-record-'))
  t.after(() => removeTheTree(scratch))
  const recording: MeshTreeRecording = { _why: 'test', registry: registry.registry, known_settings: [], known_environment_reads: {}, versions: [] }
  const tree = recordMeshTree({ tarball: registry.tarballOf(MESH_SERVER_PACKAGE), recording, scratch })
  return { registry, recording: { ...recording, versions: [tree] } }
}

const serverConfigIn = (argsFile: string) => {
  const args = readFileSync(argsFile, 'utf8').split('\n')
  const path = args[args.indexOf(MCP_CONFIG_SWITCH) + 1]
  assert.ok(path !== undefined)
  return JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, { command: string; args: string[] }> }
}

test('an approved config that installs a recorded mesh server version starts the member on the recorded tree, by path', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, [], recording))
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes(MCP_CONFIG_SWITCH), t)
  const entry = serverConfigIn(fake.argsFile).mcpServers.macula
  assert.ok(entry !== undefined)
  assert.equal(entry.command, process.execPath, 'npx is never what starts the mesh server')
  // Started by path, confined to its tree by the launcher's hook (martha#73).
  assert.equal(entry.args.at(-1), join(realpathSync(place.mesh_servers), recorded.server_version, DEPENDENCIES, MESH_SERVER_PACKAGE, 'dist', 'index.js'))
  // What the stand-in writes is captured, never let through into the run (martha#92).
  const run = spawnSync(entry.command, entry.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), RECORDED_MARK)
  started.stop('the test is over')
  await started.stopped
})

/** Starts a member on the fake host, posts its session start over the relay socket, and returns what the record holds. */
async function pathsRecordedAtStart(t: TestContext, place: Place, mesh_trees?: MeshTreeRecording): Promise<string[]> {
  const fake = fakeClaude(place)
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, [], mesh_trees))
  assert.ok(started.started, started.started ? '' : started.refusal)
  if (!started.started) return []
  await until('the fake host to start', () => existsSync(fake.envFile) && readFileSync(fake.envFile, 'utf8') !== '', t)
  const reply = await fetchOverSocket(`${RELAY_ORIGIN}${RELAY_PATHS.session_started}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(start('startup')),
    socketPath: readFileSync(fake.envFile, 'utf8'),
  })
  assert.equal(reply.text, '{"taken":1}')
  const paths = await recordedPaths(rowStreamsDirectory(place.rows))
  started.stop('the test is over')
  await started.stopped
  return paths
}

test('the launcher records an approved hook\'s output and a non-mesh server\'s block at the session start (A7, A11, martha#121)', async (t) => {
  const hook = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo from the checkout' }] }] } })
  const place = placeFor(t, SERVERS, { '.claude/settings.json': hook })
  assert.deepEqual(
    (await pathsRecordedAtStart(t, place)).sort(),
    [`${PATH_OF_SOURCE.checkout_hook}:null`, `${PATH_OF_SOURCE.server_instructions}:null`].sort(),
  )
})

test('a launch whose only server is the recorded mesh server, and no hook, records nothing at the start (martha#121)', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  assert.deepEqual(await pathsRecordedAtStart(t, place, recording), [])
})

test('what the launcher\'s environment would load into the mesh server never reaches it (#65 r=2)', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const ran = join(place.home, 'preload-ran')
  const preload = join(place.home, 'preload.cjs')
  writeFileSync(preload, `require('node:fs').appendFileSync(${JSON.stringify(ran)}, 'x')\n`)
  const launch = memberLaunch(place, fake.command, place.approved, [], recording)
  const shellPrefix = join(place.home, 'wrap.sh')
  const planted = {
    ...launch,
    inherited: { ...launch.inherited, NODE_OPTIONS: `--require ${preload}`, SOME_ADDON_PREBUILD: place.home, CLAUDE_CODE_SHELL_PREFIX: shellPrefix },
  }
  const started = await aMemberStartedIn(t, place, planted)
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes(MCP_CONFIG_SWITCH), t)
  // The host's own environment, read from the kernel, under the entry's env: how Claude Code starts a server.
  const hostEnv = (await environmentOf(started.pid, inTest(t))) ?? {}
  assert.equal(hostEnv.NODE_OPTIONS, `--require ${preload}`, 'the host itself was given the planted preload')
  assert.equal(Object.hasOwn(hostEnv, 'CLAUDE_CODE_SHELL_PREFIX'), false, 'the host is never given a prefix it would run every server through (#65 r=3)')
  const entry = serverConfigIn(fake.argsFile).mcpServers.macula as { command: string; args: string[]; env?: Record<string, string> } | undefined
  assert.ok(entry !== undefined)
  const run = spawnSync(entry.command, entry.args, { env: { ...hostEnv, ...entry.env }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), RECORDED_MARK, run.stderr)
  assert.equal(existsSync(ran), false, 'the preload never ran in the server')
  const seen = JSON.parse(run.stderr.trim().split('\n').at(-1) ?? '{}') as Record<string, string | null>
  for (const name of NEVER_REACHES_THE_MESH_SERVER) {
    assert.ok(Object.hasOwn(seen, name), `the stand-in was never asked about ${name}`)
    assert.ok(!seen[name], `${name} reached the server as ${seen[name]}`)
  }
  started.stop('the test is over')
  await started.stopped
})

// --- what Claude Code's settings files add to a server's environment (#65 r=3) ---
// The host gives every server its own environment, then the env of each settings
// file it loaded: the owner's user settings and the approved --settings copy.

const USER_SETTINGS = join(CLAUDE_FOLDER, USER_SETTINGS_FILE)
const settingsWithEnv = (env: Record<string, string>) => JSON.stringify({ env })

async function refusedLeavingNothing(t: TestContext, place: Place, launch: Parameters<typeof launchClaudeCodeMember>[0], ranFile: string): Promise<string> {
  const lines: string[] = []
  const started = await aMemberStartedIn(t, place, { ...launch, tellOwner: (line) => void lines.push(line) })
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.equal(existsSync(ranFile), false)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.deepEqual(lines, [refusal])
  return refusal
}

// --- a config folder of the member's own (martha#602, T1) -----------------------
// Everything the owner's user settings could carry, which the gate refused while the member's host read that file:
// with a folder of its own the member starts, its host is pointed at that folder and at the owner's default sign-in
// store, and the owner's file is neither read into it nor changed.

/** The running member's own config folder: the one launch directory under the snapshot root, and its member folder. */
function membersOwnConfig(place: Place): string {
  const launches = readdirSync(place.snapshot_root)
  assert.equal(launches.length, 1, `the snapshot root holds ${launches.join(', ')}`)
  return join(place.snapshot_root, launches[0] ?? '', MEMBER_CONFIG_FOLDER)
}

test("whatever the owner's user settings carry, the member starts on a config folder of its own and the owner's default sign-in store (martha#602)", async (t) => {
  assert.ok(HOOKS_OFF !== undefined)
  const [SAFE_MODE_VARIABLE] = CLAUDE_CODE_HOOK_SWITCHES.safe_mode.variables
  assert.ok(SAFE_MODE_VARIABLE !== undefined)
  const place = placeFor(t)
  const owners = writeSettings(join(place.home, USER_SETTINGS), {
    hooks: { SessionStart: [OWNER_HOOK], PreToolUse: [OWNER_HOOK] },
    enabledPlugins: { [OWNER_PLUGIN]: true },
    [HOOKS_OFF]: true,
    env: {
      [PLUGIN_DIRS_VARIABLE]: join(place.home, 'plugins'),
      [SAFE_MODE_VARIABLE]: '1',
      FROM_SETTINGS: 'x',
      ...Object.fromEntries([...Object.keys(CLAUDE_MEMORY_OFF), ...CLAUDE_MEMORY_ELSEWHERE].map((name) => [name, '0'])),
    },
  })
  const before = readFileSync(owners, 'utf8')
  const fake = fakeClaudeThatSaysHowItStarted(place)
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved))
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to write what it was started with', () => existsSync(fake.envFile), t)
  const env = environmentOfDump(readFileSync(fake.envFile, 'utf8'))
  const own = membersOwnConfig(place)
  assert.equal(env[CONFIG_DIR_VARIABLE], own, "the member's host reads its config from its own folder")
  assert.equal(env[CLAUDE_CODE_SIGN_IN_STORE_VARIABLE], '', "the member's host is signed in from the owner's default store, set and empty")
  assert.ok(own.startsWith(`${place.snapshot_root}/`), `${own} is not inside the launch's own directory`)
  assert.deepEqual(JSON.parse(readFileSync(join(own, USER_SETTINGS_FILE), 'utf8')), MEMBERS_OWN_SETTINGS)
  assert.equal(readFileSync(owners, 'utf8'), before, "the owner's user settings are not changed")
  started.stop('the test is over')
  await started.stopped
  assert.deepEqual(readdirSync(place.snapshot_root), [], "the member's folder goes with its launch")
})

test('a name in the approved --settings env nobody approved starts nothing, naming it', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version), { [USER_SETTINGS]: settingsWithEnv({ FROM_SETTINGS: 'x' }) })
  const fake = fakeClaude(place)
  const refusal = await refusedLeavingNothing(t, place, memberLaunch(place, fake.command, place.approved, [], recording), fake.ranFile)
  assert.ok(refusal.includes(USER_SETTINGS) && refusal.includes('FROM_SETTINGS'), refusal)
})

for (const [shape, configDir] of [
  ['empty', ''],
  ['relative', CLAUDE_FOLDER],
] as const) {
  test(`a CLAUDE_CONFIG_DIR that is ${shape} starts nothing, naming the variable (#65 r=4)`, async (t) => {
    const recorded = RECORDED_MESH_SERVERS[0]
    assert.ok(recorded !== undefined)
    const { recording } = await recordedTreeOf(t, recorded.server_version)
    const place = placeFor(t, meshServerAt(recorded.server_version))
    const fake = fakeClaude(place)
    const launch = memberLaunch(place, fake.command, place.approved, [], recording)
    const refusal = await refusedLeavingNothing(t, place, { ...launch, inherited: { ...launch.inherited, CLAUDE_CONFIG_DIR: configDir } }, fake.ranFile)
    assert.ok(refusal.includes(CONFIG_DIR_VARIABLE), refusal)
  })
}

// --- settings that turn Martha's relay off (martha#122) -------------------------

const [HOOKS_OFF] = CLAUDE_CODE_HOOK_SWITCHES.every_source
const MANAGED_ONLY = CLAUDE_CODE_HOOK_SWITCHES.managed.filter((key) => !CLAUDE_CODE_HOOK_SWITCHES.every_source.includes(key))

function writeSettings(path: string, settings: Record<string, unknown>): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings))
  return path
}

async function hookLaunchRefused(t: TestContext, plant: (place: Place) => string, key: string, files: Readonly<Record<string, string>> = {}): Promise<void> {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version), files)
  const fake = fakeClaude(place)
  const file = plant(place)
  const refusal = await refusedLeavingNothing(t, place, memberLaunch(place, fake.command, place.approved, [], recording), fake.ranFile)
  assert.ok(refusal.includes(file) && refusal.includes(key), refusal)
}

test('a hook-killing key in the approved --settings copy starts nothing, naming it and the key', async (t) => {
  assert.ok(HOOKS_OFF !== undefined)
  await hookLaunchRefused(t, () => USER_SETTINGS, HOOKS_OFF, { [USER_SETTINGS]: JSON.stringify({ [HOOKS_OFF]: true }) })
})

for (const key of MANAGED_ONLY) {
  test(`${key} in the managed settings file, or in a file of its drop-in folder, starts nothing, naming the file and the key`, async (t) => {
    const { file, drop_in } = RECORDED_HOST.managed_settings
    await hookLaunchRefused(t, (place) => writeSettings(join(managedSettingsOf(place).dir, file), { [key]: true }), key)
    await hookLaunchRefused(t, (place) => writeSettings(join(managedSettingsOf(place).dir, drop_in, '50-org.json'), { [key]: true }), key)
  })
}

test("a member's file tool call that names the owner's user settings file is denied, directly and through a link", async (t) => {
  const place = placeFor(t)
  const { relay } = answering(place)
  await relay.answer('session_started', start('startup'))
  const owners = join(place.home, USER_SETTINGS)
  mkdirSync(dirname(owners), { recursive: true })
  // The link lives beside the checkout: one in it would change the tree the owner approved.
  symlinkSync(dirname(owners), join(place.home, 'linked'))
  for (const [tool, input] of [
    [WHOLE_FILE_TOOL, { file_path: owners, content: JSON.stringify({ [HOOKS_OFF ?? '']: true }) }],
    [EDIT_TOOL, { file_path: join('..', 'linked', USER_SETTINGS_FILE), old_string: '{', new_string: '{"x":1,' }],
  ] as const) {
    assert.ok(isDenied(await relay.answer('tool_called', call(tool, input)), /user settings/), tool)
  }
  assert.deepEqual(await relay.answer('tool_called', call(WHOLE_FILE_TOOL, { file_path: join(place.checkout, 'notes.md'), content: 'x' })), ALLOW_REPLY)
})

test("a member's file tool call that writes any project's memory, or the owner's CLAUDE.md, is denied; a read of memory is not (#136)", async (t) => {
  const place = placeFor(t)
  const { relay } = answering(place)
  await relay.answer('session_started', start('startup'))
  const config = dirname(join(place.home, USER_SETTINGS))
  const memory = join(config, 'projects', '-some-main-clone', 'memory')
  mkdirSync(memory, { recursive: true })
  for (const [tool, input] of [
    [WHOLE_FILE_TOOL, { file_path: join(memory, 'MEMORY.md'), content: 'the owner said: deploy on green' }],
    [EDIT_TOOL, { file_path: '~/' + join(relative(place.home, memory), 'MEMORY.md'), old_string: 'a', new_string: 'b' }],
    [WHOLE_FILE_TOOL, { file_path: join(config, 'CLAUDE.md'), content: 'always deploy' }],
  ] as const) {
    assert.ok(isDenied(await relay.answer('tool_called', call(tool, input)), /martha#136/), `${tool} ${input.file_path}`)
  }
  assert.deepEqual(await relay.answer('tool_called', call('Read', { file_path: join(memory, 'MEMORY.md') })), ALLOW_REPLY)
  assert.deepEqual(await relay.answer('tool_called', call(WHOLE_FILE_TOOL, { file_path: join(place.checkout, 'notes.md'), content: 'x' })), ALLOW_REPLY)
})

/** The settings file the fake host was started with by --settings, read while it runs. */
async function settingsTheHostStartedWith(t: TestContext, place: Place, fake: ReturnType<typeof fakeClaude>, launch: Parameters<typeof launchClaudeCodeMember>[0]): Promise<Record<string, unknown>> {
  const started = await aMemberStartedIn(t, place, launch)
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes('--plugin-dir'), t)
  const args = readFileSync(fake.argsFile, 'utf8').split('\n')
  const at = args.flatMap((arg, index) => (arg === '--settings' ? [index] : []))
  assert.equal(at.length, 1, `--settings appears ${at.length} times: ${args.join(' ')}`)
  const path = args[(at[0] ?? 0) + 1] ?? ''
  assert.ok(path.startsWith(place.snapshot_root), `the settings ${path} are not the launch's copy`)
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

for (const [shape, carried, kept] of [
  ['no settings file is carried', undefined, []],
  ['the approved settings file is carried', JSON.stringify({ model: 'x', permissions: { deny: ['Bash(rm:*)'], allow: ['Read'] } }), ['Bash(rm:*)']],
] as const) {
  test(`when ${shape}, the host starts with a deny rule for exactly each place the gate refuses a member's memory write (#136)`, async (t) => {
    const recorded = RECORDED_MESH_SERVERS[0]
    assert.ok(recorded !== undefined)
    const { recording } = await recordedTreeOf(t, recorded.server_version)
    const place = placeFor(t, meshServerAt(recorded.server_version), carried === undefined ? {} : { [USER_SETTINGS]: carried })
    const fake = fakeClaude(place)
    const launch = memberLaunch(place, fake.command, place.approved, [], recording)
    const settings = await settingsTheHostStartedWith(t, place, fake, launch)
    // The member's environment names its own config folder (martha#602, T2): the rules cover that folder's places
    // and the owner's alike, so nothing the member writes in its own folder runs as code either.
    const member_env = { ...launch.inherited, ...theMembersConfigEnvironment(membersOwnConfig(place)) }
    // And Martha's own state root, whole (martha#619): the records of the owner's acts are no member's to write.
    const places = ownerMemoryPlaces({ launcher_env: launch.inherited, member_env, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home), martha_state_root: place.state_root })
    const ownersOnly = ownerMemoryPlaces({ launcher_env: launch.inherited, member_env: launch.inherited, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home) })
    assert.ok(memoryDenyRules(places).length > memoryDenyRules(ownersOnly).length, "the member's own folder adds rules of its own")
    for (const rule of memoryDenyRules(ownersOnly)) assert.ok(memoryDenyRules(places).includes(rule), `the owner's ${rule} is still denied`)
    const permissions = settings.permissions as { deny: string[]; allow?: string[] }
    assert.ok(permissions.deny.includes(`Edit(/${realPathOf(place.state_root)}/**)`), "the host starts with no rule denying Martha's state root")
    assert.deepEqual(permissions.deny, [...kept, ...memoryDenyRules(places)])
    if (carried !== undefined) {
      assert.equal(settings.model, 'x')
      assert.deepEqual(permissions.allow, ['Read'])
    }
    // The other way: every rule's place is one the gate refuses a member's write into.
    for (const rule of memoryDenyRules(places)) {
      const glob = /^(?:Write|Edit)\(\/(.*)\)$/.exec(rule)?.[1]
      assert.ok(glob !== undefined, rule)
      const inside = glob.replace('/*/', '/some-project/').replace(/\/\*\*$/, '/note.md')
      assert.ok(writesTheOwnersMemory(WHOLE_FILE_TOOL, { file_path: inside }, places, place.checkout, place.home, thisMachine) !== undefined, `${rule}: ${inside}`)
    }
  })
}

test('a carried settings file whose permissions.deny is not a list starts nothing, naming it (#136)', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version), { [USER_SETTINGS]: JSON.stringify({ permissions: { deny: CLAUDE_CODE_SHELL_TOOL } }) })
  const fake = fakeClaude(place)
  const refusal = await refusedLeavingNothing(t, place, memberLaunch(place, fake.command, place.approved, [], recording), fake.ranFile)
  assert.ok(refusal.includes(USER_SETTINGS) && refusal.includes('permissions.deny'), refusal)
})

test("a call after which the owner's user settings carry a hook-killing key stops the member, naming the file and the key", async (t) => {
  assert.ok(HOOKS_OFF !== undefined)
  const place = placeFor(t)
  const { relay, stops } = answering(place)
  await relay.answer('session_started', start('startup'))
  const shell = call(CLAUDE_CODE_SHELL_TOOL, { command: 'python3 -c "..."' })
  assert.deepEqual(await relay.answer('tool_called', shell), ALLOW_REPLY)
  const file = writeSettings(join(place.home, USER_SETTINGS), { [HOOKS_OFF]: true })
  const after = await relay.answer('tool_answered', shell)
  assert.equal(after.answered, false)
  assert.equal(stops.length, 1)
  assert.ok(stops[0]?.includes(file) && stops[0].includes(HOOKS_OFF), stops[0] ?? 'no stop')
})

test("a hook-killing key written into the member's own settings while it runs stops it, with no tool call after the write (martha#602)", async (t) => {
  assert.ok(HOOKS_OFF !== undefined)
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command))
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to start', () => existsSync(fake.envFile) && readFileSync(fake.envFile, 'utf8') !== '', t)
  const posted = await fetchOverSocket(`${RELAY_ORIGIN}${RELAY_PATHS.session_started}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(start('startup')),
    socketPath: readFileSync(fake.envFile, 'utf8'),
  })
  assert.equal(posted.text, '{"taken":1}')
  // The host may drop its hooks once it reloads the file, so no hook asks again: the launcher must.
  const file = writeSettings(join(membersOwnConfig(place), USER_SETTINGS_FILE), { [HOOKS_OFF]: true })
  const stopped = await started.stopped
  const why = stopped.stopped_because ?? ''
  assert.ok(why.includes(file) && why.includes(HOOKS_OFF), why)
})

/** The recorded host's safe mode switches, read when a test asks. */
const safeMode = () => CLAUDE_CODE_HOOK_SWITCHES.safe_mode

/** A launch changed by `change` is refused, starts nothing, leaves nothing behind, and names each of `named`. */
async function safeModeLaunchRefused(
  t: TestContext,
  change: (launch: ReturnType<typeof memberLaunch>, place: Place) => ReturnType<typeof memberLaunch>,
  named: (place: Place) => readonly string[],
): Promise<void> {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const refusal = await refusedLeavingNothing(t, place, change(memberLaunch(place, fake.command, place.approved, [], recording), place), fake.ranFile)
  for (const name of named(place)) assert.ok(refusal.includes(name), `${name} not in: ${refusal}`)
  assert.ok(refusal.includes('turns off the hooks'), refusal)
}

test("safe mode in the launcher's own environment starts nothing, naming the variable", async (t) => {
  const [SAFE_MODE_VARIABLE] = safeMode().variables
  assert.ok(SAFE_MODE_VARIABLE !== undefined)
  await safeModeLaunchRefused(t, (launch) => ({ ...launch, inherited: { ...launch.inherited, [SAFE_MODE_VARIABLE]: '1' } }), () => [SAFE_MODE_VARIABLE])
})

test("safe mode among the owner's arguments starts nothing, naming the argument", async (t) => {
  const [SAFE_MODE_FLAG] = safeMode().flags
  assert.ok(SAFE_MODE_FLAG !== undefined)
  await safeModeLaunchRefused(t, (launch) => ({ ...launch, args: [...launch.args, SAFE_MODE_FLAG] }), () => [SAFE_MODE_FLAG])
})

// --- hooks and plugins the owner's user or managed settings declare (martha#121, finding 1) ---

const OWNER_HOOK = { matcher: '', hooks: [{ type: 'command', command: 'echo from-the-owner' }] }
const OWNER_PLUGIN = 'formatter@tools'

/**
 * Each settings file the admin holds, by name, and where it lies under a test's place. The owner's user settings are
 * no longer one: the member reads its own (martha#602), whose launch-time contents are Martha's.
 */
const OWNERS_FILES: readonly (readonly [string, (place: Place) => string])[] = [
  ['the managed settings file', (place) => join(managedSettingsOf(place).dir, RECORDED_HOST.managed_settings.file)],
  ['a file of the managed drop-in folder', (place) => join(managedSettingsOf(place).dir, RECORDED_HOST.managed_settings.drop_in, '50-org.json')],
]

for (const [which, pathOf] of OWNERS_FILES) {
  test(`a hook only in ${which} starts nothing, naming the file and the event`, async (t) => {
    await hookLaunchRefused(t, (place) => writeSettings(pathOf(place), { hooks: { SessionStart: [OWNER_HOOK] } }), 'SessionStart')
  })

  test(`a plugin only in ${which} starts nothing, naming the file and the plugin`, async (t) => {
    await hookLaunchRefused(t, (place) => writeSettings(pathOf(place), { enabledPlugins: { [OWNER_PLUGIN]: true } }), OWNER_PLUGIN)
  })

  test(`a plugin folder in the env of ${which} starts nothing, naming the file and the variable`, async (t) => {
    await hookLaunchRefused(t, (place) => writeSettings(pathOf(place), { env: { [PLUGIN_DIRS_VARIABLE]: join(place.home, 'plugins') } }), PLUGIN_DIRS_VARIABLE)
  })

  // T4: the host applies a settings file's env, so this could point the member back at the owner's folder.
  for (const name of [CONFIG_DIR_VARIABLE, CLAUDE_CODE_SIGN_IN_STORE_VARIABLE]) {
    test(`${name} in the env of ${which} starts nothing, naming the file and the variable (martha#602)`, async (t) => {
      await hookLaunchRefused(t, (place) => writeSettings(pathOf(place), { env: { [name]: join(place.home, CLAUDE_FOLDER) } }), name)
    })
  }
}

test("a plugin folder in the launcher's own environment starts nothing, naming the variable", async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const launch = memberLaunch(place, fake.command, place.approved, [], recording)
  const refusal = await refusedLeavingNothing(t, place, { ...launch, inherited: { ...launch.inherited, [PLUGIN_DIRS_VARIABLE]: join(place.home, 'plugins') } }, fake.ranFile)
  assert.ok(refusal.includes(PLUGIN_DIRS_VARIABLE), refusal)
})

test('an empty user settings file, or one whose hooks and plugins are empty or off, starts the member', async (t) => {
  for (const settings of [{}, { hooks: {}, enabledPlugins: {} }, { hooks: { SessionStart: [] }, enabledPlugins: { [OWNER_PLUGIN]: false } }]) {
    const place = placeFor(t)
    writeSettings(join(place.home, USER_SETTINGS), settings)
    const fake = fakeClaude(place)
    const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command))
    if (!started.started) assert.fail(`${JSON.stringify(settings)}: ${started.refusal}`)
    started.stop('the test is over')
    await started.stopped
  }
})

test("a hook written into the member's own settings while it runs stops it, naming the file and the event (martha#602)", async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command))
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to start', () => existsSync(fake.envFile) && readFileSync(fake.envFile, 'utf8') !== '', t)
  const file = writeSettings(join(membersOwnConfig(place), USER_SETTINGS_FILE), { hooks: { UserPromptSubmit: [OWNER_HOOK] } })
  const stopped = await started.stopped
  const why = stopped.stopped_because ?? ''
  assert.ok(why.includes(file) && why.includes('UserPromptSubmit'), why)
})

test('a mesh server tree changed since it was installed starts nothing, naming the file, and leaves nothing behind', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const first = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, [], recording))
  assert.ok(first.started, first.started ? '' : first.refusal)
  first.stop('the test is over')
  await first.stopped
  rmSync(fake.ranFile, { force: true })

  const changed = join(DEPENDENCIES, MESH_SERVER_PACKAGE, 'dist', 'index.js')
  writeFileSync(join(place.mesh_servers, recorded.server_version, changed), "console.log('planted')\n")
  const lines: string[] = []
  const second = await aMemberStartedIn(t, place, memberLaunch(place, fake.command, place.approved, lines, recording))
  assert.equal(second.started, false)
  const refusal = second.started ? '' : second.refusal
  assert.ok(refusal.includes(changed), refusal)
  assert.equal(existsSync(fake.ranFile), false)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.deepEqual(lines, [refusal])
})

/**
 * The relay folder a running launch gave its host: the installed relay's files byte for byte, read-only, and the
 * folder the host's loader was asked about, already filled (martha#117 with #104).
 */
function assertTheLaunchsCopy(plugin_dir: string, validatedFile: string): void {
  for (const file of relayCopy.RELAY_FILES) {
    assert.deepEqual(readFileSync(join(plugin_dir, file)), readFileSync(join(RELAY_PLUGIN_DIR, file)), file)
  }
  assert.equal(lstatSync(plugin_dir).mode & 0o777, relayCopy.RELAY_COPY_DIRECTORY_MODE)
  assert.equal(readFileSync(validatedFile, 'utf8'), `${plugin_dir} held\n`)
}

test('an approved launch starts the host with the switches and the relay, and a refusal after a call kills its whole group', async (t) => {
  const place = placeFor(t)
  const validatedFile = join(place.home, 'validated')
  const fake = fakeClaude(place, { validatedFile })
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command))
  assert.equal(started.started, true)
  if (!started.started) return
  t.after(() => {
    try {
      process.kill(-started.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  })
  await until('the fake host to start', () => existsSync(fake.childFile) && readFileSync(fake.childFile, 'utf8').trim() !== '', t)

  const args = readFileSync(fake.argsFile, 'utf8').trimEnd().split('\n')
  const snapshot = readdirSync(place.snapshot_root)
  assert.equal(snapshot.length, 1)
  const socket_path = readFileSync(fake.envFile, 'utf8')
  // The host is given this launch's read-only copy of the relay, never the installed folder (martha#117).
  const plugin_dir = join(dirname(socket_path), relayCopy.RELAY_COPY_NAME)
  assert.notEqual(plugin_dir, RELAY_PLUGIN_DIR)
  assert.deepEqual(args, [
    '-p',
    'the owner prompt',
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    MCP_CONFIG_SWITCH,
    join(place.snapshot_root, snapshot[0] ?? '', '.mcp.json'),
    // Written by the launch when none is carried: the rules that keep the host's own writes out of the owner's memory (martha#136).
    '--settings',
    join(place.snapshot_root, snapshot[0] ?? '', CLAUDE_FOLDER, USER_SETTINGS_FILE),
    '--plugin-dir',
    plugin_dir,
  ])
  assertTheLaunchsCopy(plugin_dir, validatedFile)
  assert.equal(dirname(dirname(socket_path)), place.relay_root)
  assert.equal(lstatSync(dirname(socket_path)).mode & 0o777, RELAY_DIRECTORY_MODE)
  assert.equal(Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(started.pid)], { encoding: 'utf8' }).trim()), started.pid)
  assert.deepEqual(
    launchRecordsDirectory(place.launch_records).all().map((record) => record.key),
    ['Mercury'],
  )

  // The checkout changes under a running member: the next after-call check kills the group.
  const child = Number(readFileSync(fake.childFile, 'utf8').trim())
  const post = (event: RelayEvent, body: unknown) =>
    fetchOverSocket(`${RELAY_ORIGIN}${RELAY_PATHS[event]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      socketPath: socket_path,
    })
  assert.equal((await post('session_started', start('startup'))).text, '{"taken":1}')
  writeFileSync(join(place.checkout, 'README.md'), 'changed\n')
  await assert.rejects(post('tool_answered', call(CLAUDE_CODE_SHELL_TOOL, { command: 'git pull' })), 'the relay never gets an answer')

  const stopped = await started.stopped
  assert.equal(stopped.signal, 'SIGKILL')
  await until('the member\'s child to die with it', () => !isAlive(child), t)
  assert.deepEqual(launchRecordsDirectory(place.launch_records).all(), [])
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
})

test('a member that exits by itself leaves no record, socket or snapshot, and no child in its group', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  writeFileSync(fake.command, readFileSync(fake.command, 'utf8').replace('exec sleep 600', 'sleep 0.5; exit 3'))
  const started = await aMemberStartedIn(t, place, memberLaunch(place, fake.command))
  assert.equal(started.started, true)
  if (!started.started) return
  const stopped = await started.stopped
  assert.equal(stopped.exit_code, 3)
  const child = Number(readFileSync(fake.childFile, 'utf8').trim())
  await until('the child left in the group to be killed', () => !isAlive(child), t)
  assert.deepEqual(launchRecordsDirectory(place.launch_records).all(), [])
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
})

/** The process group of a pid, or undefined when the process is gone. */
function groupOf(pid: number): number | undefined {
  try {
    return Number(readFileSync(`${PROC_ROOT}/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')[2])
  } catch {
    return undefined
  }
}

/**
 * Whether a process's environment names this relay root. A process caught inside
 * exec is waited on for a moment (#85); one whose environment stays empty past
 * that, which `env -i` can start, carries no relay root.
 */
async function carriesRelayRoot(pid: number, relay_root: string, read: ProcRead = readProc): Promise<boolean> {
  const environment = await environmentOf(pid, withinCleanupBound(CLEANUP_SETTLE_MS), read)
  return environment?.[RELAY_SOCKET_VARIABLE]?.startsWith(`${relay_root}/`) ?? false
}

/**
 * Sends SIGKILL to the group of every process whose environment names this
 * relay root: the member and everything it started carry its socket's path,
 * whether or not it got as far as writing any file. Never this test's own group.
 */
async function killGroupsCarrying(relay_root: string): Promise<void> {
  const own = groupOf(process.pid)
  for (const entry of readdirSync(PROC_ROOT)) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 1) continue
    if (!(await carriesRelayRoot(pid, relay_root))) continue
    const group = groupOf(pid)
    if (group === undefined || group <= 1 || group === own) continue
    try {
      process.kill(-group, 'SIGKILL')
    } catch {
      // The group is gone already.
    }
  }
}

/** Every process this user has that names this relay root in its environment. */
async function pidsCarrying(relay_root: string): Promise<number[]> {
  const found: number[] = []
  for (const entry of readdirSync(PROC_ROOT)) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid <= 1) continue
    if (await carriesRelayRoot(pid, relay_root)) found.push(pid)
  }
  return found
}

/**
 * What one look at the place sees: every pid that still carries its relay root, and the launcher, which carries none
 * (martha#216). A look reads the processes that exist when it begins, so it is a photograph, never a watch.
 */
type ALook = () => Promise<number[]>

/**
 * Waits, within cleanup's own bound, for nothing to carry the relay root any more, and answers the pids that outlast
 * the wait: those are the ones a test left behind (martha#216).
 *
 * The bound is on how long a process is waited for, never on how long a look may take: a look reads every process's
 * environment, and one caught in `exec` holds the look for up to CLEANUP_SETTLE_MS (martha#85), so a busy machine can
 * spend the whole bound inside one look and end the wait on a photograph taken before anything was looked for.
 *
 * A look that finds nothing is followed by one more (martha#466): the photograph it took is of the processes that
 * existed when it began, so a process forked while it ran is in neither its list nor the one before it, and believing
 * the first quiet photograph failed a run on a process that was only on its way out.
 */
async function waitForNothingToCarry(look: ALook): Promise<number[]> {
  const deadline = Date.now() + CLEANUP_SETTLE_MS * 4
  while (Date.now() < deadline) {
    if (await nothingCarriesTwice(look)) return []
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return look()
}

/**
 * Whether two looks in a row found nothing. The second is taken after the first has ended, so a process forked while
 * the first ran — which that look's own list does not hold — is seen by it (martha#466). A first look that finds
 * something is answered without a second: it is not quiet, and the wait goes on.
 */
async function nothingCarriesTwice(look: ALook): Promise<boolean> {
  if ((await look()).length > 0) return false
  return (await look()).length === 0
}

/** Waits for every process that still carries this relay root to be gone, and answers the ones that outlast it. */
async function noProcessCarries(relay_root: string, alsoGone: readonly number[]): Promise<number[]> {
  return waitForNothingToCarry(async () => [
    ...(await pidsCarrying(relay_root)),
    ...alsoGone.filter((pid) => pid > 1 && isAlive(pid)),
  ])
}

/** Whether a process's command line names this home: false for one the kernel will not say, which is one already gone. */
function namesTheHome(pid: number, home: string): boolean {
  try {
    return readFileSync(`${PROC_ROOT}/${pid}/cmdline`, 'utf8').includes(home)
  } catch {
    return false
  }
}

/**
 * Every process of this user, but this test's own, whose command line names this place's home: a launcher names its
 * script there, its shell names the launcher, the terminal `script` names the shell, and a member started on the
 * terminal names its own fake host there. One look, taken over the processes that exist when it begins.
 */
function pidsNamingTheHome(home: string): number[] {
  return readdirSync(PROC_ROOT)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1 && pid !== process.pid && namesTheHome(pid, home))
}

/**
 * Kills every process of this user whose command line names this place's home, and waits a moment for them to go: a
 * launcher names its script there, and that script is the one file of the place a running process holds open. Used by the
 * place's own hook when a marked place has no removal registered, so a test body that stops early leaves nothing behind
 * (martha#216 r=3).
 */
async function killWhateverNamesTheHome(home: string): Promise<void> {
  for (const pid of pidsNamingTheHome(home)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process is gone already.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS * 5))
}

/**
 * The place's home goes once nothing is left writing in it (martha#216): a test that starts its member in a process of
 * its own has to kill that process and wait for its member before the home the host was writing in can be removed.
 * `alsoGone` names pids that carry no relay root of their own, such as a launcher killed by its pid.
 *
 * Whatever still holds the home when it is due is killed here, so a red run never leaves a member behind, and the test
 * then fails by name naming those pids: a home that goes under a running host is never again only an occasioned
 * ENOTEMPTY (martha#216). A pid is named only once it has outlasted the wait that the look before it began: a process
 * that is on its way out is waited for, never named (martha#466).
 */
async function theHomeGoes(place: Pick<Place, 'home' | 'relay_root'>, alsoGone: readonly number[] = []): Promise<void> {
  const left = await noProcessCarries(place.relay_root, alsoGone)
  await killGroupsCarrying(place.relay_root)
  removeTheTree(place.home)
  if (left.length > 0) {
    throw new Error(`the place's home was due for removal while ${left.join(', ')} still held it: a test that starts a member in a process of its own marks the place, and removes the home after that process has gone (martha#216)`)
  }
}

/**
 * The removal for a test that started its member in a process of its own (martha#216). Registered AFTER the hook that
 * kills that process and waits for it, so it runs after that hook has done so: hooks run in registration order, each
 * awaited before the next.
 */
const thePlaceGoesWithItsProcesses = (t: TestContext, place: Place): void => {
  place.aRemovalIsRegistered()
  t.after(() => theHomeGoes(place))
}

test('a quiet look is not a watch: a second look in a row is what ends the wait (martha#466)', async () => {
  // One look reads the processes that exist when it begins, so a quiet one may simply have been taken before the one
  // that was leaving was forked. The wait may end only on two quiet looks in a row, so a place that is quiet every
  // time is looked at exactly twice: a wait that stopped on the first quiet look would take one.
  let looks = 0
  const left = await waitForNothingToCarry(async () => {
    looks += 1
    return []
  })
  assert.deepEqual(left, [])
  assert.equal(looks, 2, 'the wait ended on one quiet look, which is the photograph that can miss a process forked while it ran')
})

test('the removal waits for a process that is only on its way out, and does not name it (martha#466)', async () => {
  // The looks a busy machine can hand the wait: the first quiet, then — in the one look that closes the window a
  // photograph leaves — a process that is already leaving, gone by the look after. Nothing was left behind, so nothing
  // is named, and a run that changed nothing is not failed for it. The first quiet look is not believed, which is what
  // lets the second one see the process at all.
  const looks = [[], [41234], []]
  let at = 0
  const left = await waitForNothingToCarry(async () => looks[at++] ?? [])
  assert.deepEqual(left, [])
  assert.ok(at > 1, 'the wait ended on the first quiet look and so never saw the process the look after it found')
})

test('the removal names a process that outlasts its wait (martha#216)', async () => {
  // A member a test never stopped is there every time the wait looks: it is named, never passed over.
  const left = await waitForNothingToCarry(async () => [41234])
  assert.deepEqual(left, [41234])
})

/**
 * A launcher in a process of its own, started on this place, that says when its
 * member runs, and stops it on SIGUSR2 the way a refusal does. It stays up after
 * its member has stopped, until it is ended — unless `staysUp` is false, which is
 * how a test asks whether a launch that never got a member still ends by itself
 * (#472): the interval that keeps this one up is the only thing between a refused
 * launch and a process that exits, so a test that keeps the interval proves nothing.
 *
 * It is the run's, too (#559): the run's end is read from the pipe `runEndsAt` names, and when it comes this process
 * stops its member, ends the shell that waits on it, removes the home and ends itself. `runEndsAt` is the run this file
 * is unless a test plays a run of its own and is killed to see it happen.
 */
/** The owner's arguments a launcher process passes unless told otherwise: one prompt, answered and printed. */
const OWNER_PROMPT_ARGS = ['-p', 'the owner prompt']

function launcherProcess(
  place: Place,
  command: string,
  stdio: 'ignore' | 'inherit' = 'ignore',
  inherited: Readonly<Record<string, string>> = {},
  mesh_trees?: MeshTreeRecording,
  deadlines: SessionStartDeadlines = {},
  args: readonly string[] = OWNER_PROMPT_ARGS,
  staysUp = true,
  runEndsAt: string = THE_RUNS_END,
): string {
  // A member runs here, in a process this one does not own: the place's own hook leaves the removal to this test, which
  // alone can wait for that process before the home goes (martha#216).
  place.aMemberStartsHere()
  const script = join(place.home, 'launcher.ts')
  const launchModule = new URL('./launch_a_claude_code_member.ts', import.meta.url).href
  const endsWithItsRunModule = new URL('../../prove_the_core/a_launcher_ends_with_its_run.ts', import.meta.url).href
  writeFileSync(
    script,
    [
      `import { launchClaudeCodeMember } from ${JSON.stringify(launchModule)}`,
      `import { endTheLauncherWhenItsRunGoes } from ${JSON.stringify(endsWithItsRunModule)}`,
      `const place = ${JSON.stringify(place)}`,
      'const starting = launchClaudeCodeMember({',
      "  member_name: 'Mercury',",
      `  node_id: ${JSON.stringify(NODE_ID)},`,
      `  place: { host: ${JSON.stringify(CLAUDE_CODE)}, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: place.approved, snapshot_root: place.snapshot_root },`,
      '  policy: { may_send_executable_text: [] },',
      '  places: { rows: place.rows, dashboard: place.dashboard, launch_records: place.launch_records, relay_root: place.relay_root, mesh_servers: place.mesh_servers, relay_journal: place.relay_journal, state_root: place.state_root },',
      ...(mesh_trees === undefined ? [] : [`  mesh_trees: ${JSON.stringify(mesh_trees)},`]),
      ...Object.entries(deadlines).map(([name, ms]) => `  ${name}: ${ms},`),
      `  command: ${JSON.stringify(command)},`,
      `  args: ${JSON.stringify(args)},`,
      // The place's own HOME and managed folder, so the settings files the launcher reads are the test's, never the developer's.
      `  managed_settings: ${JSON.stringify(managedSettingsOf(place))},`,
      `  inherited: { PATH: process.env.PATH, HOME: place.home, ...${JSON.stringify(inherited)} },`,
      `  stdio: ${JSON.stringify(stdio)},`,
      '  tellOwner: () => undefined,',
      '})',
      // Declared before the launch is waited on: a run that goes while a member is being admitted is answered as soon as
      // the launch settles, rather than never (#559).
      `endTheLauncherWhenItsRunGoes({ run_ends_at: ${JSON.stringify(runEndsAt)}, home: place.home, shell_noted_at: ${JSON.stringify(join(place.home, 'terminal', 'shell'))}, the_member: async () => { const made = await starting; return made.started ? made : undefined } })`,
      'const started = await starting',
      "if (started.started) process.once('SIGUSR2', () => started.stop('the test said so'))",
      "process.stdout.write(started.started ? `started ${started.pid}\\n` : `refused: ${started.refusal}\\n`)",
      "if (started.started) { const stopped = await started.stopped; process.stdout.write(`stopped ${stopped.signal ?? 'by itself'}\\n${stopped.stopped_because === null ? '' : `because ${stopped.stopped_because}\\n`}`) }",
      ...(staysUp ? ['setInterval(() => undefined, 1 << 30)'] : []),
      '',
    ].join('\n'),
  )
  return script
}

// Every signal a launcher can be ended by without its own say, including the two a terminal's hangup and its quit key
// send (martha#472): a launcher signalled directly cleans up exactly like one spoken to by martha stop.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT'] as const) {
  test(`${signal} to the launcher kills its member's group and leaves no socket or snapshot`, async (t) => {
    const place = placeFor(t)
    const fake = fakeClaude(place)
    const launcher = spawn(process.execPath, [launcherProcess(place, fake.command)], { stdio: ['ignore', 'pipe', 'inherit'] })
    const ended = new Promise<NodeJS.Signals | null>((resolve) => launcher.once('exit', (_code, by) => resolve(by)))
    // Before any assertion: a test that fails must not leave the member running.
    t.after(async () => {
      if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
      await ended
      await killGroupsCarrying(place.relay_root)
    })
    thePlaceGoesWithItsProcesses(t, place)
    let said = ''
    launcher.stdout.on('data', (chunk: Buffer) => void (said += chunk.toString()))
    await until('the launcher to start its member', () => said.includes('started') && existsSync(fake.childFile), t, () => said, () => REFUSED_LINE.exec(said)?.[0])
    assert.match(said, /^started \d+\n$/)
    assert.equal(readdirSync(place.relay_root).length, 1)
    assert.equal(readdirSync(place.snapshot_root).length, 1)
    const child = Number(readFileSync(fake.childFile, 'utf8').trim())
    const group = groupOf(child)
    assert.ok(
      group !== undefined && Number.isInteger(group) && group > 1 && group !== groupOf(process.pid) && group !== groupOf(launcher.pid ?? 0),
      'the member runs in a group of its own, which the group kill relies on',
    )

    launcher.kill(signal)
    assert.equal(await ended, signal, 'the signal still ends the launcher')
    await until('the member\'s group to be killed', () => !isAlive(child), t)
    assert.deepEqual(readdirSync(place.relay_root), [])
    assert.deepEqual(readdirSync(place.snapshot_root), [])
  })
}

// --- the run a member is started under (martha#472) ---------------------------------

/**
 * A host that answers as a stand-in does, ignores a terminal's hangup as a real one does — so no test can pass on the
 * fake's own death — and keeps a child in its group, as a tool server does. Given `park`, it waits before answering
 * anything until `waitFor` exists, saying in `parked` that it is waiting: the launcher is then provably parked in its
 * own questions, which is where a test puts the end of a run without racing it (#472).
 */
function fakeHostUnderARun(
  place: Place,
  park?: { readonly waitFor: string; readonly parked: string },
): { command: string; argsFile: string; readyFile: string; childFile: string } {
  const dir = join(place.home, 'fake-run')
  mkdirSync(dir)
  const files = { argsFile: join(dir, 'args'), readyFile: join(dir, 'ready'), childFile: join(dir, 'child') }
  const command = join(dir, CLAUDE)
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      ...(park === undefined ? [] : [`: > '${park.parked}'; while [ ! -e '${park.waitFor}' ]; do sleep 0.01; done`]),
      ...hostAnswers({ initAnswer: reportsOutputStyles(join(place.home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER)) }),
      // Its own pid, which `exec` keeps, so a test can tell the member from the process under it by which one it reads.
      `echo $$ > '${files.readyFile}'`,
      `printf '%s\\n' "$@" > '${files.argsFile}'`,
      // A host ignores a terminal's hangup, so nothing but the launcher's group kill can take it away (#472).
      `trap '' HUP`,
      'sleep 600 &',
      `echo $! > '${files.childFile}'`,
      'exec sleep 600',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return { command, ...files }
}

/** The group a process leads or belongs to, or nothing when it went while it was looked at. */
function groupOfOrNothing(pid: number): number | undefined {
  try {
    return groupOf(pid)
  } catch {
    return undefined
  }
}

/** Every process in `group`, as the kernel lists them. */
function pidsInGroup(group: number): number[] {
  return readdirSync(PROC_ROOT)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1 && groupOfOrNothing(pid) === group)
}

/** What one of a process's descriptors names, or nothing when it went with its process. */
function descriptorNames(pid: number, descriptor: string): string {
  try {
    return readlinkSync(`${PROC_ROOT}/${pid}/fd/${descriptor}`)
  } catch {
    return ''
  }
}

/** Every process in `group` that holds a descriptor naming `path`: the run's plumbing, if it reached the member (#472). */
function holdersInGroupOf(group: number, path: string): number[] {
  return pidsInGroup(group).filter((pid) => readdirSync(`${PROC_ROOT}/${pid}/fd`).some((descriptor) => descriptorNames(pid, descriptor) === path))
}

/**
 * Fails unless the member's environment names the pipe nowhere (#472). What it says when it fails is the entries that
 * name it and nothing else: that environment is the run's own, so every other entry of it is one of the owner's.
 */
function assertThePipeIsUnnamed(environment: readonly string[]): void {
  const naming = environment.filter((named) => named.startsWith(`${RUN_LIFELINE_VARIABLE}=`))
  assert.equal(naming.length, 0, `the member is handed no variable naming the pipe: ${JSON.stringify(naming)}`)
}

/**
 * How long a launcher's own answer to its run's end may take: a pipe closing and a group kill, not a host's pace
 * (#472). A wait for that answer with no bound would end as the harness's timeout, which names no assertion.
 */
const REACTS_WITHIN_MS = 25_000

/**
 * The session-start backstop's deadline, put beyond any wait a lifeline test holds: the backstop stops a host that never
 * reported its session, and a test that let it within its own run could not tell that stop from the lifeline's (#472).
 */
const BEYOND_ANY_WAIT_MS = 900_000

/** Waits for what a launcher reacts with, no longer than `ms`: true when it came. */
async function reactsWithin(holds: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (holds()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return holds()
}

test('a member handed a variable naming the pipe is failed by that entry alone, never by its whole environment (#472)', () => {
  const anOwnersOwn = 'AN_OWNERS_OWN_SECRET=what-no-log-carries'
  const naming = `${RUN_LIFELINE_VARIABLE}=${RUN_LIFELINE_FD}`
  assert.doesNotThrow(() => assertThePipeIsUnnamed(['PATH=/usr/bin', anOwnersOwn]), 'an environment naming no pipe passes')
  let said = ''
  try {
    assertThePipeIsUnnamed(['PATH=/usr/bin', naming, anOwnersOwn])
  } catch (error) {
    said = error instanceof Error ? error.message : String(error)
  }
  assert.ok(said.includes(naming), `the entry that names the pipe is what a failure says: ${said}`)
  assert.equal(said.includes(anOwnersOwn), false, `and never the rest of the member's environment: ${said}`)
})

test('a run that closes its lifeline takes its member down with it, leaving no relay directory, snapshot or record (#472)', async (t) => {
  const place = placeFor(t)
  const fake = fakeHostUnderARun(place)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-lifeline-'))
  const lifeline = keepTheLifelineIn(runtime)
  // The backstop is put beyond this test, so what stops the member can only be the lifeline's own end.
  const launcher = spawn(process.execPath, [launcherProcess(place, fake.command, 'ignore', lifeline.environment, undefined, { session_start_deadline_ms: BEYOND_ANY_WAIT_MS })], { stdio: lifeline.stdio })
  const ended = new Promise<number | null>((resolve) => launcher.once('exit', (code) => resolve(code)))
  // Before any assertion: a test that fails must not leave the member running.
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to start its member', () => said.includes('started') && existsSync(fake.childFile), t, () => said, () => REFUSED_LINE.exec(said)?.[0])
  const member = Number(readFileSync(fake.readyFile, 'utf8').trim())
  const child = Number(readFileSync(fake.childFile, 'utf8').trim())
  assert.equal(isAlive(member), true)
  assert.equal(isAlive(child), true)
  // The launcher took the pipe in close-on-exec and closed the number it was handed: nothing the member runs holds it.
  assert.deepEqual(holdersInGroupOf(groupOf(member) ?? member, lifeline.path), [])
  // And the member is handed no variable naming it (#472 r=3): the number it would name is one the launcher has closed,
  // so a tool server or a nested `martha start` reading it would be told of a run it cannot read. The rest of the run's
  // own environment is inherited, which is what says this environment was read at all.
  const environment = readFileSync(`${PROC_ROOT}/${member}/environ`, 'utf8').split('\0')
  assertThePipeIsUnnamed(environment)
  assert.equal(environment.some((named) => named.startsWith('PATH=')), true, 'and inherits the run\'s own environment besides it')
  assert.equal(readdirSync(place.relay_root).length, 1, 'the launch has its relay directory while it runs')
  assert.equal(readdirSync(place.snapshot_root).length, 1)
  assert.equal(readdirSync(place.launch_records).length, 1)
  // The run goes: its end of the pipe closes, and nothing else has to happen for the member to be taken with it.
  lifeline.closeTheRunsEnd()
  // The reason is what tells this kill from the backstop's, which this launch cannot reach: an assertion only that the
  // member stopped would pass on the wrong killer (#472 r=1).
  assert.ok(
    await reactsWithin(() => said.includes('stopped'), REACTS_WITHIN_MS),
    `the launcher never said it stopped its member after its run went: ${JSON.stringify(said)}`,
  )
  assert.ok(said.includes(`because ${THE_RUN_IS_GONE}`), `not the run's end that stopped it: ${JSON.stringify(said)}`)
  await until('the member and the process under it to be killed', () => !isAlive(member) && !isAlive(child), t)
  await until('the launch directory and the snapshot to go', () => readdirSync(place.relay_root).length === 0 && readdirSync(place.snapshot_root).length === 0, t)
  await until('the launch record to go', () => readdirSync(place.launch_records).length === 0, t)
})

test('a launch refused while its run is still there ends by itself: its run\'s lifeline never holds a launcher up (#472)', async (t) => {
  const place = placeFor(t)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-lifeline-'))
  const lifeline = keepTheLifelineIn(runtime)
  // Nothing keeps this launcher up but its own work: the command is not one it can run, so no member starts, and the
  // script holds no interval. The run keeps its end open for the whole test, so a launcher that waited on it would
  // never end — which is what a pipe left referenced does (#472 r=1).
  const script = launcherProcess(place, join(place.home, 'no-such-command'), 'ignore', lifeline.environment, undefined, {}, OWNER_PROMPT_ARGS, false)
  const launcher = spawn(process.execPath, [script], { stdio: lifeline.stdio })
  let ended = false
  launcher.once('exit', () => (ended = true))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to refuse', () => REFUSED_LINE.test(said), t, () => said)
  assert.ok(said.includes('is not a command this launcher can run'), said)
  assert.ok(
    await reactsWithin(() => ended, REACTS_WITHIN_MS),
    `the launcher never ended on its refusal while its run was still there: ${JSON.stringify(said)}`,
  )
  assert.deepEqual(readdirSync(place.relay_root), [], 'a refusal leaves nothing behind')
})

test('a run killed hard is still taken with its member: the pipe\'s end closes however the run ends (#472)', async (t) => {
  const place = placeFor(t)
  const fake = fakeHostUnderARun(place)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-lifeline-'))
  const launcher = launcherProcess(place, fake.command, 'ignore', { [RUN_LIFELINE_VARIABLE]: String(RUN_LIFELINE_FD) }, undefined, { session_start_deadline_ms: BEYOND_ANY_WAIT_MS })
  // The run, in a process of its own, keeps the pipe's write end and starts the launcher through `script`, so the
  // launcher is its grandchild and survives it: nothing in the chain dies of the kill, and only the pipe says so.
  const runScript = join(place.home, 'the-run.ts')
  // What the launcher's terminal shows, written to a file by the terminal itself: a pipe carried back through this run
  // would end with the run, and the reason this test asserts is said after the run is killed.
  const shownAt = join(place.home, 'the-launcher-said')
  const shown = (): string => (existsSync(shownAt) ? readFileSync(shownAt, 'utf8') : '')
  writeFileSync(
    runScript,
    [
      `import { spawn } from 'node:child_process'`,
      `import { openSync } from 'node:fs'`,
      `import { keepTheLifelineIn } from ${JSON.stringify(new URL('../end_a_launch_when_its_run_ends/keep_the_lifeline_in.ts', import.meta.url).href)}`,
      `const lifeline = keepTheLifelineIn(${JSON.stringify(runtime)})`,
      `spawn(${JSON.stringify(PTY_RUNNER)}, ['-qec', ${JSON.stringify(`'${process.execPath}' '${launcher}'`)}, '/dev/null'], { stdio: [lifeline.stdio[0], openSync(${JSON.stringify(shownAt)}, 'w'), lifeline.stdio[2], lifeline.stdio[3]] })`,
      `process.stdout.write('the run is up\\n')`,
      'setInterval(() => undefined, 1 << 30)',
      '',
    ].join('\n'),
  )
  const run = spawn(process.execPath, [runScript], { stdio: ['ignore', 'pipe', 'inherit'] })
  t.after(async () => {
    if (run.exitCode === null && run.signalCode === null) run.kill('SIGKILL')
    await killGroupsCarrying(place.relay_root)
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  await until('the run to start its launcher\'s member', () => existsSync(fake.childFile) && textIn(fake.readyFile) !== '', t, shown)
  const member = Number(textIn(fake.readyFile))
  const child = Number(textIn(fake.childFile))
  assert.equal(isAlive(member), true, 'the member runs before the kill')
  run.kill('SIGKILL')
  await until('the member and the process under it to be killed', () => !isAlive(member) && !isAlive(child), t, shown)
  // Bounded, and the backstop was put out of reach: a member nobody stops fails here, naming the reason it never said.
  assert.ok(await reactsWithin(() => shown().includes('stopped'), REACTS_WITHIN_MS), `the launcher never said it stopped its member: ${JSON.stringify(shown())}`)
  assert.ok(shown().includes(`because ${THE_RUN_IS_GONE}`), `not the run's end that stopped it: ${JSON.stringify(shown())}`)
  await until('the launch directory and the snapshot to go', () => readdirSync(place.relay_root).length === 0 && readdirSync(place.snapshot_root).length === 0, t)
  await until('the launch record to go', () => readdirSync(place.launch_records).length === 0, t)
})

test('a run that goes while the launcher waits on the host leaves the member\'s command unrun (#472)', async (t) => {
  const place = placeFor(t)
  const marker = join(place.home, 'the-questions-may-be-answered')
  const fake = fakeHostUnderARun(place, { waitFor: marker, parked: join(place.home, 'the-launcher-is-parked') })
  const runtime = mkdtempSync(join(tmpdir(), 'martha-lifeline-'))
  const lifeline = keepTheLifelineIn(runtime)
  // On a terminal, because a member is admitted there through the hold this test puts the run's end in: the member is
  // never started at all, rather than started and then stopped.
  const script = launcherProcess(place, fake.command, 'inherit', lifeline.environment)
  const terminal = spawn(PTY_RUNNER, ['-qec', `'${process.execPath}' '${script}'`, '/dev/null'], { stdio: lifeline.stdio })
  const ended = new Promise<void>((resolve) => terminal.once('exit', () => resolve()))
  t.after(async () => {
    terminal.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  terminal.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to be parked on its questions', () => existsSync(join(place.home, 'the-launcher-is-parked')), t, () => said)
  lifeline.closeTheRunsEnd()
  writeFileSync(marker, '')
  // Bounded, so a hold that admits a member anyway fails by name here rather than as the harness's timeout (#472 r=1).
  assert.ok(
    await reactsWithin(() => REFUSED_LINE.test(said), REACTS_WITHIN_MS),
    `the launcher never refused the member its run's end forbids: ${JSON.stringify(said)}`,
  )
  assert.ok(said.includes(THE_RUN_IS_GONE), said)
  assert.equal(existsSync(fake.argsFile), false, 'the member\'s command never ran: not stopped, unrun')
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
})

test('a run that goes before the launcher knows its member\'s group still takes the member down (#472)', async (t) => {
  const place = placeFor(t)
  const marker = join(place.home, 'the-questions-may-be-answered')
  const fake = fakeHostUnderARun(place, { waitFor: marker, parked: join(place.home, 'the-launcher-is-parked') })
  const runtime = mkdtempSync(join(tmpdir(), 'martha-lifeline-'))
  const lifeline = keepTheLifelineIn(runtime)
  // Off the owner's terminal, so there is no hold to refuse the member in: it is started, and the run's end arrives
  // before its group is in the launcher's hand. `theGroupIsKnown` is the launch's only answer for that, which is why
  // this case exists apart from the one above. The backstop is put beyond this test, so only the lifeline can stop it.
  const script = launcherProcess(place, fake.command, 'ignore', lifeline.environment, undefined, { session_start_deadline_ms: BEYOND_ANY_WAIT_MS })
  const launcher = spawn(process.execPath, [script], { stdio: lifeline.stdio })
  const ended = new Promise<number | null>((resolve) => launcher.once('exit', (code) => resolve(code)))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to be parked on its questions', () => existsSync(join(place.home, 'the-launcher-is-parked')), t, () => said)
  lifeline.closeTheRunsEnd()
  writeFileSync(marker, '')
  assert.ok(
    await reactsWithin(() => said.includes('stopped'), REACTS_WITHIN_MS),
    `the launcher never stopped the member it started after its run went: ${JSON.stringify(said)}`,
  )
  assert.ok(/^started \d+$/m.test(said), `the member was started, not refused: there is no hold off the owner's terminal: ${JSON.stringify(said)}`)
  assert.ok(said.includes(`because ${THE_RUN_IS_GONE}`), `not the run's end that stopped it: ${JSON.stringify(said)}`)
  const member = Number(/^started (\d+)$/m.exec(said)?.[1])
  assert.equal(isAlive(member), false, 'the member the run\'s end found in the group it had is dead')
  await until('the launch directory and the snapshot to go', () => readdirSync(place.relay_root).length === 0 && readdirSync(place.snapshot_root).length === 0, t)
  await until('the launch record to go', () => readdirSync(place.launch_records).length === 0, t)
})

test('a lifeline whose run is already gone refuses the launch by name, before anything is made (#472)', async (t) => {
  const place = placeFor(t)
  const fake = fakeHostUnderARun(place)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-lifeline-'))
  const lifeline = keepTheLifelineIn(runtime)
  lifeline.closeTheRunsEnd()
  const launcher = spawn(process.execPath, [launcherProcess(place, fake.command, 'ignore', lifeline.environment)], { stdio: lifeline.stdio })
  const ended = new Promise<number | null>((resolve) => launcher.once('exit', (code) => resolve(code)))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to refuse', () => REFUSED_LINE.test(said), t, () => said)
  assert.ok(said.includes(RUN_LIFELINE_VARIABLE), said)
  assert.ok(said.includes('already closed'), said)
  assert.equal(existsSync(fake.argsFile), false, 'no member started')
  assert.deepEqual(readdirSync(place.relay_root), [], 'nothing was made: no relay directory')
  assert.deepEqual(readdirSync(place.snapshot_root), [], 'and no snapshot')
})


test('a launcher killed hard leaves its directory behind, and the next launch takes it away (#124)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)

  const first = spawn(process.execPath, [launcherProcess(place, fake.command)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const firstEnded = new Promise<NodeJS.Signals | null>((resolve) => first.once('exit', (_code, by) => resolve(by)))
  // Before any assertion: a test that fails must not leave a member running.
  t.after(async () => {
    if (first.exitCode === null && first.signalCode === null) first.kill('SIGKILL')
    await firstEnded
    await killGroupsCarrying(place.relay_root)
  })
  let said = ''
  first.stdout.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the first launcher to start its member', () => said.includes('started') && existsSync(fake.childFile), t, () => said, () => REFUSED_LINE.exec(said)?.[0])

  const [leftover] = readdirSync(place.relay_root) as [string]
  assert.ok(leftover !== undefined, 'a launch keeps its directory in the relay root')
  // The record holds both processes, so a sweep waits for the member as well as
  // the launcher: a member can outlive a launcher killed hard (#124).
  const launchRecord = JSON.parse(readFileSync(join(place.relay_root, leftover, LAUNCHER_RECORD_NAME), 'utf8')) as LaunchRecord
  assert.equal(linuxProcessIdentities.lookupOf(launchRecord.launcher.pid).found, 'held', 'the launcher the record names is this one')
  assert.equal(launchRecord.member === undefined ? 'none' : linuxProcessIdentities.lookupOf(launchRecord.member.pid).found, 'held', 'and the member it names is the one running')

  // SIGKILL runs none of the launcher's own cleanup: what it made stays, and so
  // does its member, which the launcher's handlers would have killed.
  first.kill('SIGKILL')
  assert.equal(await firstEnded, 'SIGKILL')
  await killGroupsCarrying(place.relay_root)
  assert.deepEqual(readdirSync(place.relay_root), [leftover], 'a launcher killed hard leaves its directory behind')
  // The read-only copy (#117) refuses a plain removal, which is why the sweep
  // and the teardown open the folders first. Asked of the copy itself: a refused
  // removal of the whole directory takes whatever it reaches before it fails,
  // and that would be the record the sweep needs, in the order this filesystem
  // happens to list them.
  assert.throws(
    () => rmSync(join(place.relay_root, leftover, relayCopy.RELAY_COPY_NAME), { recursive: true }),
    'the read-only relay copy (#117) refuses a plain removal',
  )

  // The next launch on this relay root sweeps the leftover away, and keeps its own.
  const next = spawn(process.execPath, [launcherProcess(place, fake.command)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const nextEnded = new Promise<NodeJS.Signals | null>((resolve) => next.once('exit', (_code, by) => resolve(by)))
  t.after(async () => {
    if (next.exitCode === null && next.signalCode === null) next.kill('SIGKILL')
    await nextEnded
    await killGroupsCarrying(place.relay_root)
  })
  // Registered after the hook above, and after the first launcher's: both have killed their processes and waited.
  thePlaceGoesWithItsProcesses(t, place)
  let nextSaid = ''
  next.stdout.on('data', (chunk: Buffer) => void (nextSaid += chunk.toString()))
  await until('the next launcher to start its member', () => nextSaid.includes('started') && existsSync(fake.childFile), t, () => nextSaid, () => REFUSED_LINE.exec(nextSaid)?.[0])

  const after = readdirSync(place.relay_root)
  assert.equal(after.length, 1, 'the leftover went, and this launch has its own')
  assert.notEqual(after[0], leftover, 'the directory left here is this launch\'s, not the one it swept')
})

// --- the crew's state a member is kept out of (martha#683) ----------------------

/** The variable a launch marks its inherited environment with, so a read of the kernel's record is known to be that one. */
const WHAT_I_WAS_GIVEN = 'MARTHA_683_WHAT_I_WAS_GIVEN'

/** What the kernel holds for `pid` as its environment, or nothing when the process went while it was looked at. */
function theEnvironmentTheKernelHoldsOrNothing(pid: number): Record<string, string> | undefined {
  try {
    const entries = readFileSync(`${PROC_ROOT}/${pid}/environ`, 'utf8')
      .split('\0')
      .filter((entry) => entry.includes('='))
      .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)] as const)
    return Object.fromEntries(entries)
  } catch {
    return undefined
  }
}

/** What the kernel holds for `pid`, once its environment carries `marker`: an answer from a process inside `exec` is empty (#85). */
async function theEnvironmentTheKernelHolds(pid: number, marker: string): Promise<Record<string, string>> {
  for (let tried = 0; tried < 500; tried += 1) {
    const held = theEnvironmentTheKernelHoldsOrNothing(pid)
    if (held?.[marker] !== undefined) return held
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`/proc/${pid}/environ never showed ${marker}`)
}

test("a launched member is handed neither the crew state the launch inherited nor a session the crew recorded (martha#683)", async (t) => {
  const place = placeFor(t)
  const fake = fakeHostUnderARun(place)
  // What the launch inherits: a state home planted in it, a path inside this launch's own crew state, and the id of a
  // session this crew has recorded, kept the way its row store keeps one.
  const planted = join(place.home, 'a-state-home-the-launch-inherited')
  const sessionId = randomUUID()
  mkdirSync(join(place.rows, streamDirectoryNameOf(sessionRecordStreamOf(sessionId))), { mode: STREAM_DIRECTORY_MODE })
  const plantedRecord = join(place.state_root, CREWS_PLACE, 'a-crew', CREW_ROWS_PLACE)
  const inherited = {
    [STATE_HOME_VARIABLE]: planted,
    MARTHA_683_PLANTED_RECORD: plantedRecord,
    MARTHA_683_PLANTED_SESSION: sessionId,
    [WHAT_I_WAS_GIVEN]: 'given',
  }
  const launcher = spawn(process.execPath, [launcherProcess(place, fake.command, 'ignore', inherited)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const ended = new Promise<NodeJS.Signals | null>((resolve) => launcher.once('exit', (_code, by) => resolve(by)))
  // Before any assertion: a test that fails must not leave the member running.
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to start its member', () => said.includes('started') && existsSync(fake.readyFile), t, () => said, () => REFUSED_LINE.exec(said)?.[0])
  const member = Number(readFileSync(fake.readyFile, 'utf8').trim())
  // The environment the launcher really started its member with, read from the kernel: nothing is filtered here.
  const held = await theEnvironmentTheKernelHolds(member, WHAT_I_WAS_GIVEN)
  assert.equal(
    held[STATE_HOME_VARIABLE],
    dirname(place.state_root),
    "the member is handed the launcher's own state home, never the one the launch inherited",
  )
  assert.equal(held.MARTHA_683_PLANTED_RECORD, undefined, "a path inside the crew's state root is not handed on")
  assert.equal(held.MARTHA_683_PLANTED_SESSION, undefined, 'a session id the crew recorded is not handed on')
  launcher.kill('SIGTERM')
  assert.equal(await ended, 'SIGTERM', 'the signal still ends the launcher')
})

// --- a member on the owner's own terminal (martha#54) ---------------------------

/** The pseudo-terminal the owner's terminal is played on: util-linux's script. */
const PTY_RUNNER = 'script'

/** The column count a test resizes the owner's terminal to. */
const RESIZED_COLUMNS = 93

/** The line on which the fake terminal member exits by itself, leaving the terminal as it set it. */
const LEAVE_LINE = 'leave'

/**
 * Longer than the 5 s deadline this file held before martha#90, so the wait below
 * fails here by name if a deadline measured against the clock ever comes back.
 */
const SLOWER_THAN_A_FIXED_DEADLINE_MS = 5500

/** The keys a terminal turns into signals for its foreground group, as the owner types them. */
const CTRL_C = '\x03'
const CTRL_Z = '\x1a'

/**
 * A fake `claude` for a terminal: first notes whether it holds the descriptor the
 * launcher reads its pid from, where it could write a pid of its choosing; then
 * sets the terminal non-canonical without echo (its keys still signal), says when
 * it is ready, reads a line, and notes each resize and each Ctrl-C. On LEAVE_LINE
 * it exits by itself, after `exitsAfterMs` when a test asks it to be slow about
 * it; otherwise it waits with a child in its group.
 */
function fakeTerminalClaude(place: Place, exitsAfterMs = 0): {
  command: string
  readyFile: string
  gotFile: string
  resizedFile: string
  interruptedFile: string
  childFile: string
  pidPipeFile: string
  argsFile: string
} {
  const dir = join(place.home, 'fake-tty')
  mkdirSync(dir)
  const files = {
    readyFile: join(dir, 'ready'),
    gotFile: join(dir, 'got'),
    resizedFile: join(dir, 'resized'),
    interruptedFile: join(dir, 'interrupted'),
    childFile: join(dir, 'child'),
    pidPipeFile: join(dir, 'held-the-pid-pipe'),
    argsFile: join(dir, 'args'),
  }
  const command = join(dir, CLAUDE)
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      ...hostAnswers(),
      `printf '%s\\n' "$@" > '${files.argsFile}'`,
      `if { true >&${MEMBER_PID_FD}; } 2> /dev/null; then : > '${files.pidPipeFile}'; fi`,
      `trap ": > '${files.resizedFile}'" WINCH`,
      `trap ": > '${files.interruptedFile}'" INT`,
      'stty -icanon -echo',
      `echo $$ > '${files.readyFile}'`,
      `IFS= read -r line; printf '%s' "$line" > '${files.gotFile}'`,
      ...(exitsAfterMs === 0 ? [] : [`[ "$line" = '${LEAVE_LINE}' ] && sleep ${exitsAfterMs / 1000}`]),
      `[ "$line" = '${LEAVE_LINE}' ] && exit 0`,
      'sleep 600 &',
      `echo $! > '${files.childFile}'`,
      'while :; do wait; done',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return { command, ...files }
}

/** The settings of a terminal, as `stty -g` prints them. */
const settingsOf = (tty: string): string => execFileSync('stty', ['-F', tty, '-g'], { encoding: 'utf8' }).trim()

/** The foreground process group of the terminal a process is on. */
const foregroundOf = (pid: number): number => Number(execFileSync('ps', ['-o', 'tpgid=', '-p', String(pid)], { encoding: 'utf8' }).trim())

const textIn = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '')

interface OwnersTerminal {
  readonly launcher: number
  readonly tty: string
  readonly before: string
  readonly owner_shell: number
  readonly fake: ReturnType<typeof fakeTerminalClaude>
  type(line: string): void
  /** Types keys with no newline after them. */
  press(keys: string): void
  /** What the terminal has shown so far. */
  shown(): string
  /**
   * The status the launcher ended with and the last of what it printed, when it ended without starting a member
   * (martha#454): a script that cannot load dies before the launcher says `started`, so nothing else it could say
   * tells a test why the member never came. Undefined while it runs, and for one that started or refused one.
   */
  launcherEnd(): { readonly code: number; readonly said: string } | undefined
}

/** How the owner's terminal launches: what it starts, its environment, and where the launcher's stderr goes. */
interface TerminalLaunch {
  readonly inherited?: Readonly<Record<string, string>>
  /** The command the launcher starts, instead of the fake terminal member. */
  readonly command?: string
  /** A file the launcher's stderr is redirected to, so only its stdin is the terminal. */
  readonly stderrTo?: string
  /** The recorded mesh server trees the launch accepts. */
  readonly mesh_trees?: MeshTreeRecording
  /** How long the fake terminal member waits before it exits on the leave line, for a slow host (martha#90). */
  readonly exitsAfterMs?: number
  /** The launch's own session start deadlines (#104 r=2). */
  readonly deadlines?: SessionStartDeadlines
  /** The owner's arguments to the host, instead of a prompt to print an answer to. */
  readonly args?: readonly string[]
  /** The launcher script the terminal runs, instead of the one the harness writes, for a script that cannot load (martha#454). */
  readonly launcher_script?: string
}

/** The deadlines a test gives a launch in place of the launcher's own. */
interface SessionStartDeadlines {
  readonly session_start_deadline_ms?: number
  readonly trust_answer_deadline_ms?: number
}

/**
 * The owner's terminal: a pseudo-terminal whose session leader is a shell that
 * outlives the launcher, as the owner's shell does. The shell notes the
 * terminal, its settings and the launcher's pid before the launch. Resolves
 * once the fake member is ready.
 */
async function ownersTerminal(t: TestContext, place: Place, how: TerminalLaunch = {}): Promise<OwnersTerminal> {
  const terminal = terminalLaunch(t, place, how)
  // What the terminal said goes into the wait's own diagnostic: on a hang the
  // harness reports its timeout and drops anything thrown from here (martha#90 r=2).
  await untilOnTerminal(terminal, 'the owner\'s terminal to launch the member', () => terminal.launcher() !== 0 && textIn(terminal.fake.readyFile) !== '', t)
  return { ...terminal, launcher: terminal.launcher() }
}

/** The line the launcher process prints when it refuses (launcherProcess), as the terminal shows it. */
const REFUSED_LINE = /refused: [^\r\n]*/

/** The line the launcher process prints when it starts its member, as the terminal shows it. */
const STARTED_LINE = /started \d+/

/**
 * The last of what a launcher printed, for a message that has to carry its own error: the stack frames are left out,
 * since the line that says what went wrong is the one above them, and what remains is capped so the message stays one
 * line a reader can follow.
 */
const theLastOf = (said: string): string =>
  said
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('at '))
    .slice(-3)
    .join(' / ')
    .slice(-400)

/**
 * Waits on the owner's terminal for what a test means, and fails at once when
 * the launcher has said it refused: after that, no member event can come
 * (martha#94).
 *
 * A launcher that ends fails the wait at once too, naming the status it ended
 * with and the last of what it printed (martha#454): a script that cannot load
 * says nothing on the terminal and starts no member, so the wait would otherwise
 * run to the harness's timeout and leave only that as the failure.
 */
const untilOnTerminal = (terminal: Pick<OwnersTerminal, 'shown' | 'launcherEnd'>, what: string, holds: () => boolean, t: TestContext): Promise<void> =>
  until(what, holds, t, () => terminal.shown(), () => {
    const refused = REFUSED_LINE.exec(terminal.shown())?.[0]
    if (refused !== undefined) return refused
    const ended = terminal.launcherEnd()
    if (ended === undefined) return undefined
    return `the launcher ended with status ${ended.code} and started nothing${ended.said === '' ? '' : `; it said: ${ended.said}`}`
  })

/**
 * The shell the owner's terminal runs (martha#559): it notes itself, the terminal and its settings, then starts the
 * launcher, notes its pid and waits on it, notes its status, and ends on `read finished` — which is what holds a shell
 * that has waited its launcher out open, exactly as the owner's own shell holds it.
 */
function theShellATerminalRuns(note: (name: string) => string, launcher: string, stderr: string): string {
  return [
    `echo $$ > '${note('shell')}'`,
    `readlink ${PROC_ROOT}/$$/fd/0 > '${note('tty')}'`,
    `stty -g > '${note('before')}'`,
    // A shell without job control gives a background command /dev/null as its input, unless told otherwise.
    // The launcher's own status is noted when it ends, so a test waiting on the terminal can fail at once with it
    // rather than run to the harness's timeout (martha#454).
    `'${process.execPath}' '${launcher}' < /dev/tty${stderr} & launcher=$!; echo $launcher > '${note('launcher')}'; wait $launcher; echo $? > '${note('ended')}'`,
    'read finished',
  ].join('; ')
}

/** The owner's terminal with the launch started, not waited on: for a launch that may start no member. */
function terminalLaunch(t: TestContext, place: Place, how: TerminalLaunch): Omit<OwnersTerminal, 'launcher'> & { launcher(): number } {
  const fake = fakeTerminalClaude(place, how.exitsAfterMs)
  const notes = join(place.home, 'terminal')
  mkdirSync(notes)
  const note = (name: string) => join(notes, name)
  const launcher = how.launcher_script ?? launcherProcess(place, how.command ?? fake.command, 'inherit', how.inherited ?? {}, how.mesh_trees, how.deadlines, how.args)
  const stderr = how.stderrTo === undefined ? '' : ` 2> '${how.stderrTo}'`
  const shell = theShellATerminalRuns(note, launcher, stderr)
  const runner = spawn(PTY_RUNNER, ['-qec', shell, '/dev/null'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let shown = ''
  runner.stdout.on('data', (chunk: Buffer) => void (shown += chunk.toString()))
  const ended = new Promise<void>((resolve) => runner.once('exit', () => resolve()))
  // The removal this test registers ends the hook below, so the place's own hook leaves it to that one (martha#216 r=3).
  place.aRemovalIsRegistered()
  // Before any assertion: a test that fails must not leave the member, its launcher or the terminal running.
  t.after(async () => {
    const launcherPid = Number(textIn(note('launcher')))
    if (launcherPid > 1 && isAlive(launcherPid)) process.kill(launcherPid, 'SIGKILL')
    await killGroupsCarrying(place.relay_root)
    runner.kill('SIGKILL')
    await ended
    // The launcher was killed by its pid, which its own environment does not name: waited for here, then the home goes
    // (martha#216). Its pid file is still there because the home is.
    await theHomeGoes(place, [launcherPid])
  })
  return {
    launcher: () => Number(textIn(note('launcher'))),
    get tty() {
      return textIn(note('tty'))
    },
    get before() {
      return textIn(note('before'))
    },
    get owner_shell() {
      return Number(textIn(note('shell')))
    },
    fake,
    type: (line: string) => void runner.stdin.write(`${line}\n`),
    press: (keys: string) => void runner.stdin.write(keys),
    shown: () => shown,
    // What the launcher printed is the terminal itself, unless the test sent its stderr to a file: either way it is the
    // launcher's own error, which is the whole point of naming it (martha#454).
    launcherEnd: () => {
      const ended = textIn(note('ended'))
      // A launcher that started or refused a member has said what became of it: what follows its end is another
      // test's to wait for, and its end rules nothing out (martha#454).
      if (ended === '' || STARTED_LINE.test(shown) || REFUSED_LINE.test(shown)) return undefined
      return { code: Number(ended), said: theLastOf(how.stderrTo === undefined ? shown : textIn(how.stderrTo)) }
    },
  }
}

test('a member on the owner\'s terminal is its foreground job: it reads the owner\'s line and gets each resize and Ctrl-C', async (t) => {
  const place = placeFor(t)
  // What the owner's environment could run in the job-control shell: a BASH_ENV
  // file, and an exported function that would stand in for its fg.
  const startupRan = join(place.home, 'bash-env-ran')
  const fgRan = join(place.home, 'exported-fg-ran')
  const startup = join(place.home, 'bash-env')
  writeFileSync(startup, `: > '${startupRan}'\n`)
  const terminal = await ownersTerminal(t, place, { inherited: { BASH_ENV: startup, 'BASH_FUNC_fg%%': `() { : > '${fgRan}'; }` } })
  assert.equal(existsSync(startupRan), false, 'no BASH_ENV ran in the job-control shell')
  assert.equal(existsSync(fgRan), false, 'no exported function stood in for fg')
  const member = Number(textIn(terminal.fake.readyFile))
  assert.equal(groupOf(member), member, 'the member leads a group of its own, which the group kill relies on')
  assert.notEqual(groupOf(member), groupOf(terminal.launcher))
  assert.equal(foregroundOf(member), member, 'the member\'s group is the terminal\'s foreground')
  await untilOnTerminal(terminal, 'the launcher to say whom it started', () => /started \d+/.test(terminal.shown()), t)
  assert.ok(terminal.shown().includes(`started ${member}`), 'the launcher holds the member\'s own pid')
  assert.equal(existsSync(terminal.fake.pidPipeFile), false, 'the member cannot write where the launcher reads its pid')

  const line = 'the owner types this'
  terminal.type(line)
  await untilOnTerminal(terminal, 'the member to read the owner\'s line', () => textIn(terminal.fake.gotFile) === line, t)

  execFileSync('stty', ['-F', terminal.tty, 'cols', String(RESIZED_COLUMNS)])
  await untilOnTerminal(terminal, 'the member to be told of the resize', () => existsSync(terminal.fake.resizedFile), t)

  terminal.press(CTRL_C)
  await untilOnTerminal(terminal, 'the member to be told of the Ctrl-C', () => existsSync(terminal.fake.interruptedFile), t)
  assert.ok(isAlive(terminal.launcher), 'the owner\'s Ctrl-C is the member\'s, not the launcher\'s')
})

test('a member on the owner\'s terminal starts the recorded mesh server tree, by path, as a detached one does (#54 with #65)', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const terminal = await ownersTerminal(t, place, { mesh_trees: recording, inherited: { HOME: place.home } })
  const entry = serverConfigIn(terminal.fake.argsFile).mcpServers.macula
  assert.ok(entry !== undefined)
  assert.equal(entry.command, process.execPath, 'npx is never what starts the mesh server')
  // Started by path, confined to its tree by the launcher's hook (martha#73).
  assert.equal(entry.args.at(-1), join(realpathSync(place.mesh_servers), recorded.server_version, DEPENDENCIES, MESH_SERVER_PACKAGE, 'dist', 'index.js'))
  terminal.type(LEAVE_LINE)
  await untilOnTerminal(terminal, 'the launcher to say its member stopped by itself', () => terminal.shown().includes('stopped by itself'), t)
})

test('a member on the owner\'s terminal that Ctrl-Z stops is resumed in the foreground and reads on', async (t) => {
  const place = placeFor(t)
  const terminal = await ownersTerminal(t, place)
  const member = Number(textIn(terminal.fake.readyFile))
  terminal.press(CTRL_Z)
  const line = 'typed after the Ctrl-Z'
  terminal.type(line)
  await untilOnTerminal(terminal, 'the stopped member to read on', () => textIn(terminal.fake.gotFile) === line, t)
  assert.equal(foregroundOf(member), member, 'the member\'s group has the terminal again')
})

/** The recording's own argument that tells the host to read no trust record, so it may ask the owner after all. */
function ignoreTrustFlag(): string {
  const flag = CLAUDE_CODE_HOOK_SWITCHES.outside_a_terminal.flags[0]
  assert.ok(flag !== undefined, 'the recording names no argument for the exit')
  return flag
}

test('a member on the owner\'s terminal whose owner tells the host to ignore its trust record, and whose relay never reports its session start, is stopped at the trust answer deadline, saying the host may still have been asking (#104 r=2, martha#602)', async (t) => {
  const place = placeFor(t)
  const trust_answer_deadline_ms = 500
  const terminal = await ownersTerminal(t, place, { args: [ignoreTrustFlag()], deadlines: { session_start_deadline_ms: MINUTE_MS, trust_answer_deadline_ms } })
  await until('the launcher to stop the member', () => terminal.shown().includes('because '), t, () => terminal.shown())
  const why = /because (.*)/.exec(terminal.shown())?.[1] ?? ''
  assert.ok(why.includes(`within ${trust_answer_deadline_ms / 1000} s`), why)
  assert.ok(why.includes('trust'), why)
})

// T8: the owner chose that the launcher marks the approved checkout trusted in the member's own record (martha#602), so
// the host asks nothing and the member is held to the short deadline, whatever the owner's own record says.
test('a member on the owner\'s terminal is held to the short deadline: its own record trusts the approved checkout, so the host asks nothing (#104 r=3, martha#602)', async (t) => {
  const place = placeFor(t)
  // The owner's own record trusts nothing: only the member's own folder can be what the host reads.
  writeFileSync(join(place.home, HOST_TRUST_RECORD_FILE), JSON.stringify({ projects: {} }))
  const session_start_deadline_ms = 300
  const terminal = await ownersTerminal(t, place, { inherited: { HOME: place.home }, deadlines: { session_start_deadline_ms, trust_answer_deadline_ms: MINUTE_MS } })
  await until('the launcher to stop the member', () => terminal.shown().includes('because '), t, () => terminal.shown())
  const why = /because (.*)/.exec(terminal.shown())?.[1] ?? ''
  assert.ok(why.includes(`within ${session_start_deadline_ms / 1000} s`), why)
  assert.ok(!why.includes('trust'), why)
})

test('a member on the owner\'s terminal whose owner passes the host its ignore-persisted-trust argument keeps the trust answer deadline (#332 r=4)', async (t) => {
  // The record trusts the folder, so a launch whose arguments the trust reader never saw is stopped at the short
  // deadline (the test above). The owner's own argument says the host reads no record, so the host may ask after all:
  // the member keeps the long deadline and runs. This is the call site, not the reader: the arguments must be passed.
  const place = placeFor(t)
  const session_start_deadline_ms = 300
  const terminal = await ownersTerminal(t, place, { args: [ignoreTrustFlag()], inherited: { HOME: place.home }, deadlines: { session_start_deadline_ms, trust_answer_deadline_ms: MINUTE_MS } })
  const member = Number(textIn(terminal.fake.readyFile))
  await new Promise((resolve) => setTimeout(resolve, 5 * session_start_deadline_ms))
  assert.equal(isAlive(member), true, 'the member still runs: the host was told to ignore its record, so it may ask')
  assert.ok(!terminal.shown().includes('stopped'), terminal.shown())
})

test('a member on the owner\'s terminal that exits by itself leaves the terminal\'s settings as they were', async (t) => {
  const place = placeFor(t)
  const terminal = await ownersTerminal(t, place)
  assert.notEqual(settingsOf(terminal.tty), terminal.before, 'the member changed the terminal\'s settings')
  terminal.type(LEAVE_LINE)
  await untilOnTerminal(terminal, 'the launcher to say its member stopped by itself', () => terminal.shown().includes('stopped by itself'), t)
  assert.equal(settingsOf(terminal.tty), terminal.before)
  assert.equal(foregroundOf(terminal.launcher), groupOf(terminal.launcher), 'the launcher\'s group has the terminal again')
})

test('a member on the owner\'s terminal that is slow to stop is waited for, not timed (martha#90)', async (t) => {
  const place = placeFor(t)
  const terminal = await ownersTerminal(t, place, { exitsAfterMs: SLOWER_THAN_A_FIXED_DEADLINE_MS })
  terminal.type(LEAVE_LINE)
  await untilOnTerminal(terminal, 'the launcher to say its member stopped by itself', () => terminal.shown().includes('stopped by itself'), t)
})

test('a member on the owner\'s terminal that is stopped gives the terminal back: its settings and the launcher\'s foreground', async (t) => {
  const place = placeFor(t)
  const terminal = await ownersTerminal(t, place)
  const member = Number(textIn(terminal.fake.readyFile))
  assert.notEqual(settingsOf(terminal.tty), terminal.before, 'the member changed the terminal\'s settings')
  terminal.type('a line')
  await untilOnTerminal(terminal, 'the member to leave a child in its group', () => textIn(terminal.fake.childFile) !== '', t)
  const child = Number(textIn(terminal.fake.childFile))

  process.kill(terminal.launcher, 'SIGUSR2')
  await until('the member\'s group to be killed', () => !isAlive(member) && !isAlive(child), t)
  await untilOnTerminal(terminal, 'the terminal\'s settings to be restored', () => settingsOf(terminal.tty) === terminal.before, t)
  assert.ok(isAlive(terminal.launcher), 'the launcher outlives its member')
  await untilOnTerminal(terminal, 'the launcher to say how its member stopped', () => terminal.shown().includes('stopped SIGKILL'), t)
  assert.equal(foregroundOf(terminal.launcher), groupOf(terminal.launcher), 'the launcher\'s group has the terminal again')
})

test('SIGTERM to a launcher whose member is on the owner\'s terminal kills the group and gives the owner\'s shell the terminal as it was', async (t) => {
  const place = placeFor(t)
  const terminal = await ownersTerminal(t, place)
  const member = Number(textIn(terminal.fake.readyFile))
  terminal.type('a line')
  await untilOnTerminal(terminal, 'the member to leave a child in its group', () => textIn(terminal.fake.childFile) !== '', t)
  const child = Number(textIn(terminal.fake.childFile))

  process.kill(terminal.launcher, 'SIGTERM')
  await untilOnTerminal(terminal, 'the launcher to end', () => !isAlive(terminal.launcher), t)
  await until('the member\'s group to be killed', () => !isAlive(member) && !isAlive(child), t)
  await untilOnTerminal(terminal, 'the terminal\'s settings to be restored', () => settingsOf(terminal.tty) === terminal.before, t)
  await untilOnTerminal(terminal, 'the owner\'s shell to have the terminal', () => foregroundOf(terminal.owner_shell) === groupOf(terminal.owner_shell), t)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
})

test('a launcher whose stderr is not the terminal starts its member detached, and the member still reads the owner\'s line', async (t) => {
  const place = placeFor(t)
  const log = join(place.home, 'launcher-stderr')
  const terminal = await ownersTerminal(t, place, { stderrTo: log })
  const member = Number(textIn(terminal.fake.readyFile))
  assert.notEqual(foregroundOf(member), member, 'bash hands a job the terminal through its stderr, so the member is not made the foreground job')
  terminal.type(LEAVE_LINE)
  await untilOnTerminal(terminal, 'the member to read the owner\'s line', () => textIn(terminal.fake.gotFile) === LEAVE_LINE, t)
  await untilOnTerminal(terminal, 'the launcher to say its member stopped by itself', () => terminal.shown().includes('stopped by itself'), t)
})

test('a wait on the owner\'s terminal fails at once, naming the refusal, once the launcher has refused (#94)', async (t) => {
  const place = placeFor(t)
  const command = join(place.home, 'no-such-claude')
  const terminal = terminalLaunch(t, place, { command })
  await assert.rejects(
    untilOnTerminal(terminal, 'the launcher to say its member stopped by itself', () => terminal.shown().includes('stopped by itself'), t),
    (error: Error) => error.message.startsWith('the launcher to say its member stopped by itself cannot happen: refused: ') && error.message.includes(notACommandThisLauncherCanRun(command)),
  )
})

/** A member that exits as soon as it runs: before #94 the launcher could read its pid after it had gone. */
function exitsAtOnce(place: Place): string {
  const command = join(place.home, 'claude-that-exits-at-once')
  writeFileSync(command, ['#!/bin/sh', ...hostAnswers(), 'exit 0', ''].join('\n'), { mode: 0o700 })
  return command
}

test('a member on the owner\'s terminal that exits at once is recorded and stops by itself, never refused as not running (#94)', async (t) => {
  const place = placeFor(t)
  const terminal = terminalLaunch(t, place, { command: exitsAtOnce(place) })
  await untilOnTerminal(terminal, 'the launcher to say its member stopped by itself', () => terminal.shown().includes('stopped by itself'), t)
  assert.match(terminal.shown(), /started \d+/)
})

test('a detached member that exits at once is recorded and stops by itself, never refused as not running (#94)', async (t) => {
  const place = placeFor(t)
  const launcher = spawn(process.execPath, [launcherProcess(place, exitsAtOnce(place))], { stdio: ['ignore', 'pipe', 'inherit'] })
  const ended = new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to say its member stopped by itself', () => said.includes('stopped by itself'), t, () => said, () => REFUSED_LINE.exec(said)?.[0])
  assert.match(said, /^started \d+\nstopped by itself\n$/)
})

for (const [what, make] of [
  ['names no command on its PATH', (dir: string) => join(dir, 'no-such-claude')],
  ['is a file that cannot be run', (dir: string) => {
    const file = join(dir, 'not-runnable-claude')
    writeFileSync(file, '#!/bin/sh\n', { mode: 0o600 })
    return file
  }],
] as const) {
  test(`a member on the owner's terminal whose command ${what} is refused at start and leaves nothing behind`, async (t) => {
    const place = placeFor(t)
    const command = make(place.home)
    const terminal = terminalLaunch(t, place, { command })
    await untilOnTerminal(terminal, 'the launcher to refuse the launch', () => terminal.shown().includes('refused: '), t)
    assert.ok(terminal.shown().includes(`refused: ${NOT_STARTED}: ${notACommandThisLauncherCanRun(command)}`), terminal.shown())
    assert.deepEqual(readdirSync(place.relay_root), [])
    assert.deepEqual(readdirSync(place.snapshot_root), [])
  })
}

test('a launcher script that cannot load fails the test at once, naming the export it wanted and did not get (martha#454)', async (t) => {
  const place = placeFor(t)
  // A script whose import names something the launch module does not export. The host ends it before it starts anything,
  // and the terminal shows no line at all, so the launcher's own error is the only thing that can say why: without it
  // the wait runs to the harness's timeout, which reports the wait and never the script.
  const script = join(place.home, 'launcher-that-cannot-load.ts')
  const launchModule = new URL('./launch_a_claude_code_member.ts', import.meta.url).href
  writeFileSync(script, `import { launchClaudeCodeMember, NOTHING_THIS_MODULE_EXPORTS } from ${JSON.stringify(launchModule)}\nvoid launchClaudeCodeMember\nvoid NOTHING_THIS_MODULE_EXPORTS\n`)
  // A file, so what the launcher printed is read as the launcher wrote it, with no race against the terminal.
  const said = join(place.home, 'launcher-that-cannot-load.stderr')
  await assert.rejects(ownersTerminal(t, place, { launcher_script: script, stderrTo: said }), (failure: Error) => {
    // The harness's timeout is the failure this replaces, and it names nothing.
    assert.doesNotMatch(failure.message, /timed out/)
    assert.match(failure.message, /the launcher ended with status 1 and started nothing/)
    assert.match(failure.message, /does not provide an export named 'NOTHING_THIS_MODULE_EXPORTS'/)
    return true
  })
})

// The recorded host itself, on the owner's terminal (martha#117). The host writes
// its generated types into the folder --plugin-dir names on an interactive start,
// only the files that are missing, and keeps what is there; no stand-in does, so
// only the host can show a launch leaves the installed relay folder as it was.
// The case skips on RECORDED_HOST_SKIP; ci.yml's relay job runs it with the recorded
// version, as prove_the_relay_loads/recorded_host_runs.json lists, and checks first that this host does write into a writable folder, so a pass here is not
// a host that writes nothing.

/** Every file under `directory`, by its path inside it, with the SHA-256 of its bytes. */
function treeOf(directory: string): Record<string, string> {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => !entry.isDirectory())
  return Object.fromEntries(
    files
      .map((entry) => join(entry.parentPath, entry.name))
      .map((path) => [relative(directory, path), createHash('sha256').update(readFileSync(path)).digest('hex')] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

test(
  "with the recorded host on the owner's terminal, a launch leaves the installed relay folder as it was (martha#117)",
  { skip: RECORDED_HOST_SKIP },
  async (t) => {
    const host = recordedHost()
    // No mesh server: the real host would start one.
    const place = placeFor(t, JSON.stringify({ mcpServers: {} }))
    // What an owner's first run records: onboarding done and the checkout trusted. No account and no key.
    const home = join(place.home, 'host-home')
    mkdirSync(home, { mode: 0o700 })
    writeFileSync(join(home, HOST_TRUST_RECORD_FILE), JSON.stringify({ hasCompletedOnboarding: true, projects: { [place.checkout]: { hasTrustDialogAccepted: true } } }))
    const before = treeOf(RELAY_PLUGIN_DIR)

    const terminal = terminalLaunch(t, place, { command: host, inherited: { HOME: home, TERM: HOST_TERMINAL }, args: [] })
    await untilOnTerminal(terminal, "the relay to report the session's start", () => readdirSync(place.rows).length > 0, t)
    // Out through the host's own exit, so whatever it does on its start is done.
    terminal.press(`${HOST_EXIT_COMMAND}\r`)
    await untilOnTerminal(terminal, 'the launch to end', () => /stopped /.test(terminal.shown()), t)

    assert.deepEqual(treeOf(RELAY_PLUGIN_DIR), before)
    assert.deepEqual(readdirSync(place.relay_root), [])
  },
)

/** What these launches started the host with: the arguments and environment the adapter's declaration names (martha#135). */
function startedWithTheSwitchesOfTheAdapter(): StartedWith {
  return startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env)
}


// martha#129: a `martha run <name>` the launcher allowed is the one call a run binds to; the client asks on
// RUN_PATH; the receipt is taken once, at tool_answered.
const RUN_OUTPUT = 'ok 1 - the suite passed\n'

async function runOverSocket(socket_path: string, body: unknown) {
  const answer = await fetchOverSocket(`${RELAY_ORIGIN}${RUN_PATH}`, { method: 'POST', headers: {}, body: JSON.stringify(body), socketPath: socket_path })
  return heardRan(answer.status, answer.text)
}

test('a martha run call the launcher allowed binds one run, served on its path, and its receipt is taken at the answer (martha#129)', async (t) => {
  const place = placeFor(t)
  const ran: string[] = []
  const receipts = receiptsInMemory()
  const runs = signedRunsOf(receipts, async (name) => (ran.push(name), { output: Buffer.from(RUN_OUTPUT), status: 1 }), () => ['test'], CLAUDE_CODE_BASH_RESULT_SHAPES)
  const { relay } = answering(place, rowStreamsDirectory(place.rows), [], runs)
  const directory = makeRelayDirectory(join(place.relay_root, 'relay-runs'))
  assert.ok(directory.made)
  if (!directory.made) return
  const server = await serveTheRelay(relay, directory.socket_path)
  t.after(() => (void server.close(), directory.remove()))

  assert.deepEqual(await relay.answer('session_started', start('startup')), TAKEN_REPLY)
  assert.deepEqual(await runOverSocket(directory.socket_path, { name: 'test' }), { ran: false, why: 'no martha run test call is pending' })
  const bash = call(CLAUDE_CODE_SHELL_TOOL, { command: `${RUN_COMMAND_PREFIX}test`, tool_use_id: 'toolu_9' })
  assert.deepEqual(await relay.answer('tool_called', bash), ALLOW_REPLY)
  assert.deepEqual(await runOverSocket(directory.socket_path, { name: 'test' }), { ran: true, status: 1, output: Buffer.from(RUN_OUTPUT).toString('base64') })
  assert.deepEqual(ran, ['test'])
  assert.deepEqual(await relay.answer('tool_answered', bash), TAKEN_REPLY)
  // Taken at the answer: nothing is left for the call, and no second run binds to it.
  assert.equal(receipts.take('toolu_9'), undefined)
  assert.deepEqual(await runOverSocket(directory.socket_path, { name: 'test' }), { ran: false, why: 'no martha run test call is pending' })
  assert.equal(sha256Of(RUN_OUTPUT).length, 64)
})

test('a martha run call the launcher denied binds no run (martha#129)', async (t) => {
  const place = placeFor(t)
  const ran: string[] = []
  const { relay } = answering(place, rowStreamsDirectory(place.rows), [], signedRunsOf(receiptsInMemory(), async (name) => (ran.push(name), { output: Buffer.alloc(0), status: 0 }), () => ['test'], CLAUDE_CODE_BASH_RESULT_SHAPES))
  await relay.answer('session_started', start('startup'))
  await relay.answer('tool_called', call('mcp__probe__fetch_page'))
  await relay.answer('tool_answered', call('mcp__probe__fetch_page'))
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: `${RUN_COMMAND_PREFIX}test`, tool_use_id: 'toolu_9' })), /B2/))
  assert.deepEqual(await relay.run({ name: 'test' }), { refused: 'no martha run test call is pending' })
  assert.deepEqual(ran, [])
})

test('a member launched without signed runs runs no shape (martha#129)', async (t) => {
  const { relay } = answering(placeFor(t))
  assert.deepEqual(await relay.run({ name: 'test' }), { refused: NO_SIGNED_RUNS })
})

// --- a signed run's answer keeps the shell (martha#129, design step 4) ---------------------------
//
// The exemption is judged where it is used: a `martha run test` the launcher allowed, a receipt kept for that very
// call by a run, and the answer the host showed for it. What every test below asks is the same question the member
// asks after its tests: does the next `Edit` run? A recorded `Bash` result takes the shell (martha#127), so an
// `Edit` that is allowed is the proof that nothing was recorded.

const SIGNED_NAME = 'test'
const RUN_TOOL_USE_ID = 'toolu_run'

/** The answer the pinned host shows for a run that ended with `status` and printed `output`. */
const hostAnswerFor = (status: number, output: string): unknown => resultBuiltFrom(CLAUDE_CODE_BASH_RESULT_SHAPES, status, output)

/** Signed runs over a fresh receipt store, on the names given, each run giving `ended` without running anything. */
const signedRunsGiving = (ended: { output: string; status: number }, names: readonly string[] = [SIGNED_NAME]): SignedRuns =>
  signedRunsOf(receiptsInMemory(), async () => ({ output: Buffer.from(ended.output), status: ended.status }), () => names, CLAUDE_CODE_BASH_RESULT_SHAPES)

interface OneRun {
  readonly command?: string
  readonly tool_use_id?: string
  readonly run_in_background?: unknown
  readonly status?: number
  readonly output?: string
  readonly signed?: readonly string[]
  /** The answer the host showed, when not the one the receipt builds. */
  readonly answer?: unknown
}

const bashCall = (one: OneRun) =>
  call(CLAUDE_CODE_SHELL_TOOL, {
    command: one.command ?? `${RUN_COMMAND_PREFIX}${SIGNED_NAME}`,
    tool_use_id: one.tool_use_id ?? RUN_TOOL_USE_ID,
    ...(one.run_in_background === undefined ? {} : { run_in_background: one.run_in_background }),
  })

/** One answered run: what it recorded, and whether an `Edit` still runs after it. */
async function afterARunWasAnswered(place: Place, one: OneRun = {}): Promise<{ paths: string[]; edit: RelayReply; ran: Ran | Refused }> {
  const status = one.status ?? 0
  const output = one.output ?? RUN_OUTPUT
  const { relay, rows } = answering(place, rowStreamsDirectory(place.rows), [], signedRunsGiving({ output, status }, one.signed))
  await relay.answer('session_started', start('startup'))
  const bash = bashCall(one)
  assert.deepEqual(await relay.answer('tool_called', bash), ALLOW_REPLY)
  const ran = await relay.run({ name: SIGNED_NAME })
  assert.deepEqual(await relay.answer('tool_answered', { session_id: SESSION, call: bash.call, answer: one.answer ?? hostAnswerFor(status, output) }), TAKEN_REPLY)
  return { paths: await recordedPaths(rows), edit: await relay.answer('tool_called', call(EDIT_TOOL, { file_path: join(place.checkout, 'README.md'), old_string: 'a', new_string: 'b' })), ran }
}

test('a signed run whose answer is exactly the one its receipt builds keeps the shell, for exit 0 and for exit 1 (martha#129)', async (t) => {
  for (const status of [0, 1]) {
    const after = await afterARunWasAnswered(placeFor(t), { status })
    assert.deepEqual(after.paths, [], `a status ${String(status)} run records nothing`)
    assert.deepEqual(after.edit, ALLOW_REPLY, `and the Edit after a status ${String(status)} run runs`)
  }
})

test('the same run with an answer one byte or one field off records A13, and the Edit after it is denied (martha#129)', async (t) => {
  const correct = hostAnswerFor(0, RUN_OUTPUT) as { readonly result: Readonly<Record<string, unknown>>; readonly text: string }
  const variants: readonly { readonly what: string; readonly answer: unknown }[] = [
    { what: 'one extra byte of output', answer: { ...correct, text: `${correct.text}x`, result: { ...correct.result, stdout: `${String(correct.result['stdout'])}x` } } },
    { what: 'one byte on stderr', answer: { ...correct, result: { ...correct.result, stderr: 'a stranger wrote here' } } },
    { what: 'the output truncated', answer: { ...correct, text: correct.text.slice(0, -1) } },
    { what: 'one extra key', answer: { ...correct, note: 'added by another hook' } },
    { what: 'the error form of exit 1', answer: hostAnswerFor(1, RUN_OUTPUT) },
  ]
  for (const { what, answer } of variants) {
    const after = await afterARunWasAnswered(placeFor(t), { answer })
    assert.deepEqual(after.paths, ['A13:null'], `an answer with ${what} is not the one the run gave`)
    assert.ok(isDenied(after.edit, /A13/), what)
  }
})

test('only the exact command is a signed run: a prefix, a trailing space, a pipe or the script typed directly records A13 (martha#129)', async (t) => {
  for (const command of [`cd . && martha run ${SIGNED_NAME}`, `martha run ${SIGNED_NAME} `, ` martha run ${SIGNED_NAME}`, `martha run ${SIGNED_NAME}; id`, 'npm test']) {
    const after = await afterARunWasAnswered(placeFor(t), { command })
    assert.deepEqual(after.paths, ['A13:null'], command)
    assert.ok(isDenied(after.edit, /A13/), command)
  }
})

test('a run asked for in the background never keeps the shell (martha#129)', async (t) => {
  const after = await afterARunWasAnswered(placeFor(t), { run_in_background: true })
  assert.deepEqual(after.paths, ['A13:null'])
  assert.ok(isDenied(after.edit, /A13/))
})

test('a receipt binds one call: an answer under another tool_use_id takes none of it and records A13 (martha#129)', async (t) => {
  const place = placeFor(t)
  const answer = hostAnswerFor(0, RUN_OUTPUT)
  const { relay, rows } = answering(place, rowStreamsDirectory(place.rows), [], signedRunsGiving({ output: RUN_OUTPUT, status: 0 }))
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', bashCall({})), ALLOW_REPLY)
  assert.deepEqual(await relay.run({ name: SIGNED_NAME }), { ran: 1, status: 0, output: Buffer.from(RUN_OUTPUT).toString('base64') })
  assert.deepEqual(await relay.answer('tool_answered', { session_id: SESSION, call: bashCall({ tool_use_id: 'toolu_other' }).call, answer }), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), ['A13:null'], 'the receipt is kept for the call the relay saw, not for another')
  assert.ok(isDenied(await relay.answer('tool_called', call(EDIT_TOOL, { file_path: join(place.checkout, 'README.md'), old_string: 'a', new_string: 'b' })), /A13/))
})

test('a receipt is spent by the answer it was kept for: a second answer for that call records A13 (martha#129)', async (t) => {
  const place = placeFor(t)
  const answer = hostAnswerFor(0, RUN_OUTPUT)
  const { relay, rows } = answering(place, rowStreamsDirectory(place.rows), [], signedRunsGiving({ output: RUN_OUTPUT, status: 0 }))
  await relay.answer('session_started', start('startup'))
  const bash = bashCall({})
  assert.deepEqual(await relay.answer('tool_called', bash), ALLOW_REPLY)
  assert.deepEqual(await relay.run({ name: SIGNED_NAME }), { ran: 1, status: 0, output: Buffer.from(RUN_OUTPUT).toString('base64') })
  assert.deepEqual(await relay.answer('tool_answered', { session_id: SESSION, call: bash.call, answer }), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), [], 'the first answer keeps the shell and records nothing')
  assert.deepEqual(await relay.answer('tool_called', call(EDIT_TOOL, { file_path: join(place.checkout, 'README.md'), old_string: 'a', new_string: 'b' })), ALLOW_REPLY)
  assert.deepEqual(await relay.answer('tool_answered', { session_id: SESSION, call: bash.call, answer }), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), ['A13:null'], 'the receipt was spent, so the second answer has nothing to be built from')
  assert.ok(isDenied(await relay.answer('tool_called', call(EDIT_TOOL, { file_path: join(place.checkout, 'README.md'), old_string: 'a', new_string: 'b' })), /A13/))
})

// A kept run is a run that recorded nothing, not a call that skipped the checks (martha#129 r=2). The rechecks run
// before the exemption is judged, so a launch that changed under the run, or a settings file that turned the relay
// off, stops the member exactly as it does after any other call: an answer that would otherwise keep the shell keeps
// nothing when the launcher can no longer vouch for what it is running in.
test('a kept run whose launch changed under it still stops the member, and records nothing (martha#129 r=2)', async (t) => {
  const place = placeFor(t)
  const { relay, stops, rows } = answering(place, rowStreamsDirectory(place.rows), [], signedRunsGiving({ output: RUN_OUTPUT, status: 0 }))
  await relay.answer('session_started', start('startup'))
  const bash = bashCall({})
  assert.deepEqual(await relay.answer('tool_called', bash), ALLOW_REPLY)
  assert.deepEqual(await relay.run({ name: SIGNED_NAME }), { ran: 1, status: 0, output: Buffer.from(RUN_OUTPUT).toString('base64') })
  // A stranger's change to the config, after the call was allowed and before it was answered.
  writeFileSync(join(place.checkout, '.mcp.json'), JSON.stringify({ mcpServers: {} }))
  const after = await relay.answer('tool_answered', { session_id: SESSION, call: bash.call, answer: hostAnswerFor(0, RUN_OUTPUT) })
  assert.equal(after.answered, false, 'the member is stopped, never answered with a taken')
  assert.equal(stops.length, 1)
  assert.ok((stops[0] ?? '').includes('.mcp.json'), stops[0] ?? 'no stop')
  assert.deepEqual(await recordedPaths(rows), [], 'a stopped member records nothing')
})

test('a kept run whose settings turned the relay off still stops the member, and records nothing (martha#129 r=2)', async (t) => {
  assert.ok(HOOKS_OFF !== undefined)
  const place = placeFor(t)
  const { relay, stops, rows } = answering(place, rowStreamsDirectory(place.rows), [], signedRunsGiving({ output: RUN_OUTPUT, status: 0 }))
  await relay.answer('session_started', start('startup'))
  const bash = bashCall({})
  assert.deepEqual(await relay.answer('tool_called', bash), ALLOW_REPLY)
  assert.deepEqual(await relay.run({ name: SIGNED_NAME }), { ran: 1, status: 0, output: Buffer.from(RUN_OUTPUT).toString('base64') })
  const file = writeSettings(join(place.home, USER_SETTINGS), { [HOOKS_OFF]: true })
  const after = await relay.answer('tool_answered', { session_id: SESSION, call: bash.call, answer: hostAnswerFor(0, RUN_OUTPUT) })
  assert.equal(after.answered, false, 'the member is stopped, never answered with a taken')
  assert.equal(stops.length, 1)
  assert.ok((stops[0] ?? '').includes(file) && (stops[0] ?? '').includes(HOOKS_OFF), stops[0] ?? 'no stop')
  assert.deepEqual(await recordedPaths(rows), [], 'a stopped member records nothing')
})

test('a name the owner did not sign is not exempt, even with a receipt and the recorded answer (martha#129)', async (t) => {
  const after = await afterARunWasAnswered(placeFor(t), { signed: [] })
  assert.deepEqual(after.paths, ['A13:null'])
  assert.ok(isDenied(after.edit, /A13/))
})

// --- an agent the host started under this session (martha#170) ----------------------------------
//
// A background agent hands its answer into the member's turn with no tool result to place it on, so the launcher's
// own record of the agent — its start, its calls, its stop — is what places that answer: on nothing when the agent is
// vouched for, on B7 when it is not.

/** One agent's answer as the host stamps it: `tool_response.agentId`, on the member's own call (martha#170). */
const anAgentsAnswer = (agentId: string, status = 'completed') => ({ agentId, status, content: [{ type: 'text', text: 'reviewed' }] })

const agentStart = (agent_id: string, session_id = SESSION) => ({ session_id, agent_id, agent_type: 'general-purpose' })
const agentStop = (agent_id: string, session_id = SESSION) => ({ session_id, agent_id, agent_type: 'general-purpose', last_assistant_message: 'no findings' })

/** A session started, an agent started under it, and the agent's one call answered or left unanswered. */
async function anAgentUnderASession(t: TestContext, options: { readonly answerItsCall: boolean }): Promise<{ asking: Answering; session_id: string; agent_id: string }> {
  const place = placeFor(t)
  const asking = answering(place)
  const session_id = 'agent-session-1'
  const agent_id = 'ag-0000000000001'
  await asking.relay.answer('session_started', start('startup', session_id))
  assert.deepEqual(await asking.relay.answer('subagent_started', agentStart(agent_id, session_id)), TAKEN_REPLY)
  // The agent reads a file in the tree the owner approved, which records nothing: a review of the approved tree is the
  // case this design is for, and a command's output would record A13 and close the shell on its own row (martha#127).
  const inside = join(place.checkout, 'README.md')
  const itsCall = { session_id, call: { tool: 'Read', tool_use_id: 'tu-agent-1', agent_id, file_path: inside } }
  assert.deepEqual(await asking.relay.answer('tool_called', itsCall), ALLOW_REPLY)
  if (options.answerItsCall) {
    assert.equal((await asking.relay.answer('tool_answered', { session_id, call: itsCall.call, answer: { file: { filePath: inside, content: 'a checkout' } } })).answered, true)
  }
  return { asking, session_id, agent_id }
}

/** The launcher's answer to the member's own shell call after all of the above. */
const afterTheAgent = async (pair: { asking: Answering; session_id: string }, agent_id: string, completion: boolean): Promise<RelayReply> => {
  if (completion) assert.deepEqual(await pair.asking.relay.answer('subagent_stopped', agentStop(agent_id, pair.session_id)), TAKEN_REPLY)
  return pair.asking.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, pair.session_id))
}

test('a background agent’s completion from an agent the launcher cannot vouch for closes the shell (martha#170, case 1)', async (t) => {
  // Its one call was never answered here, so the agent is not vouched for.
  const pair = await anAgentUnderASession(t, { answerItsCall: false })
  const denied = await afterTheAgent(pair, pair.agent_id, true)
  assert.ok(isDenied(denied, /subagent/), JSON.stringify(denied))
  assert.ok((await recordedPaths(pair.asking.rows, pair.session_id)).includes('B7:null'), 'the completion is recorded on B7')
})

test('a vouched agent’s completion keeps the shell (martha#170, case 2)', async (t) => {
  const pair = await anAgentUnderASession(t, { answerItsCall: true })
  assert.deepEqual(await afterTheAgent(pair, pair.agent_id, true), ALLOW_REPLY)
})

test('while an agent is between its start and its stop the shell is refused, and the stop gives it back (martha#170, case 3)', async (t) => {
  const pair = await anAgentUnderASession(t, { answerItsCall: true })
  const whileRunning = await pair.asking.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, pair.session_id))
  assert.ok(isDenied(whileRunning, /has not stopped/), JSON.stringify(whileRunning))
  const readOnly = await pair.asking.relay.answer('tool_called', call('Read', { file_path: join(tmpdir(), 'anything.md') }, pair.session_id))
  assert.deepEqual(readOnly, ALLOW_REPLY, 'reading is still allowed while an agent runs')
  assert.deepEqual(await afterTheAgent(pair, pair.agent_id, true), ALLOW_REPLY)
})

test('the member’s own Agent result is placed by tool_response.agentId, never by the tool name (martha#170, case 4)', async (t) => {
  const vouched = await anAgentUnderASession(t, { answerItsCall: true })
  const spawnResult = await vouched.asking.relay.answer('tool_answered', {
    session_id: vouched.session_id,
    call: { tool: 'Agent', tool_use_id: 'tu-spawn', prompt: 'review' },
    answer: anAgentsAnswer(vouched.agent_id),
  })
  assert.equal(spawnResult.answered, true)
  assert.deepEqual(await afterTheAgent(vouched, vouched.agent_id, true), ALLOW_REPLY, 'a vouched agent’s answer adds nothing')

  const stranger = answering(placeFor(t))
  await stranger.relay.answer('session_started', start('startup', 'agent-session-2'))
  await stranger.relay.answer('tool_answered', {
    session_id: 'agent-session-2',
    call: { tool: 'Agent', tool_use_id: 'tu-spawn-2', prompt: 'review' },
    answer: anAgentsAnswer('ag-never-seen-00001'),
  })
  const denied = await stranger.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, 'agent-session-2'))
  assert.ok(isDenied(denied, /subagent/), JSON.stringify(denied))
})

test('a handback the agent makes itself is placed by the agent_id on its call, and a vouched agent keeps the shell (martha#170, case 5)', async (t) => {
  const pair = await anAgentUnderASession(t, { answerItsCall: true })
  // The real shape (Claude Code 2.1.322): the subagent calls SubagentHandback itself, so the call carries the
  // hook-level agent_id and the answer is `{success, message}` with no agentId on it at all.
  const itsHandback = { session_id: pair.session_id, call: { tool: 'SubagentHandback', tool_use_id: 'tu-handback', agent_id: pair.agent_id, message: 'my findings' } }
  assert.deepEqual(await pair.asking.relay.answer('tool_called', itsHandback), ALLOW_REPLY)
  const handback = await pair.asking.relay.answer('tool_answered', { ...itsHandback, answer: { success: true, message: 'Report delivered to your caller.' } })
  assert.equal(handback.answered, true)
  const recorded = (await recordedPaths(pair.asking.rows, pair.session_id)).filter((p) => p.startsWith('B7'))
  assert.deepEqual(recorded, [], 'the handback recorded: ' + JSON.stringify(recorded))
  // The agent is still inside its run when it hands back, so the shell stays held until its stop — and a vouched
  // agent's stop gives it back.
  assert.ok(isDenied(await pair.asking.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, pair.session_id)), /has not stopped/))
  assert.deepEqual(await afterTheAgent(pair, pair.agent_id, true), ALLOW_REPLY)
})

test('a handback from an agent the launcher never saw start holds the shell while it runs and records B7 when it stops (martha#170, case 5)', async (t) => {
  const stranger = answering(placeFor(t))
  const session_id = 'agent-session-3'
  const agent_id = 'ag-never-seen-00002'
  await stranger.relay.answer('session_started', start('startup', session_id))
  const itsHandback = { session_id, call: { tool: 'SubagentHandback', tool_use_id: 'tu-handback-2', agent_id, message: 'my findings' } }
  assert.deepEqual(await stranger.relay.answer('tool_called', itsHandback), ALLOW_REPLY)
  await stranger.relay.answer('tool_answered', { ...itsHandback, answer: { success: true, message: 'Report delivered to your caller.' } })
  // A handback records nothing by itself, so the stop is what places the text: until it lands the agent holds the
  // shell, and when it lands an agent this launcher never saw start records B7.
  const whileRunning = await stranger.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, session_id))
  assert.ok(isDenied(whileRunning, /never saw start/), JSON.stringify(whileRunning))
  assert.deepEqual(await stranger.relay.answer('subagent_stopped', agentStop(agent_id, session_id)), TAKEN_REPLY)
  const denied = await stranger.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, session_id))
  assert.ok(isDenied(denied, /subagent/), JSON.stringify(denied))
  assert.ok((await recordedPaths(stranger.rows, session_id)).includes('B7:null'), 'the stop records the text it cannot vouch for')
})

test('a handback naming an agent the launcher has no run of records B7 and refuses the shell at once (martha#170, case 5)', async (t) => {
  // Uranus's probe r2: the answer arrives with no start and no tool_called before it, so the launcher has no run for
  // this id at all. Placing it as a running agent's answer would let the handback hand text into the turn and record
  // nothing, which is the hole r=2 opened; an id with no run is unknown, and unknown records on B7 (martha#170).
  const stranger = answering(placeFor(t))
  const session_id = 'agent-session-5'
  await stranger.relay.answer('session_started', start('startup', session_id))
  const itsHandback = { session_id, call: { tool: 'SubagentHandback', tool_use_id: 'tu-handback-3', agent_id: 'ag-ghost-0009', message: 'my findings' } }
  assert.equal((await stranger.relay.answer('tool_answered', { ...itsHandback, answer: { success: true, message: 'Report delivered to your caller.' } })).answered, true)
  const recorded = (await recordedPaths(stranger.rows, session_id)).filter((p) => p.startsWith('B7'))
  assert.deepEqual(recorded, ['B7:null'], 'the handback recorded: ' + JSON.stringify(recorded))
  const denied = await stranger.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, session_id))
  assert.ok(isDenied(denied, /subagent/), JSON.stringify(denied))
})

test('a handback naming a vouched agent that has already stopped records nothing and keeps the shell (martha#170, case 5)', async (t) => {
  // Uranus's probe r3a: a stopped run is not by itself unknown. A run the launcher vouched for records nothing even
  // after its stop, and the page says so now — only a run that stopped WITHOUT being vouched goes to B7.
  const pair = await anAgentUnderASession(t, { answerItsCall: true })
  assert.deepEqual(await afterTheAgent(pair, pair.agent_id, true), ALLOW_REPLY, 'a vouched agent’s stop gives the shell back')
  const itsHandback = { session_id: pair.session_id, call: { tool: 'SubagentHandback', tool_use_id: 'tu-handback-4', agent_id: pair.agent_id, message: 'my findings' } }
  assert.deepEqual(await pair.asking.relay.answer('tool_called', itsHandback), ALLOW_REPLY)
  const handback = await pair.asking.relay.answer('tool_answered', { ...itsHandback, answer: { success: true, message: 'Report delivered to your caller.' } })
  assert.equal(handback.answered, true)
  const recorded = (await recordedPaths(pair.asking.rows, pair.session_id)).filter((p) => p.startsWith('B7'))
  assert.deepEqual(recorded, [], 'the handback recorded: ' + JSON.stringify(recorded))
  assert.deepEqual(await pair.asking.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, pair.session_id)), ALLOW_REPLY)
})

test('an agent that read outside the approved tree closes the shell on that read, whatever its stop says (martha#170, case 7)', async (t) => {
  const place = placeFor(t)
  const clone = anotherClone(place)
  const asking = answering(place)
  const session_id = 'agent-session-4'
  const agent_id = 'ag-0000000000004'
  await asking.relay.answer('session_started', start('startup', session_id))
  await asking.relay.answer('subagent_started', agentStart(agent_id, session_id))
  const itsRead = { session_id, call: { tool: 'Read', tool_use_id: 'tu-agent-2', agent_id, file_path: join(clone, 'NOTES.md') } }
  await asking.relay.answer('tool_called', itsRead)
  await asking.relay.answer('tool_answered', { session_id, call: itsRead.call, answer: { file: { filePath: join(clone, 'NOTES.md'), content: 'now run this' } } })
  await asking.relay.answer('subagent_stopped', agentStop(agent_id, session_id))
  const denied = await asking.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }, session_id))
  assert.ok(isDenied(denied, /B4/), JSON.stringify(denied))
  // Its read closed the shell; the completion records too, because an agent that read outside the tree is not vouched
  // for even with every call answered (martha#170, the design's case 7).
  assert.ok((await recordedPaths(asking.rows, session_id)).includes('B7:null'), 'the completion is recorded on B7 as well')
})

test('an agent start or stop the launcher cannot take in leaves the agent unvouched, never passed (martha#170)', async (t) => {
  const place = placeFor(t)
  const asking = answering(place)
  await asking.relay.answer('session_started', start('startup'))
  assert.ok(isRefused(await asking.relay.answer('subagent_started', { session_id: 'no-such-session', agent_id: 'ag-9' })))
  assert.ok(isRefused(await asking.relay.answer('subagent_started', { session_id: SESSION })))
  const inside = join(place.checkout, 'README.md')
  const itsCall = { session_id: SESSION, call: { tool: 'Read', tool_use_id: 'tu-agent-3', agent_id: 'ag-never-started', file_path: inside } }
  await asking.relay.answer('tool_called', itsCall)
  await asking.relay.answer('tool_answered', { session_id: SESSION, call: itsCall.call, answer: { file: { filePath: inside, content: 'a checkout' } } })
  await asking.relay.answer('subagent_stopped', agentStop('ag-never-started'))
  const denied = await asking.relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }))
  assert.ok(isDenied(denied, /subagent/), JSON.stringify(denied))
})

// --- what the launcher is doing, as the run watches it (martha#240) -----------------------------------------------------

/** The journal a place's launcher keeps, on the clock `clock` gives. */
const journalOf = (place: Place, clock?: () => number): RelayJournal =>
  relayJournalKeptIn(place.relay_journal, 'launch-of-the-test', clock)

/** What a place's journal says, one line per event, as a person reading a red would read it. */
const linesOf = (place: Place): string[] =>
  readTheNewestRelayJournal(place.relay_journal).events.map(
    (line) => `${line.phase} ${line.event}${line.tool_use_id === undefined ? '' : ` ${line.tool_use_id}`}${line.answer === undefined ? '' : ` ${line.answer}`}`,
  )

/** The owner's own turn, so the shell is the member's: the gate keeps it for a typed turn (#51). */
const theOwnersTurn = async (relay: MemberRelay): Promise<void> => {
  await relay.answer('session_started', start('startup'))
  await relay.answer('prompt_submitted', prompt('composer', 'run the tests'))
}

test('each event is a line as it arrives and a line as it is answered, and an allowed call stays open until its answer comes back', async (t) => {
  const place = placeFor(t)
  const { relay } = answering(place, undefined, [], undefined, journalOf(place))
  await theOwnersTurn(relay)
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls', tool_use_id: 'call_00_the_test' })), ALLOW_REPLY)
  assert.deepEqual(linesOf(place), [
    'received session_started',
    'answered session_started taken',
    'received prompt_submitted',
    'answered prompt_submitted taken',
    'received tool_called call_00_the_test',
    'answered tool_called call_00_the_test allow',
  ])
  // The call the launcher allowed is the one a run waits on, by the host's own id for it.
  assert.deepEqual(
    readTheNewestRelayJournal(place.relay_journal).open.map((open) => `${open.tool_use_id} ${open.tool}`),
    ['call_00_the_test Bash'],
  )
  await relay.answer('tool_answered', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls', tool_use_id: 'call_00_the_test' }))
  assert.deepEqual(readTheNewestRelayJournal(place.relay_journal).open, [], 'the tool came back and the call is still open')
})

test('a call the launcher denies never opens, so a run has nothing to wait on', async (t) => {
  const place = placeFor(t)
  const { relay } = answering(place, undefined, [], undefined, journalOf(place))
  // A call on a session whose start was never taken: the launcher refuses it, and a refusal is a deny here.
  const reply = await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls', tool_use_id: 'call_00_denied' }))
  assert.ok(isDenied(reply, /no start of session/), 'the launcher answered a call this case needed denied')
  assert.deepEqual(readTheNewestRelayJournal(place.relay_journal).open, [])
  assert.deepEqual(linesOf(place), ['received tool_called call_00_denied', 'answered tool_called call_00_denied deny'])
})

test('an allow the relay gave up on is journalled as the deny the host took, and the member is answered as before', async (t) => {
  const place = placeFor(t)
  // The receipt is stamped on the journal's clock as it arrives; this clock then jumps past the relay's deadline, which
  // is what a launcher that took 30 s to decide looks like from the relay's side.
  let late_by = 0
  const { relay } = answering(place, undefined, [], undefined, journalOf(place, () => Date.now() + late_by))
  await theOwnersTurn(relay)
  const answered = relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls', tool_use_id: 'call_00_late' }))
  // Stamped before the event queues, so moving the clock here is moving it between the receipt and the answer (martha#240).
  late_by = RELAY_DEADLINE_MS + 1
  assert.deepEqual(await answered, ALLOW_REPLY, 'the member was answered differently, and only the journal was meant to change')
  const kept = readTheNewestRelayJournal(place.relay_journal)
  assert.equal(kept.events.at(-1)?.answer, 'deny', 'an allow the relay gave up on was journalled as an allow')
  assert.equal(kept.events.at(-1)?.why, GAVE_UP_BEFORE_ALLOW)
  assert.deepEqual(kept.open, [], 'the late allow opened a call, so a run would wait on a tool that never ran')
})

// --- a member's first mesh answer (martha#251) ------------------------------------

/** The recording's own bare `mesh_hello` answer: an answer the pinned server really gave. */
function recordedHello(): Readonly<Record<string, unknown>> {
  const version = RECORDED_MESH_ANSWER_SHAPES.at(-1)
  const bare = version?.states['bare'] as Readonly<Record<string, unknown>> | undefined
  const hello = bare?.[MESH_HELLO] as Readonly<Record<string, unknown>> | undefined
  assert.ok(hello !== undefined, 'the recording carries no bare mesh_hello answer')
  return hello
}

test('a member’s first mesh answer records nothing, so its ring reaches A5 instead of being refused (martha#251)', async (t) => {
  const place = placeFor(t)
  const hello = recordedHello()
  const ring = hello['ring'] as Readonly<Record<string, unknown>>
  const policy_file = String(ring['policy_file'])
  const home = policy_file.slice(0, policy_file.length - `/${CONTACT_POLICY_FILE_UNDER_HOME}`.length)
  const { relay, rows } = answering(place, undefined, [], undefined, undefined, 'enforced', undefined, {
    node_id: String(hello['node_id']),
    env: { HOME: home },
    home,
    host_version: RECORDED_HOST.host_version,
  })
  await relay.answer('session_started', start('startup'))
  const helloAnswer = [{ type: 'text', text: JSON.stringify(hello, null, 2) }]
  const session = (extra: Record<string, unknown>) => ({ session_id: SESSION, ...extra })

  // The call's own input is the member's words, and the launcher reads them from the call itself.
  assert.deepEqual(
    await relay.answer('tool_answered', session({ call: { tool: `mcp__macula__${MESH_HELLO}`, operator_name: 'martha recorder' }, answer: helloAnswer })),
    TAKEN_REPLY,
  )
  assert.deepEqual(await recordedPaths(rows), [], 'the member’s own hello answer took nothing in')
  assert.deepEqual(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'id' })), ALLOW_REPLY, 'and the shell it needs for the ring is still there')
  assert.deepEqual(await relay.answer('tool_called', call(`mcp__macula__${RINGS_AND_RETURNS_THE_ANSWER}`, { to: 'f'.repeat(64), purpose: 'a check' })), ALLOW_REPLY, 'the ring itself is not refused')

  const ringAnswer = RECORDED_RING_ANSWERS[RINGS_AND_RETURNS_THE_ANSWER]
  assert.ok(ringAnswer !== undefined, 'the recording carries no mesh_ring answer')
  assert.deepEqual(
    await relay.answer('tool_answered', session({ call: { tool: `mcp__macula__${RINGS_AND_RETURNS_THE_ANSWER}`, ...ringAnswer.tool_input }, answer: ringAnswer.tool_call_answer })),
    TAKEN_REPLY,
  )
  const after = await recordedPaths(rows)
  assert.ok(after.some((entry) => entry.startsWith(`${PATH_OF_SOURCE.ring_answer}:`)), `the ring's answer reached its own row: ${after.join(', ')}`)
  assert.equal(after.filter((entry) => entry.startsWith('B2:')).length, 0, 'and nothing landed on B2')
  assert.ok(isDenied(await relay.answer('tool_called', call(CLAUDE_CODE_SHELL_TOOL, { command: 'id' }))), 'the ring’s answer is another agent’s text, so the shell closes on it, as the gate means it to')
})

/**
 * What the launch hands the relay about its mesh answers, driven through the launch itself rather than handed in
 * (martha#251 review r=1): the reading is only worth anything if a real launch carries it.
 */

/** The mesh server entry the host is really started with, out of the config the launch wrote. */
function theMeshServerStarted(argsFile: string): { readonly env?: Readonly<Record<string, string>> } {
  const entry = serverConfigIn(argsFile).mcpServers[SERVER_NAME] as { env?: Record<string, string> } | undefined
  assert.ok(entry !== undefined, `the host was started with no ${SERVER_NAME} server`)
  return entry
}

test('with one exact-pin mesh server, the launch hands the relay that server’s own environment, its home and the launch’s node id (martha#251)', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  // A HOME the server is really given, and not the one its host runs with: only a reading of the server's own
  // environment carries it, and the contact-policy default is walked from it. It comes in through the approved
  // settings copy's env, the one settings file the member's host reads that a checkout can carry (martha#602).
  const serverHome = mkdtempSync(join(tmpdir(), 'martha-the-server-home-'))
  t.after(() => removeTheTree(serverHome))
  const place = placeFor(t, meshServerAt(recorded.server_version), { [USER_SETTINGS]: settingsWithEnv({ HOME: serverHome }) })
  const fake = fakeClaude(place)
  const heard: MemberRelayPlace[] = []
  const started = await aMemberStartedIn(t, place, {
    ...memberLaunch(place, fake.command, place.approved, [], recording),
    hearRelayPlace: (relayPlace) => void heard.push(relayPlace),
  })
  if (!started.started) assert.fail(started.refusal)
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes(MCP_CONFIG_SWITCH), t)
  const passed = heard[0]?.wordless_answers
  assert.ok(passed !== undefined, 'the launch handed the relay no reading of its mesh answers')
  assert.deepEqual(passed.env, theMeshServerStarted(fake.argsFile).env, 'the relay was handed an environment other than the one its server is started with')
  assert.equal(passed.home, serverHome, 'the relay would walk the contact-policy default from a home the server never ran with')
  assert.equal(passed.node_id, NODE_ID, 'the relay was handed another launch’s node id')
  started.stop('the test is over')
  await started.stopped
})

test('with no exact-pin mesh server, the launch hands the relay no reading of its mesh answers, so every answer taints as before (martha#251)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const heard: MemberRelayPlace[] = []
  const started = await aMemberStartedIn(t, place, { ...memberLaunch(place, fake.command), hearRelayPlace: (relayPlace) => void heard.push(relayPlace) })
  if (!started.started) assert.fail(started.refusal)
  assert.equal(heard.length, 1, 'the launcher handed the relay one place')
  assert.equal(heard[0]?.wordless_answers, undefined, 'a launch with no mesh server told the relay how to read an answer anyway')
  started.stop('the test is over')
  await started.stopped
})

test('with two exact-pin mesh servers, the launch hands the relay no reading: one server’s environment is not the other’s (martha#251)', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, JSON.stringify({ mcpServers: { [SERVER_NAME]: memberShapeAt(recorded.server_version), another: memberShapeAt(recorded.server_version) } }))
  const fake = fakeClaude(place)
  const heard: MemberRelayPlace[] = []
  const started = await aMemberStartedIn(t, place, {
    ...memberLaunch(place, fake.command, place.approved, [], recording),
    hearRelayPlace: (relayPlace) => void heard.push(relayPlace),
  })
  if (!started.started) assert.fail(started.refusal)
  assert.equal(heard[0]?.wordless_answers, undefined, 'a launch with two mesh servers picked one of them to read its answers by')
  started.stop('the test is over')
  await started.stopped
})

test('a run killed hard takes its launcher, its shell, its member and its home with it (#559)', async (t) => {
  // The run is a pipe, not a signal: nothing in the chain below it is signalled by the kill — the launcher is three
  // processes away, behind `script` and a shell that is only waiting on it — and nothing has to be. What a shell timeout
  // or --test-force-exit does to a suite is done here to one run of this file's own.
  const place = placeFor(t)
  const fake = fakeTerminalClaude(place)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-cc-the-run-'))
  const notes = join(place.home, 'terminal')
  mkdirSync(notes)
  const note = (name: string) => join(notes, name)
  const launcher = launcherProcess(place, fake.command, 'inherit', {}, undefined, {}, OWNER_PROMPT_ARGS, true, join(runtime, 'lifeline'))
  const theRun = join(runtime, 'the-run.ts')
  // The run: it keeps the lifeline's other end open and starts the owner's terminal on the launcher, as this file does.
  writeFileSync(
    theRun,
    [
      `import { spawn } from 'node:child_process'`,
      `import { keepTheLifelineIn } from ${JSON.stringify(new URL('../end_a_launch_when_its_run_ends/keep_the_lifeline_in.ts', import.meta.url).href)}`,
      `keepTheLifelineIn(${JSON.stringify(runtime)})`,
      // The terminal's own input is a pipe this run keeps open and never writes: a shell that has waited its launcher
      // out is held by `read finished` until it is ended, exactly as the owner's terminal holds it.
      `spawn(${JSON.stringify(PTY_RUNNER)}, ['-qec', ${JSON.stringify(theShellATerminalRuns(note, launcher, ''))}, '/dev/null'], { stdio: ['pipe', 'ignore', 'inherit'] })`,
      `process.stdout.write('the run is up\\n')`,
      'setInterval(() => undefined, 1 << 30)',
      '',
    ].join('\n'),
  )
  const run = spawn(process.execPath, [theRun], { stdio: ['ignore', 'pipe', 'inherit'] })
  t.after(async () => {
    if (run.exitCode === null && run.signalCode === null) run.kill('SIGKILL')
    await killGroupsCarrying(place.relay_root)
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  await until('the run to start its launcher\'s member', () => textIn(fake.readyFile) !== '', t)
  const member = Number(textIn(fake.readyFile))
  const shell = Number(textIn(note('shell')))
  const launcherPid = Number(textIn(note('launcher')))
  assert.equal(isAlive(member), true, 'the member runs before the kill')
  assert.equal(isAlive(shell), true, 'the shell waits on the launcher before the kill')
  assert.equal(isAlive(launcherPid), true, 'the launcher runs before the kill')
  assert.ok(pidsNamingTheHome(place.home).length >= 3, `the launcher, its shell and the member all name the home: ${pidsNamingTheHome(place.home).join(', ')}`)
  run.kill('SIGKILL')
  // Nothing is signalled to anything below the run: every one of them ends because the pipe's other end closed.
  await until(
    'the home the run made to go, and every process that named it',
    () => !existsSync(place.home) && pidsNamingTheHome(place.home).length === 0,
    t,
    () => `still named by ${pidsNamingTheHome(place.home).join(', ')}`,
  )
  assert.equal(isAlive(member), false, 'the member did not outlive the run that started it')
  assert.equal(isAlive(shell), false, 'nor did the shell that waited on its launcher')
  assert.equal(isAlive(launcherPid), false, 'nor did the launcher itself')
  assert.equal(existsSync(join(runtime, 'lifeline')), true, 'the run\'s own pipe is the launcher\'s to read, and never to remove')
})

test('a launcher whose run was already gone ends at once, taking its member and its home (#559)', async (t) => {
  // The other side of the same rule: a run killed while a test was still starting a launcher leaves a pipe whose other
  // end is already closed. A launcher that read that as a live run would wait for a signal that is never coming, which
  // is the orphan itself.
  const place = placeFor(t)
  const marker = join(place.home, 'the-questions-may-be-answered')
  const fake = fakeHostUnderARun(place, { waitFor: marker, parked: join(place.home, 'the-launcher-is-parked') })
  const runtime = mkdtempSync(join(tmpdir(), 'martha-cc-the-run-'))
  const lifeline = keepTheLifelineIn(runtime)
  // The run this launcher is told about is over before the launcher starts: the pipe it reads has no writer left.
  lifeline.closeTheRunsEnd()
  const launcher = spawn(process.execPath, [launcherProcess(place, fake.command, 'ignore', {}, undefined, {}, OWNER_PROMPT_ARGS, true, lifeline.path)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const ended = new Promise<number | null>((resolve) => launcher.once('exit', (code) => resolve(code)))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  // Held on its questions, so the launch has not settled when this run's end has already come: the launcher is answered
  // as soon as the launch settles, and not a moment before.
  await until('the launcher to be parked on its questions', () => existsSync(join(place.home, 'the-launcher-is-parked')), t, () => said)
  writeFileSync(marker, '')
  await until('the launcher to end by itself', () => launcher.exitCode !== null || launcher.signalCode !== null, t, () => said)
  assert.equal(await ended, 0, `the launcher did not end by itself: ${JSON.stringify(said)}`)
  const started = /^started (\d+)$/m.exec(said)
  if (started !== null) {
    // A launcher that ends before it can print is not failed for it: what it owes a run already gone is stated below,
    // and where it did print, the member it named is the one that must be gone.
    assert.equal(isAlive(Number(started[1])), false, 'the member the launcher started did not outlive it')
    assert.ok(said.includes(`because ${THE_RUN_IS_GONE}`), `not the run's end that stopped it: ${JSON.stringify(said)}`)
  }
  assert.equal(existsSync(place.home), false, 'nor did the home the run made for it')
  assert.deepEqual(pidsNamingTheHome(place.home), [], 'and nothing names the home any more')
  assert.equal(existsSync(lifeline.path), true, 'the run\'s own pipe is the launcher\'s to read, and never to remove')
})

test('a run that goes off the owner\'s terminal takes its member with it, and ends only the pid that is its own shell (#559)', async (t) => {
  // Off a terminal there is no hangup to fall back on, so the member ends only because the launcher stopped it — which is
  // what the mid-way test cannot tell apart from the terminal's own hangup.
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-cc-the-run-'))
  const lifeline = keepTheLifelineIn(runtime)
  // A pid a stale note might name: it is not this launcher's shell, and nothing but that check keeps it alive.
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1 << 30)'], { stdio: 'ignore' })
  const foreignPid = foreign.pid
  if (foreignPid === undefined) assert.fail('the foreign process did not start')
  mkdirSync(join(place.home, 'terminal'), { recursive: true })
  writeFileSync(join(place.home, 'terminal', 'shell'), String(foreignPid))
  const launcher = spawn(process.execPath, [launcherProcess(place, fake.command, 'ignore', {}, undefined, {}, OWNER_PROMPT_ARGS, true, lifeline.path)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const ended = new Promise<number | null>((resolve) => launcher.once('exit', (code) => resolve(code)))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
    foreign.kill('SIGKILL')
    lifeline.close()
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to start its member', () => /^started \d+$/m.test(said), t)
  const member = Number(/^started (\d+)$/m.exec(said)?.[1])
  assert.equal(isAlive(member), true, 'the member runs before the run goes')
  lifeline.closeTheRunsEnd()
  await until('the launcher to end by itself', () => launcher.exitCode !== null || launcher.signalCode !== null, t, () => said)
  assert.equal(await ended, 0, `the launcher did not end by itself: ${JSON.stringify(said)}`)
  assert.equal(isAlive(member), false, 'the member was stopped by the launcher, with no terminal to hang it up')
  // The launcher's own exit would kill the member's group anyway, without a reason: what this pins is that the run's
  // end stopped it first, with the product's own reason, and waited for it before the home went.
  assert.ok(said.includes(`because ${THE_RUN_IS_GONE}`), `the member was stopped with the run's own reason: ${JSON.stringify(said)}`)
  assert.equal(isAlive(foreignPid), true, 'a pid the note holds that is not this launcher\'s shell was left alone')
  assert.equal(existsSync(place.home), false, 'the home the run made went with it')
})

test('a launcher told a run\'s end it cannot even open ends at once, taking its home (#559)', async (t) => {
  // The pipe is gone rather than closed — a run killed between making the lifeline and starting the launcher leaves
  // this. A path that cannot be opened is the run gone, never a reason to wait for it.
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const runtime = mkdtempSync(join(tmpdir(), 'martha-cc-the-run-'))
  const neverMade = join(runtime, 'no-such-run')
  const launcher = spawn(process.execPath, [launcherProcess(place, fake.command, 'ignore', {}, undefined, {}, OWNER_PROMPT_ARGS, true, neverMade)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const ended = new Promise<number | null>((resolve) => launcher.once('exit', (code) => resolve(code)))
  t.after(async () => {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    await ended
    await killGroupsCarrying(place.relay_root)
    removeTheTree(runtime)
  })
  thePlaceGoesWithItsProcesses(t, place)
  let said = ''
  launcher.stdout?.on('data', (chunk: Buffer) => void (said += chunk.toString()))
  await until('the launcher to end by itself', () => launcher.exitCode !== null || launcher.signalCode !== null, t, () => said)
  assert.equal(await ended, 0, `the launcher did not end by itself: ${JSON.stringify(said)}`)
  assert.equal(existsSync(place.home), false, 'the home the run made went with it')
})

// --- the crew tools read the launch's own sessions map (martha#669) ------------------

test('the crew tools a launch hands over read the sessions map its relay keeps, so a handover is stamped with its session (martha#669)', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  // The stamps the launch's crew tools write, kept here rather than on disk: what a handover was stamped with is
  // this case's question, and the handover file itself is proved in its own slice.
  const stamped: HandoverStamp[] = []
  const stamps: HandoverStampStore = {
    read: () => undefined,
    write: (_file, stamp) => {
      stamped.push(stamp)
      return undefined
    },
  }
  const handed: CrewTools[] = []
  const started = await aMemberStartedIn(t, place, {
    ...memberLaunch(place, fake.command, place.approved),
    // Exactly the shape the launcher's own wiring uses: the crew tools are built over the accessor the launcher
    // hands over, and that accessor is the thing under test.
    crew_tools: (sessions, member) => {
      const crew = crewToolsOver({
        member: 'Mercury',
        ledger: { clock: { now: () => 5_000 }, stores: { rows: rowStreamsDirectory(place.rows) } },
        beats: dashboardRowsIn(place.dashboard),
        root: place.checkout,
        documents: { read: async (path) => readFileSync(path, 'utf8') },
        stores: { crew: keepTheCrewsFilesAsDirectories(join(place.rows, 'crew-files')) },
        stamps,
        sessions,
        // The watch the launch hands over, which a launch's crew tools must hold (martha#710).
        served_tools: member.served_tools,
      })
      handed.push(crew)
      return crew
    },
  })
  if (!started.started) assert.fail(started.refusal)

  // A session really starts in this launch, through the relay the member's host talks to.
  await until('the fake host to start', () => existsSync(fake.envFile) && readFileSync(fake.envFile, 'utf8') !== '', t)
  const posted = await fetchOverSocket(`${RELAY_ORIGIN}${RELAY_PATHS.session_started}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(start('startup')),
    socketPath: readFileSync(fake.envFile, 'utf8'),
  })
  assert.equal(posted.text, '{"taken":1}', 'the launch took the session start')

  const crew = handed[0]
  if (crew === undefined) assert.fail('the launch handed no crew tools over')
  // The handover comes from the session that just started. It is stamped with that session only if the crew tools
  // read the map the launch's relay keeps: were they handed a map of their own, this call would be refused as one
  // from a session the launch does not know, and no handover would be stamped.
  const answered = await crew.answer(WRITE_MY_HANDOVER_TOOL, { content: 'The next session carries on from here.' }, SESSION)
  assert.equal('refused' in answered ? answered.refused : '', '', 'the launch knows the session that started in it')
  assert.equal(stamped.length, 1, 'the handover was stamped')
  assert.equal(stamped[0]?.predecessor_id, SESSION, 'the stamp names the session the handover came from')
})
