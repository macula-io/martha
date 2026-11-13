// `martha start <member>`: one member of the declared crew, started on the config the owner approved (martha#98).
//
// A real git checkout under a temporary home, a fake `claude` standing in for the host, the real launcher and the
// real launch records. A place ends every member started on it before it removes the home they were writing in, and
// the member's process group goes with it (martha#272).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, watch, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { CREW_TOOL_NAMES, NO_ACTING_PLACE, THE_TOOLS_ASK } from '../a_crews_tools/a_crews_tools.ts'
import { approveConfig } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, MODE_TEXTS_DIRECTORY, REVIEW_MODEL, ROLE_TEXTS_DIRECTORY, STRICT_GATE } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew, SOLO_MEMBERS, SOLO_MODE, soloDeclaration } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import {
  nodeIdsFor,
  openState,
  OWN_WRITES_LAUNCHES_KEPT,
  OWN_WRITES_PLACE,
  ownWritesKeptForLaunch,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { OWN_WRITE_MODES, ownWritesOfLaunch, type OwnWrite } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { reviewModelRefusal } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import { readApprovals } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { NOT_STARTED, type MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { NO_CREW_TOOLS, type MemberRelayPlace } from '../launch_a_claude_code_member/answer_the_relay.ts'
import { RELAY_SOCKET_NAME } from '../launch_a_claude_code_member/relay_directory.ts'
import { CLAUDE_CODE_MODELS, CLAUDE_CODE_SUBAGENT_SPAWN } from '../claude_code_host/claude_code_host.ts'
import { RELAY_ORIGIN, RELAY_PATHS, TOOL_ANSWER_PATH, toolCallBody } from '../claude_code_relay/hooks/relay_protocol.ts'
import { BEAT_INTERVAL_MS } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { shortRelayRoot } from '../launch_a_claude_code_member/short_relay_root.ts'
import { POLL_MS, until } from '../launch_a_claude_code_member/wait_until_the_event.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { SWITCHES_THAT_LOAD_NO_CONFIG } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { approvedPlace, launcherPlacesOf, NOT_A_TERMINAL, startMember, type MemberStartRequest } from './start_a_member.ts'
import { declareCrew } from '../declare_crew/declare_crew.ts'
import { crewStateDirectory } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { stopTheCrew } from '../run_the_martha_command/list_stop_and_restart_the_crew.ts'
import { crewRowsDirectoryOf } from '../launch_a_claude_code_member/drive_the_recorded_host.ts'
import { hostAnswers } from '../launch_a_claude_code_member/host_stand_in.ts'
import { canonicalHashWithoutModel, sha256Of } from '../put_the_owners_model_back/the_owners_settings_file.ts'
import { MODEL_PLACE, theModelMarker, type ModelMarker } from '../switch_a_members_model/switch_a_members_model.ts'
import { crewSubdirectory } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

/** The models this test's host runs (martha#315): the vocabulary a declaration's review_model is read against. */
const HOST_MODELS = ['opus', 'fable']

const SERVERS = JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } })
const documents = { read: (path: string) => readFile(path, 'utf8') }
const [BUILDER] = SOLO_MEMBERS

interface Place {
  readonly home: string
  readonly root: string
  readonly state: MarthaState
  readonly relay_root: string
  /** Every member started on this place, so the place ends them before the home they write in is removed (martha#272). */
  readonly membersStarted: AStartedMember[]
}

/** A member that did start, as the launcher hands it to a test: it can be stopped, and it says when it is gone. */
type AStartedMember = Extract<MemberStarted, { readonly started: true }>

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd })
}

/**
 * The end of a place: every member it started is stopped and gone before the home they and the children they started
 * write in is removed (martha#272).
 *
 * A test's hooks run in the order they were registered, and the place is made before any member is, so the home used to
 * be removed while the member was still running: the red seen once in a full run on #256's worktree, ENOTEMPTY, the home
 * gaining an entry between the remove reading it and removing it. The place owns the member's end instead of the order
 * of the hooks, so a test that starts a member and says nothing else still tears down cleanly.
 */
async function thePlaceEnds(place: Place): Promise<void> {
  for (const started of place.membersStarted) started.stop('the test is over')
  await Promise.all(place.membersStarted.map((started) => started.stopped))
  removeTheTree(place.home)
}

/** A member started on a place, which the place ends before its home goes (martha#272). */
async function startedOn(place: Place, request: MemberStartRequest): Promise<MemberStarted> {
  const started = await startMember(request)
  if (started.started) place.membersStarted.push(started)
  return started
}

function placeFor(t: TestContext, files: Readonly<Record<string, string>>): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-start-')))
  const root = join(home, 'project')
  mkdirSync(root)
  git(root, 'init', '-q', '.')
  writeFileSync(join(root, 'README.md'), 'a project\n')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  git(root, 'add', '--all')
  git(root, 'commit', '-q', '-m', 'start')
  const state = openState(join(home, 'state'), root)
  assert.ok('directory' in state)
  const place: Place = { home, root, state, relay_root: shortRelayRoot(t), membersStarted: [] }
  t.after(() => thePlaceEnds(place))
  return place
}

/** A fake `claude`: notes that it ran and with what, then waits to be stopped. */
function fakeClaude(place: Place): { readonly command: string; readonly ran: string; readonly args: string } {
  const dir = join(place.home, 'fake')
  mkdirSync(dir)
  const ran = join(dir, 'ran')
  const args = join(dir, 'args')
  const command = join(dir, 'claude')
  writeFileSync(command, ['#!/bin/sh', ...hostAnswers(), `: > '${ran}'`, `printf '%s\\n' "$@" > '${args}'`, 'exec sleep 600', ''].join('\n'), { mode: 0o700 })
  return { command, ran, args }
}

