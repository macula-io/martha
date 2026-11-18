// The launcher of one Goose member: the places it gets, the config root it writes, the environment the
// engine runs in, the engine in a process group of its own, and the permission store checked empty at the
// end (launch_a_goose_member.ts, martha#541 packages 7-8 part A).
//
// Every expectation about the engine here is read from the recording the launcher reads, never typed beside
// it: the extension keys, the mode values and the settings are `RECORDED_GOOSE_ENGINE`'s own. Everything a
// test makes is removed after it.

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  A_LAUNCHS_FOLDERS_MODE,
  THE_EXTENSION_A_MEMBER_KEEPS,
  THE_EXTENSIONS_SETTING,
  THE_MODE_THAT_ASKS_THE_CLIENT,
  THE_MODEL_SETTING,
  THE_PATH_A_LAUNCH_GIVES,
  THE_PROVIDER_SETTING,
  launchTheGooseEngine,
  startTheEngine,
  theConfigFileOf,
  theConfigOfALaunch,
  theEnvironmentOfALaunch,
  thePermissionStoreIsStillEmpty,
  thePermissionStoreOf,
  thePlacesOfALaunch,
} from './launch_a_goose_member.ts'

const FACTS = RECORDED_GOOSE_ENGINE

/** How long a test waits for a stand-in engine to write what it was run with, or for its group to be gone. */
const THE_WAIT_A_TEST_GIVES_MS = 3_000

/** A provider and a model a test names, and one setting of that provider's, so nothing here is the tree's. */
const A_MODEL = { provider: 'a-provider-a-test-names', model: 'a-model-a-test-names', settings: { A_SETTING_A_TEST_NAMES: 'a-value-a-test-names' } }

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

test('the config root names the model, the asking mode and the slash switch, and switches every extension off but the one kept (martha#541)', () => {
  const config = theConfigOfALaunch(FACTS, A_MODEL)

  assert.equal(theValueOf(config, THE_PROVIDER_SETTING), A_MODEL.provider)
  assert.equal(theValueOf(config, THE_MODEL_SETTING), A_MODEL.model)
  assert.equal(theValueOf(config, FACTS.mode.setting), THE_MODE_THAT_ASKS_THE_CLIENT)
  // Slash commands are off, and the setting turns them on: off is `false` whatever the engine's own default
  // is, so both defaults a recording can carry write the same word.
  for (const when_unset of [true, false]) {
    const facts = { ...FACTS, slash_commands: { ...FACTS.slash_commands, when_unset } }
    assert.equal(theValueOf(theConfigOfALaunch(facts, A_MODEL), FACTS.slash_commands.setting), 'false', `with the engine's default ${String(when_unset)}`)
  }
  for (const [key, value] of Object.entries(A_MODEL.settings)) assert.equal(theValueOf(config, key), value)

  // One `enabled` line for every extension the pinned build declares, and true for the kept one alone.
  const lines = config.split('\n')
  assert.deepEqual(
    lines.filter((line) => line.startsWith('  ') && line.trimEnd().endsWith(':')).map((line) => line.trim().slice(0, -1)),
    FACTS.platform_extensions.map((extension) => extension.key),
  )
  for (const extension of FACTS.platform_extensions) {
    const at = lines.indexOf(`  ${extension.key}:`)
    assert.notEqual(at, -1, `the config switches nothing for ${extension.key}`)
    assert.equal(lines[at + 1], `    enabled: ${String(extension.key === THE_EXTENSION_A_MEMBER_KEEPS)}`, `the switch for ${extension.key}`)
  }
})

test('the config root holds no key but the ones the launcher derives: a subagent model cannot be written into it (martha#541)', () => {
  const config = theConfigOfALaunch(FACTS, A_MODEL)
  const derived = [
    THE_PROVIDER_SETTING,
    THE_MODEL_SETTING,
    FACTS.mode.setting,
    FACTS.slash_commands.setting,
    ...Object.keys(A_MODEL.settings),
    THE_EXTENSIONS_SETTING,
  ]
  assert.deepEqual(topLevelKeysOf(config), derived)
})

