// The launcher answers the relay through the core, fails closed on every event,
// and starts and stops a member whole (#41, on #16's launch gate).
//
// Real directories, a real git checkout, a real Unix socket and real process
// groups: a fake `claude` stands in for the host, and the relay's own hooks
// stand in for the engine's calls. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_TOOL_RESULT_ROWS, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { register, type RelayCatch, type RelayEngine, type RelayHook } from '../claude_code_relay/hooks/register.ts'
import { RELAY_ORIGIN, RELAY_PATHS, RELAY_SOCKET_VARIABLE, type RelayEvent } from '../claude_code_relay/hooks/relay_protocol.ts'
import { ROW_NOT_DURABLE, type Row, type RowStore } from '../host_contract/host_contract.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { fakeMeshRegistry, type FakeRegistry } from '../install_the_recorded_mesh_server/fake_mesh_registry.ts'
import { recordMeshTree } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import type { MeshTreeRecording } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { POLL_MS, until } from './wait_until_the_event.ts'
import { OWNER_AT_THE_TERMINAL } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { PATH_OF_SOURCE, RECORD_LOST } from '../take_in_a_turn/take_in_a_turn.ts'
import { UNPLACED_TOOL_RESULT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { memberRelay, type MemberRelay, type RelayReply } from './answer_the_relay.ts'
import { notACommandThisLauncherCanRun } from './host_runs_the_relay.ts'
import { hostAnswers, type HostAnswers, refusesTheRelay } from './host_stand_in.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { CLAUDE_CODE, launchClaudeCodeMember, NOT_STARTED, RELAY_PLUGIN_DIR } from './launch_a_claude_code_member.ts'
import { MEMBER_PID_FD } from './member_on_the_owners_terminal.ts'
import { makeRelayDirectory, RELAY_DIRECTORY_MODE, RELAY_SOCKET_NAME } from './relay_directory.ts'
import { serveTheRelay } from './serve_the_relay.ts'
import { shortRelayRoot } from './short_relay_root.ts'
import { LOST, recordOf, SESSION_RECORD_STREAM, sessionRecordsIn } from './session_records_in_rows.ts'

// --- a member's places ----------------------------------------------------------

interface Place {
  /** The stop directory, standing in for the owner's home. */
  readonly home: string
  /** A git checkout under it, with an approved tool-server config committed. */
  readonly checkout: string
  readonly rows: string
  readonly launch_records: string
  readonly relay_root: string
  readonly snapshot_root: string
  /** Where the launcher installs the recorded mesh server trees (martha#65). */
  readonly mesh_servers: string
  readonly approved: readonly string[]
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
  t.after(() => rmSync(home, { recursive: true, force: true }))
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
    rows: closed('rows'),
    launch_records: closed('launches'),
    relay_root: shortRelayRoot(t),
    snapshot_root: closed('snapshots'),
    mesh_servers: closed('mesh-servers'),
    approved,
  }
}

const launchOf = (place: Place) => ({
  host: CLAUDE_CODE,
  launch_dir: place.checkout,
  stop_dir: place.home,
  approved_fingerprints: place.approved,
})

interface Answering {
  readonly relay: MemberRelay
  readonly stops: string[]
  readonly rows: RowStore
}

