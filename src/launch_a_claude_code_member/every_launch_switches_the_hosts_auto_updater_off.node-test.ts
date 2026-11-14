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
// The switch is one definition (`THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF`), and these cases call the two builders
// a host can be started with, so a launch path that stops carrying it fails by name here rather than on the owner's
// machine. Two more launches start a host themselves, outside those builders — the relay-loads check-bites leg and the
// dialog-order probe — and they are read here for the same switch (martha#460 r=1). Nothing here starts a host: both
// builders are pure, so this runs in every CI run.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { environmentOf } from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'
import {
  launchEnvironment,
  THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF,
  type HostSwitches,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** The switches a launch that adds nothing asks for: what the member and probe launches start from. */
const NO_SWITCHES: HostSwitches = { args: [], env: {}, env_dropped: [] }

/** The stand-in's address for a run that never reaches it: nothing listens there, and nothing here connects. */
const AN_ADDRESS_NOTHING_ANSWERS = 'http://127.0.0.1:9'

/** The names and values the switch is made of, so a case cannot restate one and drift from the definition. */
const THE_SWITCH = Object.entries(THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF)

/** Every entry of the definition is in `environment`, or the message names the launch that starts a host without it. */
function assertTheUpdaterIsOff(launch: string, environment: Readonly<Record<string, string>>): void {
  for (const [name, value] of THE_SWITCH) {
    assert.equal(
      environment[name],
      value,
      `${launch} starts a host under its own home, so it must switch the host's auto-updater off (${name}=${value}); it starts it without that`,
    )
  }
}

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
  assertTheUpdaterIsOff('the member and probe launch (launchEnvironment)', launchEnvironment({ HOME: '/an-owner-home' }, NO_SWITCHES))
})

test('the recorded host run switches the host auto-updater off', (t) => {
  const home = aHome(t)
  const host = aRunnableFile(home, 'the-recorded-host')

  assertTheUpdaterIsOff('the recorded host run (environmentOf)', environmentOf({ claude: host, home }, AN_ADDRESS_NOTHING_ANSWERS, join(home, 'runtime')))
})

test('neither an inherited value nor a switch can turn the updater back on inside a run', () => {
  const only = THE_SWITCH[0]
  assert.ok(only !== undefined, 'the switch is at least one variable to turn off')
  const [name, value] = only
  const foreign = { HOME: '/an-owner-home', [name]: '0' }
  const switched: HostSwitches = { args: [], env: { [name]: '0' }, env_dropped: [] }

  assertTheUpdaterIsOff('a launch inheriting an owner who switched it on', launchEnvironment(foreign, NO_SWITCHES))
  assertTheUpdaterIsOff('a launch whose switches name another value', launchEnvironment(foreign, switched))
  assert.equal(launchEnvironment(foreign, switched)[name], value, 'the launch decides this, not the owner environment it inherits')
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
    /THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF/,
    `${run} starts a host under its own home, so it must take the switch from THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF; it does not name the definition`,
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
    /import\s*\{[^}]*THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF[^}]*\}\s*from\s*'[^']*refuse_launch_of_unapproved_config\.ts'/,
    `${run} starts a host under its own home, so it must take the switch from THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF in the launch module; it does not`,
  )
  const launch = theLineHolding(run, file, 'HOME: places.home,')
  assert.match(
    launch,
    /\.\.\.THE_LAUNCHED_HOSTS_AUTO_UPDATER_SWITCHED_OFF\s*\}/,
    `${run} starts a host under its own home, so its environment must spread the switch last; it starts it without that`,
  )
})
