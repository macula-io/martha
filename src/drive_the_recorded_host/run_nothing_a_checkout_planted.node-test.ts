// A member the launcher starts runs none of the code a checkout planted for its
// ordinary commands (martha#24, option 3): its git hooks, its npm install
// scripts, the program its .npmrc names as git, and its .envrc
// (../refuse_code_a_checkout_runs_itself).
//
// Each planted file only writes a marker. The doors are split into groups
// (DOOR_GROUPS), each with the commands that open them, and each group's commands
// run twice on two fresh copies of the same checkout: once with the owner's
// environment as the launcher inherits it (the control: exactly that group's
// markers must appear, or the plant proves nothing), and once as a member the
// launcher started (no marker at all may appear). The owner's environment here is
// a hostile one: it already tries to switch each door back on, so the launcher's
// settings must win over it.
//
// Why groups (martha#700): a launched member's git runs through the launch's git
// guard, which starts node for every call, so on a loaded machine one launch that
// ran every door's commands outlasted the suite's per-test limit. One launch per
// group keeps each test's work a part of that; a test the limit still cancels says
// which command its member was in.
//
// Real git, real npm and real direnv. The .envrc door follows the tool: each
// direnv the tests prove (direnvs_under_test.ts)
// gets its own pair of tests, and with none installed the door is left out by
// name. CI names two direnvs, so there it is never left out. Everything a test
// makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { PLUGIN_DIRS_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { direnvsUnderTest, type Direnv } from './direnvs_under_test.ts'
import { DIRENV_CONFIG_VARIABLE } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { EMPTY_DIRECTORY_MODE } from '../empty_directory_of_a_launch/empty_directory.ts'
import { DEPENDENCIES } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { EMPTY_DIRECTORY_NAME, launchClaudeCodeMember, type MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { shortRelayRoot } from './short_relay_root.ts'
import { hostAnswers } from './host_stand_in.ts'
import { RELAY_PATHS, RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { readTheNewestRelayJournal } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { CLAUDE, CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'

/** The first git that runs hooks named in config (`hook.<name>.command`). */
const CONFIG_HOOKS_SINCE: readonly [number, number] = [2, 54]

function gitVersion(): readonly [number, number] {
  const match = /(\d+)\.(\d+)/.exec(execFileSync('git', ['version'], { encoding: 'utf8' }))
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0)]
}

function gitRunsConfigHooks(): boolean {
  const [major, minor] = gitVersion()
  return major > CONFIG_HOOKS_SINCE[0] || (major === CONFIG_HOOKS_SINCE[0] && minor >= CONFIG_HOOKS_SINCE[1])
}

/** Every door, by the marker its planted file writes. */
const DOORS = {
  hook: 'a hook in .git/hooks',
  config_hook: 'a hook named in the checkout\'s git config',
  fsmonitor: 'an fsmonitor command in the checkout\'s git config',
  hooks_path: 'a tracked hook directory the checkout\'s git config points at',
  postinstall: 'an npm postinstall script, with an .npmrc switching scripts back on',
  npm_git: 'a program a tracked .npmrc names as git, which npm runs to fetch a git dependency',
  envrc: 'an .envrc under a directory the owner\'s direnv trusts',
} as const

type Door = keyof typeof DOORS

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function script(path: string, marker: string): void {
  writeFileSync(path, `#!/bin/sh\n: > '${marker}'\n`)
  chmodSync(path, 0o755)
}

interface Fixture {
  /** The stop directory, standing in for the owner's home. */
  readonly home: string
  readonly checkout: string
  /** A second checkout whose own config moves its hooks into a tracked directory. */
  readonly husky: string
  readonly markers: string
  /** The owner's environment, already trying to switch every door back on. */
  readonly owner_env: Record<string, string | undefined>
  /** Where a launched member's stderr is kept: the launch hands it no terminal, so a member that stops early says why here. */
  readonly member_errors: string
}

/** What the launched member printed on its stderr, for the assertion that it ran to the end. */
const whatTheMemberPrinted = (place: Fixture): string => (existsSync(place.member_errors) ? readFileSync(place.member_errors, 'utf8') : '(nothing)')

/** The owner's environment, and managed settings in a folder of the test's own, never the machine's (martha#121). */
const ownersSettings = (place: Fixture) => ({
  inherited: place.owner_env,
  managed_settings: { ...RECORDED_HOST.managed_settings, dir: join(place.home, 'managed-settings') },
})

function fixture(t: TestContext, direnv: Direnv | undefined): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'martha-checkout-runs-'))
  t.after(() => removeTheTree(home))
  const markers = join(home, 'markers')
  mkdirSync(markers)
  const marker = (door: Door): string => join(markers, door)

  const checkout = plantedCheckout(home, marker)
  const husky = huskyCheckout(home, marker)
  const owner_env = ownerEnvironment(home, checkout, direnv)

  return { home, checkout, husky, markers, owner_env, member_errors: join(home, 'member-errors') }
}