function answering(place: Place, rows: RowStore = rowStreamsDirectory(place.rows)): Answering {
  const stops: string[] = []
  const relay = memberRelay({
    records: sessionRecordsIn(rows),
    launch: launchOf(place),
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    binder: bindNothing,
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
const ALLOW_REPLY: RelayReply = { answered: true, body: { allow: 1 } }

function isDenied(reply: RelayReply, pattern?: RegExp): boolean {
  if (!reply.answered || !('deny' in reply.body)) return false
  return pattern === undefined || pattern.test(reply.body.deny)
}
const isRefused = (reply: RelayReply): boolean => reply.answered && 'refused' in reply.body

async function recordedPaths(rows: RowStore, session_id = SESSION): Promise<string[]> {
  const stored = await rows.read(`${SESSION_RECORD_STREAM}${session_id}`)
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
  assert.deepEqual(await relay.answer('tool_called', call('Bash', { command: 'ls' })), ALLOW_REPLY)
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
    assert.ok(isDenied(await relay.answer('tool_called', call('Bash', { command: 'ls' }))), what)
    // A typed turn after it does not give the shell back.
    assert.deepEqual(await relay.answer('prompt_submitted', prompt('composer')), TAKEN_REPLY, what)
    assert.ok(isDenied(await relay.answer('tool_called', call('Bash', { command: 'ls' }))), what)
  }
})

test('a fresh start allows the shell; fork and a claimed crew_refresh start lost, whatever the input claims', async (t) => {
  const { relay, rows } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call('Bash', { command: 'ls' })), ALLOW_REPLY)

  // T7: a fork carries its parent's context under a new id; T8: a refresh is never claimed.
  for (const [session_id, source] of [['forked', 'fork'], ['refreshed', 'crew_refresh']] as const) {
    await relay.answer('session_started', start(source, session_id, { predecessor_id: SESSION }))
    assert.ok(isDenied(await relay.answer('tool_called', call('Bash', { command: 'ls' }, session_id)), /cannot be read/), source)
    assert.deepEqual(await recordedPaths(rows, session_id), [`${RECORD_LOST.path}:null`], source)
  }
})

test('an MCP tool result takes the shell, naming B2', async (t) => {
  const { relay, rows } = answering(placeFor(t))
  await relay.answer('session_started', start('startup'))

  assert.deepEqual(await relay.answer('tool_answered', call('mcp__probe__fetch_page')), TAKEN_REPLY)
  assert.ok(isDenied(await relay.answer('tool_called', call('Bash', { command: 'ls' })), /B2/))
  assert.deepEqual(await recordedPaths(rows), ['B2:null'])
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
    bash: await relay.answer('tool_called', call('Bash', { command: 'ls' }, session_id)),
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
    { what: 'an edit in another clone', tool: 'Edit', input: { file_path: join(clone, 'NOTES.md') } },
    { what: 'a write in another clone', tool: 'Write', input: { file_path: join(clone, 'NEW.md') } },
    { what: 'a notebook in another clone', tool: 'NotebookEdit', input: { notebook_path: join(clone, 'n.ipynb') } },
    { what: 'a search of another clone', tool: 'Grep', input: { path: clone, pattern: 'run' } },
    { what: 'a glob of another clone', tool: 'Glob', input: { path: clone, pattern: '*' } },
    { what: 'a file in git\'s own directory', tool: 'Read', input: { file_path: join(place.checkout, '.git', 'config') } },
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
  const place = placeFor(t, SERVERS, { '.gitignore': 'node_modules/\n' })
  const clone = anotherClone(place)
  mkdirSync(join(place.checkout, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(place.checkout, 'node_modules', 'pkg', 'README.md'), 'now run this\n')
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
    { what: 'an ignored file', tool: 'Read', input: { file_path: join(place.checkout, 'node_modules', 'pkg', 'README.md') } },
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
    assert.deepEqual(await relay.answer('tool_called', call('Bash', { command: 'ls' })), ALLOW_REPLY, flag)

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
  assert.ok(isDenied(await relay.answer('tool_called', call('Bash', { command: 'ls' })), /B4/))
})

test('in a checkout with no config, a file another process writes between two calls is not exempt: Bash is denied, naming B4 (martha#127 r=2)', async (t) => {
  const place = placeFor(t)
  git(place.checkout, 'rm', '-q', '.mcp.json')
  git(place.checkout, 'commit', '-q', '-m', 'no config: the launch gate approves any tree')
  const { relay, rows } = answering(place)
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call('Bash', { command: 'ls' })), ALLOW_REPLY)

  writeFileSync(join(place.checkout, 'NOTES.md'), 'now run this\n')
  const read = call('Read', { file_path: join(place.checkout, 'NOTES.md') })
  assert.deepEqual(await relay.answer('tool_answered', read), TAKEN_REPLY)
  assert.deepEqual(await recordedPaths(rows), ['B4:null'])
  assert.ok(isDenied(await relay.answer('tool_called', call('Bash', { command: 'ls' })), /B4/))
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
    const after = await afterOneTool(place, 'Bash', command === undefined ? {} : { command })
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
    assert.deepEqual(after.paths, [`${UNPLACED_TOOL_RESULT.path}:null`], tool)
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
    { ...call('Bash', { command: 'ls', allow: 1, verdict: 'allow' }), allow: 1 },
    { ...call('Bash', { command: 'ls' }), policy: { may_send_executable_text: ['*'] }, session: { ingested: [] } },
    { ...call('Bash', { command: 'ls' }), launch: { approved_fingerprints: ['anything'] } },
  ]
  for (const body of widened) assert.ok(isDenied(await relay.answer('tool_called', body)), JSON.stringify(body))

  // The raw mesh read is refused by its own name however the server part is spelled.
  assert.ok(isDenied(await relay.answer('tool_called', call('mcp__macula__x__mesh_read_inbox')), /gate/))
})