/**
 * A fake `claude` that keeps every call's arguments, each call separated from the last, then waits to be stopped. The
 * launcher asks its host several questions before it starts a member, so a file that kept only the last call would be
 * the last question's, never the member's own start (martha#255 part 2 R1).
 */
function aClaudeThatWritesEachCall(place: Place): { readonly command: string; readonly args: string } {
  const dir = join(place.home, 'fake-each-call')
  mkdirSync(dir)
  const args = join(dir, 'args')
  const command = join(dir, 'claude')
  writeFileSync(
    command,
    ['#!/bin/sh', ...hostAnswers(), `{ printf '%s\\n' "$@"; echo '---'; } >> '${args}'`, 'exec sleep 600', ''].join('\n'),
    { mode: 0o700 },
  )
  return { command, args }
}

/** Every call the fake host kept, each as the arguments it was spawned with, in the order it was spawned. */
const callsIn = (file: string): string[][] =>
  readFileSync(file, 'utf8')
    .split('---\n')
    .map((call) => call.split('\n').filter((line) => line !== ''))
    .filter((call) => call.length > 0)

/**
 * A fake `claude` that starts a child writing into the home until it is killed, and then waits to be stopped: the shape
 * of the run the teardown race came from (martha#272). The child puts an entry into the home every few microseconds, so
 * a teardown that removes the home under it is removing a tree that is not quiet.
 *
 * The child's pid is written to a file of its own, and the write is worth care: the pid file is read by the test, and a
 * reader can see the file after it is made and before the number is in it. So the number goes to a temporary name that
 * is renamed into place, which is one step to a reader: a pid file that is there holds a whole pid.
 */
function aHostWritingIn(place: Place): { readonly command: string; readonly child: string } {
  const dir = join(place.home, 'writer')
  mkdirSync(dir)
  mkdirSync(join(place.home, 'written'))
  const child = join(dir, 'child')
  const command = join(dir, 'claude')
  const theChild =
    'const fs = require("node:fs");const home = process.argv[1];' +
    'for (;;) { try { fs.writeFileSync(`${home}/written/now`, String(process.pid)) } catch { /* the home is going */ } }'
  writeFileSync(
    command,
    [
      '#!/bin/sh',
      ...hostAnswers(),
      `node -e '${theChild}' '${place.home}' &`,
      `printf '%s\\n' "$!" > '${child}.being-written' && mv '${child}.being-written' '${child}'`,
      'exec sleep 600',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return { command, child }
}

/** The pid a file names, or 0 when it names none: a pid file is read, and reading it may find it still being written. */
function pidIn(path: string): number {
  try {
    const named = Number(readFileSync(path, 'utf8').trim())
    return Number.isInteger(named) && named > 0 ? named : 0
  } catch {
    return 0
  }
}

/**
 * Whether a process is still running: a signal that does nothing, and then the state the kernel keeps for it. A process
 * that has been killed is a zombie (`Z`) or exiting (`X`) for a moment after, and either answers the signal, so the
 * signal alone would call it running. Where there is no `/proc` to ask, the signal's answer is the answer.
 */
function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  return !['Z', 'X'].includes(stateOf(pid) ?? '')
}

/** A process's state letter, as `/proc` keeps it; undefined where it cannot be read. */
function stateOf(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.charAt(0)
  } catch {
    return undefined
  }
}

/** How long a test waits for the child it killed to be gone. A zombie is reaped in a moment; this is far above that. */
const GONE_WITHIN_MS = 5_000

/** Waits for a killed child to be gone, within a bound: a wait that never ends fails the test when the bound runs out. */
async function untilItIsGone(pid: number): Promise<void> {
  const deadline = Date.now() + GONE_WITHIN_MS
  while (isRunning(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS))
}

function requestFor(place: Place, command: string, member: string, lines: string[]): MemberStartRequest {
  const places = launcherPlacesOf(place.state, place.relay_root, place.root)
  assert.ok('rows' in places, 'refusal' in places ? places.refusal : '')
  return {
    root: place.root,
    home: place.home,
    member,
    args: ['--effort', 'low'],
    is_terminal: true,
    state: place.state,
    places,
    command,
    // HOME is the place's own, so the owner's user settings file the launcher reads is the test's.
    inherited: { PATH: process.env.PATH, HOME: place.home },
    stdio: 'ignore',
    documents,
    tellOwner: (line) => void lines.push(line),
  }
}

const declared = async (place: Place): Promise<void> => {
  const outcome = await declareSoloCrew({ root: place.root, owner: 'Ada Owner', state: place.state, documents, models: HOST_MODELS })
  assert.ok(outcome.declared, outcome.declared ? '' : outcome.refusal)
}

const yes = { is_terminal: true, ask: () => Promise.resolve('yes') }

test('start with no declaration starts nothing, naming the file and the command that writes one', async (t) => {
  const place = placeFor(t, {})
  const fake = fakeClaude(place)
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.startsWith(NOT_STARTED), refusal)
  assert.ok(refusal.includes(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)), refusal)
  assert.ok(refusal.includes('martha init'), refusal)
  assert.equal(existsSync(fake.ran), false)
})

test('start of a member the crew does not have starts nothing, naming it and the crew', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const started = await startedOn(place, requestFor(place, fake.command, 'stranger', []))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes('stranger'), refusal)
  for (const member of SOLO_MEMBERS) assert.ok(refusal.includes(member.name), refusal)
  assert.equal(existsSync(fake.ran), false)
})

test('start on a config the owner has not approved starts nothing, naming martha approve', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, lines))
  assert.equal(started.started, false)
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes('.mcp.json'), refusal)
  assert.ok(refusal.includes('martha approve'), refusal)
  assert.deepEqual(lines, [refusal], 'the refusal is shown to the owner once')
  assert.equal(existsSync(fake.ran), false)
})