test('a recording that names neither the mode nor the kept extension refuses instead of writing a switch the engine ignores (martha#541)', () => {
  const noMode = { ...FACTS, mode: { ...FACTS.mode, values: FACTS.mode.values.filter((mode) => mode !== THE_MODE_THAT_ASKS_THE_CLIENT) } }
  assert.throws(() => theConfigOfALaunch(noMode, A_MODEL), new RegExp(THE_MODE_THAT_ASKS_THE_CLIENT))
  const noExtension = { ...FACTS, platform_extensions: FACTS.platform_extensions.filter((extension) => extension.key !== THE_EXTENSION_A_MEMBER_KEEPS) }
  assert.throws(() => theConfigOfALaunch(noExtension, A_MODEL), new RegExp(THE_EXTENSION_A_MEMBER_KEEPS))
})

test('a key that is not a word cannot start a line of the config of its own, and a value cannot carry a line break (martha#541)', () => {
  // A setting's key comes from the member's declaration, and a key holding a colon would write a second one.
  assert.throws(() => theConfigOfALaunch(FACTS, { ...A_MODEL, settings: { 'a key: a value of its own': 'a-value-a-test-names' } }))
  assert.throws(() => theConfigOfALaunch(FACTS, { ...A_MODEL, settings: { A_SETTING_A_TEST_NAMES: 'a value\nwith a line of its own' } }))
})

test('a provider setting under the engine\'s own prefix is refused, so the subagent model cannot be written into the config root (martha#541)', () => {
  // The engine's own settings carry the prefix of the variable that moves its root, and the subagent model
  // and provider are among them: either one written here would move a delegate's model without Martha naming it.
  const enginesOwn = FACTS.path_root_variable.split('_')[0] ?? ''
  assert.throws(
    () => theConfigOfALaunch(FACTS, { ...A_MODEL, settings: { [`${enginesOwn}_A_SETTING_A_TEST_NAMES`]: 'a-value-a-test-names' } }),
    new RegExp(`${enginesOwn}_A_SETTING_A_TEST_NAMES`),
  )
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
  const { root, checkout } = aLaunchRoot(t)
  const refused = await launchTheGooseEngine({ facts: FACTS, binary: join(root, 'not-there'), launch_root: root, checkout, model: A_MODEL })
  assert.ok('refusal' in refused, 'a missing engine binary started a launch')

  const launch = await launchTheGooseEngine({ facts: FACTS, binary: aStandInEngineIn(root), launch_root: root, checkout, model: A_MODEL })
  assert.ok('engine' in launch, 'the launch was refused')
  t.after(() => launch.engine.stop())
  assert.equal(readFileSync(launch.config_at, 'utf8'), theConfigOfALaunch(FACTS, A_MODEL))
  assert.equal(realpathSync(launch.config_at).startsWith(realpathSync(launch.places.root)), true)

  const ended = await launch.end()
  assert.equal(ended.stopped, true)
  assert.deepEqual(ended.permissions, { empty: true })
})

test('a launch whose engine had already ended says it was not stopped, and still reads the store (martha#541)', async (t) => {
  const { root, checkout } = aLaunchRoot(t)
  const briefly = join(root, 'an-engine-that-has-finished')
  writeFileSync(briefly, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  const launch = await launchTheGooseEngine({ facts: FACTS, binary: briefly, launch_root: root, checkout, model: A_MODEL })
  assert.ok('engine' in launch, 'the launch was refused')
  t.after(() => launch.engine.stop())
  await launch.engine.exited

  const ended = await launch.end()
  assert.equal(ended.stopped, false, 'an engine that had already ended was reported as one the launch stopped')
  assert.deepEqual(ended.permissions, { empty: true })
})