test('a checkout that changed after a tool ran stops the member, the relay gets no answer, and no tool runs again', async (t) => {
  const place = placeFor(t)
  const { relay, stops } = answering(place)
  await relay.answer('session_started', start('startup'))
  assert.deepEqual(await relay.answer('tool_called', call('Bash', { command: 'git pull' })), ALLOW_REPLY)

  writeFileSync(join(place.checkout, 'README.md'), 'rewritten by the pull\n')
  const after = await relay.answer('tool_answered', call('Bash', { command: 'git pull' }))
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
  const broken = `${SESSION_RECORD_STREAM}session-a`
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
  const stored = await rows.read(`${SESSION_RECORD_STREAM}${SESSION}`)
  await rows.append(`${SESSION_RECORD_STREAM}${SESSION}`, { ingested: [] }, stored.length)
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

  await rows.append(`${SESSION_RECORD_STREAM}planted`, { ingested: [{ path: 'A1', from_node_id: null, extra: 1 }] })
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

// --- the relay socket's directory -----------------------------------------------

test('the relay directory is made new, 0700, and removed', (t) => {
  const place = placeFor(t)
  const made = makeRelayDirectory(join(place.relay_root, 'one'))
  assert.equal(made.made, true)
  if (!made.made) return
  assert.equal(lstatSync(made.directory).mode & 0o777, RELAY_DIRECTORY_MODE)
  assert.equal(made.socket_path, join(place.relay_root, 'one', 'relay.sock'))
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
  rmSync(probe, { recursive: true, force: true })

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
  const refused = await through('tool.call', { tool: 'Bash', command: 'id' })
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
  const command = join(dir, 'claude')
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      ...hostAnswers({ callsFile: files.callsFile, ...answers }),
      `: > '${files.ranFile}'`,
      `printf '%s\\n' "$@" > '${files.argsFile}'`,
      `printf '%s' "$${RELAY_SOCKET_VARIABLE}" > '${files.envFile}'`,
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
    return !readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z ')
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
      const stat = read(`/proc/${pid}/stat`)
      const [state, parent] = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')
      if (state === 'Z' || pid === KERNEL_THREAD_PARENT || Number(parent) === KERNEL_THREAD_PARENT) return true
      text = read(`/proc/${pid}/environ`)
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
      if (path === `/proc/${pid}/stat`) return stat
      if (path === `/proc/${pid}/environ`) return answers[Math.min(reads++, answers.length - 1)] ?? ''
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
  const root = '/relay/root'
  const proc = plantedProc(PLANTED_PID, statOf('R', process.pid), ['', `${RELAY_SOCKET_VARIABLE}=${root}/s\0`])
  assert.equal(await carriesRelayRoot(PLANTED_PID, root, proc.read), true)
})

test('cleanup passes by a process whose environment stays empty, which `env -i` starts, and never hangs on it (#85)', async () => {
  const proc = plantedProc(PLANTED_PID, statOf('R', process.pid), [''])
  assert.equal(await carriesRelayRoot(PLANTED_PID, '/relay/root', proc.read), false)
  assert.ok(proc.reads() > 1, 'the empty environment was read again before cleanup passed it by')
})

const NODE_ID = 'ab'.repeat(32)

function memberLaunch(place: Place, command: string, approved = place.approved, lines: string[] = [], mesh_trees?: MeshTreeRecording) {
  return {
    member_name: 'Mercury',
    node_id: NODE_ID,
    place: { ...launchOf(place), approved_fingerprints: approved, snapshot_root: place.snapshot_root },
    policy: { may_send_executable_text: [] },
    places: { rows: place.rows, launch_records: place.launch_records, relay_root: place.relay_root, mesh_servers: place.mesh_servers },
    ...(mesh_trees === undefined ? {} : { mesh_trees }),
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
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, [], lines))
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
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, lines))
  if (started.started) t.after(async () => (started.stop('the test is over'), await started.stopped))
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
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command))
  if (started.started) t.after(async () => (started.stop('the test is over'), await started.stopped))
  assert.equal(started.started, false)
  assert.ok(!started.started && started.refusal.includes(RELAY_PLUGIN_DIR), started.started ? '' : started.refusal)
  assert.equal(existsSync(fake.ranFile), false)
})

