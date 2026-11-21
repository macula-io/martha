// `bin/martha`, run as a stranger runs it: a Node program with no dependency, in a checkout of theirs (martha#98).
//
// Each test runs the real bin/martha in a git checkout under a temporary home, with that home's own state, and
// reads what it says and how it ends. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { NOT_A_TERMINAL } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { NOT_A_TERMINAL as START_NOT_ON_A_TERMINAL } from '../start_a_member/start_a_member.ts'
import { KITTEN, KITTY, NO_DESKTOP_SESSION } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { SOLO_MEMBERS, SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { ACTS_ALONE, ACTS_OF_ONE, ACTS_OF_THEIR_OWN, CLEAR_THE_TERMINAL, HELP, HELP_WORDS, UNKNOWN_COMMAND, OWNERS_ACT_NEEDS_A_TERMINAL, aFirstPromptNeedsMarthasTmux, startedLine, UP, USAGE, keepTheCrewsRoster } from './run_the_martha_command.ts'
import { ROSTER_FILE } from '../write_the_crews_roster/write_the_crews_roster.ts'
import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { THE_FIRST_PROMPT_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { THE_COMPOSER_SETTLES_MS } from '../open_the_crew_in_tmux/open_the_crew_in_tmux.ts'
import { NOT_A_KEY_FILES_PATH } from '../bring_up_the_declared_crew/declare_the_engines_endpoint.ts'
import { noCrewDeclaredAt, THE_ENGINES_ENDPOINT, THE_KEY_FILE_QUESTION, THE_SMALLEST_DECLARATION } from '../bring_up_the_declared_crew/bring_up_the_declared_crew.ts'
import { SESSION_FILE, KITTY_PLACE } from '../open_the_crew_in_kitty/open_the_crew_in_kitty.ts'
import { ENGINE_ENDPOINT, HOST, PARKED, THE_ENGINES_HOST } from '../declare_crew/declare_crew.ts'
import { EXIT_DONE, EXIT_REFUSED, EXIT_USAGE, SAID_BY } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { MEMBER_SWITCH } from '../say_what_the_gate_does/say_what_the_gate_does.ts'
import { A_MUTE_NEEDS_THE_OWNERS_TERMINAL, BELLS_HEARD, BELLS_MUTED, THE_BELLS_FILE, THE_BELLS_PLACE } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { NOT_IN_A_MEMBER } from '../run_an_owner_signed_command/ask_the_launcher_to_run.ts'
import { RELAY_PATHS, RELAY_SOCKET_VARIABLE, RUN_PATH } from '../claude_code_relay/hooks/relay_protocol.ts'
import { OWNER_KEYS_FILE } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { hostAnswers } from '../drive_the_recorded_host/host_stand_in.ts'
import { CLAUDE, CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { CLAUDE_CODE_SESSION_EVENTS, startSession } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { keepTheCrewsFilesAsDirectories, handoverStampsIn } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { CREWS_PLACE, CREW_ROWS_PLACE, crewStateDirectory, crewSubdirectory, openState, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { OWNER_ACTS_FILE, whatTheOwnerReadsOf } from '../keep_where_owners_acts_were_typed/keep_where_owners_acts_were_typed.ts'
import { keepTheRoute, THE_ANSWER_ROUTES_PLACE, THE_OWNERS_ANSWERS_FILE } from '../serve_the_owners_answers/the_owners_answer_route.ts'
import { THE_HANDOVER_WRITTEN, HANDOVERS_PLACE, theHandoverFile, writeMyHandover } from '../write_my_handover/write_my_handover.ts'
import { theResumePrompt } from '../wake_a_member/wake_a_member.ts'
import { notRunningToRestart } from '../stop_and_restart_a_member/restart_a_member.ts'
import { RESTART, STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { CLONES, DECLARATION_DIRECTORY, DECLARATION_FILE, WORKTREES_BESIDE_CLONES } from '../declare_crew/declare_crew.ts'
import { crewKeyOf } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { rowFileNameOf, theRowWithNothingSaid } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { rowStreamsDirectory, streamDirectoryNameOf } from '../row_streams_directory/row_streams_directory.ts'
import { ledgerStreamOf } from '../log_ledger/log_ledger.ts'
import { ASKS_SETTLED, ASK_QUEUED, OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { sessionRecordStreamOf } from '../session_records_in_rows/session_records_in_rows.ts'
import { releaseMarksIn } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { NOT_A_WALL } from '../refuse_an_owner_act_from_inside_a_member/refuse_an_owner_act_from_inside_a_member.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { CONFIG_DIR_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { MEMBER_CONFIG_FOLDER } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

interface Place {
  readonly home: string
  readonly root: string
}

function placeFor(t: TestContext, { checkout = true } = {}): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  if (checkout) {
    execFileSync('git', ['init', '-q', '.'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Ada Owner'], { cwd: root })
  }
  return { home, root }
}

/** bin/martha run in the place's checkout, with its standard input a pipe, never a terminal. */
function martha(place: Place, ...args: string[]) {
  return marthaWith(place, {}, ...args)
}

function marthaWith(place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return { status: run.status, out: run.stdout, err: run.stderr, said: `${run.stdout}${run.stderr}` }
}

/** Every line on stderr is Martha's, prefixed as martha-install prefixes its own. */
const allSaidByMartha = (err: string): void => {
  for (const line of err.split('\n').filter((said) => said !== '')) assert.ok(line.startsWith(`${SAID_BY} `), line)
}

test('bin/martha is in the tree, executable, and starts with a node line', () => {
  assert.ok(existsSync(MARTHA))
  assert.match(readFileSync(MARTHA, 'utf8'), /^#!\/usr\/bin\/env node\n/)
  execFileSync('test', ['-x', MARTHA])
})

test('martha with no act shows how it is used, and ends as a usage error', (t) => {
  const run = martha(placeFor(t))
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(run.said.includes(USAGE), run.said)
})

test('#511: a folder outside any git checkout is its own crew\'s root: martha init declares there instead of refusing', (t) => {
  const place = placeFor(t, { checkout: false })
  writeFileSync(join(place.home, '.gitconfig'), '[user]\n\tname = Ada Owner\n')
  const run = martha(place, 'init')
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.ok(existsSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)))
  assert.ok(!run.said.includes('git checkout'), run.said)
})

test('#601: martha init with no git user.name declares the crew for this login, and says so in one line', (t) => {
  const place = placeFor(t)
  execFileSync('git', ['config', '--unset', 'user.name'], { cwd: place.root })
  const run = marthaWith(place, { USER: 'grace' }, 'init')
  assert.equal(run.status, EXIT_DONE, run.said)
  const written = readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')
  assert.match(written, /grace/)
  assert.match(run.err, /git holds no user\.name, so the crew's owner is this login \(grace\)/)
  allSaidByMartha(run.err)
})

test('martha init writes the declaration once and refuses the second time', (t) => {
  const place = placeFor(t)
  const first = martha(place, 'init')
  assert.equal(first.status, 0, first.said)
  for (const member of SOLO_MEMBERS) assert.ok(first.out.includes(member.name), first.out)
  const file = join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const written = readFileSync(file, 'utf8')
  assert.match(written, /Ada Owner/)

  const second = martha(place, 'init')
  assert.equal(second.status, EXIT_REFUSED)
  assert.ok(second.err.includes(file), second.err)
  allSaidByMartha(second.err)
  assert.equal(readFileSync(file, 'utf8'), written)
})

/**
 * A place whose checkout sits at `<clones>/acme/widget`, its origin naming that same repository (martha#611): the
 * shape `martha init` reads a workspace layout from, out of the checkout itself.
 */
function placeUnderItsOrigin(t: TestContext): Place {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => removeTheTree(home))
  const remote = join(home, 'remote', 'acme')
  mkdirSync(remote, { recursive: true })
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', join(remote, 'widget.git')])
  mkdirSync(join(home, CLONES, 'acme'), { recursive: true })
  const root = join(home, CLONES, 'acme', 'widget')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Ada Owner'], { cwd: root })
  execFileSync('git', ['remote', 'add', 'origin', join(remote, 'widget.git')], { cwd: root })
  return { home, root }
}

test('martha init declares the workspace layout its checkout proves, so a fresh owner edits no house_rules', (t) => {
  const place = placeUnderItsOrigin(t)
  const run = martha(place, 'init')
  assert.equal(run.status, EXIT_DONE, run.said)
  const clones = join(place.home, CLONES)
  const worktrees = join(place.home, WORKTREES_BESIDE_CLONES)
  const written = JSON.parse(readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { house_rules?: unknown }
  assert.deepEqual(written.house_rules, { workspace_layout: true, clones, worktrees })
  assert.ok(run.out.includes(`Workspace layout declared: clones ${clones}, worktrees ${worktrees}.`), run.out)
})

test('martha init says why it declared no layout for a checkout with no origin', (t) => {
  const place = placeFor(t)
  const run = martha(place, 'init')
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.ok(run.out.includes(`No workspace layout: ${place.root} names no origin remote.`), run.out)
})

test('martha start on a terminal with no declaration refuses, naming martha init', (t) => {
  const run = marthaOnATerminal(placeFor(t), {}, 'start', 'builder')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /martha init/)
  allSaidByMartha(run.said)
})

/** A kitty and a kitten on the place's PATH that only answer --version, above any floor, and note it if kitty is ever started. */
function kittyThatAnswers(place: Place): { readonly started: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'kitty-bin')
  mkdirSync(bin)
  const started = join(place.home, 'kitty-started')
  const answer = (name: string, started: string): string => ['#!/bin/sh', 'if [ "$1" = --version ]; then', `  echo '${name} 99.0.0 created by a stand-in'`, '  exit 0', 'fi', `: > '${started}'`, ''].join('\n')
  writeFileSync(join(bin, KITTY), answer(KITTY, started), { mode: 0o700 })
  writeFileSync(join(bin, KITTEN), answer(KITTEN, started), { mode: 0o700 })
  return { started, env: { PATH: `${bin}:${process.env.PATH}` } }
}

test('bare martha start whose input is no terminal refuses in the words martha start <member> uses, before any crew or kitty is read (#547 S6 r=1 R1)', (t) => {
  const place = placeFor(t)
  const kitty = kittyThatAnswers(place)
  // No crew declared yet: the terminal is asked for before the crew is read, so this is the terminal refusal too.
  const undeclared = marthaWith(place, kitty.env, 'start')
  assert.equal(undeclared.status, EXIT_REFUSED, undeclared.said)
  assert.ok(undeclared.err.includes(START_NOT_ON_A_TERMINAL), undeclared.err)
  assert.equal(marthaWith(place, kitty.env, 'init').status, EXIT_DONE)
  const run = marthaWith(place, kitty.env, 'start')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.err.includes(START_NOT_ON_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
  assert.equal(existsSync(kitty.started), false, 'kitty was started with no terminal')
})

test('bare martha start on a terminal, with a crew declared and no desktop session, reaches the kitty opener and is refused there, opening nothing (#547 S6 r=1 R3)', (t) => {
  const place = placeFor(t)
  const kitty = kittyThatAnswers(place)
  assert.equal(marthaWith(place, kitty.env, 'init').status, EXIT_DONE)
  const run = marthaOnATerminal(place, kitty.env, 'start')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(NO_DESKTOP_SESSION), run.said)
  assert.ok(!run.said.includes(USAGE), run.said)
  assert.equal(existsSync(kitty.started), false, 'kitty was started with no desktop session')
})

// --- martha help and martha version (martha#511) -------------------------------

test('#511: martha help, -h and --help each print one line per act and end done', (t) => {
  const place = placeFor(t)
  for (const word of HELP_WORDS) {
    const run = martha(place, word)
    assert.equal(run.status, EXIT_DONE, `${word}: ${run.said}`)
    assert.equal(run.out, `${HELP.join('\n')}\n`, word)
  }
})

test('#511: every act the command takes has its own line in the help', () => {
  const acts = [...ACTS_ALONE, ...ACTS_OF_ONE, ...Object.keys(ACTS_OF_THEIR_OWN)].filter((act) => act !== '--version')
  for (const act of acts) assert.ok(HELP.some((line) => line.startsWith(`martha ${act} `)), act)
})

test('#511: martha version prints exactly what martha --version prints', (t) => {
  const place = placeFor(t)
  const word = martha(place, 'version')
  const flag = martha(place, '--version')
  assert.equal(word.status, EXIT_DONE, word.said)
  assert.equal(word.out, flag.out)
  assert.match(word.out, /^\d+\.\d+\.\d+/)
})

test('#511: a word that is no act says so first, then prints the help, and ends as a usage error', (t) => {
  const run = martha(placeFor(t), 'frobnicate')
  assert.equal(run.status, EXIT_USAGE, run.said)
  const lines = run.err.split('\n').filter((line) => line !== '')
  assert.ok(lines[0]!.endsWith(`${UNKNOWN_COMMAND} frobnicate`), lines[0]!)
  assert.deepEqual(lines.slice(1).map((line) => line.replace(/^martha: /, '')), HELP)
})

// --- martha up (martha#511) -------------------------------

/** A workspace as the owner keeps one: no git checkout, and the owner's name in their git config. */
function aWorkspace(t: TestContext): Place {
  const place = placeFor(t, { checkout: false })
  writeFileSync(join(place.home, '.gitconfig'), '[user]\n\tname = Ada Owner\n')
  return place
}

/** The workspace's declaration file. */
const theDeclarationAt = (place: Place): string => join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)

/** One engine member, on a model of this test's own. */
const anEngineMember = (name: string): Record<string, unknown> => ({ name, role: 'builder', model: 'a-model-a-test-names', [HOST]: THE_ENGINES_HOST })

/** The declaration the owner writes at the workspace: the smallest one's mode, with these members and fields; its text. */
function theOwnerDeclares(place: Place, members: readonly Record<string, unknown>[], fields: Readonly<Record<string, unknown>> = {}): string {
  const text = `${JSON.stringify({ ...THE_SMALLEST_DECLARATION, mode: { ...THE_SMALLEST_DECLARATION.mode, roles: [SUPERVISOR, 'builder'] }, members, ...fields }, null, 2)}\n`
  mkdirSync(join(place.root, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(theDeclarationAt(place), text)
  return text
}

/** An engine endpoint of this test's own: a made-up host and key file, never real. */
const AN_ENDPOINT = { [ENGINE_ENDPOINT]: { host: 'https://provider.invalid', key_file: '/a-key-file-a-test-names' } }

/** The tabs a kitty session file opens, by the member each one starts. */
const theTabsIn = (session: string): string[] => session.split('\n').filter((line) => line.startsWith('new_tab ')).map((line) => line.slice('new_tab '.length))

/** The tabs the last kitty session at `place` opened. */
function theTabsOpenedAt(place: Place): string[] {
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok('directory' in state)
  return theTabsIn(readFileSync(join(state.directory, KITTY_PLACE, SESSION_FILE), 'utf8'))
}

/** The engine endpoint the declaration at `place` holds now, or undefined when it holds none. */
const theEndpointDeclared = (place: Place): unknown => (JSON.parse(readFileSync(theDeclarationAt(place), 'utf8')) as Record<string, unknown>)[ENGINE_ENDPOINT]

/** A key file under the place's home, with `mode`: its path as the owner types it, under `~/`, and in full. */
function aKeyFile(place: Place, mode: number): { readonly typed: string; readonly at: string } {
  const typed = '~/keys-a-test-made/the-key'
  const at = join(place.home, 'keys-a-test-made', 'the-key')
  mkdirSync(join(place.home, 'keys-a-test-made'), { mode: 0o700 })
  writeFileSync(at, 'a-key-a-test-made\n', { mode })
  chmodSync(at, mode)
  return { typed, at }
}

const ON_A_DESKTOP = { WAYLAND_DISPLAY: 'wayland-511' }

/** A process that runs until the test ends: no ancestor of the `martha` a test runs, so it can stand for a running member. */
function aProcessThatRuns(t: TestContext): number {
  const child = spawn('sleep', ['600'], { stdio: 'ignore' })
  t.after(() => child.kill())
  assert.ok(child.pid !== undefined)
  return child.pid
}

test('#919: martha up takes only --prompt <text>; up --claude, a bare --prompt and any other word are usage errors', (t) => {
  const place = aWorkspace(t)
  for (const words of [[UP, '--claude'], [UP, 'extra'], [UP, THE_FIRST_PROMPT_SWITCH], [UP, THE_FIRST_PROMPT_SWITCH, 'hi', 'extra']]) {
    const run = martha(place, ...words)
    assert.equal(run.status, EXIT_USAGE, `${words.join(' ')}: ${run.said}`)
  }
  assert.ok(USAGE.includes(`martha ${UP} [${THE_FIRST_PROMPT_SWITCH} <text>] |`), USAGE)
  assert.ok(HELP.some((line) => line.startsWith(`martha ${UP} `)), HELP.join('\n'))
  assert.equal(HELP.some((line) => line.includes('--claude')), false, HELP.join('\n'))
})

test('#511: martha up whose input is no terminal refuses, and writes nothing', (t) => {
  const place = aWorkspace(t)
  const run = martha(place, UP)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.equal(existsSync(theDeclarationAt(place)), false)
})

test('#511: martha up with no declaration starts nothing, writes nothing, and says where the file goes and the smallest one', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  const run = marthaOnATerminal(place, { ...kitty.env, ...ON_A_DESKTOP }, UP)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(noCrewDeclaredAt(theDeclarationAt(place))), run.said)
  assert.equal(existsSync(theDeclarationAt(place)), false, 'up wrote a declaration of its own')
  assert.equal(existsSync(kitty.started), false, 'kitty was started with no crew declared')
})

test('#511: the declaration is the config: martha up opens exactly the members the owner declares, on both hosts, none parked and none running, and leaves the file as it was', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  const declared = theOwnerDeclares(place, [
    { name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE },
    { name: 'Kept-down', role: 'builder', [HOST]: CLAUDE_CODE, [PARKED]: true },
    { name: 'Already-up', role: 'builder', [HOST]: CLAUDE_CODE },
    anEngineMember('flash-a'),
    { ...anEngineMember('flash-down'), [PARKED]: true },
    anEngineMember('flash-b'),
  ], AN_ENDPOINT)
  aMemberLaunchedAs(place, 'Already-up', aProcessThatRuns(t))

  const run = marthaOnATerminal(place, { ...kitty.env, ...ON_A_DESKTOP }, UP)
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.deepEqual(theTabsOpenedAt(place), ['Lead', 'flash-a', 'flash-b'])
  assert.ok(run.said.includes('Already-up is already running'), run.said)
  assert.equal(readFileSync(theDeclarationAt(place), 'utf8'), declared, 'up changed the owner\'s declaration')
})

/** A file whose presence makes the fake tmux fail to name its socket, as a server that has ended does. */
const SERVER_GONE = 'tmux-server-gone'

/** Where the fake tmux says Martha's server keeps its socket, as `display-message -p '#{socket_path}'` would. */
function theSocketOfMarthasServer(place: Place): string {
  return join(place.home, 'tmux-sockets', 'martha')
}

/**
 * A stand-in tmux on the place's PATH: it says it is tmux 3.8, keeps each command it is run with as one line of words
 * after the server's four, has the crew's session once a session is opened, and names its socket when asked.
 */
function tmuxThatAnswers(place: Place): { readonly ran: string; readonly bin: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'tmux-bin')
  mkdirSync(bin)
  const ran = join(place.home, 'tmux-ran')
  const opened = join(place.home, 'tmux-session-opened')
  writeFileSync(join(bin, 'tmux'), [
    '#!/bin/sh',
    'if [ "$1" = -V ]; then echo "tmux 3.8"; exit 0; fi',
    `[ "$1 $2 $3" = "-L martha -f" ] || exit 9`,
    'shift 4',
    `echo "$*" >> '${ran}'`,
    `case "$1" in has-session) [ -e '${opened}' ] ;; new-session) : > '${opened}' ;; display-message) [ -e '${join(place.home, SERVER_GONE)}' ] && exit 1; echo '${theSocketOfMarthasServer(place)}' ;; esac`,
    '',
  ].join('\n'), { mode: 0o700 })
  return { ran, bin, env: { PATH: `${bin}:${process.env.PATH}` } }
}

test('#932: a crew declared "terminal": "tmux" is opened by martha up in Martha\'s own tmux, a window per member up starts, and kitty is not started', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  const tmux = tmuxThatAnswers(place)
  theOwnerDeclares(place, [
    { name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE },
    { name: 'Kept-down', role: 'builder', [HOST]: CLAUDE_CODE, [PARKED]: true },
    anEngineMember('flash-a'),
  ], { ...AN_ENDPOINT, id: 'a-crew', terminal: 'tmux' })
  const run = marthaOnATerminal(place, { PATH: `${tmux.bin}:${kitty.env.PATH}` }, UP)
  assert.equal(run.status, EXIT_DONE, run.said)
  const opened = readFileSync(tmux.ran, 'utf8').split('\n').filter((line) => /^(new-session|new-window|split-window) /.test(line))
  const verbAndAct = (line: string): string => `${line.split(' ')[0]} ${line.split(' -- ')[1]!.split(' ').slice(-2).join(' ')}`
  assert.deepEqual(opened.map(verbAndAct), [
    `new-session start Lead`,
    `split-window ${opened[1]!.split(' ').at(-2)} crew`,
    `new-window start flash-a`,
    `split-window ${opened[3]!.split(' ').at(-2)} crew`,
  ])
  assert.ok(opened[0]!.includes('-s a-crew -n Lead'), opened.join('\n'))
  assert.ok(opened[2]!.includes('-t =a-crew: -n flash-a'), opened.join('\n'))
  assert.equal(existsSync(kitty.started), false, 'kitty was started for a tmux crew')
  assert.ok(run.said.includes('martha attach shows it'), run.said)
})

test('#932: martha attach takes one member at most and no switch, needs a terminal, and refuses a crew that opens in kitty', (t) => {
  const place = aWorkspace(t)
  for (const words of [['attach', 'a', 'b'], ['attach', '--all'], ['attach', '']]) assert.equal(martha(place, ...words).status, EXIT_USAGE, words.join(' '))
  assert.ok(USAGE.includes('martha attach [<member>]'), USAGE)
  assert.ok(HELP.some((line) => line.startsWith('martha attach ')), HELP.join('\n'))
  theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE }])
  assert.equal(martha(place, 'attach').status, EXIT_REFUSED)
  const tmux = tmuxThatAnswers(place)
  const kittyCrew = marthaOnATerminal(place, tmux.env, 'attach')
  assert.equal(kittyCrew.status, EXIT_REFUSED, kittyCrew.said)
  assert.ok(kittyCrew.said.includes('this crew opens in kitty'), kittyCrew.said)
  assert.equal(existsSync(tmux.ran), false, 'tmux was run for a crew that opens in kitty')
})

