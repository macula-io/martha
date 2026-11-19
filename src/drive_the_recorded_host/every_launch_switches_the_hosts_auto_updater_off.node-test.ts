// Every launch environment switches the host's auto-updater off, and says which launch lacks it when one does
// (martha#460).
//
// A launch hands the host a home of its own. The host therefore starts with the updater's default, which is on — the
// owner's own `autoUpdates` answer lives in a `~/.claude.json` the run never reads — and a host older than the
// registry's latest updates itself with `npm install --global`, which npm resolves against the NODE prefix. The install
// meant for the run lands on the owner's global Claude Code, with `npm_config_ignore_scripts=true` in the updater's own
// npm environment, so the package's postinstall never runs and the stub is what stays. Measured on the crew host:
// sixteen such installs in half an hour, each one within a second of a launch.
//
// Each host's switch is its own row's `env_last` in HOSTS (martha#474), and these cases call the two builders a host can
// be started with, so a launch path that stops carrying it fails by name here rather than on the owner's machine. One case
// pins the switch to the spelling its host reads, and Claude Code's is the recording's pair, since every other case reads
// the row and so would agree with a misspelt one (martha#637). Two more launches start a host themselves, outside those
// builders — the relay-loads check-bites leg and the dialog-order probe — and they are read here for the same switch
// (martha#460 r=1). Nothing here starts a host: both builders are pure, so this runs in every CI run.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { environmentOf } from './drive_the_recorded_host.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  HOSTS,
  launchEnvironment,
  NO_AUTO_UPDATER,
  theRowOfHost,
  type Host,
  type HostSwitches,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { autoUpdaterSwitchIn } from '../record_claude_code_host/the_auto_updater_switch.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

/** The switches a launch that adds nothing asks for: what the member and probe launches start from. */
const NO_SWITCHES: HostSwitches = { args: [], env: {}, env_dropped: [] }

/** The stand-in's address for a run that never reaches it: nothing listens there, and nothing here connects. */
const AN_ADDRESS_NOTHING_ANSWERS = 'http://127.0.0.1:9'

/** Every host Martha has a launch row for. */
const EVERY_HOST = Object.keys(HOSTS) as Host[]

/** The names and values a host's switch is made of, so a case cannot restate one and drift from the row. */
const theSwitchOf = (host: Host): [string, string][] => Object.entries(theRowOfHost(host).env_last)

/**
 * The hosts whose row turns their updater off with a switch. Every launch case below reads its switch from the row, so a
 * host with none is one whose reason says it needs none (NO_AUTO_UPDATER), and asking it for a switch would be asking
 * it to write one the engine has no use for.
 */
const HOSTS_THAT_SWITCH = EVERY_HOST.filter((host) => theSwitchOf(host).length > 0)

/**
 * Every entry of `host`'s switch is in `environment`, or the message names the launch that starts it without it.
 */
function assertTheUpdaterIsOff(launch: string, environment: Readonly<Record<string, string>>, host: Host = CLAUDE_CODE): void {
  const the_switch = theSwitchOf(host)
  assert.ok(the_switch.length > 0, `${host} has no auto-updater switch in its row's env_last, so a launch of it would update itself`)
  for (const [name, value] of the_switch) {
    assert.equal(
      environment[name],
      value,
      `${launch} starts a host under its own home, so it must switch the host's auto-updater off (${name}=${value}); it starts it without that`,
    )
  }
}

/**
 * A host is either switched or has a written reason, never both and never neither (martha#541's ruling): a switch with
 * no reason to be spared and a reason with a switch beside it are each a row that says two things about one updater.
 * This is the half of the guard a host with no switch is held to, and it names that host when either half is wrong.
 */