test('init, approve and start bring a member up on the approved config, recorded under the node id init made', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
  assert.equal(approved.kind, 'approved')
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, lines))
  assert.ok(started.started, started.started ? '' : started.refusal)

  const ids = nodeIdsFor(place.state, [BUILDER!.name])
  assert.ok('ids' in ids)
  const places = launcherPlacesOf(place.state, place.relay_root, place.root)
  assert.ok('rows' in places)
  const records = launchRecordsDirectory(places.launch_records).all()
  assert.deepEqual(records.map((record) => [record.key, record.row['node_id']]), [[BUILDER!.name, ids.ids[BUILDER!.name]]])
  assert.ok(lines.some((line) => approved.kind === 'approved' && line.includes(approved.fingerprint)), 'the owner is shown the approval in use')
  await until('the fake host to write its arguments', () => existsSync(fake.args) && readFileSync(fake.args, 'utf8').includes('--plugin-dir'), t)
  assert.ok(readFileSync(fake.args, 'utf8').includes('--mcp-config'), 'the approved copy is passed')
})

test('a place ends the member it started before it removes the home, while a child of it is still writing there (#272)', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
  const writer = aHostWritingIn(place)
  const lines: string[] = []
  const started = await startedOn(place, requestFor(place, writer.command, BUILDER!.name, lines))
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the host\'s child to name its pid', () => pidIn(writer.child) > 1, t)
  const child = pidIn(writer.child)
  assert.ok(child > 1, 'the pid the child wrote is a pid of its own, never 0: a signal to 0 is sent to every process of this test\'s group')
  assert.ok(isRunning(child), 'the child that writes into the home is running when the test ends')
  // The order is read, not raced: the two things the teardown does are noted as they happen. Nothing here stops the
  // member or removes the home — the place does both — and this hook is registered after the place's own, so it reads
  // what the teardown left.
  const happened: string[] = []
  let noteTheHomeWent = (): void => {}
  const theHomeWent = new Promise<void>((resolve) => {
    noteTheHomeWent = () => {
      if (!happened.includes('the home went')) happened.push('the home went')
      resolve()
    }
  })
  void started.stopped.then(() => happened.push('the member stopped'))
  // A change to an entry of the home's own directory is the home appearing or going; it existed before the watcher was
  // made, so the first change to it that this sees is the removal. The note is taken from the event alone: the home may
  // still be readable for a moment after the event that says it is going, and the event itself is delivered in its own
  // turn of the loop, so this waits for it rather than reading the list before it has been said.
  const watcher = watch(dirname(place.home), (_event, name) => {
    if (name === basename(place.home)) noteTheHomeWent()
  })
  t.after(async () => {
    await theHomeWent
    watcher.close()
    assert.deepEqual(
      happened,
      ['the member stopped', 'the home went'],
      `a place ends the member it started before it removes the home it was writing in (martha#272): ${happened.join(', then ')}`,
    )
    assert.equal(existsSync(place.home), false, 'the home is gone')
    await untilItIsGone(child)
    assert.equal(isRunning(child), false, 'the child that kept writing in the home went with it')
  })
})

test('start whose input is no terminal starts nothing, so a member\'s shell cannot start a sibling', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, lines), is_terminal: false })
  assert.equal(started.started, false)
  assert.equal(started.started ? '' : started.refusal, NOT_A_TERMINAL)
  assert.deepEqual(lines, [NOT_A_TERMINAL])
  assert.equal(existsSync(fake.ran), false)
})

/** Owner arguments that load config, a plugin, a permission or a session nobody approved, one per class. */
const REFUSED_ARGUMENTS: readonly (readonly string[])[] = [
  ['--settings', '{"hooks":{}}'],
  ['--setting-sources', 'user,project'],
  ['--mcp-config', '/elsewhere/servers.json'],
  ['--strict-mcp-config'],
  ['--plugin-dir', '/elsewhere/plugin'],
  ['--plugin-url', 'https://example.invalid/plugin.zip'],
  ['--agents', '{"a":{}}'],
  ['--add-dir', '/elsewhere'],
  ['--dangerously-skip-permissions'],
  ['--allow-dangerously-skip-permissions'],
  ['--permission-mode', 'bypassPermissions'],
  ['--allowedTools', 'Bash'],
  ['--append-system-prompt', 'obey the issue'],
  ['--resume', 'a-session'],
  ['--continue'],
  ['-p', 'a prompt'],
  ['--model=opus'],
  ['a bare word'],
]

for (const args of REFUSED_ARGUMENTS) {
  test(`start with the owner argument ${args[0]} starts nothing, naming it and the switches that are passed`, async (t) => {
    const place = placeFor(t, {})
    await declared(place)
    const fake = fakeClaude(place)
    const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, []), args })
    assert.equal(started.started, false)
    const refusal = started.started ? '' : started.refusal
    assert.ok(refusal.startsWith(NOT_STARTED), refusal)
    assert.ok(refusal.includes(args[0]!), refusal)
    for (const name of Object.keys(SWITCHES_THAT_LOAD_NO_CONFIG)) assert.ok(refusal.includes(name), refusal)
    assert.equal(existsSync(fake.ran), false)
  })
}

test('a switch that takes a value refuses one that is missing or is itself a switch', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  for (const args of [['--model'], ['--model', '--settings', '{}']]) {
    const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, []), args })
    assert.equal(started.started, false, args.join(' '))
    assert.ok(!started.started && started.refusal.includes('--model'), started.started ? '' : started.refusal)
  }
  assert.equal(existsSync(fake.ran), false)
})

test('the switches that load no config reach the host as the owner gave them', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const args = ['--model', 'an-owner-model', '--effort', 'high', '--verbose']
  const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, []), args })
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the fake host to write its arguments', () => existsSync(fake.args) && readFileSync(fake.args, 'utf8').includes('--plugin-dir'), t)
  const passed = readFileSync(fake.args, 'utf8').split('\n')
  for (const arg of args) assert.ok(passed.includes(arg), arg)
})