/** The environment of a window of Martha's own tmux server, pane %3: tmux names the socket in TMUX and the pane in TMUX_PANE. */
const inMarthasTmux = (place: Place): Readonly<Record<string, string>> => ({ TMUX: `${theSocketOfMarthasServer(place)},1,0`, TMUX_PANE: '%3' })

test('#919: martha start --prompt outside a window of Martha\'s tmux is refused, saying how to give one, and starts nothing', (t) => {
  const place = aWorkspace(t)
  theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE }], { id: 'a-crew', terminal: 'tmux' })
  const claude = claudeThatEnds(place, t)
  const tmux = tmuxThatAnswers(place)
  const outside = [
    {},
    { TMUX: `${join(place.home, 'default')},1,0`, TMUX_PANE: '%3' },
    // A server of the owner's own whose socket is also named martha, in another folder (tmux -S): a pane of that server
    // shares its id with a pane of Martha's, perhaps another member's, so its name alone does not make it Martha's.
    { TMUX: `${join(place.home, 'elsewhere', 'martha')},1,0`, TMUX_PANE: '%3' },
  ]
  for (const env of outside) {
    const run = marthaOnATerminal(place, { ...claude.env, ...env, PATH: `${tmux.bin}:${claude.env.PATH}` }, 'start', 'Lead', THE_FIRST_PROMPT_SWITCH, 'hi')
    assert.equal(run.status, EXIT_REFUSED, run.said)
    assert.ok(run.said.replaceAll('\n', ' ').includes(aFirstPromptNeedsMarthasTmux()), run.said)
    assert.equal(existsSync(claude.ran), false, run.said)
  }
  // Martha's server does not answer for its socket: the window cannot be shown to be one of its.
  writeFileSync(join(place.home, SERVER_GONE), '')
  const gone = marthaOnATerminal(place, { ...claude.env, ...inMarthasTmux(place), PATH: `${tmux.bin}:${claude.env.PATH}` }, 'start', 'Lead', THE_FIRST_PROMPT_SWITCH, 'hi')
  assert.equal(gone.status, EXIT_REFUSED, gone.said)
  assert.ok(gone.said.replaceAll('\n', ' ').includes(aFirstPromptNeedsMarthasTmux()), gone.said)
  assert.equal(existsSync(claude.ran), false, gone.said)
  assert.equal(existsSync(tmux.ran) && readFileSync(tmux.ran, 'utf8').includes('send-keys'), false, 'a key was typed outside Martha\'s tmux')
})