test('every host either switches its auto-updater off or says in words why it needs no switch, never both and never neither', () => {
  assert.ok(EVERY_HOST.length > 1, 'there are at least two hosts, or this walk compares nothing')
  for (const host of EVERY_HOST) {
    const switched = theSwitchOf(host).length > 0
    const reason = NO_AUTO_UPDATER[host]
    const both = switched && reason !== undefined
    const neither = !switched && reason === undefined
    assert.equal(both || neither, false, `${host} is ${both ? 'switched in its row and given a reason' : 'given neither a switch nor a reason'}: a host is one or the other`)
    for (const other of Object.keys(NO_AUTO_UPDATER)) assert.ok(EVERY_HOST.includes(other), `NO_AUTO_UPDATER names ${other}, which is no host of HOSTS`)
  }
})

/**
 * The engine's own reason, which is what lets its row hold no switch (martha#541): it names the pinned commit the two
 * readings were taken at and both places in the engine where an update could run, since a reason that names neither is a
 * claim nobody can check.
 */
test('the engine needs no auto-updater switch, and its row says why, naming the pinned engine and both places', () => {
  assert.deepEqual(theSwitchOf(RECORDED_GOOSE_ENGINE.engine_name), [], 'the engine is given a switch it has no use for')
  const reason = NO_AUTO_UPDATER[RECORDED_GOOSE_ENGINE.engine_name] ?? ''
  assert.ok(reason.includes(RECORDED_GOOSE_ENGINE.engine_commit), `the engine's reason does not name the pinned commit ${RECORDED_GOOSE_ENGINE.engine_commit}`)
  for (const place of ['crates/goose-cli/src/cli.rs', 'crates/goose/src/plugins/mod.rs']) {
    assert.ok(reason.includes(place), `the engine's reason does not name ${place}, where an update it has could run`)
  }
})

/** A home of this test's own, removed after it. */
function aHome(t: TestContext): string {
  const home = mkdtempSync(join(tmpdir(), 'martha-460-'))
  t.after(() => removeTheTree(home))
  return home
}

