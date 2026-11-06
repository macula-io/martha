// A member the launcher starts runs none of the code a checkout planted for its
// ordinary commands (martha#24, option 3): its git hooks, its npm install
// scripts, the program its .npmrc names as git, and its .envrc
// (../refuse_code_a_checkout_runs_itself).
//
// Each planted file only writes a marker. The same member commands run twice on
// two fresh copies of the same checkout: once with the owner's environment as
// the launcher inherits it (the control: every marker must appear, or the plant
// proves nothing), and once as a member the launcher started (no marker may
// appear). The owner's environment here is a hostile one: it already tries to
// switch each door back on, so the launcher's settings must win over it.
//
// Real git, real npm and real direnv. The .envrc door follows the tool: each
// direnv the tests prove (direnvs_under_test.ts)
// gets its own pair of tests, and with none installed the door is left out by
// name. CI names two direnvs, so there it is never left out. Everything a test
// makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { direnvsUnderTest, type Direnv } from './direnvs_under_test.ts'
import { DIRENV_CONFIG_VARIABLE } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { EMPTY_DIRECTORY_MODE } from './empty_directory.ts'
import { CLAUDE_CODE, EMPTY_DIRECTORY_NAME, launchClaudeCodeMember } from './launch_a_claude_code_member.ts'
import { shortRelayRoot } from './short_relay_root.ts'

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
  /** What a member types, as one sh script. */
  readonly member_commands: string
}

function fixture(t: TestContext, direnv: Direnv | undefined): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'martha-checkout-runs-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const markers = join(home, 'markers')
  mkdirSync(markers)
  const marker = (door: Door): string => join(markers, door)

  const repo = (dir: string): void => {
    mkdirSync(dir)
    git(dir, 'init', '-q', '.')
    git(dir, 'config', 'user.name', 'martha-test')
    git(dir, 'config', 'user.email', 'martha-test@example.invalid')
    git(dir, 'config', 'commit.gpgsign', 'false')
  }

  // A git dependency, so that npm install runs git.
  const dependency = join(home, 'dependency')
  repo(dependency)
  writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'dependency', version: '1.0.0' }))
  git(dependency, 'add', '--all')
  git(dependency, 'commit', '-q', '-m', 'a dependency')

  // The checkout: what its author ships, then what something on this machine
  // left in its .git (a hook, two config entries), which a clone never carries.
  // The program its .npmrc names as git writes its marker, then hands over to
  // the real git, so the install succeeds whichever git npm ran.
  const checkout = join(home, 'checkout')
  repo(checkout)
  writeFileSync(
    join(checkout, 'package.json'),
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

  const husky = join(home, 'husky')
  repo(husky)
  mkdirSync(join(husky, '.husky'))
  script(join(husky, '.husky', 'pre-commit'), marker('hooks_path'))
  git(husky, 'add', '--all')
  git(husky, 'commit', '-q', '--no-verify', '-m', 'the author\'s hooks')
  git(husky, 'config', 'core.hooksPath', '.husky')

  // The owner's direnv trusts everything under the home, and every switch the
  // launcher sets is already set the other way. Its own command-scope git
  // settings name the same fsmonitor as the checkout's config, so ours must
  // come after the owner's to win.
  const direnv_config = join(home, 'direnv-config')
  mkdirSync(direnv_config)
  writeFileSync(join(direnv_config, 'direnv.toml'), `[whitelist]\nprefix = [${JSON.stringify(home)}]\n`)
  const owner_env = {
    ...process.env,
    PATH: direnv === undefined ? process.env.PATH : `${dirname(direnv.path)}${delimiter}${process.env.PATH ?? ''}`,
    DIRENV_CONFIG: direnv_config,
    DIRENV_DISABLE: '0',
    XDG_DATA_HOME: join(home, 'xdg-data'),
    npm_config_ignore_scripts: 'false',
    NPM_CONFIG_IGNORE_SCRIPTS: 'false',
    npm_config_git: './npm-git',
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='" + join(checkout, '.git', 'fsmonitor') + "'",
  }

  const member_commands = [
    'set -eu',
    `cd '${checkout}'`,
    'git commit -q --allow-empty -m "a member commits"',
    'git status --porcelain > /dev/null',
    'npm install --offline --no-audit --no-fund > /dev/null 2>&1',
    'test -e node_modules/dependency/package.json',
    // What direnv's shell hook runs on entering a directory, as a command of its
    // own so a missing direnv fails here. A blocked .envrc is direnv's answer to
    // an .envrc it was not told to trust: it exits 1 and says so.
    ...(direnv === undefined
      ? []
      : [
          `direnv export bash > '${home}/direnv.out' 2> '${home}/direnv.err' || grep -q 'is blocked' '${home}/direnv.err'`,
          `bash -c ". '${home}/direnv.out'"`,
        ]),
    `cd '${husky}'`,
    'git commit -q --allow-empty -m "a member commits"',
    '',
  ].join('\n')

  return { home, checkout, husky, markers, owner_env, member_commands }
}