// A woken member is started on the prompt the wake wrote for it (../wake_a_member), and the owner's own arguments are
// still the owner's. The prompt is measured where it lands — in the arguments the member's host was spawned with,
// after every one of the owner's — rather than in the line that builds them (martha#255 part 2 r=1 R1).
test("a member started with Martha's own prompt carries it after the owner's arguments, and no earlier one (martha#255 part 2)", async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = aClaudeThatWritesEachCall(place)
  const args = ['--effort', 'high']
  const prompt = `${BUILDER!.name}, you are resuming from your handover at /somewhere/HANDOVER_2026-11-12_${BUILDER!.name}.md. Read it first.`
  const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, []), args, initial_prompt: prompt })
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the fake host to write the arguments it was started as a member with', () => existsSync(fake.args) && readFileSync(fake.args, 'utf8').includes('--plugin-dir'), t)
  const member = callsIn(fake.args).at(-1)
  assert.ok(member !== undefined && member.includes('--plugin-dir'), 'the launcher never started the member')
  assert.equal(member.filter((arg) => arg === prompt).length, 1, 'the prompt the wake wrote reached the host a number of times other than once')
  // The prompt is the member's own last argument: directly after the owner's. The launcher's own switches follow it.
  assert.equal(member[member.indexOf('high') + 1], prompt, `Martha's prompt does not follow the owner's arguments: ${JSON.stringify(member)}`)
})

/** An own write of one launch, as the launcher keeps one. */
function ownWriteOf(launch: string, index: number): OwnWrite {
  return {
    path: `/project/written-${index}.txt`,
    blob: 'ce013625030ba8dba906f756967f9e9ca394464a',
    mode: OWN_WRITE_MODES[0],
    tool: WHOLE_FILE_TOOL,
    tool_use_id: `toolu_${index}`,
    session: 'session-1',
    launch,
    recorded_at: new Date(index * 1000).toISOString(),
  }
}

/** The own-writes place of the project, as the launcher names the files in it (martha#162). */
const ownWritesPlace = (state: MarthaState): string => join(state.directory, OWN_WRITES_PLACE)

test('the launch a member is started as keeps its own writes: a write under that launch id is kept and read back (martha#162 r=2)', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
  assert.equal(approved.kind, 'approved')
  const kept = readApprovals(place.state)
  assert.ok('approvals' in kept)
  const started_on = approvedPlace(requestFor(place, join(place.home, 'claude'), BUILDER!.name, []), kept.approvals[0])
  const since = started_on.since_approval
  assert.ok(since !== undefined, 'a member started on an approval is started on its own launch')
  // The store the launcher is handed is this launch's, so a write carrying this launch id is kept, and comes back.
  const write = ownWriteOf(since.launch_id, 0)
  assert.equal(since.own_writes.append(write), undefined)
  assert.deepEqual(ownWritesOfLaunch(since.own_writes, since.launch_id), { writes: [write] })
})

test('starting a member on an approval prunes the own writes of launches past the newest kept (martha#162 r=2)', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
  assert.equal(approved.kind, 'approved')
  // One launch more than Martha keeps, each older than the one before, so the first two are the ones to go.
  mkdirSync(ownWritesPlace(place.state), { recursive: true, mode: 0o700 })
  const seeded = Array.from({ length: OWN_WRITES_LAUNCHES_KEPT + 2 }, (_, index) => `seeded-${index}`)
  for (const [index, launch] of seeded.entries()) {
    const before = new Set(readdirSync(ownWritesPlace(place.state)))
    assert.equal(ownWritesKeptForLaunch(place.state, launch).append(ownWriteOf(launch, index)), undefined)
    const [made] = readdirSync(ownWritesPlace(place.state)).filter((name) => !before.has(name))
    assert.ok(made !== undefined, 'the store made the launch its own file')
    const when = new Date(index * 1000)
    utimesSync(join(ownWritesPlace(place.state), made), when, when)
  }
  const fake = fakeClaude(place)
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.ok(started.started, started.started ? '' : started.refusal)
  const left = readdirSync(ownWritesPlace(place.state))
  assert.equal(left.length, OWN_WRITES_LAUNCHES_KEPT, 'the two oldest launches are pruned, and no more')
})

// --- the strict shell gate reaches the member (martha#259) ---------------------

test("the declaration's strict gate is what the member's relay is handed, and off is the default", async (t) => {
  const seenWith = async (house_rules: Readonly<Record<string, boolean>>): Promise<readonly (boolean | undefined)[]> => {
    const place = placeFor(t, { '.mcp.json': SERVERS })
    await declared(place)
    // The declaration the crew reads, with the house rules the owner wrote: init wrote none.
    writeFileSync(
      join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE),
      `${JSON.stringify({ ...soloDeclaration('Ada Owner'), house_rules }, null, 2)}\n`,
    )
    const approved = await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
    assert.equal(approved.kind, 'approved')
    const fake = fakeClaude(place)
    const handed: MemberRelayPlace[] = []
    const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, []), hear_relay_place: (relay_place) => void handed.push(relay_place) })
    assert.ok(started.started, started.started ? '' : started.refusal)
    return handed.map((relay_place) => relay_place.strict_gate)
  }

  assert.deepEqual(await seenWith({}), [false], 'no house rules: the gate is off, as the owner decided')
  assert.deepEqual(await seenWith({ [STRICT_GATE]: true }), [true], 'the declaration turns it on')
})

/**
 * The start reads the crew's declaration with the models this host runs (martha#315). A declaration that holds reviews
 * to a model the host can spell starts, and the crew the member is handed carries that rule and the vocabulary it was
 * read against. Read with no models — what a start passing `[]` would do — the same declaration is refused and no
 * member starts, so a vocabulary this launcher forgot is a crew that cannot start its reviewer.
 */