/** A file this user can run, which is what a PATH lookup answers with. */
function aRunnableFile(home: string, name: string): string {
  const path = join(home, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

test('the member and probe launches switch the host auto-updater off', () => {
  for (const host of HOSTS_THAT_SWITCH) {
    assertTheUpdaterIsOff(`the ${host} member and probe launch (launchEnvironment)`, launchEnvironment({ HOME: '/an-owner-home' }, NO_SWITCHES, host), host)
  }
})

// The one place each switch is spelled as its host reads it (martha#474): every other case reads the row, so a
// misspelt name or value there would pass all of them and bring back the install over the owner's own copy.
test("OpenCode's auto-updater switch is spelled as OpenCode reads it", () => {
  assert.deepEqual(theRowOfHost('opencode').env_last, { OPENCODE_DISABLE_AUTOUPDATE: '1' })
})

// Claude Code's switch is not spelled in this repository (martha#637): the row is exactly the pair the recording holds, so
// a re-recording that renames the variable or gives it another value is what every launch below then sets, and a row that
// restated a pair of its own would be one this case names.
test("Claude Code's row carries exactly the auto-updater switch the recording holds", () => {
  const recorded = RECORDED_HOST.auto_updater_switch
  assert.deepEqual(theRowOfHost(CLAUDE_CODE).env_last, { [recorded.variable]: recorded.off_value })
})

/** The variable and the off value a stand-in host is given: this case's own words, not the recording's pair. */
const A_STAND_INS_SWITCH = 'A_STAND_INS_UPDATER_SWITCH'
const A_STAND_INS_OFF = 'stand-in-off'

/**
 * A host's own answer, not a constant in the recorder (martha#637): a stand-in host written in the host's shape, reading a
 * variable and a value of this case's own, is cut to exactly that pair. A recorder that restated the recording's variable
 * or off value instead of reading the host's code would return the recorded pair here, and this pair is not it.
 */
test("the pair a launch sets is the host's own code read, not a constant in the recorder", () => {
  const host = [
    `function aStandInsSwitch(){return aStandInsDecision(aStandInsCheck(process.env.${A_STAND_INS_SWITCH}))}`,
    `function aStandInsDecision(aValue){return aValue?{type:"env",envVar:"${A_STAND_INS_SWITCH}"}:null}`,
    `function aStandInsCheck(aValue){return aValue==="${A_STAND_INS_OFF}"}`,
    `var aChildsEnvironment={${A_STAND_INS_SWITCH}:"${A_STAND_INS_OFF}"}`,
  ].join(';')
  const { auto_updater_switch: cut } = autoUpdaterSwitchIn(host)
  assert.equal(cut.variable, A_STAND_INS_SWITCH)
  assert.equal(cut.off_value, A_STAND_INS_OFF)
  const recorded = RECORDED_HOST.auto_updater_switch
  assert.notDeepEqual({ [cut.variable]: cut.off_value }, { [recorded.variable]: recorded.off_value }, 'the stand-in says its own pair; a case written with the recorded one would pass a recorder that restated it')
})

test('the recorded host run switches the host auto-updater off', (t) => {
  const home = aHome(t)
  const host = aRunnableFile(home, 'the-recorded-host')

  assertTheUpdaterIsOff('the recorded host run (environmentOf)', environmentOf({ claude: host, home }, AN_ADDRESS_NOTHING_ANSWERS, join(home, 'runtime')))
})

test('neither an inherited value nor a switch can turn the updater back on inside a run', () => {
  for (const host of HOSTS_THAT_SWITCH) {
    const only = theSwitchOf(host)[0]
    assert.ok(only !== undefined, `${host}'s switch is at least one variable to turn off`)
    const [name, value] = only
    const foreign = { HOME: '/an-owner-home', [name]: '0' }
    const switched: HostSwitches = { args: [], env: { [name]: '0' }, env_dropped: [] }

    assertTheUpdaterIsOff(`a ${host} launch inheriting an owner who switched it on`, launchEnvironment(foreign, NO_SWITCHES, host), host)
    assertTheUpdaterIsOff(`a ${host} launch whose switches name another value`, launchEnvironment(foreign, switched, host), host)
    assert.equal(launchEnvironment(foreign, switched, host)[name], value, 'the launch decides this, not the owner environment it inherits')
  }
})

// The two launches below start a host themselves rather than through a builder, so no case above can reach them. Each
// is read as committed: the launch must take the switch from the definition and hand it to the host it starts.
const aRunsFile = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

/** The one line of `text` that holds `needle`, or a failure naming the run and the line that is gone. */
function theLineHolding(run: string, text: string, needle: string): string {
  const line = text.split('\n').find((candidate) => candidate.includes(needle))
  assert.ok(line !== undefined, `${run} has no line holding ${needle}: the launch this case reads is gone, so it proves nothing`)
  return line
}

test('the relay-loads check-bites leg switches the host auto-updater off', () => {
  const run = 'the relay-loads check-bites leg (prove_the_relay_loads.sh)'
  const file = aRunsFile('prove_the_relay_loads/prove_the_relay_loads.sh')

  assert.match(
    file,
    /HOSTS\[f\.CLAUDE_CODE\]\.env_last/,
    `${run} starts a host under its own home, so it must take the switch from Claude Code's row's env_last; it does not name the row`,
  )
  const launch = theLineHolding(run, file, 'env -i')
  assert.match(
    launch,
    /"\$\{AUTO_UPDATER_OFF\[@\]\}"/,
    `${run} starts a host under its own home with a bare environment, so its launch must pass the switch the definition names; it starts it without that`,
  )
})

test('the host-drift and local re-record run switches the host auto-updater off', () => {
  const run = 'the host-drift and local re-record run (prove_the_order_of_the_dialogs.mjs)'
  const file = aRunsFile('prove_the_relay_loads/prove_the_order_of_the_dialogs.mjs')

  assert.match(
    file,
    /import\s*\{[^}]*\bHOSTS\b[^}]*\}\s*from\s*'[^']*refuse_launch_of_unapproved_config\.ts'/,
    `${run} starts a host under its own home, so it must take the switch from the HOSTS rows in the launch module; it does not`,
  )
  const launch = theLineHolding(run, file, 'HOME: places.home,')
  assert.match(
    launch,
    /\.\.\.HOSTS\[CLAUDE_CODE\]\.env_last\s*\}/,
    `${run} starts a host under its own home, so its environment must spread the switch last; it starts it without that`,
  )
})
