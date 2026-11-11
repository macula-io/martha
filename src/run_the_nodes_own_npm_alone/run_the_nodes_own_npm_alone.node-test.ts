// npm gets nothing but the registry and the lock it is given (martha#84, design section 2, T15): one red test per
// way the launcher's own environment could reach it, each against a registry that counts what arrived.
//
// The tests that a command-line flag alone could satisfy carry their own control: the same variable is proved live
// by running npm the ordinary way, where it does reach the wrong registry, file or prefix. Without that control a
// test would pass on a machine where the variable never worked, and prove nothing. Every control gets its own cache,
// so a control cannot be answered from what another control fetched.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { fakeNpmRegistry, type FakePackage, type FakeRegistry } from './fake_npm_registry.ts'
import type { Ran } from './run_the_nodes_own_npm_alone.ts'
import { NPM_RUNS_WITH, npmBesideNode, runIsolatedNpm } from './run_the_nodes_own_npm_alone.ts'

const SCOPE = '@martha-npm-isolation'
const SCOPED = `${SCOPE}/fixture`
const VERSION = '1.0.0'
const MARK = 'ran'
const PROJECT = 'project'

/** A package that leaves a mark in its own directory when its postinstall runs. */
const MARKING: FakePackage = {
  name: SCOPED,
  version: VERSION,
  scripts: { postinstall: 'node postinstall.js' },
  files: { 'postinstall.js': `require('node:fs').writeFileSync(require('node:path').join(__dirname, '${MARK}'), 'x')\n` },
}

/** Variables planted for one test that must reach no npm: one for each kind a machine's environment holds. */
const SENTINELS = ['NODE_OPTIONS', 'LD_PRELOAD', 'npm_config_registry', `npm_config_${SCOPE}:registry`, 'npm_config_userconfig', 'npm_config_prefix', 'npm_config_ignore_scripts'] as const

const scratch = (t: TestContext, what: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `martha-npm-alone-${what}-`))
  t.after(() => removeTheTree(dir))
  return dir
}

/** The directory npm is asked to install into: a project of its own, already a package. */
function projectOf(t: TestContext, what: string): string {
  const dir = scratch(t, what)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PROJECT, version: VERSION, private: true }, null, 2))
  return dir
}

/** An npm home of its own: an empty user config, and a cache no other test has written to. */
function npmHomeOf(t: TestContext, what: string): string {
  const home = scratch(t, what)
  mkdirSync(join(home, '.npm'), { recursive: true })
  writeFileSync(join(home, '.npmrc'), '')
  return home
}