function repo(dir: string): void {
  mkdirSync(dir)
  git(dir, 'init', '-q', '.')
  git(dir, 'config', 'user.name', 'martha-test')
  git(dir, 'config', 'user.email', 'martha-test@example.invalid')
  git(dir, 'config', 'commit.gpgsign', 'false')
}

function plantedCheckout(home: string, marker: (door: Door) => string): string {
  // A git dependency, so that npm install runs git.
  const dependency = join(home, 'dependency')
  repo(dependency)
  writeFileSync(join(dependency, MANIFEST), JSON.stringify({ name: 'dependency', version: '1.0.0' }))
  git(dependency, 'add', '--all')
  git(dependency, 'commit', '-q', '-m', 'a dependency')

  // The checkout: what its author ships, then what something on this machine
  // left in its .git (a hook, two config entries), which a clone never carries.
  // The program its .npmrc names as git writes its marker, then hands over to
  // the real git, so the install succeeds whichever git npm ran.
  const checkout = join(home, 'checkout')
  repo(checkout)
  writeFileSync(
    join(checkout, MANIFEST),
    JSON.stringify({
      name: 'fixture',
      version: '0.0.0',
      private: true,
      scripts: { postinstall: `: > '${marker('postinstall')}'` },
      dependencies: { dependency: `git+file://${dependency}` },
    }),
  )
  writeFileSync(join(checkout, 'npm-git'), `#!/bin/sh\n: > '${marker('npm_git')}'\nexec git "$@"\n`)
  chmodSync(join(checkout, 'npm-git'), 0o755)
  writeFileSync(join(checkout, '.npmrc'), 'ignore-scripts=false\ngit=./npm-git\n')
  writeFileSync(join(checkout, '.envrc'), `: > '${marker('envrc')}'\n`)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the author\'s files')
  script(join(checkout, '.git', 'hooks', 'pre-commit'), marker('hook'))
  git(checkout, 'config', 'hook.planted.command', `: > '${marker('config_hook')}'`)
  git(checkout, 'config', 'hook.planted.event', 'pre-commit')
  script(join(checkout, '.git', 'fsmonitor'), marker('fsmonitor'))
  git(checkout, 'config', 'core.fsmonitor', join(checkout, '.git', 'fsmonitor'))

  return checkout
}

/** A second checkout whose own config moves its hooks into a tracked directory. */
function huskyCheckout(home: string, marker: (door: Door) => string): string {
  const husky = join(home, 'husky')
  repo(husky)
  mkdirSync(join(husky, '.husky'))
  script(join(husky, '.husky', 'pre-commit'), marker('hooks_path'))
  git(husky, 'add', '--all')
  git(husky, 'commit', '-q', '--no-verify', '-m', 'the author\'s hooks')
  git(husky, 'config', 'core.hooksPath', '.husky')

  return husky
}