test('#919: a word after -- is no first prompt any more: martha start refuses it, naming --prompt', (t) => {
  const place = aWorkspace(t)
  theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE }])
  const claude = claudeThatEnds(place, t)
  const run = marthaOnATerminal(place, claude.env, 'start', 'Lead', '--', 'a prompt')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(`${THE_FIRST_PROMPT_SWITCH} <text>`), run.said)
  assert.equal(existsSync(claude.ran), false, run.said)
})

test('#919: martha start --prompt for a member that runs on martha-engine is refused in Martha\'s tmux, naming its host', (t) => {
  const place = aWorkspace(t)
  theOwnerDeclares(place, [anEngineMember('flash-a')], { ...AN_ENDPOINT, id: 'a-crew', terminal: 'tmux' })
  const run = marthaOnATerminal(place, inMarthasTmux(place), 'start', 'flash-a', THE_FIRST_PROMPT_SWITCH, 'hi')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(`flash-a runs on ${THE_ENGINES_HOST}`), run.said)
})

/**
 * A fake claude on the place's PATH that keeps its arguments, reports its session's start to its relay twice (a start,
 * then a /clear), waits past the composer's settling time, and ends: as a Claude Code member whose owner types nothing.
 */
function claudeThatReportsItsStartTwice(place: Place, t: TestContext): { readonly args: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'reporting-bin')
  mkdirSync(bin)
  const args = join(place.home, 'reporting-args')
  const reporter = join(bin, 'report.mjs')
  writeFileSync(reporter, [
    "import { request } from 'node:http'",
    'const post = (source) => new Promise((done) => {',
    `  const asked = request({ socketPath: process.env.${RELAY_SOCKET_VARIABLE}, path: '${RELAY_PATHS.session_started}', method: 'POST', headers: { 'content-type': 'application/json' } }, (answer) => { answer.resume(); answer.on('end', done) })`,
    "  asked.end(JSON.stringify({ session_id: 'a-session', source, hook_event_name: 'SessionStart', transcript_path: '/nowhere' }))",
    '})',
    "await post('startup')",
    "await post('clear')",
    `await new Promise((done) => setTimeout(done, ${THE_COMPOSER_SETTLES_MS * 2}))`,
    '',
  ].join('\n'))
  writeFileSync(join(bin, CLAUDE), ['#!/bin/sh', ...hostAnswers(), `printf '%s\\n' "$@" > '${args}'`, `exec '${process.execPath}' '${reporter}'`, ''].join('\n'), { mode: 0o700 })
  return { args, env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: shortRelayRoot(t) } }
}

test('#919: martha start --prompt in Martha\'s tmux types the prompt into the member\'s own pane once, after its session starts, then Enter; the host is never handed it', (t) => {
  const place = placeFor(t)
  const claude = claudeThatReportsItsStartTwice(place, t)
  const tmux = tmuxThatAnswers(place)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const prompt = '-v read your brief'
  const run = marthaOnATerminal(place, { ...claude.env, ...inMarthasTmux(place), PATH: `${tmux.bin}:${claude.env.PATH}` }, 'start', builder!.name, THE_FIRST_PROMPT_SWITCH, prompt)
  assert.equal(run.status, EXIT_DONE, run.said)
  const keys = readFileSync(tmux.ran, 'utf8').split('\n').filter((line) => line.startsWith('send-keys '))
  assert.deepEqual(keys, [`send-keys -t %3 -l -- ${prompt}`, 'send-keys -t %3 Enter'])
  assert.equal(readFileSync(claude.args, 'utf8').split('\n').some((word) => word.includes('read your brief')), false, 'the host was handed the first prompt')
})