test('a declaration naming a reviewer model this host runs starts the member, and the crew carries that model (#315)', async (t) => {
  const [review_model] = CLAUDE_CODE_MODELS
  assert.ok(review_model !== undefined && review_model !== '', 'the recorded host names no model, so this test could hold no review to one')
  const place = placeFor(t, {})
  await declared(place)
  // The declaration the crew reads, with the house rule the owner wrote: init wrote none.
  writeFileSync(
    join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE),
    `${JSON.stringify({ ...soloDeclaration('Ada Owner'), house_rules: { [REVIEW_MODEL]: review_model } }, null, 2)}\n`,
  )
  const fake = fakeClaude(place)
  const handed: MemberRelayPlace[] = []
  const started = await startedOn(place, { ...requestFor(place, fake.command, BUILDER!.name, []), hear_relay_place: (relay_place) => void handed.push(relay_place) })
  assert.ok(started.started, started.started ? '' : started.refusal)
  const crew = handed[0]?.crew
  assert.ok(crew !== undefined, 'the member was started with no crew tools')
  // What the started member's crew holds, asked of the crew itself rather than inferred from the line that built it:
  // the rule's own answer for the same call, compared exactly, so this pins the reviewer model and no copy of the
  // rule's wording.
  const review = { tool: CLAUDE_CODE_SUBAGENT_SPAWN.tools[0]!, input: { [CLAUDE_CODE_SUBAGENT_SPAWN.description_field]: 'review the patch' } }
  assert.equal(
    await crew.refusesTheSubagent(review),
    reviewModelRefusal(review, { spawn: CLAUDE_CODE_SUBAGENT_SPAWN, review_model }),
    'the crew handed to the member holds no review to the model the owner declared',
  )
})

test("a run reading a member's rows derives the same place the launcher writes them to (martha#254, r=1 O2)", () => {
  const state_home = mkdtempSync(join(tmpdir(), 'martha-254-derive-'))
  const checkout = join(state_home, 'checkout')
  mkdirSync(checkout, { recursive: true })
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  try {
    const state = openState(join(state_home, '.local', 'state', 'martha'), checkout)
    assert.ok('directory' in state, 'the state opens')
    const places = launcherPlacesOf(state, join(state_home, 'relay'), checkout)
    assert.ok('rows' in places, 'the launcher places are made')
    assert.equal(crewRowsDirectoryOf(join(state_home, '.local', 'state'), checkout), places.rows, 'the reader derives the place the launcher built')
  } finally {
    removeTheTree(state_home)
  }
})

// --- the crew reaches a launched member (martha#254 part 2 r=2 R3a) -------------

/** The socket of the one launch under a test's relay root, once its launcher has served it. */
async function launchedSocket(relay_root: string, t: TestContext): Promise<string> {
  let found: string | undefined
  await until('the launcher served its relay socket', () => {
    const launch = readdirSync(relay_root).find((name) => existsSync(join(relay_root, name, RELAY_SOCKET_NAME)))
    found = launch === undefined ? undefined : join(relay_root, launch, RELAY_SOCKET_NAME)
    return found !== undefined
  }, t)
  assert.ok(found !== undefined, 'the launch served a socket')
  return found
}

/** Posts a body to a launcher's relay socket, as the mod does, and gives back what it answered. */
function postOverSocket(socket_path: string, path: string, body: unknown): Promise<{ status: number; text: string }> {
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

/**
 * `crewOf` in the launcher is the only link that hands a launched member its crew's tools (martha#254 part 2 r=2
 * R3a): a launch given no crew place answers no tool, and every test of the mod built its relay by hand until this
 * one. So this starts a member the way the owner does, and asks its launcher — over the socket the mod posts to —
 * for the crew's tools.
 */
test('a member started from the crew answers the crew\'s tools over its relay (martha#254 part 2 r=2 R3a)', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const fake = fakeClaude(place)
  const started = await startMember(requestFor(place, fake.command, BUILDER!.name, []))
  assert.ok(started.started, started.started ? '' : started.refusal)
  t.after(async () => (started.stop('the test is over'), await started.stopped))

  const socket_path = await launchedSocket(place.relay_root, t)
  const heard = await postOverSocket(socket_path, TOOL_ANSWER_PATH, toolCallBody('session-254', THE_TOOLS_ASK, {}))
  assert.equal(heard.status, 200, heard.text)
  assert.ok(!heard.text.includes(NO_CREW_TOOLS), `the launch answered no tool: ${heard.text}`)
  const answered = JSON.parse((JSON.parse(heard.text) as { answer: string }).answer) as readonly { name: string }[]
  assert.deepEqual(answered.map((tool) => tool.name), [...CREW_TOOL_NAMES], 'the crew\'s own tools, named by the launcher')

  // The pane is told how often to redraw itself by the same answer it reads the crew from, and the interval is the
  // beat's own (r=2 R1): a redraw on a literal would drift from the beat the rows are written on.
  const shown = await postOverSocket(socket_path, TOOL_ANSWER_PATH, toolCallBody('session-254', 'see_the_crew', {}))
  assert.equal(shown.status, 200, shown.text)
  const crew = JSON.parse((JSON.parse(shown.text) as { answer: string }).answer) as { redraw_ms: number }
  assert.equal(crew.redraw_ms, BEAT_INTERVAL_MS, 'the pane redraws on the beat\'s own interval')

  // The five tools that act are handed the host's own processes and the crew's declaration (martha#256 r=2 R2): a
  // member Martha started calls them and is answered by the slice, not told that its launch can act in nothing. The
  // worktree tool needs both, so it is the one that would be refused if the launch dropped either.
  // A folder beside the project that is there and is no clone: git runs in it and refuses, which is the slice's
  // answer to give. A folder that is not there at all would make the run itself throw, which is no answer.
  const notAClone = join(place.home, 'not-a-clone')
  mkdirSync(notAClone)
  for (const [tool, args] of [
    [VERIFY_RANGE, { path: notAClone, base: 'a', tip: 'b' }],
    [WORKTREE_OPEN, { repo: 'synthetic-owner/widget', slug: '256-started' }],
  ] as const) {
    const acting = await postOverSocket(socket_path, TOOL_ANSWER_PATH, toolCallBody('session-254', tool, args))
    assert.equal(acting.status, 200, acting.text)
    const value = JSON.parse(acting.text) as { answer?: string; refused?: string }
    const words = value.answer ?? value.refused ?? ''
    assert.notEqual(words, NO_ACTING_PLACE, `${tool} is answered by its slice in a launch Martha started, not refused as a place that cannot act`)
    assert.notEqual(words.trim(), '', `${tool} says something`)
  }
})

