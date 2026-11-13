// A member's own file writes do not stop it; any other change to the approved checkout still does (martha#132).
//
// Real directories, a real git checkout and Martha's real state: the launcher's answers are asked as the relay asks
// them, after the test has made the change on disk the call would have made. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { openState, ownWritesKeptForLaunch, ownWritesKeptForTheHistory, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import {
  decideLaunch,
  fingerprintOf,
  readLaunchState,
  startedWithOf,
  type ApprovedLaunch,
  type LaunchState,
  type StartedWith,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { OWN_WRITE_MODES, type OwnWritesOfTheHistory } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { memberRelay, type MemberRelay, type RelayReply } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'

/** The user-scope places the recording names, under a home the tests run in (martha#154). */
const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, '.claude', CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

const MEMBER = 'builder'
const SESSION = 'session-1'
const LAUNCH = 'launch-1'
const SERVERS = JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } })

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  ).trim()
}

interface Checkout {
  readonly home: string
  readonly checkout: string
  readonly state: MarthaState
  readonly approved: LaunchState
  readonly relay: MemberRelay
  readonly stops: string[]
}

interface Options {
  readonly files?: Readonly<Record<string, string>>
  /** What the member was started on, when not what is on disk at the start. */
  readonly approved?: (on_disk: LaunchState) => LaunchState
}

function checkoutFor(t: TestContext, { files = {}, approved = (on_disk) => on_disk }: Options = {}): Checkout {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-own-writes-')))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  git(checkout, 'init', '-q', '.')
  const committed = { 'README.md': 'a checkout\n', '.mcp.json': SERVERS, '.gitignore': '.claude/settings.local.json\n', ...files }
  for (const [path, text] of Object.entries(committed)) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  const state = openState(join(home, 'state'), checkout)
  assert.ok('directory' in state, 'refusal' in state ? state.refusal : '')
  const place = { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home }
  const started = approved(readLaunchState(place, thisMachine))
  const launch: ApprovedLaunch = {
    ...place,
    approved_fingerprints: [fingerprintOf(started)],
    since_approval: { approved: started, member: MEMBER, own_writes: ownWritesKeptForLaunch(state, LAUNCH), launch_id: LAUNCH },
  }
  const stops: string[] = []
  const relay = memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(join(home, 'state'))),
    launch,
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithTheSwitchesOfTheAdapter(),
    binder: bindNothing,
    handed_at_start: [],
    ownerMemory: ownerMemoryPlaces({ launcher_env: { HOME: home }, member_env: { HOME: home }, home, launch_dir: home, settings_files: [], user_scope: userScopeFor(home) }),
    hookSettings: hookSettingsWatch({
      user: join(home, '.claude', 'settings.json'),
      home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    stopMember: (why) => void stops.push(why),
  })
  return { home, checkout, state, approved: started, relay, stops }
}

const TAKEN_REPLY: RelayReply = { answered: true, body: { taken: 1 } }
const ALLOW_REPLY: RelayReply = { answered: true, body: { allow: 1 } }

const call = (tool: string, more: Record<string, unknown> = {}) => ({ session_id: SESSION, call: { tool, tool_use_id: `toolu_${tool}`, ...more } })

async function started(place: Checkout): Promise<void> {
  const reply = await place.relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.deepEqual(reply, TAKEN_REPLY)
}

/** The member's Write: the file on disk as the host leaves it, then the launcher hears the call ran. */
async function wrote(place: Checkout, path: string, content: string, on_disk = content): Promise<RelayReply> {
  const file = join(place.checkout, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, on_disk)
  return place.relay.answer('tool_answered', call('Write', { file_path: file, content }))
}

const blobOf = (place: Checkout, path: string): string => git(place.checkout, 'hash-object', '--', path)
const allOwnWrites = (state: MarthaState): OwnWritesOfTheHistory => ownWritesKeptForTheHistory(state).all()