test('a host of another version than the recording starts its member, after one line naming both versions', async (t) => {
  const place = placeFor(t)
  const other = '999.0.0'
  const fake = fakeClaude(place, { version: other })
  const lines: string[] = []
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, lines))
  if (started.started) t.after(async () => (started.stop('the test is over'), await started.stopped))
  assert.equal(started.started, true, started.started ? '' : started.refusal)
  const named = lines.filter((line) => line.includes(other) && line.includes(RECORDED_HOST.host_version))
  assert.equal(named.length, 1, lines.join('\n'))
})

test('the member, its load check and its version check all run the one file its command resolves to', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const onPath = join(place.home, 'on-path')
  mkdirSync(onPath)
  symlinkSync(fake.command, join(onPath, 'claude'))
  const launch = memberLaunch(place, 'claude')
  const started = await launchClaudeCodeMember({ ...launch, inherited: { ...launch.inherited, PATH: `${onPath}:${process.env.PATH ?? ''}` } })
  if (!started.started) assert.fail(started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))
  await until('the fake host to start', () => existsSync(fake.childFile) && readFileSync(fake.childFile, 'utf8').trim() !== '', t)
  const calls = readFileSync(fake.callsFile, 'utf8').trimEnd().split('\n')
  assert.deepEqual(calls.map((line) => line.split(' ')[1]), ['plugin', '--version', '-p'])
  for (const line of calls) assert.equal(line.split(' ')[0], realpathSync(fake.command), line)
})

test('a member with no owner to answer its host, whose relay never reports its session start, is stopped once its deadline passes, saying why', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const session_start_deadline_ms = 300
  const started = await launchClaudeCodeMember({ ...memberLaunch(place, fake.command, place.approved, lines), session_start_deadline_ms, trust_answer_deadline_ms: 60_000 })
  if (!started.started) assert.fail(started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))
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
  const started = await launchClaudeCodeMember({ ...memberLaunch(place, fake.command), session_start_deadline_ms })
  if (!started.started) assert.fail(started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))
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
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, lines))
  // A launch that wrongly starts is stopped whole, so a failing run leaves no member behind.
  if (started.started) t.after(async () => (started.stop('the test is over'), await started.stopped))
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
    const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, lines))
    // A launch that wrongly starts is stopped whole, so a failing run leaves no member behind.
    if (started.started) t.after(async () => (started.stop('the test is over'), await started.stopped))
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
const ASKED_OF_THE_STAND_IN = [...NEVER_REACHES_THE_MESH_SERVER, 'CLAUDE_CODE_PLUGIN_DIRS'] as const
const STAND_IN_ANSWER = [
  `const asked = ${JSON.stringify(ASKED_OF_THE_STAND_IN)}`,
  'const started = { ...process.env }',
  'process.stderr.write(JSON.stringify(Object.fromEntries(asked.map((name) => [name, started[name] ?? null]))))',
].join('\n')

