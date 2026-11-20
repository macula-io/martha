// The launcher of one Goose member: the places it gets, the config root it writes, the environment the
// engine runs in, the engine in a process group of its own, and the permission store checked empty at the
// end (launch_a_goose_member.ts, martha#541 packages 7-8 part A).
//
// Every expectation about the engine here is read from the recording the launcher reads, never typed beside
// it: the extension keys, the mode values and the settings are `RECORDED_GOOSE_ENGINE`'s own. Everything a
// test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { AGENTS_MD_FILE, ENGINE_FAMILIES, ENGINE_HINTS_FILE, fingerprintOf, readLaunchState, theTextAStartLoads, type SnapshotPlace } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { theToolServersEntry } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_entry.ts'
import { THE_CREWS_TOOL_SERVER } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_words.ts'
import { LAUNCHER_RECORD_NAME } from '../sweep_leftover_launch_directories/leftover_relay_directories.ts'
import { killGroup } from '../end_a_launch_when_its_run_ends/the_run_lifeline.ts'
import {
  THE_EXTENSION_A_MEMBER_KEEPS,
  THE_EXTENSIONS_SETTING,
  THE_MODE_THAT_ASKS_THE_CLIENT,
  THE_MODEL_SETTING,
  THE_PROVIDER_SETTING,
  theConfigOfALaunch,
} from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import {
  A_LAUNCHS_FOLDERS_MODE,
  THE_PATH_A_LAUNCH_GIVES,
  launchTheGooseEngine,
  startTheEngine,
  theConfigFileOf,
  theSecretsFileOf,
  theEnvironmentOfALaunch,
  thePermissionStoreIsStillEmpty,
  thePermissionStoreOf,
  thePlacesOfALaunch,
} from './launch_a_goose_member.ts'

const FACTS = RECORDED_GOOSE_ENGINE

/** How long a test waits for a stand-in engine to write what it was run with, or for its group to be gone. */
const THE_WAIT_A_TEST_GIVES_MS = 3_000

/** A setting the provider's recording names: the only kind of setting a declaration may carry (martha#797). */
function aRecordedSetting(): string {
  const setting = FACTS.openai_provider.settings.find((one) => !FACTS.openai_provider.secrets.includes(one))
  if (setting === undefined) throw new Error('the recording names no provider setting that is not a secret, so no declaration could carry one')
  return setting
}

/** A secret the provider reads, by its recorded name (#541 package A). */
function aRecordedSecret(): string {
  const secret = FACTS.openai_provider.secrets[0]
  if (secret === undefined) throw new Error('the recording names no secret the provider reads, so no launch could write one')
  return secret
}

/**
 * The provider, one of its settings and a model a test names. The provider and the setting are the recording's
 * own rather than names of the test's: since martha#797 a launch refuses a provider nothing recorded and a
 * setting no recording names, so a made-up one would refuse every launch this file builds.
 */
const A_MODEL = { provider: FACTS.openai_provider.name, model: 'a-model-a-test-names', settings: { [aRecordedSetting()]: 'a-value-a-test-names' }, secrets: { [aRecordedSecret()]: 'a-secret-a-test-names' } }

/** A relay socket and a token a test names: the launch's own would be minted, and nothing here reads either. */
const A_TOOL_SERVER = { socket_path: join(tmpdir(), 'a-relay-a-test-names.sock'), token: 'a-token-a-test-names' }

/** The token a launch's crew tool server carries; its socket is the launch's own. */
const A_TOKEN = { token: A_TOOL_SERVER.token }

/** The relay root a test's launches make their directories in: this user's, 0700, made once. */
/**
 * Each launch root's relay root, made once by `anApprovedLaunch`: a short one (martha#79), because a launch's socket sits
 * in it and a root under the suite's own temporary folder leaves a socket address too long for Linux.
 */
const RELAY_ROOTS = new Map<string, string>()

function aRelayRootIn(root: string): string {
  const relay = RELAY_ROOTS.get(root)
  assert.ok(relay !== undefined, `no relay root was made for ${root}`)
  return relay
}

/** The owner's settings watch of a launch whose test is not about it: the settings hold. */
const THE_OWNERS_SETTINGS_HOLD = (): undefined => undefined

/** The tool server's entry for a launch whose checkout is the temporary folder: the config tests write it, never read it. */
const A_SERVER = { key: THE_CREWS_TOOL_SERVER, entry: theToolServersEntry(FACTS.stdio_extension, { ...A_TOOL_SERVER, checkout: tmpdir() }) }

/** The extension the delegate tool lives in: the one whose being off closes package 6's scope items 2 and 3. */
const SUMMON = 'summon'

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-goose-launch-'))
  t.after(() => removeTheTree(dir))
  return dir
}

/** The launch root a test hands the launcher, and the checkout its member works in. */
function aLaunchRoot(t: TestContext): { readonly root: string; readonly checkout: string } {
  const dir = scratch(t)
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  return { root: dir, checkout }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=martha-test', '-c', 'user.email=martha-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  ).trim()
}

/**
 * A checkout two levels under a home, a git repository with one commit, the folder a launch is made in, and the place
 * the gate decides on. `approved` false hands the gate no approval of that tree.
 */