// --- the crew text a started member is handed (martha#306) ---------------------

const CREW_CONVENTIONS = 'CONVENTIONS.md'
const CONVENTIONS_AS_WRITTEN = 'Read the register before you write anything.\n'
const CONVENTIONS_EDITED = 'Read the register, then the issue.\n'
/** A role text of the crew's own, which Martha does not ship: what proves the section carries the crew's bytes. */
const OWN_ROLE_TEXT = 'Our builder text, which Martha does not ship.\n'
/** A mode text of the crew's own, which Martha does not ship either (martha#306 r=4). */
const OWN_MODE_TEXT = 'Our solo text, which Martha does not ship.\n'

/** A crew as an owner declares it: its declaration, and a conventions file it names. */
function aCrewDeclaringItsConventions(): Readonly<Record<string, string>> {
  return {
    [join(DECLARATION_DIRECTORY, DECLARATION_FILE)]: JSON.stringify({ ...soloDeclaration('Ada Owner'), conventions: CREW_CONVENTIONS }),
    [join(DECLARATION_DIRECTORY, CREW_CONVENTIONS)]: CONVENTIONS_AS_WRITTEN,
  }
}

/** A crew as an owner declares it with texts of its own: a builder's role text, and a conventions file it names. */
function aCrewWithItsOwnTexts(): Readonly<Record<string, string>> {
  return {
    ...aCrewDeclaringItsConventions(),
    [join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, 'builder.md')]: OWN_ROLE_TEXT,
  }
}

const itsOwnerApproves = (place: Place) =>
  approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })

/** The crew text one session's start is handed, read off the relay's answer the way the mod reads it. */
async function theCrewTextHandedAt(socket_path: string, source: string, session_id: string): Promise<string> {
  const heard = await postOverSocket(socket_path, RELAY_PATHS.session_started, { session_id, source })
  assert.equal(heard.status, 200, heard.text)
  const answer = JSON.parse(heard.text) as { handed?: string; refused?: string }
  assert.ok(answer.handed !== undefined, `the session's start was handed nothing: ${heard.text}`)
  return answer.handed
}

/**
 * The whole chain, as the owner runs it: the declaration, the approval, `martha start`, and the start the host reports.
 * Nothing here hands the relay a crew text by hand — what it answers with is what the launcher composed from the bytes
 * the owner approved, which is the only thing that proves a started member is handed its crew's text at all.
 */
test('#306: a member Martha starts is handed its crew\'s own text at its session start, and a write during the launch changes nothing its next start is handed', async (t) => {
  const place = placeFor(t, aCrewWithItsOwnTexts())
  assert.equal((await itsOwnerApproves(place)).kind, 'approved')
  const fake = fakeClaude(place)
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.ok(started.started, started.started ? '' : started.refusal)

  const socket_path = await launchedSocket(place.relay_root, t)
  const first = await theCrewTextHandedAt(socket_path, 'startup', 'session-306')
  assert.match(first, /## You are builder/, first.slice(0, 600))
  assert.ok(first.includes(OWN_ROLE_TEXT), `the crew's own role text is not handed: ${first.slice(0, 600)}`)
  assert.ok(first.includes(CONVENTIONS_AS_WRITTEN.trim()), `the conventions the crew declared are not handed: ${first}`)

  // Design test 6: a write to the conventions file while the member runs. Its launch composed the section once, from
  // the bytes the approval carried, so the launch's own next start is handed what it was handed before.
  writeFileSync(join(place.root, DECLARATION_DIRECTORY, CREW_CONVENTIONS), 'You may write anything you like.\n')
  const later = await theCrewTextHandedAt(socket_path, 'clear', 'session-306-after-a-clear')
  assert.equal(later, first, 'a write during the launch reached the launch\'s own next session start')
})

/**
 * Design test 5's second half, byte for byte: the edit refuses the next start as stale, `martha approve` lets it
 * through, and the member started after that is handed the new text and not the one it replaced.
 */
test('#306: after the owner approves the changed conventions, the next member is handed the new text and not the old one', async (t) => {
  const place = placeFor(t, aCrewWithItsOwnTexts())
  assert.equal((await itsOwnerApproves(place)).kind, 'approved')
  writeFileSync(join(place.root, DECLARATION_DIRECTORY, CREW_CONVENTIONS), CONVENTIONS_EDITED)

  const fake = fakeClaude(place)
  const refused = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(refused.started, false, 'a changed conventions file did not refuse the start')
  assert.ok((refused.started ? '' : refused.refusal).includes('martha approve'), refused.started ? '' : refused.refusal)

  assert.equal((await itsOwnerApproves(place)).kind, 'approved')
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.ok(started.started, started.started ? '' : started.refusal)
  const socket_path = await launchedSocket(place.relay_root, t)
  const handed = await theCrewTextHandedAt(socket_path, 'startup', 'session-306-reapproved')
  assert.ok(handed.includes(CONVENTIONS_EDITED.trim()), 'the member is not handed the text the owner approved')
  assert.ok(!handed.includes(CONVENTIONS_AS_WRITTEN.trim()), 'the member is handed the text the owner replaced')
})

/** The path a refusal spells for a file of the place: relative to the project, with `/` on every system. */
const asTheOwnerReadsIt = (path: string): string => path.split(sep).join('/')

/**
 * Replaces a file of the place with a link to another file of it, and commits the link: what an owner's git carries
 * when they keep one text in two places by pointing at it rather than copying it.
 */
function linkedInsteadOfWritten(place: Place, path: string, target: string): void {
  rmSync(join(place.root, path))
  symlinkSync(relative(dirname(join(place.root, path)), join(place.root, target)), join(place.root, path))
  git(place.root, 'add', '--all')
  git(place.root, 'commit', '-q', '-m', `link ${path}`)
}

/**
 * A link where a crew text should be is refused by name, and nothing runs (martha#306 r=3, the r=2 review's finding).
 * The gate read a link's target and approved it, while the launch looked the link's own path up among the bytes it
 * carried, found none, and handed Martha's shipped text with no word to the owner. A link has no bytes the crew
 * approved, so the start says so and stops before the host is asked.
 */
test('#306 r=3: a role text the crew wrote as a link refuses the start, naming the path and saying it is a symlink', async (t) => {
  const roleText = join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY, 'builder.md')
  const place = placeFor(t, { ...aCrewWithItsOwnTexts(), [join('docs', 'builder.md')]: OWN_ROLE_TEXT })
  linkedInsteadOfWritten(place, roleText, join('docs', 'builder.md'))
  const fake = fakeClaude(place)
  const lines: string[] = []

  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, lines))
  assert.equal(started.started, false, 'a role text that is a symlink did not refuse the start')
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes(asTheOwnerReadsIt(roleText)), `the refusal does not name the linked text: ${refusal}`)
  assert.match(refusal, /is a symlink/, refusal)
  assert.deepEqual(lines, [refusal], 'the refusal is shown to the owner once')
  assert.equal(existsSync(fake.ran), false, 'the host ran, and was handed a crew text nothing approved')
})