async function recordedTreeOf(t: TestContext, version: string): Promise<{ registry: FakeRegistry; recording: MeshTreeRecording }> {
  const registry = await fakeMeshRegistry([
    { name: MESH_SERVER_PACKAGE, version, bin: { 'macula-mcp': 'dist/index.js' }, files: { 'dist/index.js': `console.log('${RECORDED_MARK}')\n${STAND_IN_ANSWER}\n` } },
  ])
  t.after(() => registry.stop())
  const scratch = mkdtempSync(join(tmpdir(), 'martha-65-record-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const recording: MeshTreeRecording = { _why: 'test', registry: registry.registry, known_settings: [], known_environment_reads: {}, versions: [] }
  const tree = recordMeshTree({ tarball: registry.tarballOf(MESH_SERVER_PACKAGE), recording, scratch })
  return { registry, recording: { ...recording, versions: [tree] } }
}

const serverConfigIn = (argsFile: string) => {
  const args = readFileSync(argsFile, 'utf8').split('\n')
  const path = args[args.indexOf('--mcp-config') + 1]
  assert.ok(path !== undefined)
  return JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, { command: string; args: string[] }> }
}

test('an approved config that installs a recorded mesh server version starts the member on the recorded tree, by path', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, [], recording))
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(() => started.stop('the test is over'))
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes('--mcp-config'), t)
  const entry = serverConfigIn(fake.argsFile).mcpServers.macula
  assert.ok(entry !== undefined)
  assert.equal(entry.command, process.execPath, 'npx is never what starts the mesh server')
  // Started by path, confined to its tree by the launcher's hook (martha#73).
  assert.equal(entry.args.at(-1), join(realpathSync(place.mesh_servers), recorded.server_version, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js'))
  // What the stand-in writes is captured, never let through into the run (martha#92).
  const run = spawnSync(entry.command, entry.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), RECORDED_MARK)
  started.stop('the test is over')
  await started.stopped
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
  const started = await launchClaudeCodeMember(planted)
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(() => started.stop('the test is over'))
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes('--mcp-config'), t)
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

const USER_SETTINGS = join('.claude', 'settings.json')
const settingsWithEnv = (env: Record<string, string>) => JSON.stringify({ env })

function ownerSettings(place: Place, env: Record<string, string>): string {
  const path = join(place.home, USER_SETTINGS)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, settingsWithEnv(env))
  return path
}

async function refusedLeavingNothing(t: TestContext, place: Place, launch: Parameters<typeof launchClaudeCodeMember>[0], ranFile: string): Promise<string> {
  const lines: string[] = []
  const started = await launchClaudeCodeMember({ ...launch, tellOwner: (line) => void lines.push(line) })
  if (started.started) t.after(async () => (started.stop('the test is over'), await started.stopped))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.equal(existsSync(ranFile), false)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.deepEqual(lines, [refusal])
  return refusal
}

test("a name in the owner's user settings env nobody approved starts nothing, naming the file and the name", async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const file = ownerSettings(place, { FROM_SETTINGS: 'x' })
  const refusal = await refusedLeavingNothing(t, place, memberLaunch(place, fake.command, place.approved, [], recording), fake.ranFile)
  assert.ok(refusal.includes(file) && refusal.includes('FROM_SETTINGS'), refusal)
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
  ['relative', '.claude'],
] as const) {
  test(`a CLAUDE_CONFIG_DIR that is ${shape} starts nothing, naming the variable (#65 r=4)`, async (t) => {
    const recorded = RECORDED_MESH_SERVERS[0]
    assert.ok(recorded !== undefined)
    const { recording } = await recordedTreeOf(t, recorded.server_version)
    const place = placeFor(t, meshServerAt(recorded.server_version))
    const fake = fakeClaude(place)
    const launch = memberLaunch(place, fake.command, place.approved, [], recording)
    const refusal = await refusedLeavingNothing(t, place, { ...launch, inherited: { ...launch.inherited, CLAUDE_CONFIG_DIR: configDir } }, fake.ranFile)
    assert.ok(refusal.includes('CLAUDE_CONFIG_DIR'), refusal)
  })
}