function anApprovedLaunch(t: TestContext, { approved = true } = {}): { readonly root: string; readonly home: string; readonly checkout: string; readonly place: SnapshotPlace } {
  const home = mkdtempSync(join(tmpdir(), 'martha-goose-c3-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'work', 'checkout')
  mkdirSync(checkout, { recursive: true })
  git(checkout, 'init', '-q', '.')
  writeFileSync(join(checkout, 'README.md'), 'a checkout\n')
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  const root = join(home, 'launch')
  mkdirSync(join(root, 'snapshots'), { recursive: true })
  RELAY_ROOTS.set(root, shortRelayRoot(t))
  t.after(() => RELAY_ROOTS.delete(root))
  const state = readLaunchState({ host: RECORDED_GOOSE_ENGINE.engine_name, launch_dir: checkout, stop_dir: home }, thisMachine)
  const place: SnapshotPlace = {
    host: RECORDED_GOOSE_ENGINE.engine_name,
    launch_dir: checkout,
    stop_dir: home,
    snapshot_root: join(root, 'snapshots'),
    approved_fingerprints: approved ? [fingerprintOf(state)] : [],
  }
  return { root, home, checkout, place }
}

/** The top-level keys of the config text, in the order written: an unindented `key:` starts one. */
function topLevelKeysOf(config: string): string[] {
  return config
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith(' ') && line.includes(':'))
    .map((line) => line.slice(0, line.indexOf(':')))
}

/** A value written in the config text, as the launcher quotes it. */
function theValueOf(config: string, key: string): string | undefined {
  const line = config.split('\n').find((each) => each.startsWith(`${key}:`))
  const written = line?.slice(key.length + 1).trim()
  if (written === undefined) return undefined
  return written.startsWith('"') && written.endsWith('"') ? written.slice(1, -1) : written
}

test('the extension a member keeps and the mode that asks are both ones the recording names (martha#541)', () => {
  assert.ok(
    FACTS.platform_extensions.some((extension) => extension.key === THE_EXTENSION_A_MEMBER_KEEPS),
    `the recording names no platform extension ${THE_EXTENSION_A_MEMBER_KEEPS}, so a launch would switch off the one extension it keeps`,
  )
  assert.ok(
    FACTS.mode.values.includes(THE_MODE_THAT_ASKS_THE_CLIENT),
    `the recording names no mode ${THE_MODE_THAT_ASKS_THE_CLIENT}, so a launch would pin the engine to a mode it does not know`,
  )
})

test('the config root names the model, the asking mode and the slash switch: Summon off, and every built-in but the kept one off, and the crew server on (martha#541)', () => {
  const config = theConfigOfALaunch(FACTS, A_MODEL, A_SERVER)

  assert.equal(theValueOf(config, THE_PROVIDER_SETTING), A_MODEL.provider)
  assert.equal(theValueOf(config, THE_MODEL_SETTING), A_MODEL.model)
  assert.equal(theValueOf(config, FACTS.mode.setting), THE_MODE_THAT_ASKS_THE_CLIENT)
  // Slash commands are off, and the setting turns them on: off is `false` whatever the engine's own default
  // is, so both defaults a recording can carry write the same word.
  for (const when_unset of [true, false]) {
    const facts = { ...FACTS, slash_commands: { ...FACTS.slash_commands, when_unset } }
    assert.equal(theValueOf(theConfigOfALaunch(facts, A_MODEL, A_SERVER), FACTS.slash_commands.setting), 'false', `with the engine's default ${String(when_unset)}`)
  }
  for (const [key, value] of Object.entries(A_MODEL.settings)) assert.equal(theValueOf(config, key), value)

  // One `enabled` line for every extension the pinned build declares, true for the kept one alone, and then
  // the crew's tool server, switched on: the one entry under extensions that is not a platform extension.
  const lines = config.split('\n')
  assert.deepEqual(
    lines.filter((line) => /^ {2}\S/.test(line)).map((line) => line.trim().slice(0, -1)),
    [...FACTS.platform_extensions.map((extension) => extension.key), THE_CREWS_TOOL_SERVER],
  )
  for (const extension of FACTS.platform_extensions) {
    const at = lines.indexOf(`  ${extension.key}:`)
    assert.notEqual(at, -1, `the config switches nothing for ${extension.key}`)
    assert.equal(lines[at + 1], `    enabled: ${String(extension.key === THE_EXTENSION_A_MEMBER_KEEPS)}`, `the switch for ${extension.key}`)
  }
  // Summon by name: the recording must name it, and it is off (package 6, scope items 2 and 3).
  assert.ok(FACTS.platform_extensions.some((extension) => extension.key === SUMMON), `the recording names no ${SUMMON}, so its switch cannot be shown off`)
  assert.equal(lines[lines.indexOf(`  ${SUMMON}:`) + 1], '    enabled: false', `${SUMMON} is on`)
  assert.equal(lines[lines.indexOf(`  ${THE_CREWS_TOOL_SERVER}:`) + 1], '    enabled: true', "the crew's tool server is not switched on")
})

test('the config root holds no key but the ones the launcher derives: a subagent model cannot be written into it (martha#541)', () => {
  const config = theConfigOfALaunch(FACTS, A_MODEL, A_SERVER)
  const derived = [
    THE_PROVIDER_SETTING,
    THE_MODEL_SETTING,
    FACTS.mode.setting,
    FACTS.slash_commands.setting,
    FACTS.telemetry.setting,
    FACTS.skills_advertised.setting,
    FACTS.builtin_skills_advertised.setting,
    FACTS.secret_storage.keyring_switch,
    ...Object.keys(A_MODEL.settings),
    THE_EXTENSIONS_SETTING,
  ]
  assert.deepEqual(topLevelKeysOf(config), derived)
})

test('a recording that names neither the mode nor the kept extension refuses instead of writing a switch the engine ignores (martha#541)', () => {
  const noMode = { ...FACTS, mode: { ...FACTS.mode, values: FACTS.mode.values.filter((mode) => mode !== THE_MODE_THAT_ASKS_THE_CLIENT) } }
  assert.throws(() => theConfigOfALaunch(noMode, A_MODEL, A_SERVER), new RegExp(THE_MODE_THAT_ASKS_THE_CLIENT))
  const noExtension = { ...FACTS, platform_extensions: FACTS.platform_extensions.filter((extension) => extension.key !== THE_EXTENSION_A_MEMBER_KEEPS) }
  assert.throws(() => theConfigOfALaunch(noExtension, A_MODEL, A_SERVER), new RegExp(THE_EXTENSION_A_MEMBER_KEEPS))
})

test('a tool server keyed as a platform extension is refused by name, never written as a second switch for that extension (martha#541 C1)', () => {
  const taken = FACTS.platform_extensions.find((extension) => extension.key !== THE_EXTENSION_A_MEMBER_KEEPS)?.key
  assert.ok(taken !== undefined, 'the recording names no platform extension but the kept one')
  assert.throws(() => theConfigOfALaunch(FACTS, A_MODEL, { ...A_SERVER, key: taken }), new RegExp(`keyed ${taken}, which is a platform extension`))
})

test('a key that is not a word cannot start a line of the config of its own, and a value cannot carry a line break (martha#541)', () => {
  // A setting's key comes from the member's declaration, and a key holding a colon must not start a line. Since
  // #797 such a key is refused as unrecorded before any line is written, so the case's own words hold through
  // the allow-list; the config's word check stays for the keys the launch writes itself, which a model setting
  // can no longer reach.
  assert.throws(
    () => theConfigOfALaunch(FACTS, { ...A_MODEL, settings: { 'a key: a value of its own': 'a-value-a-test-names' } }, A_SERVER),
    (error: unknown) => error instanceof Error && error.message.includes('a key: a value of its own'),
  )
  assert.throws(() => theConfigOfALaunch(FACTS, { ...A_MODEL, settings: { [aRecordedSetting()]: 'a value\nwith a line of its own' } }, A_SERVER), /line break/)
})

test('a provider setting under the engine\'s own prefix is refused, so the subagent model cannot be written into the config root (martha#541)', () => {
  // The engine's own settings carry the prefix of the variable that moves its root, and the subagent model
  // and provider are among them: either one written here would move a delegate's model without Martha naming it.
  // Since #797 the allow-list would refuse this key too, so pinning the key's name alone would leave the prefix
  // check unpinned; what this holds is that the refusal says the true thing about why, which is why it stays.
  const enginesOwn = FACTS.path_root_variable.split('_')[0] ?? ''
  const borrowed = `${enginesOwn}_A_SETTING_A_TEST_NAMES`
  assert.throws(
    () => theConfigOfALaunch(FACTS, { ...A_MODEL, settings: { [borrowed]: 'a-value-a-test-names' } }, A_SERVER),
    (error: unknown) => error instanceof Error && error.message.includes(borrowed) && error.message.includes("carries the engine's own prefix"),
  )
})

test('a declaration naming the setting that replaces the engine\'s hint files is refused by the launch, leaving no root, no home and no snapshot (martha#797)', async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const refused = await launchTheGooseEngine({
    facts: FACTS,
    binary: aStandInEngineIn(root),
    relay_root: aRelayRootIn(root),
    place,
    model: { ...A_MODEL, settings: { [FACTS.hint_files.setting]: `["${FACTS.hint_files.goose_hints}"]` } },
    tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD,
  })
  assert.ok('refusal' in refused, 'a declaration naming the hint-files setting started an engine')
  assert.match(refused.refusal, new RegExp(FACTS.hint_files.setting))
  assert.deepEqual(readdirSync(place.snapshot_root), [], 'a refused launch left a snapshot behind')
  assert.deepEqual(readdirSync(aRelayRootIn(root)), [], 'a refused launch made its root')
  assert.deepEqual(readdirSync(aRelayRootIn(root)), [], 'a refused launch made its home')
})