const expectedInControl = (direnv: Direnv | undefined): Door[] =>
  (Object.keys(DOORS) as Door[])
    .filter((door) => door !== 'config_hook' || gitRunsConfigHooks())
    .filter((door) => door !== 'envrc' || direnv !== undefined)
    .sort()

const { direnvs } = direnvsUnderTest(process.env)

for (const direnv of direnvs.length === 0 ? [undefined] : direnvs) {
  const which = direnv === undefined ? 'no direnv installed, so no .envrc door' : `direnv ${direnv.version}`
  checkoutTests(direnv, which)
}

function checkoutTests(direnv: Direnv | undefined, which: string): void {
  test(`every planted door runs with the owner's own environment (the control; ${which})`, (t) => {
    const place = fixture(t, direnv)
    const ran = spawnSync('sh', ['-c', place.member_commands], { cwd: place.checkout, env: place.owner_env, encoding: 'utf8' })
    assert.equal(ran.status, 0, `the member's commands failed: ${ran.stderr}`)
    assert.deepEqual(
      readdirSync(place.markers).sort(),
      expectedInControl(direnv),
      'each door must bite without the launcher, or the test below proves nothing',
    )
  })

  test(`a member the launcher started runs none of them (${which})`, async (t) => {
    const place = fixture(t, direnv)
    const closed = (name: string): string => {
      const dir = join(place.home, name)
      mkdirSync(dir, { mode: 0o700 })
      return dir
    }
    const member = join(place.home, 'claude')
    const done = join(place.home, 'done')
    const empty = join(place.home, 'empty')
    writeFileSync(
      member,
      [
        '#!/bin/sh',
        `printf '%s\\n%s\\n' "$${DIRENV_CONFIG_VARIABLE}" "$(stat -c %a "$${DIRENV_CONFIG_VARIABLE}") $(ls -A "$${DIRENV_CONFIG_VARIABLE}" | wc -l)" > '${empty}'`,
        `${place.member_commands}status=$?`,
        `printf '%s' "$status" > '${done}'`,
        '',
      ].join('\n'),
    )
    chmodSync(member, 0o700)

    const lines: string[] = []
    const started = await launchClaudeCodeMember({
      member_name: 'Mercury',
      node_id: 'ab'.repeat(32),
      place: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [], snapshot_root: closed('snapshots') },
      policy: { may_send_executable_text: [] },
      places: { rows: closed('rows'), launch_records: closed('launches'), relay_root: shortRelayRoot(t), mesh_servers: closed('mesh-servers') },
      command: member,
      args: [],
      inherited: place.owner_env,
      stdio: 'ignore',
      tellOwner: (line) => void lines.push(line),
    })
    assert.equal(started.started, true, lines.join('\n'))
    if (!started.started) return
    await started.stopped

    assert.equal(existsSync(done), true, 'the member ran its commands to the end')
    assert.equal(readFileSync(done, 'utf8'), '0', 'and every one of them succeeded')
    assert.deepEqual(readdirSync(place.markers), [], 'no door the checkout planted ran')

    const [emptyPath, modeAndCount] = readFileSync(empty, 'utf8').trimEnd().split('\n')
    assert.equal(basename(emptyPath ?? ''), EMPTY_DIRECTORY_NAME)
    assert.equal(dirname(dirname(emptyPath ?? '')), join(place.home, 'relay'), 'inside this launch\'s own relay directory')
    assert.equal(modeAndCount, `${EMPTY_DIRECTORY_MODE.toString(8)} 0`, 'the member saw it empty, mode 0500')
    assert.deepEqual(readdirSync(join(place.home, 'relay')), [], 'the empty directory went with the launch')
  })
}