test("CLAUDE_CODE_PLUGIN_DIRS in the owner's user settings starts the member, and the mesh server is given it empty", async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const fromSettings = { CLAUDE_CODE_PLUGIN_DIRS: join(place.home, 'plugins') }
  ownerSettings(place, fromSettings)
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, [], recording))
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(() => started.stop('the test is over'))
  await until('the fake host to start', () => existsSync(fake.argsFile) && readFileSync(fake.argsFile, 'utf8').includes('--mcp-config'), t)
  const entry = serverConfigIn(fake.argsFile).mcpServers.macula as { command: string; args: string[]; env?: Record<string, string> } | undefined
  assert.ok(entry !== undefined)
  // The host's environment, then the settings env, then the entry's: how Claude Code starts a server.
  const run = spawnSync(entry.command, entry.args, { env: { ...process.env, ...fromSettings, ...entry.env }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), RECORDED_MARK, run.stderr)
  const seen = JSON.parse(run.stderr.trim().split('\n').at(-1) ?? '{}') as Record<string, string>
  assert.equal(seen.CLAUDE_CODE_PLUGIN_DIRS, '', `it reached the server as ${seen.CLAUDE_CODE_PLUGIN_DIRS}`)
  started.stop('the test is over')
  await started.stopped
})

test('a mesh server tree changed since it was installed starts nothing, naming the file, and leaves nothing behind', async (t) => {
  const recorded = RECORDED_MESH_SERVERS[0]
  assert.ok(recorded !== undefined)
  const { recording } = await recordedTreeOf(t, recorded.server_version)
  const place = placeFor(t, meshServerAt(recorded.server_version))
  const fake = fakeClaude(place)
  const first = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, [], recording))
  assert.ok(first.started, first.started ? '' : first.refusal)
  first.stop('the test is over')
  await first.stopped
  rmSync(fake.ranFile, { force: true })

  const changed = join('node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js')
  writeFileSync(join(place.mesh_servers, recorded.server_version, changed), "console.log('planted')\n")
  const lines: string[] = []
  const second = await launchClaudeCodeMember(memberLaunch(place, fake.command, place.approved, lines, recording))
  if (second.started) t.after(async () => (second.stop('the test is over'), await second.stopped))
  assert.equal(second.started, false)
  const refusal = second.started ? '' : second.refusal
  assert.ok(refusal.includes(changed), refusal)
  assert.equal(existsSync(fake.ranFile), false)
  assert.deepEqual(readdirSync(place.relay_root), [])
  assert.deepEqual(readdirSync(place.snapshot_root), [])
  assert.deepEqual(lines, [refusal])
})