function ownerEnvironment(home: string, checkout: string, direnv: Direnv | undefined): Record<string, string | undefined> {
  // The owner's direnv trusts everything under the home, and every switch the
  // launcher sets is already set the other way. Its own command-scope git
  // settings name the same fsmonitor as the checkout's config, so ours must
  // come after the owner's to win.
  const direnv_config = join(home, 'direnv-config')
  mkdirSync(direnv_config)
  // direnv matches the .envrc's real path against the prefix: a TMPDIR behind a link (macOS) needs the real one (martha#79).
  writeFileSync(join(direnv_config, 'direnv.toml'), `[whitelist]\nprefix = [${JSON.stringify(realpathSync(home))}]\n`)
  // The launcher reads the owner's Claude Code settings: give it an empty config folder of the test's own, and no plugin folder from the developer's shell (martha#121).
  const { [PLUGIN_DIRS_VARIABLE]: _developers, ...owners } = process.env
  return {
    ...owners,
    CLAUDE_CONFIG_DIR: join(home, 'claude-config'),
    PATH: direnv === undefined ? process.env.PATH : `${dirname(direnv.path)}${delimiter}${process.env.PATH ?? ''}`,
    DIRENV_CONFIG: direnv_config,
    DIRENV_DISABLE: '0',
    XDG_DATA_HOME: join(home, 'xdg-data'),
    npm_config_ignore_scripts: 'false',
    NPM_CONFIG_IGNORE_SCRIPTS: 'false',
    npm_config_git: './npm-git',
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='" + join(checkout, '.git', 'fsmonitor') + "'",
  }
}

/** What a group's commands are typed in: the planted checkout, the husky one, and the home a direnv writes beside. */
type Places = Pick<Fixture, 'home' | 'checkout' | 'husky'>

/** One group of doors and the commands a member types that open them, one command a line. */
interface DoorGroup {
  /** The doors this group is there to prove: every door is in exactly one group (the partition test below). */
  readonly doors: readonly Door[]
  /**
   * Doors of other groups the same commands also open in the owner's environment, whose command-scope git settings name
   * the checkout's fsmonitor for every git run (ownerEnvironment): the control expects them too, never fewer.
   */
  readonly also: readonly Door[]
  readonly commands: (places: Places, direnv: Direnv | undefined) => readonly string[]
}

/** Every door, by the group whose commands open it (martha#700 r=1, A). */
const DOOR_GROUPS: Readonly<Record<string, DoorGroup>> = {
  'the checkout\'s git and its direnv': {
    doors: ['hook', 'config_hook', 'fsmonitor', 'envrc'],
    also: [],
    commands: ({ home, checkout }, direnv) => [
      `cd '${checkout}'`,
      'git commit -q --allow-empty -m "a member commits"',
      'git status --porcelain > /dev/null',
      // What direnv's shell hook runs on entering a directory, as a command of its
      // own so a missing direnv fails here. A blocked .envrc is direnv's answer to
      // an .envrc it was not told to trust: it exits 1 and says so.
      ...(direnv === undefined
        ? []
        : [
            `direnv export bash > '${home}/direnv.out' 2> '${home}/direnv.err' || grep -q 'is blocked' '${home}/direnv.err'`,
            `bash -c ". '${home}/direnv.out'"`,
          ]),
    ],
  },
  'npm': {
    doors: ['npm_git', 'postinstall'],
    also: ['fsmonitor'],
    commands: ({ checkout }) => [
      `cd '${checkout}'`,
      'npm install --offline --no-audit --no-fund > /dev/null 2>&1',
      `test -e ${DEPENDENCIES}/dependency/${MANIFEST}`,
    ],
  },
  'the husky checkout': {
    doors: ['hooks_path'],
    also: ['fsmonitor'],
    commands: ({ husky }) => [`cd '${husky}'`, 'git commit -q --allow-empty -m "a member commits"'],
  },
}

/** A group's commands as one sh script that stops at the first that fails. */
const asOneScript = (commands: readonly string[]): string => ['set -eu', ...commands, ''].join('\n')

const expectedInControl = (group: DoorGroup, direnv: Direnv | undefined): Door[] =>
  [...group.doors, ...group.also]
    .filter((door) => door !== 'config_hook' || gitRunsConfigHooks())
    .filter((door) => door !== 'envrc' || direnv !== undefined)
    .sort()