test('#919: martha up --prompt refuses a prompt that starts with / or holds a line break, and opens nothing', (t) => {
  const place = aWorkspace(t)
  const tmux = tmuxThatAnswers(place)
  theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE }], { id: 'a-crew', terminal: 'tmux' })
  for (const [prompt, why] of [['/hello', 'starts with /'], ['one\ntwo', 'line break']] as const) {
    const run = marthaOnATerminal(place, tmux.env, UP, THE_FIRST_PROMPT_SWITCH, prompt)
    assert.equal(run.status, EXIT_REFUSED, run.said)
    assert.ok(run.said.includes(why), run.said)
  }
  assert.equal(existsSync(tmux.ran), false, 'tmux was run for a refused first prompt')
})

test('#919: martha up --prompt on a tmux crew hands the prompt to each Claude Code member\'s window only; an engine member is told it gets none', (t) => {
  const place = aWorkspace(t)
  const tmux = tmuxThatAnswers(place)
  theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE }, anEngineMember('flash-a')], { ...AN_ENDPOINT, id: 'a-crew', terminal: 'tmux' })
  const prompt = '-v read your brief'
  const run = marthaOnATerminal(place, tmux.env, UP, THE_FIRST_PROMPT_SWITCH, prompt)
  assert.equal(run.status, EXIT_DONE, run.said)
  const windows = readFileSync(tmux.ran, 'utf8').split('\n').filter((line) => /^(new-session|new-window) /.test(line))
  assert.equal(windows.length, 2, windows.join('\n'))
  assert.ok(windows[0]!.endsWith(` start Lead ${THE_FIRST_PROMPT_SWITCH} ${prompt}`), windows.join('\n'))
  assert.ok(windows[1]!.endsWith(' start flash-a'), windows.join('\n'))
  assert.ok(run.said.includes(`flash-a runs on ${THE_ENGINES_HOST}, so it is not given your first prompt.`), run.said)
})

test('#919: martha up --prompt on a crew that opens in kitty is refused, and kitty is not started', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, model: 'sonnet', [HOST]: CLAUDE_CODE }])
  const run = marthaOnATerminal(place, { ...kitty.env, ...ON_A_DESKTOP }, UP, THE_FIRST_PROMPT_SWITCH, 'hi')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes('Declare "terminal": "tmux"'), run.said)
  assert.equal(existsSync(kitty.started), false, 'kitty was started for a refused first prompt')
})

test('#511 part B: with an engine member to start and no key variable, martha up asks once for the key file; an answer that is no path is refused unechoed, and nothing is written', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  theOwnerDeclares(place, [anEngineMember('flash-a')])
  const pasted = 'sk-a-key-the-owner-pasted-by-mistake'
  const run = marthaOnATerminalTyping(`${pasted}\n`, place, { ...kitty.env, ...ON_A_DESKTOP }, UP)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes(THE_KEY_FILE_QUESTION.trim()), run.said)
  // The terminal shows what the owner types; no line of Martha's own says it back.
  assert.equal(run.said.split('\n').filter((line) => line.startsWith(SAID_BY) && line.includes(pasted)).length, 0, `the answer was said back: ${run.said}`)
  assert.ok(run.said.includes(NOT_A_KEY_FILES_PATH), run.said)
  assert.equal(theEndpointDeclared(place), undefined)
  assert.equal(existsSync(kitty.started), false, 'kitty was started for members with no model to reach')
})

test('#511 part B: martha up writes the key file the owner names, when only the owner may read it, says so, and never asks again', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  theOwnerDeclares(place, [anEngineMember('flash-a')])
  const env = { ...kitty.env, ...ON_A_DESKTOP }
  const key = aKeyFile(place, 0o600)
  const run = marthaOnATerminalTyping(`${key.typed}\n`, place, env, UP)
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.deepEqual(theEndpointDeclared(place), { host: THE_ENGINES_ENDPOINT.host, key_file: key.at })
  assert.ok(run.said.includes(`${ENGINE_ENDPOINT} written`), run.said)
  assert.equal(run.said.includes('a-key-a-test-made'), false, run.said)
  assert.ok(existsSync(kitty.started), 'kitty was not started')
  const again = marthaOnATerminal(place, env, UP)
  assert.equal(again.status, EXIT_DONE, again.said)
  assert.equal(again.said.includes(THE_KEY_FILE_QUESTION.trim()), false, again.said)
})

test('#511 part B: a key file the group or others may read is refused by martha up, and nothing is written', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  theOwnerDeclares(place, [anEngineMember('flash-a')])
  const run = marthaOnATerminalTyping(`${aKeyFile(place, 0o644).typed}\n`, place, { ...kitty.env, ...ON_A_DESKTOP }, UP)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.equal(theEndpointDeclared(place), undefined)
  assert.equal(existsSync(kitty.started), false, 'kitty was started for members with no model to reach')
})

test('#511 part B: with the provider\'s key variable set, martha up writes key_from and asks nothing', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  theOwnerDeclares(place, [anEngineMember('flash-a')])
  // An answer typed in case it is asked anyway: one that is no path, so a question asked fails here instead of waiting.
  const run = marthaOnATerminalTyping('an-answer-never-asked-for\n', place, { ...kitty.env, ...ON_A_DESKTOP, [THE_ENGINES_ENDPOINT.key_variable]: 'a-key-a-test-names' }, UP)
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.deepEqual(theEndpointDeclared(place), { host: THE_ENGINES_ENDPOINT.host, key_from: THE_ENGINES_ENDPOINT.key_variable })
  assert.equal(run.said.includes(THE_KEY_FILE_QUESTION.trim()), false, run.said)
  assert.equal(run.said.includes('a-key-a-test-names'), false, run.said)
})

test('#511 part B: with every engine member parked, martha up asks nothing and writes no endpoint', (t) => {
  const place = aWorkspace(t)
  const kitty = kittyThatAnswers(place)
  const declared = theOwnerDeclares(place, [{ name: 'Lead', role: SUPERVISOR, [HOST]: CLAUDE_CODE }, { ...anEngineMember('flash-down'), [PARKED]: true }])
  const run = marthaOnATerminalTyping('an-answer-never-asked-for\n', place, { ...kitty.env, ...ON_A_DESKTOP }, UP)
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.equal(run.said.includes(THE_KEY_FILE_QUESTION.trim()), false, run.said)
  assert.equal(readFileSync(theDeclarationAt(place), 'utf8'), declared)
  assert.deepEqual(theTabsOpenedAt(place), ['Lead'])
})

// --- the owner's release and the gate (martha#321) -------------------------------

/** A member's dashboard row, holding the session it is live in: the only member-to-live-session lookup there is. */
function aLiveSessionRow(place: Place, member: string, session: string): void {
  const crew = join(place.home, 'state', STATE_ROOT_NAME, CREWS_PLACE, crewKeyOf(place.root))
  const row = join(crew, 'row')
  mkdirSync(row, { recursive: true, mode: 0o700 })
  mkdirSync(join(crew, CREW_ROWS_PLACE), { recursive: true, mode: 0o700 })
  const kept = { member, session, at: 1, ...theRowWithNothingSaid(), host: { model: 'opus', provider: '', contextPercent: null, costUsd: null } }
  writeFileSync(join(row, rowFileNameOf(member)), `${JSON.stringify(kept)}\n`, { mode: 0o600 })
}

/** The crew's rows directory the release writes its mark into. */
const theCrewsRows = (place: Place): string => join(place.home, 'state', STATE_ROOT_NAME, CREWS_PLACE, crewKeyOf(place.root), CREW_ROWS_PLACE)

test('martha release with no terminal is refused, so a member’s shell cannot release itself', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const run = martha(place, 'release', 'builder')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /only the owner, at a terminal/)
  allSaidByMartha(run.err)
})

test('martha release on a terminal clears the live session’s record and answers the count', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const session = 'the-live-session'
  aLiveSessionRow(place, 'builder', session)
  const rows = rowStreamsDirectory(theCrewsRows(place))
  return (async () => {
    await rows.append(sessionRecordStreamOf(session), { ingested: [{ path: 'A2', from_node_id: 'a-stranger' }] })
    const run = marthaOnATerminal(place, {}, 'release', 'builder')
    assert.equal(run.status, EXIT_DONE, run.said)
    assert.match(run.said, /Released builder: cleared 1 arrival/)
    const marks = await releaseMarksIn(rows, session)
    assert.equal(marks.length, 1, 'no release was written')
    assert.equal(marks[0]?.cleared, 1)
  })()
})

test('martha gate prints one line per declared member, and --member an unknown name is refused', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const run = martha(place, 'gate')
  assert.equal(run.status, EXIT_DONE, run.said)
  for (const member of SOLO_MEMBERS) assert.match(run.out, new RegExp(`^${member.name}: off$`, 'm'), run.out)
  const unknown = martha(place, 'gate', MEMBER_SWITCH, 'nobody')
  assert.equal(unknown.status, EXIT_REFUSED, unknown.said)
  assert.match(unknown.said, /does not know nobody/)
  assert.equal(martha(place, 'gate', MEMBER_SWITCH).status, EXIT_USAGE)
})