test('an approved launch starts the host with the switches and the relay, and a refusal after a call kills its whole group', async (t) => {
  const place = placeFor(t)
  const fake = fakeClaude(place)
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command))
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
  assert.deepEqual(args, [
    '-p',
    'the owner prompt',
    '--setting-sources',
    'user',
    '--strict-mcp-config',
    '--mcp-config',
    join(place.snapshot_root, snapshot[0] ?? '', '.mcp.json'),
    '--plugin-dir',
    RELAY_PLUGIN_DIR,
  ])
  const socket_path = readFileSync(fake.envFile, 'utf8')
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
  await assert.rejects(post('tool_answered', call('Bash', { command: 'git pull' })), 'the relay never gets an answer')

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
  const started = await launchClaudeCodeMember(memberLaunch(place, fake.command))
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
    return Number(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ')[2])
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
  for (const entry of readdirSync('/proc')) {
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

/**
 * A launcher in a process of its own, started on this place, that says when its
 * member runs, and stops it on SIGUSR2 the way a refusal does. It stays up after
 * its member has stopped, until it is ended.
 */
function launcherProcess(
  place: Place,
  command: string,
  stdio: 'ignore' | 'inherit' = 'ignore',
  inherited: Readonly<Record<string, string>> = {},
  mesh_trees?: MeshTreeRecording,
  deadlines: SessionStartDeadlines = {},
): string {
  const script = join(place.home, 'launcher.ts')
  const launchModule = new URL('./launch_a_claude_code_member.ts', import.meta.url).href
  writeFileSync(
    script,
    [
      `import { CLAUDE_CODE, launchClaudeCodeMember } from ${JSON.stringify(launchModule)}`,
      `const place = ${JSON.stringify(place)}`,
      'const started = await launchClaudeCodeMember({',
      "  member_name: 'Mercury',",
      `  node_id: ${JSON.stringify(NODE_ID)},`,
      '  place: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: place.approved, snapshot_root: place.snapshot_root },',
      '  policy: { may_send_executable_text: [] },',
      '  places: { rows: place.rows, launch_records: place.launch_records, relay_root: place.relay_root, mesh_servers: place.mesh_servers },',
      ...(mesh_trees === undefined ? [] : [`  mesh_trees: ${JSON.stringify(mesh_trees)},`]),
      ...Object.entries(deadlines).map(([name, ms]) => `  ${name}: ${ms},`),
      `  command: ${JSON.stringify(command)},`,
      "  args: ['-p', 'the owner prompt'],",
      `  inherited: { PATH: process.env.PATH, ...${JSON.stringify(inherited)} },`,
      `  stdio: ${JSON.stringify(stdio)},`,
      '  tellOwner: () => undefined,',
      '})',
      "if (started.started) process.once('SIGUSR2', () => started.stop('the test said so'))",
      "process.stdout.write(started.started ? `started ${started.pid}\\n` : `refused: ${started.refusal}\\n`)",
      "if (started.started) { const stopped = await started.stopped; process.stdout.write(`stopped ${stopped.signal ?? 'by itself'}\\n${stopped.stopped_because === null ? '' : `because ${stopped.stopped_because}\\n`}`) }",
      'setInterval(() => undefined, 1 << 30)',
      '',
    ].join('\n'),
  )
  return script
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
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
  const command = join(dir, 'claude')
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

/**
 * Waits on the owner's terminal for what a test means, and fails at once when
 * the launcher has said it refused: after that, no member event can come
 * (martha#94).
 */
const untilOnTerminal = (terminal: Pick<OwnersTerminal, 'shown'>, what: string, holds: () => boolean, t: TestContext): Promise<void> =>
  until(what, holds, t, () => terminal.shown(), () => REFUSED_LINE.exec(terminal.shown())?.[0])

/** The owner's terminal with the launch started, not waited on: for a launch that may start no member. */
function terminalLaunch(t: TestContext, place: Place, how: TerminalLaunch): Omit<OwnersTerminal, 'launcher'> & { launcher(): number } {
  const fake = fakeTerminalClaude(place, how.exitsAfterMs)
  const notes = join(place.home, 'terminal')
  mkdirSync(notes)
  const note = (name: string) => join(notes, name)
  const launcher = launcherProcess(place, how.command ?? fake.command, 'inherit', how.inherited ?? {}, how.mesh_trees, how.deadlines)
  const stderr = how.stderrTo === undefined ? '' : ` 2> '${how.stderrTo}'`
  const shell = [
    `echo $$ > '${note('shell')}'`,
    `readlink /proc/$$/fd/0 > '${note('tty')}'`,
    `stty -g > '${note('before')}'`,
    // A shell without job control gives a background command /dev/null as its input, unless told otherwise.
    `'${process.execPath}' '${launcher}' < /dev/tty${stderr} & echo $! > '${note('launcher')}'; wait`,
    'read finished',
  ].join('; ')
  const runner = spawn(PTY_RUNNER, ['-qec', shell, '/dev/null'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let shown = ''
  runner.stdout.on('data', (chunk: Buffer) => void (shown += chunk.toString()))
  const ended = new Promise<void>((resolve) => runner.once('exit', () => resolve()))
  // Before any assertion: a test that fails must not leave the member, its launcher or the terminal running.
  t.after(async () => {
    const launcherPid = Number(textIn(note('launcher')))
    if (launcherPid > 1 && isAlive(launcherPid)) process.kill(launcherPid, 'SIGKILL')
    await killGroupsCarrying(place.relay_root)
    runner.kill('SIGKILL')
    await ended
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
  assert.equal(entry.args.at(-1), join(realpathSync(place.mesh_servers), recorded.server_version, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js'))
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

test('a member on the owner\'s terminal is not held to the deadline of a member no owner can answer for: the host may first ask the owner whether to trust the folder (#104 r=2)', async (t) => {
  const place = placeFor(t)
  const session_start_deadline_ms = 300
  const terminal = await ownersTerminal(t, place, { deadlines: { session_start_deadline_ms } })
  const member = Number(textIn(terminal.fake.readyFile))
  await new Promise((resolve) => setTimeout(resolve, 5 * session_start_deadline_ms))
  assert.equal(isAlive(member), true, 'the member still runs')
  assert.ok(!terminal.shown().includes('stopped'), terminal.shown())
})

test('a member on the owner\'s terminal whose relay never reports its session start is stopped at the trust answer deadline, saying the host may still have been asking (#104 r=2)', async (t) => {
  const place = placeFor(t)
  const trust_answer_deadline_ms = 500
  const terminal = await ownersTerminal(t, place, { deadlines: { session_start_deadline_ms: 60_000, trust_answer_deadline_ms } })
  await until('the launcher to stop the member', () => terminal.shown().includes('because '), t, () => terminal.shown())
  const why = /because (.*)/.exec(terminal.shown())?.[1] ?? ''
  assert.ok(why.includes(`within ${trust_answer_deadline_ms / 1000} s`), why)
  assert.ok(why.includes('trust'), why)
})

/** The host's own record of the folders it trusts, as Claude Code keeps it in the config folder the member's HOME names. */
function hostTrustRecord(place: Place, record: string | undefined): void {
  if (record !== undefined) writeFileSync(join(place.home, '.claude.json'), record)
}

test('a member on the owner\'s terminal in a folder the host\'s record already trusts is held to the short deadline: the host asks nothing (#104 r=3)', async (t) => {
  const place = placeFor(t)
  hostTrustRecord(place, JSON.stringify({ projects: { [place.checkout]: { hasTrustDialogAccepted: true } } }))
  const session_start_deadline_ms = 300
  const terminal = await ownersTerminal(t, place, { inherited: { HOME: place.home }, deadlines: { session_start_deadline_ms, trust_answer_deadline_ms: 60_000 } })
  await until('the launcher to stop the member', () => terminal.shown().includes('because '), t, () => terminal.shown())
  const why = /because (.*)/.exec(terminal.shown())?.[1] ?? ''
  assert.ok(why.includes(`within ${session_start_deadline_ms / 1000} s`), why)
  assert.ok(!why.includes('trust'), why)
})

for (const [what, record] of [
  ['no record at all', undefined],
  ['a record that does not parse', '{"projects": {'],
  ['a record where the folder is not trusted', (place: Place) => JSON.stringify({ projects: { [place.checkout]: { hasTrustDialogAccepted: false } } })],
  ['a record that trusts only a folder above it', (place: Place) => JSON.stringify({ projects: { [dirname(place.checkout)]: { hasTrustDialogAccepted: true } } })],
  ['a record whose trust is not the value true', (place: Place) => JSON.stringify({ projects: { [place.checkout]: { hasTrustDialogAccepted: 'true' } } })],
] as const) {
  test(`a member on the owner\'s terminal keeps the trust answer deadline on ${what} (#104 r=3)`, async (t) => {
    const place = placeFor(t)
    hostTrustRecord(place, typeof record === 'function' ? record(place) : record)
    const session_start_deadline_ms = 300
    const terminal = await ownersTerminal(t, place, { inherited: { HOME: place.home }, deadlines: { session_start_deadline_ms, trust_answer_deadline_ms: 60_000 } })
    const member = Number(textIn(terminal.fake.readyFile))
    await new Promise((resolve) => setTimeout(resolve, 5 * session_start_deadline_ms))
    assert.equal(isAlive(member), true, 'the member still runs')
    assert.ok(!terminal.shown().includes('stopped'), terminal.shown())
  })
}

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
