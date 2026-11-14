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
// machine. Nothing here starts a host: both builders are pure, so this runs in every CI run.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
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