/**
 * The same for the conventions file the declaration names, and in particular not the refusal the r=2 fix gave: the
 * link's target was carried while the compose looked the link's path up, so the answer said the declaration named a
 * file that was not there — a wrong reason for the right outcome, sending the owner to write a file that was there.
 */
test('#306 r=3: a conventions file the crew wrote as a link refuses the start by name, and not as a file that is missing', async (t) => {
  const conventions = join(DECLARATION_DIRECTORY, CREW_CONVENTIONS)
  const place = placeFor(t, { ...aCrewWithItsOwnTexts(), [join('docs', CREW_CONVENTIONS)]: CONVENTIONS_AS_WRITTEN })
  linkedInsteadOfWritten(place, conventions, join('docs', CREW_CONVENTIONS))
  const fake = fakeClaude(place)

  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(started.started, false, 'a conventions file that is a symlink did not refuse the start')
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes(asTheOwnerReadsIt(conventions)), `the refusal does not name the linked conventions file: ${refusal}`)
  assert.match(refusal, /is a symlink/, refusal)
  assert.ok(!refusal.includes('no such file'), `the refusal says the file is missing, and it is there as a link: ${refusal}`)
  assert.equal(existsSync(fake.ran), false, 'the host ran, and was handed a crew text nothing approved')
})

/**
 * Makes a directory of the place a link to another directory of it, and commits the link: an owner who keeps one
 * directory in two places by pointing at it (martha#306 r=4).
 */
function directoryLinkedTo(place: Place, path: string, target: string): void {
  removeTheTree(join(place.root, path))
  symlinkSync(relative(dirname(join(place.root, path)), join(place.root, target)), join(place.root, path))
  git(place.root, 'add', '--all')
  git(place.root, 'commit', '-q', '-m', `link ${path}`)
}

/**
 * A crew text whose directory is a link refuses the start, by name (martha#306 r=4, the r=3 review's finding). The gate
 * used to resolve the directories above a crew text, so the approval and the carried bytes were named after the
 * directory the link points at while the compose looked the text up under the path the crew wrote: it missed, answered
 * "absent", and the member was handed Martha's shipped text with no word to the owner. A link is a name the gate
 * cannot pin down, so it is refused — the text itself, and every directory above it.
 */
test('#306 r=4: a role text reached through a linked roles directory refuses the start, naming the link', async (t) => {
  const roles = join(DECLARATION_DIRECTORY, ROLE_TEXTS_DIRECTORY)
  const place = placeFor(t, { ...aCrewDeclaringItsConventions(), [join('docs', ROLE_TEXTS_DIRECTORY, 'builder.md')]: OWN_ROLE_TEXT })
  directoryLinkedTo(place, roles, join('docs', ROLE_TEXTS_DIRECTORY))
  const fake = fakeClaude(place)

  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(started.started, false, 'a role text reached through a linked directory did not refuse the start')
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes(asTheOwnerReadsIt(roles)), `the refusal does not name the linked directory: ${refusal}`)
  assert.match(refusal, /is a symlink/, refusal)
  assert.equal(existsSync(fake.ran), false, 'the host ran, and was handed a crew text nothing approved')
})

test('#306 r=4: a mode text reached through a linked modes directory refuses the start, naming the link', async (t) => {
  const modes = join(DECLARATION_DIRECTORY, MODE_TEXTS_DIRECTORY)
  const place = placeFor(t, { ...aCrewWithItsOwnTexts(), [join('docs', MODE_TEXTS_DIRECTORY, `${SOLO_MODE}.md`)]: OWN_MODE_TEXT })
  directoryLinkedTo(place, modes, join('docs', MODE_TEXTS_DIRECTORY))
  const fake = fakeClaude(place)

  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(started.started, false, 'a mode text reached through a linked directory did not refuse the start')
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes(asTheOwnerReadsIt(modes)), `the refusal does not name the linked directory: ${refusal}`)
  assert.match(refusal, /is a symlink/, refusal)
  assert.equal(existsSync(fake.ran), false, 'the host ran, and was handed a crew text nothing approved')
})