test('the launch gets a root and a home of its own, made new and 0700, and neither is reused (martha#541)', (t) => {
  const { root, checkout } = aLaunchRoot(t)
  const made = thePlacesOfALaunch(root, checkout)
  assert.ok('places' in made, 'the places were refused')
  assert.equal(existsSync(made.places.root), true)
  assert.equal(existsSync(made.places.home), true)
  assert.notEqual(made.places.root, made.places.home)
  // Only this user may read either one, and nobody may write into one.
  for (const folder of [made.places.root, made.places.home]) assert.equal(statSync(folder).mode & 0o777, A_LAUNCHS_FOLDERS_MODE, `${folder} is not only this user's`)
  const again = thePlacesOfALaunch(root, checkout)
  assert.equal('refusal' in again, true, 'a launch root and home are made new, never reused')

  const missing = join(scratch(t), 'not-there')
  assert.equal('refusal' in thePlacesOfALaunch(missing, checkout), true, 'a launch root that is not there refuses the launch')
})

test('the environment holds the path root, the home and a narrow PATH, and nothing inherited can reach it (martha#541)', (t) => {
  const { root, checkout } = aLaunchRoot(t)
  const made = thePlacesOfALaunch(root, checkout)
  assert.ok('places' in made)
  const environment = theEnvironmentOfALaunch(FACTS, made.places)
  assert.deepEqual(Object.keys(environment).sort(), [FACTS.path_root_variable, 'HOME', 'PATH'].sort())
  assert.equal(environment[FACTS.path_root_variable], made.places.root)
  assert.equal(environment['HOME'], made.places.home)
  assert.equal(environment['PATH'], THE_PATH_A_LAUNCH_GIVES)
})