test('the door groups hold every door, each in exactly one group (martha#700 r=1, B)', () => {
  const grouped = Object.values(DOOR_GROUPS).flatMap((group) => group.doors)
  const inNoGroup = (Object.keys(DOORS) as Door[]).filter((door) => !grouped.includes(door))
  const twice = grouped.filter((door, at) => grouped.indexOf(door) !== at)
  assert.deepEqual(inNoGroup, [], `doors no group proves: ${inNoGroup.join(', ')}`)
  assert.deepEqual(twice, [], `doors in more than one group: ${twice.join(', ')}`)
  assert.deepEqual([...grouped].sort(), (Object.keys(DOORS) as Door[]).sort())
})

/** The code lines of a source file with their numbers, its comment lines left out: what runs, not what explains it. */
const theCodeOf = (source: string): readonly { readonly line: string; readonly number: number }[] =>
  source.split('\n').map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => !/^\s*(\/\/|\/\*\*|\*)/.test(line))

/** The declaration each test of a launched member is spelled with, in this file. */
const THE_LAUNCH_DECLARATION = ['test(`a member', ' the launcher started runs none of them'].join('')
const THE_CONTROL_DECLARATION = ['test(`every planted door', ' runs with the owner\'s own environment'].join('')

/** The word a declaration of a launched member carries to give the test its own clock rather than the suite's limit. */
const THE_CLOCKS_ARE_ASKED_FOR = ['theOptionsOf(', 'group, direnv)'].join('')

test('each test of a launched member declares its own clock, so the suite\'s limit does not cancel it on a loaded machine (martha#700)', () => {
  const typed = theCodeOf(readFileSync(new URL('./run_nothing_a_checkout_planted.node-test.ts', import.meta.url), 'utf8'))
  for (const needle of [THE_LAUNCH_DECLARATION, THE_CONTROL_DECLARATION]) {
    const declared = typed.filter(({ line }) => line.includes(needle))
    assert.equal(declared.length, 1, `this file declares ${JSON.stringify(needle)} once`)
    const without = declared.filter(({ line }) => !line.includes(THE_CLOCKS_ARE_ASKED_FOR))
    assert.deepEqual(
      without.map(({ line, number }) => `run_nothing_a_checkout_planted.node-test.ts:${number}: ${line.trim()}`),
      [],
      `${needle} does not declare its own clock, so the suite's per-test limit cancels it on a loaded machine`,
    )
  }
})

const { direnvs } = direnvsUnderTest(process.env)

for (const direnv of direnvs.length === 0 ? [undefined] : direnvs) {
  const which = direnv === undefined ? 'no direnv installed, so no .envrc door' : `direnv ${direnv.version}`
  for (const [name, group] of Object.entries(DOOR_GROUPS)) checkoutTests(direnv, `${name}; ${which}`, group)
}

/** How a launched member ended, as the launcher tells it. */
type StopOf = Awaited<(MemberStarted & { started: true })['stopped']>