test('martha bells lists every declared member, and says the declaration\'s own switch rather than a mute (martha#371)', (t) => {
  const place = placeFor(t)
  const rings = aCrewWithItsBells(place, true)
  const listed = martha(place, 'bells')
  assert.equal(listed.status, EXIT_DONE, listed.said)
  for (const member of SOLO_MEMBERS) assert.match(listed.out, new RegExp(`^${member.name}: rings$`, 'm'), listed.out)

  writeFileSync(rings, JSON.stringify({ ...JSON.parse(readFileSync(rings, 'utf8')), house_rules: { owner_bell: false } }))
  const silent = martha(place, 'bells')
  assert.equal(silent.status, EXIT_DONE, silent.said)
  for (const member of SOLO_MEMBERS) assert.match(silent.out, new RegExp(`^${member.name}: rings nothing \\(the declaration turns owner_bell off\\)$`, 'm'), silent.out)

  const mutedWhileOff = marthaOnATerminal(place, {}, 'bells', 'builder', BELLS_MUTED)
  assert.equal(mutedWhileOff.status, EXIT_DONE, mutedWhileOff.said)
  assert.match(martha(place, 'bells').out, /^builder: rings nothing \(the declaration turns owner_bell off\); muted since .* by Ada Owner /m, 'a mute made while the declaration is off is still named')
})

test('martha bells with no terminal is refused, so a member\'s shell cannot silence the bell that warns the owner (martha#371)', (t) => {
  const place = placeFor(t)
  aCrewWithItsBells(place, true)
  const run = martha(place, 'bells', 'builder', BELLS_MUTED)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.err.includes(A_MUTE_NEEDS_THE_OWNERS_TERMINAL), run.err)
  assert.equal(existsSync(theBellsFile(place)), false, 'nothing was written')
})

test('martha bells mutes one member on the owner\'s terminal and lifts it, and keeps both flips (martha#371)', (t) => {
  const place = placeFor(t)
  aCrewWithItsBells(place, true)

  const muted = marthaOnATerminal(place, {}, 'bells', 'builder', BELLS_MUTED)
  assert.equal(muted.status, EXIT_DONE, muted.said)
  assert.match(muted.said, /builder's bell is muted/)
  const listed = martha(place, 'bells')
  assert.match(listed.out, /^builder: muted since .* by Ada Owner /m, listed.out)
  assert.match(listed.out, /^reviewer: rings$/m, 'the other member still rings')

  const again = marthaOnATerminal(place, {}, 'bells', 'builder', BELLS_MUTED)
  assert.equal(again.status, EXIT_DONE, again.said)
  assert.match(again.said, /already muted, so nothing was written/)

  const heard = marthaOnATerminal(place, {}, 'bells', 'builder', BELLS_HEARD)
  assert.equal(heard.status, EXIT_DONE, heard.said)
  assert.match(heard.said, /builder's bell rings again/)
  assert.match(martha(place, 'bells').out, /^builder: rings$/m)
  assert.equal(readFileSync(theBellsFile(place), 'utf8').split('\n').filter((line) => line !== '').length, 2, 'both flips are kept')
})

test('martha bells refuses a member the declaration does not know, and writes nothing (martha#371)', (t) => {
  const place = placeFor(t)
  aCrewWithItsBells(place, true)
  const run = marthaOnATerminal(place, {}, 'bells', 'nobody', BELLS_MUTED)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /does not know nobody/)
  assert.equal(existsSync(theBellsFile(place)), false, 'nothing was written')
})

test('martha bells takes no words, or one member and one of its two ways (martha#371)', (t) => {
  const place = placeFor(t)
  aCrewWithItsBells(place, true)
  for (const args of [['bells', 'builder'], ['bells', 'builder', 'louder'], ['bells', 'builder', BELLS_MUTED, 'more'], ['bells', '--all']]) {
    assert.equal(martha(place, ...args).status, EXIT_USAGE, args.join(' '))
  }
})

/** A crew with something to ring, its declaration's own switch on the way the owner asked for it. */
function aCrewWithItsBells(place: Place, declared: boolean): string {
  assert.equal(martha(place, 'init').status, 0)
  const file = join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), house_rules: { owner_bell: declared } }))
  return file
}

/** The file the owner's mutes are kept in, in the crew's own place. */
const theBellsFile = (place: Place): string => join(place.home, 'state', STATE_ROOT_NAME, CREWS_PLACE, crewKeyOf(place.root), THE_BELLS_PLACE, THE_BELLS_FILE)

test('martha approve whose input is no terminal refuses, so a member\'s shell cannot approve', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, '.mcp.json'), '{"mcpServers":{}}')
  const run = martha(place, 'approve')
  assert.equal(run.status, EXIT_REFUSED)
  assert.ok(run.err.includes(NOT_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
})

test('#765: martha approve shows the approval it just made as typed at the owner\'s terminal, never as written without the martha command', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } }))
  const run = marthaOnATerminalTyping('yes\n', place, {}, 'approve')
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.match(run.said, /line 1: typed at \/dev\/pts\/\d+ \(session \d+\)/, run.said)
  assert.ok(!run.said.includes('WRITTEN WITHOUT THE MARTHA COMMAND'), `the owner's own yes was shown as forged: ${run.said}`)
})

test('#765: a log that cannot keep where the act was typed is said, and no listing is shown over it', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } }))
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  // A directory where the log's file belongs: nothing can be appended to it, so the act is made and never named.
  mkdirSync(join(state.directory, OWNER_ACTS_FILE))
  const run = marthaOnATerminalTyping('yes\n', place, {}, 'approve')
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.match(run.said, /The act is made, but where it was typed is not kept: /, run.said)
  assert.ok(!run.said.includes('Your approvals'), `the owner was shown a listing over an act the log does not name: ${run.said}`)
})

/** Martha's state for `place`, with builder's answer route pointing at a socket nothing serves. */
function aRouteNothingServes(t: TestContext, place: Place) {
  const state_root = join(place.home, 'state', STATE_ROOT_NAME)
  const state = openState(state_root, place.root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const routes = crewSubdirectory(state_root, place.root, THE_ANSWER_ROUTES_PLACE)
  assert.ok(!('refusal' in routes), `the test could not open the routes' place: ${'refusal' in routes ? routes.refusal : ''}`)
  mkdirSync(routes.path, { recursive: true, mode: 0o700 })
  keepTheRoute(routes.path, { member: 'builder', socket_path: join(shortRelayRoot(t), 'answers.sock'), pid: process.pid })
  return state
}

test('a martha answer its launch refuses keeps its line as typed at the owner\'s terminal, never in the shape of a forged one (#541 9a slice 2, note (a))', (t) => {
  const place = placeFor(t)
  // The line is kept, then the launch does not take the answer.
  const state = aRouteNothingServes(t, place)
  const run = marthaOnATerminal(place, {}, 'answer', 'builder', 'permission:call-1', 'allow')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /builder's launch did not take the answer/, run.said)
  // A member's shell, writing the record itself: no martha command, so no entry in the log names its line.
  appendFileSync(join(state.directory, THE_OWNERS_ANSWERS_FILE), `${JSON.stringify({ act: 'a-forged-act', member: 'builder', key: 'permission:call-1', answer: 'allow', at: '2026-11-19T00:00:00.000Z' })}\n`)
  const read = whatTheOwnerReadsOf({ state, root: place.root }, 'answer', undefined)
  assert.match(read.join('\n'), /line 1: typed at \/dev\/pts\/\d+ \(session \d+\)/, read.join('\n'))
  assert.match(read.join('\n'), /line 2: WRITTEN WITHOUT THE MARTHA COMMAND/, read.join('\n'))
})

test('a refused act whose line is kept, with a log that cannot keep where it was typed, says the act was refused, never that it was made (#541 9a slice 2)', (t) => {
  const place = placeFor(t)
  const state = aRouteNothingServes(t, place)
  // A directory where the log's file belongs: nothing can be appended to it.
  mkdirSync(join(state.directory, OWNER_ACTS_FILE))
  const run = marthaOnATerminal(place, {}, 'answer', 'builder', 'permission:call-1', 'allow')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.match(run.said, /The act ended refused, after its record kept a line, but where it was typed is not kept: /, run.said)
  assert.ok(!run.said.includes('The act is made'), run.said)
})

test('an approve the owner refuses shows no listing of the approvals already kept (#541 9a slice 2; mutant: the listing after any act)', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } }))
  const approved = marthaOnATerminalTyping('yes\n', place, {}, 'approve')
  assert.equal(approved.status, EXIT_DONE, approved.said)
  assert.ok(approved.said.includes('Your approvals'), `the first approve showed no listing, so its absence below proves nothing: ${approved.said}`)
  writeFileSync(join(place.root, '.mcp.json'), JSON.stringify({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@2.0.0'] } } }))
  const refusedOne = marthaOnATerminalTyping('no\n', place, {}, 'approve')
  assert.equal(refusedOne.status, EXIT_REFUSED, refusedOne.said)
  assert.ok(!refusedOne.said.includes('Your approvals'), `a refused approve showed the listing: ${refusedOne.said}`)
})

test('martha --version prints the version package.json carries, and nothing else', (t) => {
  const run = martha(placeFor(t, { checkout: false }), '--version')
  assert.equal(run.status, 0)
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', MANIFEST), 'utf8')) as { version: string }
  assert.equal(run.out, `${manifest.version}\n`)
})

/** bin/martha run on a terminal of its own, as the owner runs it: util-linux script gives it one. */
function marthaOnATerminal(place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  return marthaOnATerminalTyping('', place, env, ...args)
}

/** bin/martha run on a terminal of its own, with `typed` written at it as the owner types an answer. */
function marthaOnATerminalTyping(typed: string, place: Place, env: Readonly<Record<string, string>>, ...args: string[]) {
  const words = [process.execPath, MARTHA, ...args].map((word) => `'${word.replaceAll("'", "'\\''")}'`).join(' ')
  const run = spawnSync('script', ['--quiet', '--return', '--command', words, '/dev/null'], {
    cwd: place.root,
    encoding: 'utf8',
    input: typed,
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...env },
  })
  return { status: run.status, said: `${run.stdout}${run.stderr}`.replaceAll('\r\n', '\n') }
}