test('the permission store sits in the engine\'s config folder beside its config file, and is empty only when it holds no saved rule (martha#541)', (t) => {
  const { root, checkout } = aLaunchRoot(t)
  const made = thePlacesOfALaunch(root, checkout)
  assert.ok('places' in made)
  assert.deepEqual(thePermissionStoreIsStillEmpty(made.places.root), { empty: true })
  // The store is found where the engine keeps it, under the same config folder as the config file the
  // launcher writes: a launcher reading a store somewhere else would find nothing and call every launch gated.
  assert.equal(dirname(theConfigFileOf(made.places.root)), dirname(dirname(thePermissionStoreOf(made.places.root))))

  const store = thePermissionStoreOf(made.places.root)
  mkdirSync(dirname(store), { recursive: true })
  // An empty store in the shape the engine writes, and an absent one, are both empty.
  writeFileSync(store, `${JSON.stringify({ permissions: {} })}\n`)
  assert.deepEqual(thePermissionStoreIsStillEmpty(made.places.root), { empty: true })

  writeFileSync(store, `${JSON.stringify({ permissions: { 'a-tool-a-test-names': ['an-answer-a-test-names'] } })}\n`)
  const held = thePermissionStoreIsStillEmpty(made.places.root)
  assert.equal(held.empty, false)
  assert.match(held.empty ? '' : held.refusal, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  // A store in a shape this reader does not know is not read as empty: a rule it failed to see would let
  // a later call skip the gate.
  writeFileSync(store, `${JSON.stringify({ 'a-tool-a-test-names': 'an-answer-a-test-names' })}\n`)
  assert.equal(thePermissionStoreIsStillEmpty(made.places.root).empty, false, 'a store holding something else was read as empty')
  writeFileSync(store, 'a store this test made unreadable\n')
  const unreadable = thePermissionStoreIsStillEmpty(made.places.root)
  assert.equal(unreadable.empty, false, 'a store that cannot be read is not an empty one')
  assert.match(unreadable.empty ? '' : unreadable.refusal, new RegExp(store.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  // A store that is there and cannot be read, and one that is a directory, are not stores this launch never
  // wrote: only a store that is not there is. Both are refused, naming the code that says why.
  writeFileSync(store, `${JSON.stringify({ permissions: {} })}\n`)
  chmodSync(store, 0o000)
  const unreadableFile = thePermissionStoreIsStillEmpty(made.places.root)
  assert.equal(unreadableFile.empty, false, 'a store the user may not read was read as empty')
  assert.match(unreadableFile.empty ? '' : unreadableFile.refusal, /EACCES/)
  rmSync(store)
  mkdirSync(store)
  const aDirectory = thePermissionStoreIsStillEmpty(made.places.root)
  assert.equal(aDirectory.empty, false, 'a directory in the store\'s place was read as empty')
  assert.match(aDirectory.empty ? '' : aDirectory.refusal, /EISDIR/)
})

/**
 * A stand-in engine: it says what it was run with, in files a test reads, and sleeps until it is killed.
 * Each file is written beside its name and moved into place whole, since the reader takes the first text it
 * finds: uutils' `env` (Ubuntu 26.04's) makes one write per line and dash hands it HOME before PATH, so a
 * file read while `env` was still writing it held HOME and no PATH (martha#781).
 */
function aStandInEngineIn(dir: string): string {
  const binary = join(dir, 'a-stand-in-engine')
  const whole = (command: string, name: string): string => {
    const at = join(dir, name)
    return `${command} > '${at}.being-written' && mv '${at}.being-written' '${at}'`
  }
  writeFileSync(
    binary,
    ['#!/bin/sh', whole('pwd', 'the-cwd'), whole(`printf '%s\\n' "$@"`, 'the-arguments'), whole('env', 'the-environment'), 'sleep 30 &', 'sleep 31', ''].join('\n'),
    { mode: 0o700 },
  )
  return binary
}

/** Waits, briefly, for a file the stand-in engine writes, and gives its text. */
async function theFileItWrote(at: string): Promise<string> {
  for (let waited = 0; waited < THE_WAIT_A_TEST_GIVES_MS; waited += 25) {
    if (existsSync(at) && readFileSync(at, 'utf8') !== '') return readFileSync(at, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`the stand-in engine never wrote ${at}`)
}

/** Whether the process group `group` still has anything in it. */
function theGroupIsThere(group: number): boolean {
  try {
    process.kill(-group, 0)
    return true
  } catch {
    return false
  }
}

test('the engine runs in its own process group, with the launch\'s own root, home and nothing else, and the group kill reaches what it started (martha#541)', async (t) => {
  const { root, checkout } = aLaunchRoot(t)
  const made = thePlacesOfALaunch(root, checkout)
  assert.ok('places' in made)
  // A variable this test's own process holds, so an inherited environment would be seen in the child.
  process.env['MARTHA_A_LAUNCH_TEST_ONLY'] = 'a-token-a-test-names'
  t.after(() => delete process.env['MARTHA_A_LAUNCH_TEST_ONLY'])

  const started = await startTheEngine(FACTS, aStandInEngineIn(root), made.places, theEnvironmentOfALaunch(FACTS, made.places))
  assert.ok('pid' in started, 'the engine did not start')
  t.after(() => started.stop())

  assert.deepEqual((await theFileItWrote(join(root, 'the-arguments'))).trim().split('\n'), [FACTS.acp_command])
  assert.equal(realpathSync((await theFileItWrote(join(root, 'the-cwd'))).trim()), realpathSync(checkout))

  const written = await theFileItWrote(join(root, 'the-environment'))
  const environment = Object.fromEntries(
    written.split('\n').filter((line) => line.includes('=')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
  // A red run says what the file held: its size and its names in the order written, which tells a file read
  // half-written from an engine handed less. Never its values: were the environment inherited, they would be
  // the owner's, and no test output carries those (martha#92). So each is compared to a boolean: assert.equal
  // would print both sides, in its diff and as the error's `actual`, whatever message it is given.
  const held = `the engine's environment file held ${Buffer.byteLength(written)} bytes, naming ${JSON.stringify(Object.keys(environment))}`
  assert.ok(environment['HOME'] === made.places.home, `HOME is not the launch's home; ${held}`)
  assert.ok(environment['PATH'] === THE_PATH_A_LAUNCH_GIVES, `PATH is not the one a launch gives; ${held}`)
  assert.ok(environment[FACTS.path_root_variable] === made.places.root, `${FACTS.path_root_variable} is not the launch's root; ${held}`)
  // Whatever prefix the engine's own settings carry, no other variable of the owner's with it reaches the engine.
  const prefix = FACTS.path_root_variable.slice(0, FACTS.path_root_variable.indexOf('_') + 1)
  assert.deepEqual(Object.keys(environment).filter((key) => key.startsWith(prefix)), [FACTS.path_root_variable])
  assert.equal(environment['MARTHA_A_LAUNCH_TEST_ONLY'], undefined, 'an inherited variable reached the engine')

  const ended = started.exited
  started.stop()
  await ended
  for (let waited = 0; waited < THE_WAIT_A_TEST_GIVES_MS && theGroupIsThere(started.pid); waited += 25) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(theGroupIsThere(started.pid), false, 'the engine and the process under it outlived the group kill')
})

test('an environment that hands the engine no PATH, or an empty one, is refused by name (martha#781; mutant: the check removed)', async (t) => {
  const { root, checkout } = aLaunchRoot(t)
  const made = thePlacesOfALaunch(root, checkout)
  assert.ok('places' in made)
  const given = theEnvironmentOfALaunch(FACTS, made.places)
  const withoutPath = Object.fromEntries(Object.entries(given).filter(([key]) => key !== 'PATH'))
  for (const environment of [withoutPath, { ...given, PATH: '' }]) {
    const started = await startTheEngine(FACTS, aStandInEngineIn(root), made.places, environment)
    if ('pid' in started) t.after(() => started.stop())
    assert.ok('refusal' in started, `an environment naming ${JSON.stringify(Object.keys(environment))} started the engine`)
    assert.match(started.refusal, /holds no PATH/)
  }
})

test('one launch writes its root, starts the engine and ends with the permission store still empty; a binary that is not there refuses (martha#541)', async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const refused = await launchTheGooseEngine({ facts: FACTS, binary: join(root, 'not-there'), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('refusal' in refused, 'a missing engine binary started a launch')

  const launch = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('engine' in launch, 'the launch was refused')
  t.after(() => launch.engine.stop())
  assert.equal(readFileSync(launch.config_at, 'utf8'), theConfigOfALaunch(FACTS, A_MODEL, { key: THE_CREWS_TOOL_SERVER, entry: theToolServersEntry(FACTS.stdio_extension, { ...A_TOOL_SERVER, socket_path: launch.socket_path, checkout: launch.places.checkout }) }))
  assert.equal(realpathSync(launch.config_at).startsWith(realpathSync(launch.places.root)), true)

  const ended = await launch.end()
  assert.equal(ended.stopped, true)
  assert.deepEqual(ended.permissions, { empty: true })
})

test('a launch whose engine had already ended says it was not stopped, and still reads the store (martha#541)', async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const briefly = join(root, 'an-engine-that-has-finished')
  writeFileSync(briefly, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const launch = await launchTheGooseEngine({ facts: FACTS, binary: briefly, relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('engine' in launch, 'the launch was refused')
  t.after(() => launch.engine.stop())
  await launch.engine.exited

  const ended = await launch.end()
  assert.equal(ended.stopped, false, 'an engine that had already ended was reported as one the launch stopped')
  assert.deepEqual(ended.permissions, { empty: true })
})

test("the launch records a checkout's own hint files, each with the source it is, and no other file (martha#541)", (t) => {
  const dir = scratch(t)
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  const place = { host: RECORDED_GOOSE_ENGINE.engine_name, launch_dir: checkout, stop_dir: dir }
  assert.deepEqual(theTextAStartLoads(place, thisMachine), [], 'a checkout holding no hint file recorded one')

  writeFileSync(join(checkout, ENGINE_HINTS_FILE), 'a hint\n')
  writeFileSync(join(checkout, AGENTS_MD_FILE), 'an agents file\n')
  writeFileSync(join(checkout, 'README.md'), 'not a hint\n')
  const found = theTextAStartLoads(place, thisMachine)
  // The names are the gate's own constants, read from it and never spelled again here; what this pins is the
  // record: both files found at the checkout, in that order, each with the source it is, and no other file.
  assert.deepEqual(found.map((one) => ({ file: one.file, source: one.source })), [
    { file: ENGINE_HINTS_FILE, source: 'checkout_file' },
    { file: AGENTS_MD_FILE, source: 'checkout_file' },
  ])
  // The record resolves the checkout before it walks it, so the fixture is compared as the record resolves it: CI runs
  // this suite under a TMPDIR reached through a link, where the two spellings differ (martha#743).
  for (const one of found) assert.equal(one.at, join(realpathSync(checkout), one.file), 'the record names a file at a path nobody can point at')
})

test('a hint file above the checkout, up to the git root, is recorded, and one above the git root is not (martha#541)', (t) => {
  const home = scratch(t)
  const repository = join(home, 'a-repository')
  mkdirSync(repository)
  git(repository, 'init', '-q', '.')
  const checkout = join(repository, 'work', 'checkout')
  mkdirSync(checkout, { recursive: true })
  writeFileSync(join(repository, ENGINE_HINTS_FILE), 'a hint above the checkout\n')
  writeFileSync(join(home, ENGINE_HINTS_FILE), 'a hint above the git root\n')
  // The record resolves the checkout before it walks it, so the repository is compared as the record resolves it.
  assert.deepEqual(theTextAStartLoads({ host: RECORDED_GOOSE_ENGINE.engine_name, launch_dir: checkout, stop_dir: home }, thisMachine).map((one) => one.at), [join(realpathSync(repository), ENGINE_HINTS_FILE)])
})

test('a launch on a checkout the owner has not approved is refused before anything is made (martha#541)', async (t) => {
  const { root, place, checkout } = anApprovedLaunch(t, { approved: false })
  // A file the engine starts something from, with no approval of the tree holding it: the gate's own case.
  const [family] = ENGINE_FAMILIES.plugins
  mkdirSync(dirname(join(checkout, family ?? '')), { recursive: true })
  writeFileSync(join(checkout, family ?? ''), 'a plugin the gate reads\n')
  const refused = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('refusal' in refused, 'an unapproved checkout started an engine')
  assert.match(refused.refusal, /approv/i)
  assert.deepEqual(readdirSync(place.snapshot_root), [], 'a refused launch left a snapshot behind')
  assert.deepEqual(readdirSync(aRelayRootIn(root)), [], 'a refused launch made its root')
})

test('a place naming another host is refused, and an approved launch records its hints, each naming the file and the source it is (martha#541)', async (t) => {
  const { root, place, checkout } = anApprovedLaunch(t)
  const wrongHost = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place: { ...place, host: 'opencode' }, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('refusal' in wrongHost, 'a place for another host started the engine')

  writeFileSync(join(checkout, ENGINE_HINTS_FILE), 'a hint\n')
  writeFileSync(join(checkout, AGENTS_MD_FILE), 'an agents file\n')
  const launch = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('engine' in launch, 'the launch was refused')
  t.after(() => launch.engine.stop())
  assert.deepEqual(launch.text_a_start_loads.map((one) => one.file), [ENGINE_HINTS_FILE, AGENTS_MD_FILE])
  const ended = await launch.end()
  assert.equal(ended.stopped, true)
  assert.deepEqual(readdirSync(place.snapshot_root), [], "the gate's snapshot was left behind")
})

/** The engine's mode as the config writes it, and as an edit that keeps every server would change it. */
const THE_MODE_LINE = `${FACTS.mode.setting}: "${THE_MODE_THAT_ASKS_THE_CLIENT}"`

/** A launch whose config root `edit` changes between its write and the engine's start: refused, leaving nothing, starting nothing. */
async function aLaunchOfAnEditedRoot(t: TestContext, edit: (config: string) => string): Promise<string> {
  const { root, place } = anApprovedLaunch(t)
  const refused = await launchTheGooseEngine({
    facts: FACTS,
    binary: aStandInEngineIn(root),
    relay_root: aRelayRootIn(root),
    place,
    model: A_MODEL,
    tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD,
    before_the_start: (config_at) => writeFileSync(config_at, edit(readFileSync(config_at, 'utf8'))),
  })
  if ('engine' in refused) t.after(() => refused.engine.stop())
  assert.ok('refusal' in refused, 'a launch whose config root was edited before the start started the engine')
  assert.deepEqual(readdirSync(place.snapshot_root), [], 'a refused launch left a snapshot behind')
  assert.deepEqual(readdirSync(aRelayRootIn(root)), [], 'a refused launch left its root, and the edited config in it')
  assert.deepEqual(readdirSync(aRelayRootIn(root)), [], 'a refused launch left its home')
  assert.equal(existsSync(join(root, 'the-cwd')), false, 'the stand-in engine ran')
  return refused.refusal
}

test('a launch reads its config root back before the engine starts, and the servers it names, the crew\'s alone, are a fact of the launch (martha#541 C1 R1)', async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const launch = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('engine' in launch, 'the launch was refused')
  t.after(() => launch.engine.stop())
  assert.deepEqual(launch.servers, [THE_CREWS_TOOL_SERVER])
  await launch.end()
})

test('a config root edited between its write and the start to name a second server is refused by that server\'s name (martha#541 C1 R1; mutant: the server check dropped)', async (t) => {
  const aSecond = 'a-second-server-a-test-names'
  const refusal = await aLaunchOfAnEditedRoot(t, (config) => config.replace(`${THE_EXTENSIONS_SETTING}:\n`, `${THE_EXTENSIONS_SETTING}:\n  ${aSecond}:\n    enabled: true\n    cmd: "/bin/sh"\n`))
  assert.ok(refusal.includes(aSecond), `the refusal does not name the second server: ${refusal}`)
  assert.ok(refusal.includes(`${THE_CREWS_TOOL_SERVER} alone`), `the refusal does not say which server a launch starts with: ${refusal}`)
})

test('a config root edited between its write and the start, its servers untouched, is refused as not the text the launch wrote (martha#541 C1 R1; mutant: the bytes check dropped)', async (t) => {
  const refusal = await aLaunchOfAnEditedRoot(t, (config) => {
    assert.ok(config.includes(THE_MODE_LINE), `the config does not write ${THE_MODE_LINE}, so this edit would change nothing`)
    return config.replace(THE_MODE_LINE, `${FACTS.mode.setting}: "${FACTS.mode.when_unset}"`)
  })
  assert.match(refusal, /is not the text this launch wrote/)
})

test('a launch writes the secrets to the recorded file beside its config, 0600, and none of them into the config (#541 package A; mutant: secrets.yaml written 0644)', async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const launch = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('engine' in launch, `the launch was refused: ${'refusal' in launch ? launch.refusal : ''}`)
  t.after(() => launch.engine.stop())
  const at = theSecretsFileOf(FACTS, launch.places.root)
  assert.equal(dirname(at), dirname(launch.config_at), 'the secrets file is not beside the config file')
  assert.equal(statSync(at).mode & 0o777, 0o600, 'the secrets file may be read by someone other than this user')
  const [[secret, value] = ['', '']] = Object.entries(A_MODEL.secrets)
  assert.equal(readFileSync(at, 'utf8'), `${secret}: "${value}"\n`)
  assert.ok(!readFileSync(launch.config_at, 'utf8').includes(value), 'the config holds the secret\'s value')
  await launch.end()
})

/** A launch whose secrets file `change` alters between its write and the engine's start: refused, leaving nothing, starting nothing. */
async function aLaunchOfAChangedSecretsFile(t: TestContext, change: (at: string) => void): Promise<string> {
  const { root, place } = anApprovedLaunch(t)
  const refused = await launchTheGooseEngine({
    facts: FACTS,
    binary: aStandInEngineIn(root),
    relay_root: aRelayRootIn(root),
    place,
    model: A_MODEL,
    tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD,
    before_the_start: (config_at) => change(join(dirname(config_at), FACTS.secret_storage.file)),
  })
  if ('engine' in refused) t.after(() => refused.engine.stop())
  assert.ok('refusal' in refused, 'a launch whose secrets file was changed before the start started the engine')
  assert.deepEqual(readdirSync(aRelayRootIn(root)), [], 'a refused launch left its root, and the secrets in it')
  assert.equal(existsSync(join(root, 'the-cwd')), false, 'the stand-in engine ran')
  return refused.refusal
}

test('a secrets file edited between its write and the start is refused as not the text the launch wrote (#541 package A; mutant: the secrets bytes check dropped)', async (t) => {
  const refusal = await aLaunchOfAChangedSecretsFile(t, (at) => writeFileSync(at, `${readFileSync(at, 'utf8')}${aRecordedSecret()}: "another"\n`))
  assert.match(refusal, /the secrets file at .* is not the text this launch wrote/)
})

test('a secrets file opened to others between its write and the start is refused, never started on (#541 package A; mutant: the secrets mode check dropped)', async (t) => {
  const refusal = await aLaunchOfAChangedSecretsFile(t, (at) => chmodSync(at, 0o644))
  assert.match(refusal, /the secrets file at .* is not a file only this user may read and write/)
})

test("after a result the launch re-checks in order: the owner's settings, the files it wrote, then config/ and .agents/ whole (#541 package A, design G1 row checkTheSettingsStillHold; mutants: a check dropped, the order changed)", async (t) => {
  const { root, place } = anApprovedLaunch(t)
  let owners: string | undefined
  const launch = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: aRelayRootIn(root), place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: () => owners })
  assert.ok('engine' in launch, `the launch was refused: ${'refusal' in launch ? launch.refusal : ''}`)
  t.after(() => launch.engine.stop())
  assert.equal(launch.settings_still_hold(), undefined, 'a root as written holds')
  const config = readFileSync(launch.config_at, 'utf8')
  writeFileSync(launch.config_at, `${config}# a line the launch did not write\n`)
  const agents = join(launch.places.root, '.agents')
  mkdirSync(agents)
  owners = "the owner's settings a test turned off"
  assert.equal(launch.settings_still_hold(), owners, "the owner's settings are checked first")
  owners = undefined
  assert.match(launch.settings_still_hold() ?? '', /is not the text this launch wrote/, 'the files as written are checked before the folders')
  writeFileSync(launch.config_at, config)
  assert.match(launch.settings_still_hold() ?? '', /\.agents was made after the launch wrote its root/)
  rmdirSync(agents)
  assert.equal(launch.settings_still_hold(), undefined, 'a root put back holds again')
  const added = join(dirname(launch.config_at), 'a-file-a-test-adds.yaml')
  writeFileSync(added, 'x')
  assert.ok(launch.settings_still_hold()?.includes(`${added} was added`), 'a file added to config/ is seen')
  await launch.end()
})

test('the launcher is recorded before anything else of the launch is written, the engine once it runs, and the end leaves nothing in the relay root (#541 package A, design G2; mutants: the key written before the record, the engine not recorded, the directory kept)', async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const relay = aRelayRootIn(root)
  let seen: string[] | undefined
  const launch = await launchTheGooseEngine({
    facts: FACTS,
    binary: aStandInEngineIn(root),
    relay_root: relay,
    place,
    model: A_MODEL,
    tool_server: A_TOKEN,
    owners_settings: THE_OWNERS_SETTINGS_HOLD,
    when_the_launcher_is_recorded: (directory) => {
      seen = readdirSync(directory)
    },
  })
  assert.ok('engine' in launch, `the launch was refused: ${'refusal' in launch ? launch.refusal : ''}`)
  t.after(() => launch.engine.stop())
  assert.deepEqual(seen, [LAUNCHER_RECORD_NAME], 'something of the launch was written before its launcher was recorded')
  assert.equal(dirname(launch.directory), relay)
  assert.equal(dirname(launch.socket_path), launch.directory, "the crew's socket is not in the launch's directory")
  const record = JSON.parse(readFileSync(join(launch.directory, LAUNCHER_RECORD_NAME), 'utf8')) as { launcher: { pid: number }; member?: { pid: number } }
  assert.equal(record.launcher.pid, process.pid)
  assert.equal(record.member?.pid, launch.engine.pid, 'the engine is not in the record')
  await launch.end()
  assert.deepEqual(readdirSync(relay), [], "the end left the launch's directory")
})

/** Where a launcher in a child stops and says where it is: before the engine's start, or between its spawn and its record. */
type APause = 'before_the_start' | 'before_the_member_is_recorded'

/**
 * A launcher in a child process of its own, so a test can kill it hard and never the test runner: it launches with the
 * place and binary given, says where it is on its stdout at the pause, and stays there. Killed with its group after
 * the test, whatever is left of it.
 */
function aLauncherInAChild(t: TestContext, root: string, asked: { readonly place: SnapshotPlace; readonly binary: string; readonly relay_root: string }, pause: APause): ChildProcess {
  const here = new URL('.', import.meta.url).pathname
  const script = join(root, 'a-launcher-in-a-child.mts')
  writeFileSync(
    script,
    [
      "import { writeSync } from 'node:fs'",
      `import { launchTheGooseEngine } from ${JSON.stringify(join(here, 'launch_a_goose_member.ts'))}`,
      `import { RECORDED_GOOSE_ENGINE } from ${JSON.stringify(join(here, '..', 'know_the_goose_engines_facts', 'recorded_goose_engine.ts'))}`,
      'const asked = JSON.parse(process.argv[2])',
      'const say = (what: unknown): void => { writeSync(1, `${JSON.stringify(what)}\n`) }',
      'const pauses = {',
      // A synchronous hook holds the launcher where it is by blocking its thread; the async one by never settling.
      "  before_the_start: { before_the_start: (config_at: string) => { say({ config_at }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0) } },",
      '  before_the_member_is_recorded: { before_the_member_is_recorded: (pid: number) => { say({ pid }); return new Promise<void>(() => { setInterval(() => {}, 1 << 30) }) } },',
      '}',
      'await launchTheGooseEngine({ ...asked, facts: RECORDED_GOOSE_ENGINE, owners_settings: () => undefined, ...pauses[process.argv[3] as keyof typeof pauses] })',
      '',
    ].join('\n'),
  )
  // The launcher's own stdin is a pipe whose writer is another process that never writes or ends, not this runner:
  // Node closes its end of a child's stdin pipe when the child exits, so an engine that took the launcher's stdin
  // instead of a pipe of its own would see an end it should not, and pass.
  const writer = spawn('sleep', ['300'], { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
  const child = spawn(process.execPath, [script, JSON.stringify({ ...asked, model: A_MODEL, tool_server: A_TOKEN }), pause], { stdio: [writer.stdout, 'pipe', 'inherit'], detached: true })
  // The launcher holds its own copy of the pipe now; this runner's is closed, so it holds no handle past the test.
  writer.stdout.destroy()
  t.after(async () => {
    await Promise.all(
      [child, writer].map(async (one) => {
        if (one.pid === undefined || one.exitCode !== null || one.signalCode !== null) return
        const gone = new Promise((resolve) => one.once('exit', resolve))
        killGroup(one.pid)
        await gone
      }),
    )
  })
  return child
}

/** The first line a launcher in a child says, parsed; a child that ends or says nothing in time fails the test. */
async function theFirstLineOf(child: ChildProcess): Promise<Record<string, unknown>> {
  let said = ''
  return await new Promise((resolve, reject) => {
    const late = setTimeout(() => reject(new Error(`the launcher in a child said nothing in ${THE_WAIT_A_TEST_GIVES_MS} ms`)), THE_WAIT_A_TEST_GIVES_MS * 3)
    child.stdout?.on('data', (chunk: Buffer) => {
      said += chunk.toString('utf8')
      if (!said.includes('\n')) return
      clearTimeout(late)
      resolve(JSON.parse(said.slice(0, said.indexOf('\n'))) as Record<string, unknown>)
    })
    child.once('exit', (code) => reject(new Error(`the launcher in a child ended (${code}) before it said where it was`)))
  })
}

/** Kills a launcher in a child with SIGKILL, its own process only, and waits until it is gone. */
async function killedHard(child: ChildProcess): Promise<void> {
  const gone = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await gone
}

test("a launcher killed hard after the key is written leaves a directory the next launch's start sweeps, key included (#541 package A, design G2 proof; mutant: no sweep at the start)", async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const relay = aRelayRootIn(root)
  const child = aLauncherInAChild(t, root, { place, binary: aStandInEngineIn(root), relay_root: relay }, 'before_the_start')
  const { config_at } = await theFirstLineOf(child)
  assert.equal(typeof config_at, 'string')
  const [left] = readdirSync(relay)
  assert.ok(left !== undefined, 'the launcher in a child made no directory')
  const directory = join(relay, left)
  const launchRoot = dirname(dirname(String(config_at)))
  assert.ok(existsSync(theSecretsFileOf(FACTS, launchRoot)), 'the key is not written yet, so this proves nothing about it')
  await killedHard(child)
  const next = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), relay_root: relay, place, model: A_MODEL, tool_server: A_TOKEN, owners_settings: THE_OWNERS_SETTINGS_HOLD })
  assert.ok('engine' in next, `the next launch was refused: ${'refusal' in next ? next.refusal : ''}`)
  t.after(() => next.engine.stop())
  assert.equal(existsSync(directory), false, "the next start left the killed launch's directory, and its key")
  await next.end()
})

test("an engine whose launcher is killed between the spawn and the engine's record ends: its stdin closes (#541 package A, design G2 step 2 build claim; mutant: the engine's stdin not the launcher's pipe)", async (t) => {
  const { root, place } = anApprovedLaunch(t)
  const binary = join(root, 'an-engine-that-reads-its-stdin')
  // The engine's ACP server reads its client on stdin; this stand-in does only that, and ends at its end.
  writeFileSync(binary, ['#!/bin/sh', 'cat > /dev/null', ''].join('\n'), { mode: 0o700 })
  const child = aLauncherInAChild(t, root, { place, binary, relay_root: aRelayRootIn(root) }, 'before_the_member_is_recorded')
  const { pid } = await theFirstLineOf(child)
  assert.equal(typeof pid, 'number')
  const engine = Number(pid)
  t.after(() => killGroup(engine))
  assert.ok(theGroupIsThere(engine), 'the engine had ended before its launcher was killed, so this proves nothing')
  await killedHard(child)
  for (let waited = 0; waited < THE_WAIT_A_TEST_GIVES_MS && theGroupIsThere(engine); waited += 25) await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(theGroupIsThere(engine), false, `the engine ${engine} still runs ${THE_WAIT_A_TEST_GIVES_MS} ms after its launcher was killed`)
})