/** The body a stand-in posts for its session's start: the shape the launcher's own tests answer with. */
const THE_STAND_INS_SESSION_START = { session_id: 'the-stand-ins', source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' }

/**
 * Writes the stand-in host the launcher runs: it answers the host's checks, reports its session's start, then runs the
 * member's commands. The report is what keeps this test off the launcher's clock (martha#700): the launcher stops a
 * member whose relay has not reported its session's start within SESSION_START_DEADLINE_MS (martha#104), a bound on
 * the *host* and never on the member's work — and the member's work here is real npm and git, which on a loaded
 * machine (a full `npm test` beside every other file) outlasts it, so the launcher kills the member mid-way and this
 * test, alone always inside the bound, reds only under load. With the start reported first, the gate is met and the
 * test waits on the member's own end. A report the launcher does not take ends the member at that line, and the
 * stderr kept from it says which one did.
 */
function aStandInThatReportsItsStart(place: Fixture, member: string, run: TheMembersRun, commands: readonly string[]): void {
  const report_start = join(place.home, 'report-start.mjs')
  writeFileSync(
    report_start,
    [
      'import { request } from \'node:http\'',
      `const body = JSON.stringify(${JSON.stringify(THE_STAND_INS_SESSION_START)})`,
      `const sent = request({ socketPath: process.env[${JSON.stringify(RELAY_SOCKET_VARIABLE)}], path: ${JSON.stringify(RELAY_PATHS.session_started)}, method: 'POST', headers: { 'content-type': 'application/json' } }, (answer) => {`,
      '  answer.resume()',
      '  answer.on(\'end\', () => process.exit(answer.statusCode === 200 ? 0 : 1))',
      '})',
      'sent.on(\'error\', () => process.exit(1))',
      'sent.end(body)',
      '',
    ].join('\n'),
  )
  writeFileSync(
    member,
    [
      '#!/bin/sh',
      ...hostAnswers(),
      `exec 2> '${place.member_errors}'`,
      `'${process.execPath}' '${report_start}' || { printf '%s\\n' 'the stand-in could not report its session start' >&2; exit 1; }`,
      `printf '%s\\n%s\\n' "$${DIRENV_CONFIG_VARIABLE}" "$(stat -c %a "$${DIRENV_CONFIG_VARIABLE}") $(ls -A "$${DIRENV_CONFIG_VARIABLE}" | wc -l)" > '${run.empty}'`,
      `${asOneScript(withTheirSteps(commands, run.steps))}status=$?`,
      `printf '%s' "$status" > '${run.done}'`,
      '',
    ].join('\n'),
  )
  chmodSync(member, 0o700)
}

/** Where a launched member leaves what it did: its exit status, what it saw of the empty directory, and its steps. */
interface TheMembersRun {
  readonly done: string
  readonly empty: string
  /** One line as the member starts, then one per command it finished: the command's number and the second it ended. */
  readonly steps: string
}

/** The commands, each followed by the line that says it finished, and the start line before them. */
const withTheirSteps = (commands: readonly string[], steps: string): readonly string[] => [
  `printf 'start %s\\n' "$(date +%s)" >> '${steps}'`,
  ...commands.flatMap((command, at) => [command, `printf '%s %s\\n' ${at} "$(date +%s)" >> '${steps}'`]),
]

/** Which commands the member finished, how long each took, and the one it was in when it stopped, if any. */
function whereTheMemberWas(commands: readonly string[], steps: string): string {
  const lines = existsSync(steps) ? readFileSync(steps, 'utf8').trimEnd().split('\n') : []
  const seconds = lines.map((line) => Number(line.split(' ')[1]))
  const finished = Math.max(0, lines.length - 1)
  const took = commands.slice(0, finished).map((command, at) => `\`${command}\` ${String((seconds[at + 1] ?? 0) - (seconds[at] ?? 0))} s`)
  const now = Math.floor(Date.now() / 1000)
  const was =
    lines.length === 0
      ? 'it never started its commands'
      : finished >= commands.length
        ? 'it finished every command'
        : `it was in \`${commands[finished] ?? ''}\` for ${String(now - (seconds[finished] ?? now))} s`
  return `${was}; finished ${String(finished)} of ${String(commands.length)}${took.length === 0 ? '' : `: ${took.join(', ')}`}`
}

/**
 * The member's end, or, when the suite's per-test limit cancels the test first, the member stopped and the command it
 * was in written where the run shows it (martha#700): a cancelled test asserts nothing, so this is the one place the
 * cancel can say what it caught, and the member never outlives its test. All of it happens inside the abort listener,
 * which node:test calls before the test's after hooks: one turn later, the fixture holding the member's steps is gone.
 */
async function theEndOrTheCancel(t: TestContext, started: MemberStarted & { started: true }, where: () => string): Promise<StopOf | undefined> {
  let cancel = (): void => undefined
  const cancelled = new Promise<undefined>((resolve) => {
    cancel = () => {
      process.stderr.write(`${t.fullName}: cancelled; the launched member ${where()}\n`)
      started.stop('its test was cancelled')
      resolve(undefined)
    }
    t.signal.addEventListener('abort', cancel, { once: true })
  })
  // node:test aborts the signal of every test that ends, not only of one its limit cancels: a member that ended first
  // takes the listener with it, so a passing test never reports a cancel.
  const ended = await Promise.race([started.stopped, cancelled])
  t.signal.removeEventListener('abort', cancel)
  return ended
}

function checkoutTests(direnv: Direnv | undefined, which: string, group: DoorGroup): void {
  test(`every planted door runs with the owner's own environment (the control; ${which})`, (t) => {
    const place = fixture(t, direnv)
    const ran = spawnSync('sh', ['-c', asOneScript(group.commands(place, direnv))], { cwd: place.checkout, env: place.owner_env, encoding: 'utf8' })
    assert.equal(ran.status, 0, `the member's commands failed: ${ran.stderr}`)
    assert.deepEqual(
      readdirSync(place.markers).sort(),
      expectedInControl(group, direnv),
      'each door of the group must bite without the launcher, and no other, or the test below proves nothing',
    )
  })

  test(`a member the launcher started runs none of them (${which})`, async (t) => {
    const place = fixture(t, direnv)
    const closed = (name: string): string => {
      const dir = join(place.home, name)
      mkdirSync(dir, { mode: 0o700 })
      return dir
    }
    const member = join(place.home, CLAUDE)
    const run: TheMembersRun = { done: join(place.home, 'done'), empty: join(place.home, 'empty'), steps: join(place.home, 'steps') }
    const commands = group.commands(place, direnv)
    aStandInThatReportsItsStart(place, member, run, commands)
    const how = (ended: StopOf): string => `it ended ${JSON.stringify(ended)}, ${whereTheMemberWas(commands, run.steps)}, and printed: ${whatTheMemberPrinted(place)}`

    const lines: string[] = []
    const relay_root = shortRelayRoot(t)
    const relay_journal = closed('the-relay-journal')
    const started = await launchClaudeCodeMember({
      member_name: 'Mercury',
      node_id: 'ab'.repeat(32),
      place: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [], snapshot_root: closed('snapshots') },
      policy: { may_send_executable_text: [] },
      places: { rows: closed('row-streams'), dashboard: closed('dashboard-rows'), launch_records: closed('launches'), relay_root, mesh_servers: closed('mesh-servers'), relay_journal, state_root: closed('martha-state') },
      command: member,
      args: [],
      ...ownersSettings(place),
      stdio: 'ignore',
      tellOwner: (line) => void lines.push(line),
    })
    assert.equal(started.started, true, lines.join('\n'))
    if (!started.started) return
    const ended = await theEndOrTheCancel(t, started, () => whereTheMemberWas(commands, run.steps))
    if (ended === undefined) return

    assert.equal(existsSync(run.done), true, `the member ran its commands to the end; ${how(ended)}`)
    assert.equal(readFileSync(run.done, 'utf8'), '0', `and every one of them succeeded; ${how(ended)}`)
    // What keeps the test above a race: the launcher met its start gate, and the member ended by itself. A report that
    // stopped reaching the launcher fails here at once, on an idle machine, instead of surfacing only under load.
    const heard = readTheNewestRelayJournal(relay_journal)
    assert.ok(
      heard.events.some((line) => line.event === 'session_started' && line.phase === 'received'),
      `the launcher heard the stand-in's session start; ${how(ended)}`,
    )
    assert.equal(ended.stopped_because, null, `the member ended by itself; ${how(ended)}`)
    assert.deepEqual(readdirSync(place.markers), [], 'no door the checkout planted ran, of this group or any other')

    const [emptyPath, modeAndCount] = readFileSync(run.empty, 'utf8').trimEnd().split('\n')
    assert.equal(basename(emptyPath ?? ''), EMPTY_DIRECTORY_NAME)
    assert.equal(dirname(dirname(emptyPath ?? '')), relay_root, 'inside this launch\'s own relay directory')
    assert.equal(modeAndCount, `${EMPTY_DIRECTORY_MODE.toString(8)} 0`, 'the member saw it empty, mode 0500')
    assert.deepEqual(readdirSync(relay_root), [], 'the empty directory went with the launch')
  })
}