const MOVED = (paths: string): string =>
  `The checkout changed since the owner approved it, and not by this member's own file writes: ${paths}. ` +
  `Run martha approve, read what it shows, and answer yes; then martha start ${MEMBER}.`

const DENIED_BEFORE_A_CALL = (why: string): RelayReply => ({
  answered: true,
  body: {
    deny:
      'No tool runs in this session: the checkout it was started in no longer matches what the owner approved, ' +
      `and its hooks run the checkout's scripts as they are now. ${why}`,
  },
})

const STOPPING = (why: string): RelayReply => ({ answered: false, stopping: why })

test("a member's Write of a tracked file passes the recheck after that very call, and the next call's", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  assert.deepEqual(await wrote(place, 'README.md', 'changed by the member\n'), TAKEN_REPLY)
  assert.deepEqual(await place.relay.answer('tool_called', call('Read', { file_path: join(place.checkout, 'README.md') })), ALLOW_REPLY)
  assert.deepEqual(place.stops, [])
})

test("a member's own Write of a new file keeps the shell: what it wrote itself is the member's own text, not a stranger's", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  assert.deepEqual(await wrote(place, 'hello.txt', 'hello\n'), TAKEN_REPLY)
  assert.deepEqual(await place.relay.answer('tool_called', call('Bash', { command: 'ls' })), ALLOW_REPLY)
  assert.deepEqual(place.stops, [])
})

test('an own write is kept with its eight fields: the real path, the blob and mode on disk, the call, the session and the launch', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  const before = Date.now()
  await wrote(place, 'hello.txt', 'hello\n')
  const kept = allOwnWrites(place.state)
  assert.ok('writes' in kept)
  assert.equal(kept.writes.length, 1)
  const [write] = kept.writes
  assert.ok(write !== undefined)
  const { recorded_at, ...rest } = write
  assert.deepEqual(rest, {
    path: join(place.checkout, 'hello.txt'),
    blob: blobOf(place, 'hello.txt'),
    mode: OWN_WRITE_MODES[0],
    tool: 'Write',
    tool_use_id: 'toolu_Write',
    session: SESSION,
    launch: LAUNCH,
  })
  assert.ok(Date.parse(recorded_at) >= before - 1000 && Date.parse(recorded_at) <= Date.now())
})

test("an Edit and a NotebookEdit are own writes of the file they name, as it is on disk after the call", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  writeFileSync(join(place.checkout, 'README.md'), 'edited\n')
  assert.deepEqual(await place.relay.answer('tool_answered', call('Edit', { file_path: join(place.checkout, 'README.md'), old_string: 'a', new_string: 'b' })), TAKEN_REPLY)
  writeFileSync(join(place.checkout, 'book.ipynb'), '{"cells":[]}\n')
  assert.deepEqual(await place.relay.answer('tool_answered', call('NotebookEdit', { notebook_path: join(place.checkout, 'book.ipynb'), new_source: 'x' })), TAKEN_REPLY)
  const kept = allOwnWrites(place.state)
  assert.ok('writes' in kept)
  assert.deepEqual(
    kept.writes.map(({ path, blob, tool }) => ({ path, blob, tool })),
    [
      { path: join(place.checkout, 'README.md'), blob: blobOf(place, 'README.md'), tool: 'Edit' },
      { path: join(place.checkout, 'book.ipynb'), blob: blobOf(place, 'book.ipynb'), tool: 'NotebookEdit' },
    ],
  )
  assert.deepEqual(place.stops, [])
})

test('a path the member gives relative to where it started, from its home, or with spaces around it, is the file the host wrote', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  writeFileSync(join(place.checkout, 'hello.txt'), 'hello\n')
  assert.deepEqual(await place.relay.answer('tool_answered', call('Write', { file_path: ' hello.txt ', content: 'hello\n' })), TAKEN_REPLY)
  writeFileSync(join(place.checkout, 'other.txt'), 'other\n')
  assert.deepEqual(await place.relay.answer('tool_answered', call('Write', { file_path: '~/checkout/other.txt', content: 'other\n' })), TAKEN_REPLY)
  assert.deepEqual(place.stops, [])
})