/** Sets variables for one test and puts the old values back after it. */
function withEnvironment(t: TestContext, values: Record<string, string>): void {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

/** Two registries: the one an install is given, and one that serves nothing, standing for every other source. */
async function registries(t: TestContext): Promise<{ good: FakeRegistry; evil: FakeRegistry }> {
  const good = await fakeNpmRegistry([MARKING])
  const evil = await fakeNpmRegistry([])
  t.after(() => Promise.all([good.stop(), evil.stop()]))
  return { good, evil }
}

/**
 * npm run the ordinary way, with the test's own environment and a cache of its own: the control that proves the
 * variable under test is live on this machine. Its own words are returned, never asserted on.
 */
function npmTheOrdinaryWay(t: TestContext, dir: string, args: readonly string[], env: NodeJS.ProcessEnv): { readonly status: number | null; readonly said: string } {
  const home = npmHomeOf(t, 'control-home')
  const run = spawnSync(process.execPath, [npmBesideNode(), ...args, `--cache=${join(home, '.npm', 'cache')}`, `--userconfig=${join(home, '.npmrc')}`], {
    cwd: dir,
    env: { ...process.env, ...env, HOME: home },
    encoding: 'utf8',
    timeout: 120_000,
  })
  return { status: run.status, said: `${run.stdout}${run.stderr}` }
}

/** The install that must reach nothing but the registry it is given. */
const isolatedInstall = (dir: string, registry: string, npmHome: string): Ran => runIsolatedNpm(['install', '--no-save', SCOPED], dir, registry, npmHome)

/** Nothing, or why npm could not be run. */
const whyNotRan = (ran: Ran): string => (ran.ran ? '' : ran.why)

test('a module the launcher would preload into npm is not loaded', (t) => {
  const planted = scratch(t, 'preload')
  const ran = join(planted, MARK)
  writeFileSync(join(planted, 'preload.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(ran)}, 'x')\n`)
  withEnvironment(t, { NODE_OPTIONS: `--require ${join(planted, 'preload.cjs')}` })
  // The control: node run the ordinary way does load it, so the plant is live and this check can fail.
  spawnSync(process.execPath, ['-e', ''], { env: { ...process.env }, encoding: 'utf8' })
  assert.ok(existsSync(ran), 'the plant runs when node is started the ordinary way')
  rmSync(ran)
  runIsolatedNpm(['--version'], projectOf(t, 'preload'), 'https://registry.invalid/', npmHomeOf(t, 'preload-home'))
  assert.equal(existsSync(ran), false, 'the plant never runs under npm run alone')
})

test('a registry in the environment, scoped or not, is not the registry npm asks', async (t) => {
  const { good, evil } = await registries(t)
  const dir = projectOf(t, 'registry')
  // The control: npm reads a scoped registry from the environment, and asks it for the package instead.
  const control = npmTheOrdinaryWay(t, dir, ['install', '--no-save', SCOPED], { [`npm_config_${SCOPE}:registry`]: evil.registry })
  assert.notEqual(control.status, 0, control.said)
  assert.ok(evil.requests() > 0, 'the scoped registry in the environment is live: npm asks it')
  const before = evil.requests()
  const ran = isolatedInstall(dir, good.registry, npmHomeOf(t, 'registry-home'))
  assert.ok(ran.ran, whyNotRan(ran))
  assert.equal(evil.requests(), before, 'nothing reached the other registry')
  assert.ok(good.requests() > 0, 'the install came from the registry it was given')
})

test('a user or global config in the environment is never read', async (t) => {
  const { good, evil } = await registries(t)
  const dir = projectOf(t, 'config')
  const planted = join(scratch(t, 'config-rc'), 'npmrc')
  writeFileSync(planted, `registry=${evil.registry}\nproxy=${evil.registry}\n`)
  // The control: with the file named the ordinary way, npm sends its request through it.
  const control = npmTheOrdinaryWay(t, dir, ['install', '--no-save', SCOPED], { npm_config_userconfig: planted, npm_config_globalconfig: planted })
  assert.notEqual(control.status, 0, control.said)
  assert.ok(evil.requests() > 0, 'the planted config is live: npm reads it')
  const before = evil.requests()
  withEnvironment(t, { npm_config_userconfig: planted, npm_config_globalconfig: planted })
  const ran = isolatedInstall(dir, good.registry, npmHomeOf(t, 'config-home'))
  assert.ok(ran.ran, whyNotRan(ran))
  assert.equal(evil.requests(), before, 'the planted config was never read')
})

test('an install script a variable would turn on never runs', async (t) => {
  const { good } = await registries(t)
  const dir = projectOf(t, 'scripts')
  const mark = join(dir, 'node_modules', SCOPED, MARK)
  // The control: npm the ordinary way runs the postinstall once it is allowed to.
  const control = npmTheOrdinaryWay(t, dir, ['install', '--no-save', '--dangerously-allow-all-scripts', `--registry=${good.registry}`, SCOPED], { npm_config_ignore_scripts: 'false' })
  assert.equal(control.status, 0, control.said)
  assert.ok(existsSync(mark), 'the postinstall is live: npm the ordinary way runs it')
  removeTheTree(join(dir, 'node_modules'))
  withEnvironment(t, { npm_config_ignore_scripts: 'false', npm_config_dangerously_allow_all_scripts: 'true' })
  const ran = isolatedInstall(dir, good.registry, npmHomeOf(t, 'scripts-home'))
  assert.ok(ran.ran, whyNotRan(ran))
  assert.equal(existsSync(mark), false, 'the postinstall never ran')
})

test('a prefix in the environment is not where anything is installed', async (t) => {
  const { good } = await registries(t)
  const dir = projectOf(t, 'prefix')
  const prefix = scratch(t, 'prefix')
  const installedUnder = join(prefix, 'lib', 'node_modules', SCOPED)
  // The control: npm the ordinary way installs a global package under the prefix it is given.
  const control = npmTheOrdinaryWay(t, dir, ['install', '-g', '--no-save', `--registry=${good.registry}`, SCOPED], { npm_config_prefix: prefix })
  assert.equal(control.status, 0, control.said)
  assert.ok(existsSync(installedUnder), 'the prefix is live: npm the ordinary way installs under it')
  removeTheTree(join(prefix, 'lib'))
  withEnvironment(t, { npm_config_prefix: prefix })
  const ran = runIsolatedNpm(['install', '-g', '--no-save', SCOPED], dir, good.registry, npmHomeOf(t, 'prefix-home'))
  assert.ok(ran.ran, whyNotRan(ran))
  assert.equal(existsSync(installedUnder), false, 'nothing was installed under the prefix')
})

test('the npm a stand-in reports is handed exactly the names NPM_RUNS_WITH holds, and nothing else', (t) => {
  const dir = projectOf(t, 'environment')
  const said = join(scratch(t, 'environment-out'), 'environment.json')
  const standIn = join(scratch(t, 'stand-in'), 'npm.js')
  writeFileSync(standIn, `require('node:fs').writeFileSync(${JSON.stringify(said)}, JSON.stringify({ args: process.argv.slice(2), env: process.env }))\n`)
  for (const name of SENTINELS) withEnvironment(t, { [name]: 'planted' })
  const ran = runIsolatedNpm(['ci'], dir, 'https://registry.invalid/', npmHomeOf(t, 'environment-home'), standIn)
  assert.ok(ran.ran, whyNotRan(ran))
  const heard = JSON.parse(readFileSync(said, 'utf8')) as { args: string[]; env: Record<string, string> }
  assert.deepEqual(Object.keys(heard.env).sort(), [...NPM_RUNS_WITH].sort(), 'npm was handed exactly the names the allow-list holds')
  for (const name of SENTINELS) assert.ok(!(name in heard.env), `${name} reached npm`)
  assert.deepEqual(heard.args.slice(0, 1), ['ci'], 'the arguments asked for reach npm first')
})