/**
 * A fake claude on the place's PATH that notes it ran, then ends with status 7 at once. The launcher holds a member
 * on a terminal until it has recorded its launch (martha#94), so ending at once is not a race.
 */
function claudeThatEnds(place: Place, t: TestContext): { readonly ran: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'bin')
  mkdirSync(bin)
  const ran = join(place.home, 'ran')
  writeFileSync(join(bin, CLAUDE), ['#!/bin/sh', ...hostAnswers(), `: > '${ran}'`, 'exit 7', ''].join('\n'), { mode: 0o700 })
  return { ran, env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: shortRelayRoot(t) } }
}

test('martha init then martha start on a terminal runs the owner\'s claude, names the member and its pid, and ends as it did', (t) => {
  const place = placeFor(t)
  const claude = claudeThatEnds(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const run = marthaOnATerminal(place, claude.env, 'start', builder!.name)
  assert.equal(run.status, 7, run.said)
  assert.match(run.said, new RegExp(`^${startedLine(builder!.name, '[0-9]+')}$`, 'm'))
  assert.ok(existsSync(claude.ran), 'the owner\'s claude ran')
})

test('martha start whose input is no terminal refuses, so a member\'s shell cannot start a sibling', (t) => {
  const place = placeFor(t)
  const claude = claudeThatEnds(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0)
  const [builder] = SOLO_MEMBERS
  const run = marthaWith(place, claude.env, 'start', builder!.name)
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.err.includes(START_NOT_ON_A_TERMINAL), run.err)
  allSaidByMartha(run.err)
  assert.equal(existsSync(claude.ran), false)
})

test('what martha shows the owner carries no terminal control: it is written out as an escape', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-command-')))
  t.after(() => removeTheTree(home))
  const root = join(home, EVERY_CONTROL_CLASS)
  mkdirSync(root)
  // A folder outside any checkout is its own crew's root (martha#511): a declaration folder that is a file is refused
  // naming its path, so the folder's name is shown to the owner.
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Ada Owner\n')
  writeFileSync(join(root, DECLARATION_DIRECTORY), '')
  const run = martha({ home, root }, 'init')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.doesNotMatch(run.said, SHOWN_CONTROLS)
  assert.ok(run.err.includes(EVERY_CONTROL_CLASS_SHOWN), run.err)
  allSaidByMartha(run.err)
})

/**
 * A directory name holding one of every class a terminal acts on: a C0 control (ESC), a C1 control (CSI), DEL,
 * two bidirectional overrides, two isolates, the three direction marks, and the line and paragraph separators.
 */
const EVERY_CONTROL_CLASS = 'erase\u001b[2K\u009bline\u007fdel\u202a\u202eover\u2066\u2069iso\u200e\u200f\u061c\u2028\u2029'

/** That name as the owner must see it: each control written out as its escape, by hand rather than by the function under test. */
const EVERY_CONTROL_CLASS_SHOWN = 'erase\\x1b[2K\\x9bline\\x7fdel\\u202a\\u202eover\\u2066\\u2069iso\\u200e\\u200f\\u061c\\u2028\\u2029'

/** What no line Martha shows may carry: every control and direction mark a terminal acts on, the newline that ends a line aside. */
const SHOWN_CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

test('an error nobody expected reaches the owner as one escaped martha: line, never as Node\'s own trace', (t) => {
  const place = placeFor(t)
  const closed = join(place.home, EVERY_CONTROL_CLASS)
  // Empty and closed to writing: the state root cannot be made in it, and the home's removal still takes it.
  mkdirSync(closed, { mode: 0o500 })
  const run = marthaWith(place, { XDG_STATE_HOME: closed }, 'init')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.doesNotMatch(run.said, SHOWN_CONTROLS)
  assert.doesNotMatch(run.err, /^\s+at /m, 'no stack trace')
  assert.ok(run.err.includes(EVERY_CONTROL_CLASS_SHOWN), run.err)
  allSaidByMartha(run.err)
})

// martha#129: martha run, martha pin-key and martha keep-shapes.

test('martha pin-key and keep-shapes off a terminal refuse, and pin nothing', (t) => {
  const place = placeFor(t)
  writeFileSync(join(place.root, 'owner.pub'), 'sk-ssh-ed25519@openssh.com AAAA owner\n')
  for (const act of ['pin-key', 'keep-shapes']) {
    const run = martha(place, act, 'owner.pub')
    assert.equal(run.status, EXIT_REFUSED)
    assert.ok(run.err.includes(OWNERS_ACT_NEEDS_A_TERMINAL), run.err)
  }
  assert.equal(execFileSync('find', [join(place.home, 'state'), '-name', OWNER_KEYS_FILE], { encoding: 'utf8' }), '')
})

test('martha run, pin-key and keep-shapes take exactly one argument', (t) => {
  const place = placeFor(t)
  for (const args of [['run'], ['run', 'a', 'b'], ['run', ''], ['pin-key'], ['keep-shapes', 'a', 'b']]) {
    assert.equal(martha(place, ...args).status, EXIT_USAGE, args.join(' '))
  }
})

test('martha run outside a member\'s shell refuses, naming why', (t) => {
  const run = martha(placeFor(t), 'run', 'test')
  assert.equal(run.status, EXIT_REFUSED)
  assert.ok(run.err.includes(NOT_IN_A_MEMBER), run.err)
  assert.equal(run.out, '')
})

/** bin/martha run against a stand-in launcher answering `answer`, while this process keeps serving it. */
async function runAgainst(t: TestContext, answer: unknown) {
  const place = placeFor(t)
  const socket_path = join(shortRelayRoot(t), 'launcher.sock')
  const asked: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      asked.push({ path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown })
      response.end(JSON.stringify(answer))
    })
  })
  await new Promise<void>((resolve) => server.listen(socket_path, resolve))
  t.after(() => server.close())
  const child = spawn(process.execPath, [MARTHA, 'run', 'test'], {
    cwd: place.root,
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), [RELAY_SOCKET_VARIABLE]: socket_path },
  })
  const out: Buffer[] = []
  const err: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve))
  return { status, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8'), asked }
}

test('martha run writes the run\'s bytes to stdout as they are, nothing to stderr, and ends with its status', async (t) => {
  // Terminal controls and a byte that is not text: the host must get exactly what the run gave.
  const bytes = Buffer.from('ok \u001b[2J\r\n\u0000 done\n', 'utf8')
  const run = await runAgainst(t, { ran: 1, status: 3, output: bytes.toString('base64') })
  assert.deepEqual(run.asked, [{ path: RUN_PATH, body: { name: 'test' } }])
  assert.equal(run.status, 3)
  assert.deepEqual(run.out, bytes)
  assert.equal(run.err, '')
})

test('martha run with a refusal from the launcher shows it, and writes nothing to stdout', async (t) => {
  const run = await runAgainst(t, { refused: 'nothing ran: planted.txt' })
  assert.equal(run.status, EXIT_REFUSED)
  assert.equal(run.out.length, 0)
  assert.match(run.err, /nothing ran: planted\.txt/)
})

test('martha run hears any other answer as a refusal', async (t) => {
  for (const answer of [{ ran: 1, status: 0, output: 'not base64!' }, { ran: 1, status: 0, output: '', extra: 1 }, { allow: 1 }]) {
    const run = await runAgainst(t, answer)
    assert.equal(run.status, EXIT_REFUSED, JSON.stringify(answer))
    assert.equal(run.out.length, 0)
  }
})

test('martha install runs outside a checkout, and refuses a release that carries no pin, naming it', (t) => {
  // The act is placed before the places are read: an installed machine with no checkout must still upgrade
  // (martha#84). This tree carries no installer.json, so the refusal is the pin's, never the checkout's.
  const run = martha(placeFor(t, { checkout: false }), 'install')
  assert.equal(run.status, EXIT_REFUSED)
  assert.match(run.said, /installer pin/)
  assert.doesNotMatch(run.said, /git checkout/)
  allSaidByMartha(run.err)
})

test('martha install with a switch it does not know is a usage error, and the usage names the act', (t) => {
  const run = martha(placeFor(t), 'install', '--bogus')
  assert.equal(run.status, EXIT_USAGE)
  assert.ok(USAGE.includes('martha install'), USAGE)
  assert.doesNotMatch(run.err, /installer pin/)
})

test('martha install passes --withdrawal-in <version> through to the pinned installer, and the usage names it (martha#21)', (t) => {
  // It reaches the pin, so the words were taken as a way the command is used and handed on, not refused here.
  const run = martha(placeFor(t, { checkout: false }), 'install', '1.0.0', '--downgrade', '--withdrawal-in', '2.1.0')
  assert.equal(run.status, EXIT_REFUSED)
  assert.match(run.said, /installer pin/)
  assert.ok(USAGE.includes('martha install [<version>] [--downgrade] [--digest sha256:<hex>] [--withdrawal-in <version>]'), USAGE)
  assert.equal(martha(placeFor(t), 'install', '1.0.0', '--withdrawal-in').status, EXIT_USAGE, '--withdrawal-in takes a value')
})

/**
 * A fake claude on the place's PATH that keeps every call's arguments, each call separated from the last, then ends at
 * once as the owner's host would end a session it finished with. The launcher asks its host several questions before
 * it starts a member, so what a test reads is the last call that carries the member's own switches.
 */