test("a Bash call's changes are never own writes: it is stopped, naming the path, and nothing is kept", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  writeFileSync(join(place.checkout, 'README.md'), 'changed by a command\n')
  const why = MOVED('README.md')
  assert.deepEqual(await place.relay.answer('tool_answered', call('Bash', { command: 'echo changed > README.md' })), STOPPING(why))
  assert.deepEqual(place.stops, [why])
  assert.deepEqual(allOwnWrites(place.state), { writes: [], unread: [] })
})

test('a change nobody recorded is refused before the next call, naming the path and how to approve it', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  writeFileSync(join(place.checkout, 'outsider.txt'), 'planted\n')
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), DENIED_BEFORE_A_CALL(MOVED('outsider.txt')))
})

test("another launch's record of the same bytes does not pass a path", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  writeFileSync(join(place.checkout, 'outsider.txt'), 'planted\n')
  const elsewhere = {
    path: join(place.checkout, 'outsider.txt'),
    blob: blobOf(place, 'outsider.txt'),
    mode: OWN_WRITE_MODES[0],
    tool: 'Write',
    tool_use_id: 'toolu_other',
    session: SESSION,
    launch: 'another-launch',
    recorded_at: new Date().toISOString(),
  }
  assert.equal(ownWritesKeptForTheHistory(place.state).append(elsewhere), undefined)
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), DENIED_BEFORE_A_CALL(MOVED('outsider.txt')))
})

test('own write A, then own write B, then the file put back to A by someone else: stopped', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  assert.deepEqual(await wrote(place, 'hello.txt', 'A\n'), TAKEN_REPLY)
  assert.deepEqual(await wrote(place, 'hello.txt', 'B\n'), TAKEN_REPLY)
  writeFileSync(join(place.checkout, 'hello.txt'), 'A\n')
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), DENIED_BEFORE_A_CALL(MOVED('hello.txt')))
})

test("an own Write that git changes as it adds it (text=auto over CRLF) passes: the blob is kept as git would add it", async (t) => {
  const place = checkoutFor(t, { files: { '.gitattributes': '* text=auto\n' } })
  await started(place)
  assert.deepEqual(await wrote(place, 'windows.txt', 'one\r\ntwo\r\n'), TAKEN_REPLY)
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), ALLOW_REPLY)
  const kept = allOwnWrites(place.state)
  assert.ok('writes' in kept)
  assert.equal(kept.writes[0]?.blob, blobOf(place, 'windows.txt'))
  assert.deepEqual(place.stops, [])
})

test("an own write whose mode someone else changes after it (chmod +x) stops the member, naming the path", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  assert.deepEqual(await wrote(place, 'run.sh', 'echo hello\n'), TAKEN_REPLY)
  chmodSync(join(place.checkout, 'run.sh'), 0o755)
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), DENIED_BEFORE_A_CALL(MOVED('run.sh')))
})

test("a Write whose bytes on disk are not the call's content is not kept, and the member is stopped", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  const why = MOVED('hello.txt')
  assert.deepEqual(await wrote(place, 'hello.txt', 'what the member wrote\n', 'what someone else left\n'), STOPPING(why))
  assert.deepEqual(allOwnWrites(place.state), { writes: [], unread: [] })
})

test('a link put in the checkout is never an own write, even where the member wrote', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  assert.deepEqual(await wrote(place, 'hello.txt', 'hello\n'), TAKEN_REPLY)
  symlinkSync('hello.txt', join(place.checkout, 'link.txt'))
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), DENIED_BEFORE_A_CALL(MOVED('link.txt')))
})

test('a directory named by a Write is not an own write: nothing is kept, and the call does not read it', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  const directory = join(place.checkout, 'notes')
  mkdirSync(directory)
  assert.deepEqual(await place.relay.answer('tool_answered', call('Write', { file_path: directory, content: 'hello\n' })), TAKEN_REPLY)
  assert.deepEqual(allOwnWrites(place.state), { writes: [], unread: [] })
  assert.deepEqual(place.stops, [])
})