test('#306 r=4: a crew directory that is a link refuses the start, naming the link', async (t) => {
  // Every text of the crew, and its declaration, stand behind a link one level above them all.
  const place = placeFor(t, {
    [join('crew-files', DECLARATION_FILE)]: JSON.stringify({ ...soloDeclaration('Ada Owner'), conventions: CREW_CONVENTIONS }),
    [join('crew-files', CREW_CONVENTIONS)]: CONVENTIONS_AS_WRITTEN,
    [join('crew-files', ROLE_TEXTS_DIRECTORY, 'builder.md')]: OWN_ROLE_TEXT,
  })
  directoryLinkedTo(place, DECLARATION_DIRECTORY, 'crew-files')
  const fake = fakeClaude(place)

  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, []))
  assert.equal(started.started, false, 'a crew directory that is a link did not refuse the start')
  const refusal = started.started ? '' : started.refusal
  assert.ok(refusal.includes(asTheOwnerReadsIt(DECLARATION_DIRECTORY)), `the refusal does not name the linked crew directory: ${refusal}`)
  assert.match(refusal, /is a symlink/, refusal)
  assert.equal(existsSync(fake.ran), false, 'the host ran, and was handed a crew text nothing approved')
})

test('#312: a member Martha started is stopped by its own launcher when the owner asks, not by the verb', async (t) => {
  const place = placeFor(t, { '.mcp.json': SERVERS })
  await declared(place)
  // The crew's own texts are approved with the config (martha#306), so this approval covers them as every other here does.
  await approveConfig({ root: place.root, home: place.home, state: place.state, terminal: yes, documents, tellOwner: () => {}, now: () => new Date() })
  const fake = fakeClaude(place)
  const lines: string[] = []
  const request = requestFor(place, fake.command, BUILDER!.name, lines)
  const started = await startedOn(place, request)
  assert.ok(started.started, started.started ? '' : started.refusal)
  await until('the fake host to start', () => existsSync(fake.ran), t)
  const crew = crewStateDirectory(place.state.state_root, place.root)
  assert.ok('path' in crew, 'refusal' in crew ? crew.refusal : '')
  // The launcher's watch answers within its tick and the member's end; without the watch, the verb waits out its
  // deadline and ends the group itself, which says 'owner_verb'.
  const stopped = await stopTheCrew({ launcher: request.places, crew: crew.path, settings: await declareCrew(documents, place.root, CLAUDE_CODE_MODELS) }, BUILDER!.name)
  assert.deepEqual(stopped.map((one) => [one.kind, one.kind === 'stopped' ? one.ended_by : one.told]), [['stopped', 'launcher']])
  await started.stopped
  assert.ok(lines.some((line) => line.startsWith(`${BUILDER!.name} is being stopped, asked by `)), 'the launcher told its owner why the member is ending')
})

/**
 * A switch a killed launch left between the host's save and the restore (martha#359, step 7): the member's record still
 * holds it, the owner's file still holds the model the host saved, and this launch must put the owner's model back
 * before the member's host starts. The hash the record kept is what makes that safe: it wrote only `model`, and only
 * because nothing else in the file had moved.
 */
test('#359: a switch a killed launch left unfinished is finished before the member\'s host starts', async (t) => {
  const place = placeFor(t, {})
  await declared(place)
  const config = join(place.home, DEFAULT_CONFIG_DIR)
  mkdirSync(config, { recursive: true })
  const settings_file = join(config, USER_SETTINGS_FILE)
  const theOwnersModel = 'opus'
  const theSavedModel = 'sonnet'
  const anOwnersSetting = { includeCoAuthoredBy: false }
  const before = `${JSON.stringify({ ...anOwnersSetting, model: theOwnersModel }, null, 2)}\n`
  // The host's save, as it left the file when the launch died: the same file, with the model it was told to save.
  const after = `${JSON.stringify({ ...anOwnersSetting, model: theSavedModel }, null, 2)}\n`
  writeFileSync(settings_file, after)
  const crew = crewSubdirectory(place.state.state_root, place.root, MODEL_PLACE)
  assert.ok('path' in crew, 'refusal' in crew ? crew.refusal : '')
  mkdirSync(crew.path, { recursive: true, mode: 0o700 })
  const record = {
    config_dir: config,
    before: sha256Of(Buffer.from(before)),
    after: sha256Of(Buffer.from(after)),
    without_model: canonicalHashWithoutModel({ ...anOwnersSetting, model: theSavedModel }),
    had_file: true,
    had_model: true,
    owner_model: theOwnersModel,
    wrote: theSavedModel,
    why: '',
  }
  writeFileSync(
    join(crew.path, theModelMarker(BUILDER!.name)),
    `${JSON.stringify({ switched: true, model: theSavedModel, home: theOwnersModel, package: '#359', why: 'the review needs it', since: new Date(1_000).toISOString(), directed: true, settings: record })}\n`,
    { mode: 0o600 },
  )
  const fake = fakeClaude(place)
  const lines: string[] = []
  const started = await startedOn(place, requestFor(place, fake.command, BUILDER!.name, lines))
  assert.ok(started.started, started.started ? '' : started.refusal)
  assert.ok(lines.every((line) => !line.includes('could not')), `the owner was told: ${lines.join(' | ')}`)
  assert.deepEqual(
    JSON.parse(readFileSync(settings_file, 'utf8')) as unknown,
    { ...anOwnersSetting, model: theOwnersModel },
    'the launch did not put the owner\'s model back before it started the member',
  )
  const kept = JSON.parse(readFileSync(join(crew.path, theModelMarker(BUILDER!.name)), 'utf8')) as ModelMarker
  assert.equal(kept.settings, undefined, 'the record of a switch this launch finished outlived it')
  assert.equal(kept.switched, true, 'the member\'s own switch was taken away by the recovery, which is about the owner\'s file')
})