function claudeThatWritesItsArguments(place: Place, t: TestContext): { readonly args: string; readonly env: Readonly<Record<string, string>> } {
  const bin = join(place.home, 'wake-bin')
  mkdirSync(bin)
  const args = join(place.home, 'wake-args')
  writeFileSync(join(bin, CLAUDE), ['#!/bin/sh', ...hostAnswers(), `{ printf '%s\\n' "$@"; echo '---'; } >> '${args}'`, 'exit 0', ''].join('\n'), { mode: 0o700 })
  return { args, env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: shortRelayRoot(t) } }
}

// The verb's whole point (martha#255 part 2, R1): `martha wake <member>` really does start the member on the prompt
// the wake composed, and it starts it on the handover its stamp names. Measured at the host's own arguments, because
// a wake that starts a member with no prompt, or with someone else's words, still prints "woken".
test('martha wake starts the member on its newest handover, and the prompt it is started on names that file', (t) => {
  const place = placeFor(t)
  const claude = claudeThatWritesItsArguments(place, t)
  assert.equal(marthaWith(place, claude.env, 'init').status, 0, 'the test could not declare a crew')
  const [builder] = SOLO_MEMBERS
  const member = builder!.name
  const content = 'What stands: the package, its branch, its tip.\n'
  const at = new Date('2026-11-12T09:00:00Z')
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const crew = crewStateDirectory(state.state_root, place.root)
  assert.ok(!('refusal' in crew), `the test could not reach the crew's store: ${'refusal' in crew ? crew.refusal : ''}`)
  const stamps = handoverStampsIn(crew.path)
  const session = startSession({ read: () => undefined, write: () => {} }, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const written = writeMyHandover({ stores: { crew: keepTheCrewsFilesAsDirectories(crew.path) } }, { member, content, at, stamps, session })
  assert.equal(written, THE_HANDOVER_WRITTEN, `the host did not write the handover the test needed: ${JSON.stringify(written)}`)
  const handovers = keepTheCrewsFilesAsDirectories(crew.path).place(HANDOVERS_PLACE)
  assert.ok(!('refusal' in handovers), 'the crew store refused its handovers place')
  const file = join(handovers.path, theHandoverFile(member, at))

  const run = marthaOnATerminal(place, claude.env, 'wake', member)

  assert.equal(run.status, 0, run.said)
  assert.match(run.said, new RegExp(`^${member} woken from .*MARTHA_HANDOVER_2026-11-12_${member}\\.md$`, 'm'), 'the wake did not say which handover it woke the member from')
  const calls = readFileSync(claude.args, 'utf8')
    .split('---\n')
    .map((call) => call.split('\n').filter((line) => line !== ''))
    .filter((call) => call.length > 0)
  const started = calls.find((call) => call.includes('--plugin-dir'))
  assert.ok(started !== undefined, `the wake never started the member: ${JSON.stringify(calls)}`)
  assert.ok(started.includes(theResumePrompt({ file, content }, member)), `the member was not started on the prompt its wake composed: ${JSON.stringify(started)}`)
})

// --- martha ls and martha stop (martha#312) -------------------------------------------------------------------------

/** The relay root under the test's own home, so a verb that composes the launcher's places leaves nothing in /tmp. */
const runtimeOf = (place: Place): Readonly<Record<string, string>> => ({ XDG_RUNTIME_DIR: join(place.home, 'run') })

test('#312: martha ls takes no argument, and martha stop one member at most and no switch', (t) => {
  const place = placeFor(t)
  for (const args of [['ls', 'Terra'], [STOP, 'a', 'b'], [STOP, '--all'], [STOP, '']]) {
    assert.equal(marthaWith(place, runtimeOf(place), ...args).status, EXIT_USAGE, args.join(' '))
  }
  assert.ok(USAGE.includes('martha ls | martha stop [<member>]'), USAGE)
})

test('#312: martha ls shows every declared member, in the declaration order, stopped when none was started', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const listed = marthaWith(place, runtimeOf(place), 'ls')
  assert.equal(listed.status, 0, listed.said)
  const declaration = JSON.parse(readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { members: { name: string }[] }
  const names = declaration.members.map((member) => member.name)
  assert.ok(names.length > 1, 'a solo crew declares more than one member, so the order is a real check')
  assert.deepEqual(listed.out.trimEnd().split('\n').map((line) => line.split('  ').slice(0, 2)), names.map((name) => [name, 'stopped']), listed.out)
})

test('#312: martha stop with nothing running says so and ends done; a name the crew does not have is refused', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const none = marthaWith(place, runtimeOf(place), STOP)
  assert.equal(none.status, 0, none.said)
  assert.ok(none.err.includes('no member of this crew is running, so nothing was stopped.'), none.err)
  allSaidByMartha(none.err)
  const stranger = marthaWith(place, runtimeOf(place), STOP, 'nobody')
  assert.equal(stranger.status, EXIT_REFUSED)
  assert.match(stranger.err, /nobody is not on this crew \(its members are /)
})

// --- martha crew (martha#572) --------------------------------------------------------------------------------------

/** How long `martha crew` may take to draw its first frame before the test gives up on it. */
const FIRST_FRAME_MS = 20_000

test('#572: martha crew takes no argument', (t) => {
  const place = placeFor(t)
  assert.equal(marthaWith(place, runtimeOf(place), 'crew', 'Terra').status, EXIT_USAGE)
  // No argument but one of the verbs martha#307 added: the strip is still `martha crew` alone, and the bracket holds the
  // verbs, each optional.
  assert.ok(USAGE.includes('| martha crew [add <member> <role>'), USAGE)
})

test('#572: martha crew clears the terminal and draws the header and every declared member, in the declaration order', async (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const declaration = JSON.parse(readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { members: { name: string }[] }
  const names = declaration.members.map((member) => member.name)
  const strip = spawn(process.execPath, [MARTHA, 'crew'], {
    cwd: place.root,
    env: { PATH: process.env.PATH, HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1', ...runtimeOf(place) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => strip.kill('SIGKILL'))
  let out = ''
  let err = ''
  strip.stderr.on('data', (chunk: Buffer) => void (err += chunk.toString('utf8')))
  const drawn = await new Promise<boolean>((resolve) => {
    const giveUp = setTimeout(() => resolve(false), FIRST_FRAME_MS)
    strip.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
      if (out.split('\n').length > names.length + 1) {
        clearTimeout(giveUp)
        resolve(true)
      }
    })
    strip.on('exit', () => {
      clearTimeout(giveUp)
      resolve(false)
    })
  })
  const ended = new Promise((resolve) => strip.on('close', resolve))
  strip.kill('SIGTERM')
  await ended
  assert.ok(drawn, `martha crew drew no whole frame: out ${JSON.stringify(out)} err ${JSON.stringify(err)}`)
  assert.ok(out.startsWith(CLEAR_THE_TERMINAL), `the frame does not open by clearing the terminal: ${JSON.stringify(out)}`)
  const [header, ...lines] = out.slice(CLEAR_THE_TERMINAL.length).trimEnd().split('\n')
  assert.equal(header, `0/${names.length} online · 0 waiting · 0 need you`)
  assert.deepEqual(lines, names.map((name) => `${name}: idle ·  0/1`), out)
})

// --- martha restart (martha#312) ------------------------------------------------------------------------------------

test('#312: martha restart takes one member and the one switch --fresh', (t) => {
  const place = placeFor(t)
  for (const args of [[RESTART], [RESTART, '--fresh'], [RESTART, 'a', 'b'], [RESTART, 'a', '--all'], [RESTART, 'a', '--fresh', '--fresh'], [RESTART, '']]) {
    assert.equal(marthaWith(place, runtimeOf(place), ...args).status, EXIT_USAGE, args.join(' '))
  }
  assert.ok(USAGE.includes('martha restart <member> [--fresh]'), USAGE)
})

test('#312 test 9: martha restart of a member that is not running starts nothing and names martha wake; a stranger is refused', (t) => {
  const place = placeFor(t)
  assert.equal(martha(place, 'init').status, 0)
  const declaration = JSON.parse(readFileSync(join(place.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { members: { name: string }[] }
  const member = declaration.members[0]!.name
  for (const args of [[RESTART, member], [RESTART, member, '--fresh']]) {
    const asked = marthaWith(place, runtimeOf(place), ...args)
    assert.equal(asked.status, EXIT_REFUSED, asked.said)
    assert.ok(asked.err.includes(notRunningToRestart(member)), asked.err)
    allSaidByMartha(asked.err)
  }
  const stranger = marthaWith(place, runtimeOf(place), RESTART, 'nobody')
  assert.equal(stranger.status, EXIT_REFUSED)
  assert.match(stranger.err, /nobody is not on this crew \(its members are /)
})

/**
 * A member's launch, recorded in the place's own state root as the launcher records one (martha#619), whose host is
 * `pid`: the process above a `martha` this test runs, so the act runs inside that member as a member's shell would.
 */
function aMemberLaunchedAs(place: Place, member: string, pid: number): void {
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state), 'refusal' in state ? state.refusal : '')
  const records = join(state.directory, THE_PLACES_A_STATE_ROOT_KEEPS.records_place)
  mkdirSync(records, { recursive: true, mode: THE_PLACES_A_STATE_ROOT_KEEPS.only_its_owner_may_enter })
  const process_started_at = linuxProcessIdentities.identityOf(pid)
  assert.ok(process_started_at !== null, `the test could not read process ${pid}`)
  launchRecordsDirectory(records).keep(member, { member_name: member, node_id: 'ab'.repeat(32), pid, process_started_at })
}

test("#619: martha answer under a terminal a member's shell made (script), with a member's host above it, is refused naming the member", (t) => {
  const place = placeFor(t)
  // This test's own process stands as the member's host: script, then martha, run below it, as a member's shell would.
  aMemberLaunchedAs(place, 'builder', process.pid)
  const run = marthaOnATerminal(place, {}, 'answer')
  assert.equal(run.status, EXIT_REFUSED, run.said)
  assert.ok(run.said.includes("this runs inside builder's session") && run.said.includes(NOT_A_WALL), run.said)
})

test('#619: answering the owner ask refuses inside a member, and every other owner act goes ahead there (#601: the act list cut to one)', (t) => {
  const place = placeFor(t)
  aMemberLaunchedAs(place, 'builder', process.pid)
  // A stand-in claude that ends at once, so an act this lets through starts nothing real and ends the case quickly.
  const claude = claudeThatEnds(place, t)
  for (const words of [['answer'], ['answer', 'builder', 'permission:call-1', 'allow']]) {
    const run = marthaOnATerminal(place, claude.env, ...words)
    assert.ok(run.said.includes("this runs inside builder's session"), `martha ${words.join(' ')}: ${run.said}`)
  }
  for (const words of [['approve'], ['release', 'builder'], ['pin-key', 'a-key'], ['keep-shapes', 'a-list'], ['bells', 'builder', BELLS_MUTED], ['ls'], ['bells']]) {
    const run = marthaOnATerminal(place, claude.env, ...words)
    assert.ok(!run.said.includes("this runs inside builder's session"), `martha ${words.join(' ')} is not the one act kept, and was refused: ${run.said}`)
  }
})

test("#619: answering the owner ask with a member's relay socket or its own config folder in the environment is refused, and the owner's own terminal is not", (t) => {
  const place = placeFor(t)
  const socket = marthaOnATerminal(place, { [RELAY_SOCKET_VARIABLE]: join(place.home, 'a-socket') }, 'answer')
  assert.ok(socket.said.includes(RELAY_SOCKET_VARIABLE) && socket.said.includes(NOT_A_WALL), socket.said)
  const folder = marthaOnATerminal(place, { [CONFIG_DIR_VARIABLE]: join(place.home, 'snapshots', 'launch-1', MEMBER_CONFIG_FOLDER) }, 'answer')
  assert.ok(folder.said.includes(MEMBER_CONFIG_FOLDER) && folder.said.includes(NOT_A_WALL), folder.said)
  // The owner's own terminal: no member's mark, and no member's launch above it.
  const owners = marthaOnATerminal(place, {}, 'answer')
  assert.ok(!owners.said.includes(NOT_A_WALL), owners.said)
})

test('#619: a launch record whose pid is above this act but whose start time is not that process\'s does not refuse it (a reused pid)', (t) => {
  const place = placeFor(t)
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok(!('refusal' in state))
  const records = join(state.directory, THE_PLACES_A_STATE_ROOT_KEEPS.records_place)
  mkdirSync(records, { recursive: true, mode: THE_PLACES_A_STATE_ROOT_KEEPS.only_its_owner_may_enter })
  launchRecordsDirectory(records).keep('builder', { member_name: 'builder', node_id: 'ab'.repeat(32), pid: process.pid, process_started_at: 'another-boot:1' })
  const run = marthaOnATerminal(place, {}, 'answer')
  assert.ok(!run.said.includes("this runs inside builder's session"), run.said)
})

test('#619: martha bells shows each flip the owner typed with its terminal, and a line written straight into the file as written without the martha command', (t) => {
  const place = placeFor(t)
  aCrewWithItsBells(place, true)
  // A flip made before Martha recorded where acts are typed: it is history, before the cutover the next act takes.
  mkdirSync(dirname(theBellsFile(place)), { recursive: true, mode: 0o700 })
  appendFileSync(theBellsFile(place), `${JSON.stringify({ member: 'builder', bells: BELLS_HEARD, by: 'Ada Owner', at: '2026-11-01T00:00:00.000Z' })}\n`, { mode: 0o600 })
  const flipped = marthaOnATerminal(place, {}, 'bells', 'builder', BELLS_MUTED)
  assert.equal(flipped.status, EXIT_DONE, flipped.said)
  // A member's shell, writing the bells file itself: no martha command, so no entry in the log names its line.
  appendFileSync(theBellsFile(place), `${JSON.stringify({ member: 'builder', bells: BELLS_HEARD, by: 'Ada Owner', at: '2026-11-18T12:00:00.000Z' })}\n`, { mode: 0o600 })
  const listed = martha(place, 'bells')
  assert.equal(listed.status, EXIT_DONE, listed.said)
  assert.match(listed.out, /line 1: history before /, listed.out)
  assert.match(listed.out, /line 2: typed at \/dev\/pts\/\d+ \(session \d+\)/, listed.out)
  assert.match(listed.out, /line 3: WRITTEN WITHOUT THE MARTHA COMMAND/, listed.out)
})

test("martha week answers one ISO week from the crew's own rows, and a word that is not a week is refused by name (martha#308)", async (t) => {
  const place = placeFor(t)
  const rows = join(place.home, 'state', STATE_ROOT_NAME, CREWS_PLACE, crewKeyOf(place.root), CREW_ROWS_PLACE)
  mkdirSync(rows, { recursive: true, mode: 0o700 })
  const stored = rowStreamsDirectory(rows)
  const package_name = 'synthetic-owner/repo#7'
  const at = Date.UTC(2026, 10, 17, 10)
  await stored.append(ledgerStreamOf(package_name), { kind: 'review_round_closed', package: package_name, member: 'Hygiea', at, note: 'r=1 asked for two things' })
  await stored.append(ledgerStreamOf(package_name), { kind: 'package_landed', package: package_name, member: 'Hygiea', at: at + 60 * 60 * 1000, note: 'landed' })
  await stored.append(OWNER_ASKS_STREAM, { kind: ASK_QUEUED, question: 'Delete the merged branch?', asked_by: 'Hygiea', since: at })
  await stored.append(OWNER_ASKS_STREAM, { kind: ASKS_SETTLED, batch: 1, yes: [0], at: at + 30 * 60 * 1000, by: 'the owner' })
  mkdirSync(join(rows, streamDirectoryNameOf('ledger/not-a-package')), { mode: 0o700 })

  const answered = martha(place, 'week', '2026-W47')
  assert.equal(answered.status, EXIT_DONE, answered.said)
  assert.ok(answered.out.includes('2026-W47 (Mon 16 Nov 00:00 UTC – Mon 23 Nov 00:00 UTC)'), answered.out)
  assert.ok(answered.out.includes(`${package_name} — cycle 1 h 0 min`), answered.out)
  assert.ok(answered.out.includes('owner wait: 1 ask, 1 answered, 0 still waiting'), answered.out)
  assert.ok(answered.out.includes('money: not in the rows'), answered.out)
  assert.ok(answered.out.includes('skipped: ledger/not-a-package (not a package name)'), 'a ledger stream no package owns was not named as skipped')
  allSaidByMartha(answered.err)

  const refusedWeek = martha(place, 'week', '2026-47')
  assert.equal(refusedWeek.status, EXIT_REFUSED, refusedWeek.said)
  assert.match(refusedWeek.err, /is not an ISO week/)

  const refusedWords = martha(place, 'week', '--wat')
  assert.equal(refusedWords.status, EXIT_USAGE, refusedWords.said)
})

/** A crew of two in the given mode, with its keys folder and a key for the first member only, under a place of this test's own. */
function aRosterWrite(t: TestContext, mode: string, nodeIdOf: NonNullable<Parameters<typeof keepTheCrewsRoster>[0]['nodeIdOf']>) {
  const place = placeFor(t, { checkout: false })
  const keys = join(place.home, 'keys')
  mkdirSync(keys)
  writeFileSync(join(keys, 'agent-venus.key'), 'a key', { mode: 0o600 })
  const state = openState(join(place.home, 'state', STATE_ROOT_NAME), place.root)
  assert.ok('directory' in state)
  mkdirSync(state.directory, { recursive: true })
  const settings = { mode: { name: mode }, mesh_keys: { folder: keys, named: {} }, members: [{ name: 'Venus' }, { name: 'Terra' }], paths: { root: place.root } } as unknown as CrewSettings
  const told: string[] = []
  return { write: { settings, home: place.home, state, mesh_servers: join(place.home, 'mesh-servers'), tell: (line: string) => void told.push(line), nodeIdOf }, told, roster: join(state.directory, ROSTER_FILE) }
}

const A_NODE_ID = 'ef'.repeat(32)
/** The team mode as the owner writes it in a declaration. */
const A_TEAM = 'team'

test('#1016: martha up keeps a team crew\'s roster whole and owner-only, and tells each member left out by name', (t) => {
  const { write, told, roster } = aRosterWrite(t, A_TEAM, () => ({ id: A_NODE_ID }))
  keepTheCrewsRoster(write)
  assert.deepEqual(JSON.parse(readFileSync(roster, 'utf8')), { Venus: A_NODE_ID })
  assert.equal(statSync(roster).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(write.state.directory).filter((name) => name !== ROSTER_FILE), [], 'a staged roster was left behind')
  assert.equal(told.length, 1)
  assert.ok(told[0]!.startsWith("Terra is left out of the roster: Terra's mesh key: there is no key at"), String(told[0]))
})

test('#1016: martha up writes no roster for a solo crew, and a node id bin that cannot start is told and stops nothing', (t) => {
  const solo = aRosterWrite(t, SOLO_MODE, () => assert.fail('a solo crew\'s key was read'))
  keepTheCrewsRoster(solo.write)
  assert.equal(existsSync(solo.roster), false)
  assert.deepEqual(solo.told, [])
  const refused = aRosterWrite(t, A_TEAM, { refusal: 'the bin is not recorded' })
  assert.doesNotThrow(() => keepTheCrewsRoster(refused.write))
  assert.equal(existsSync(refused.roster), false)
  assert.deepEqual(refused.told, ['No roster was written: the bin is not recorded'])
})