test('a branch checked out mid-session that drops the config and adds a file stops the member (martha#142)', async (t) => {
  const place = checkoutFor(t)
  git(place.checkout, 'checkout', '-q', '-b', 'outsider')
  git(place.checkout, 'rm', '-q', '.mcp.json')
  writeFileSync(join(place.checkout, 'planted.sh'), 'echo planted\n')
  git(place.checkout, 'add', 'planted.sh')
  git(place.checkout, 'commit', '-q', '-m', 'drop the config, add a script')
  git(place.checkout, 'checkout', '-q', '-')
  await started(place)
  git(place.checkout, 'checkout', '-q', 'outsider')
  const why = MOVED('planted.sh')
  assert.deepEqual(await place.relay.answer('tool_answered', call('Bash', { command: 'git checkout outsider' })), STOPPING(why))
  assert.deepEqual(place.stops, [why])
})

test('a checkout git can no longer read mid-session stops the member, even with its config gone: nothing can be told apart', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  removeTheTree(join(place.checkout, '.git'))
  rmSync(join(place.checkout, '.mcp.json'))
  const why =
    "The checkout no longer matches what the owner approved, and git can no longer read it as a checkout below the owner's home, so the member's own writes cannot be told from anyone else's. " +
    `Run martha approve, read what it shows, and answer yes; then martha start ${MEMBER}.`
  assert.deepEqual(await place.relay.answer('tool_answered', call('Bash', { command: 'rm -rf .git' })), STOPPING(why))
})

test('a file the member deleted passes: removing a file plants nothing', async (t) => {
  const place = checkoutFor(t)
  await started(place)
  rmSync(join(place.checkout, 'README.md'))
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), ALLOW_REPLY)
})

test("the member's own Write to the checkout's config passes, as any own write does", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  const servers = JSON.stringify({ mcpServers: {} })
  assert.deepEqual(await wrote(place, '.mcp.json', servers), TAKEN_REPLY)
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), ALLOW_REPLY)
})

test("a config file git ignores is outside the tree, so even the member's own Write to it stops it", async (t) => {
  const place = checkoutFor(t)
  await started(place)
  const why = MOVED('.claude/settings.local.json')
  assert.deepEqual(await wrote(place, '.claude/settings.local.json', '{}\n'), STOPPING(why))
})

test('a tree the owner approved that the checkout no longer holds refuses: nothing can be told apart', async (t) => {
  const missing = '0'.repeat(40)
  const place = checkoutFor(t, { approved: (on_disk) => ({ ...on_disk, tree: missing }) })
  await started(place)
  const why =
    `The tree the owner approved (${missing}) can no longer be read from the checkout, so the member's own writes cannot be told from anyone else's. ` +
    `Run martha approve, read what it shows, and answer yes; then martha start ${MEMBER}.`
  assert.deepEqual(await place.relay.answer('tool_called', call('Read')), DENIED_BEFORE_A_CALL(why))
})

test('a start refusal for a checkout the owner has not approved says how to approve it, not where to type a fingerprint', (t) => {
  const place = checkoutFor(t)
  const decision = decideLaunch({ host: CLAUDE_CODE, ...place.approved, approved_fingerprints: [] })
  assert.equal(decision.allow, false)
  assert.ok(!decision.allow)
  assert.equal(
    decision.refusal,
    `This coding tool is not started here: the checkout holds config that starts code by itself (.mcp.json), and the owner has not approved this config with this checkout's files (fingerprint ${fingerprintOf(place.approved)}). Run martha approve, read what it shows, and answer yes.`,
  )
})

/** What these launches started the host with: the arguments and environment the adapter's declaration names (martha#135). */
function startedWithTheSwitchesOfTheAdapter(): StartedWith {
  return startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env)
}
