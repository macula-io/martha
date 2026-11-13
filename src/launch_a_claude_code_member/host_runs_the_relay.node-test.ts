// The host's answers are read strictly: anything but a report of success refuses (#104).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLAUDE_SERVERS, HOSTS } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import {
  firstValidatorError,
  initQuestionArgs,
  MCP_CONFIG_SWITCH,
  SESSION_INIT_ARGS,
  HOST_TRUST_RECORD_FILE,
  hostTrustsTheFolder,
  hostVersionLine,
  notACommandThisLauncherCanRun,
  refusalToLoadTheRelay,
  resolvedHostCommand,
  versionIn,
} from './host_runs_the_relay.ts'
import { hostAnswers, LOADS_THE_RELAY, refusesTheRelay } from './host_stand_in.ts'
import { removeTheTree } from './relay_copy.ts'

function placeFor(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-host-'))
  t.after(() => removeTheTree(dir))
  return dir
}

function standIn(dir: string, lines: readonly string[], name = 'claude'): string {
  const file = join(dir, name)
  writeFileSync(file, ['#!/bin/sh', ...lines, 'exit 9', ''].join('\n'), { mode: 0o700 })
  return file
}

const RELAY = '/the/relay'

test('the first error is the manifest\'s, then each content file\'s, then the refusal of the whole plugin', () => {
  const with_ = (manifest: string[], contents: string[][], digestRefusal?: string) => ({
    success: false,
    manifest: { errors: manifest.map((message) => ({ message })) },
    contents: contents.map((errors) => ({ errors: errors.map((message) => ({ message })) })),
    ...(digestRefusal === undefined ? {} : { digestRefusal }),
  })
  assert.equal(firstValidatorError(with_(['m1'], [['c1']], 'd')), 'm1')
  assert.equal(firstValidatorError(with_([], [[], ['c2', 'c3']], 'd')), 'c2')
  assert.equal(firstValidatorError(with_([], [], 'd')), 'd')
  assert.equal(firstValidatorError(with_([], [])), undefined)
  assert.equal(firstValidatorError('not a report'), undefined)
})

test('a version is read only from the start of what --version prints', () => {
  assert.equal(versionIn('2.1.319 (Claude Code)\n'), '2.1.319')
  assert.equal(versionIn('2.1.319\n'), '2.1.319')
  assert.equal(versionIn('Claude Code 2.1.319'), undefined)
  assert.equal(versionIn('2.1.3190x'), undefined)
  assert.equal(versionIn(''), undefined)
})

test('a command resolves once, to the file its link names: first runnable on PATH, a path is that path', (t) => {
  const dir = placeFor(t)
  const real = standIn(dir, [], 'real-claude')
  const notRunnable = join(dir, 'a')
  mkdirSync(notRunnable)
  writeFileSync(join(notRunnable, 'claude'), '#!/bin/sh\n', { mode: 0o600 })
  const linked = join(dir, 'b')
  mkdirSync(linked)
  symlinkSync(real, join(linked, 'claude'))
  assert.deepEqual(resolvedHostCommand('claude', `${notRunnable}:${linked}`, dir), { binary: realpathSync(real) })
  assert.deepEqual(resolvedHostCommand('./real-claude', undefined, dir), { binary: realpathSync(real) })
  assert.deepEqual(resolvedHostCommand('claude', notRunnable, dir), { refusal: notACommandThisLauncherCanRun('claude') })
  assert.deepEqual(resolvedHostCommand('claude', undefined, dir), { refusal: notACommandThisLauncherCanRun('claude') })
  assert.deepEqual(resolvedHostCommand(notRunnable, undefined, dir), { refusal: notACommandThisLauncherCanRun(notRunnable) })
})

test('a PATH entry that is empty or relative names a folder under the checkout, and is skipped: a planted claude is never what runs', (t) => {
  const checkout = placeFor(t)
  standIn(checkout, [], 'claude')
  const planted = join(checkout, 'bin')
  mkdirSync(planted)
  standIn(planted, [], 'claude')
  const owners = join(checkout, 'owners')
  mkdirSync(owners)
  const real = standIn(owners, [], 'claude')
  for (const path of ['', ':', '.', 'bin', './bin', `:${owners}`, `.:${owners}`, `bin:${owners}`, `${owners}:`]) {
    const resolved = resolvedHostCommand('claude', path, checkout)
    const expected = path.includes(owners) ? { binary: realpathSync(real) } : { refusal: notACommandThisLauncherCanRun('claude') }
    assert.deepEqual(resolved, expected, `PATH=${JSON.stringify(path)}`)
  }
})

test('only a report of success with exit 0 loads the relay; every other answer refuses, naming the relay', async (t) => {
  const dir = placeFor(t)
  const answer = async (lines: readonly string[]) => refusalToLoadTheRelay(standIn(dir, lines), RELAY, {}, dir)
  assert.equal(await answer(hostAnswers()), undefined)
  const cases: [string, readonly string[], RegExp][] = [
    ['a refusal', hostAnswers({ report: refusesTheRelay('the reason') }), /the reason/],
    ['success with a failing exit', hostAnswers({ report: LOADS_THE_RELAY, reportExit: 1 }), /no reason \(exit 1\)/],
    ['no JSON', hostAnswers({ report: 'nope', reportExit: 0 }), /not the JSON report/],
    ['a failure with no reason', hostAnswers({ report: '{"success":false}' }), /no reason \(exit 1\)/],
    ['a host that dies on a signal', ['kill -s KILL $$'], /ended on SIGKILL/],
  ]
  for (const [what, lines, why] of cases) {
    const refusal = (await answer(lines)) ?? ''
    assert.match(refusal, why, what)
    assert.ok(refusal.includes(RELAY), what)
  }
  assert.match((await refusalToLoadTheRelay(join(dir, 'gone'), RELAY, {}, dir)) ?? '', /could not be run/)
})

test('the version line is told only when the host is not the recorded version, naming both', async (t) => {
  const dir = placeFor(t)
  assert.equal(await hostVersionLine(standIn(dir, hostAnswers()), {}, dir), undefined)
  const other = await hostVersionLine(standIn(dir, hostAnswers({ version: '999.0.0' })), {}, dir)
  assert.ok(other?.includes('999.0.0') && other.includes(RECORDED_HOST.host_version), String(other))
  const silent = await hostVersionLine(standIn(dir, []), {}, dir)
  assert.ok(silent?.includes(RECORDED_HOST.host_version) && silent.includes('does not say'), String(silent))
})

test('the host\'s trust record is read from CLAUDE_CONFIG_DIR before HOME, only when absolute, and not when the host is told to ignore it', (t) => {
  // The host records a folder by its real path; the test's own folder may sit under a link (a linked TMPDIR).
  const folder = realpathSync(placeFor(t))
  const trusting = JSON.stringify({ projects: { [folder]: { hasTrustDialogAccepted: true } } })
  const home = placeFor(t)
  const configDir = placeFor(t)
  writeFileSync(join(home, HOST_TRUST_RECORD_FILE), trusting)
  assert.equal(hostTrustsTheFolder({ HOME: home }, folder, []), true)
  assert.equal(hostTrustsTheFolder({ HOME: home, CLAUDE_CONFIG_DIR: configDir }, folder, []), false, 'CLAUDE_CONFIG_DIR names the record, and it has none')
  writeFileSync(join(configDir, HOST_TRUST_RECORD_FILE), trusting)
  assert.equal(hostTrustsTheFolder({ HOME: placeFor(t), CLAUDE_CONFIG_DIR: configDir }, folder, []), true)
  assert.equal(hostTrustsTheFolder({ HOME: home, CLAUDE_CONFIG_DIR: 'relative' }, folder, []), false)
  const [variable] = CLAUDE_CODE_HOOK_SWITCHES.outside_a_terminal.variables
  assert.ok(variable !== undefined, 'the recording names no variable for the exit')
  assert.equal(hostTrustsTheFolder({ HOME: home, [variable]: '1' }, folder, []), false)
  const linked = join(placeFor(t), 'linked')
  symlinkSync(folder, linked)
  assert.equal(hostTrustsTheFolder({ HOME: home }, linked, []), true, 'the record names the real path')
})

test('an owner who passes the host its ignore-persisted-trust argument is read as a host that trusts no record (r=1 R1)', (t) => {
  // The host's trust predicate is the very function behind the hook exit (`Hde(){return RUo()}`): with that argument
  // among the owner's own, the host reads no trust record, so the member may be asked and keeps the long deadline. The
  // argument and the variable are the recording's, not names typed here.
  const folder = realpathSync(placeFor(t))
  const home = placeFor(t)
  writeFileSync(join(home, HOST_TRUST_RECORD_FILE), JSON.stringify({ projects: { [folder]: { hasTrustDialogAccepted: true } } }))
  const { flags, variables } = CLAUDE_CODE_HOOK_SWITCHES.outside_a_terminal
  const flag = flags[0]
  const variable = variables[0]
  assert.ok(flag !== undefined && variable !== undefined, 'the recording names no way into the exit')
  assert.equal(hostTrustsTheFolder({ HOME: home }, folder, []), true, 'the record trusts the folder and the owner passed nothing')
  assert.equal(hostTrustsTheFolder({ HOME: home }, folder, [flag]), false, 'the owner passed the argument the host reads')
  assert.equal(hostTrustsTheFolder({ HOME: home }, folder, ['--other', flag]), false)
  // The host tests its arguments by exact token, so a longer argument that merely contains it is not the same thing.
  assert.equal(hostTrustsTheFolder({ HOME: home }, folder, [`${flag}=1`]), true)
  assert.equal(hostTrustsTheFolder({ HOME: home }, folder, [`${flag}-and-more`]), true)
  assert.equal(hostTrustsTheFolder({ HOME: home, [variable]: '1' }, folder, []), false, 'the variable the host reads is honoured')
})

// What the question is asked with (martha#154 r=2): the member's own settings, so the `env` block that moves the
// config dir applies, and nothing that starts anything -- no server file, and every hook off.
test('the session-init question is asked with no server file and with hooks off (#154 r=2)', () => {
  const serversSwitch = HOSTS['claude-code'].carried[CLAUDE_SERVERS]
  assert.ok(serversSwitch !== undefined, 'the adapter names the switch that hands the host its server file')
  const launchSwitches = [...HOSTS['claude-code'].project_config_off.args, ...serversSwitch(join(tmpdir(), 'servers.json')).args]
  assert.ok(launchSwitches.includes('--mcp-config'), 'the member itself is started with the servers file')
  const asked = initQuestionArgs(launchSwitches, '/tmp/hooks-off.json')
  assert.deepEqual(asked.filter((arg) => arg.startsWith(MCP_CONFIG_SWITCH)), [], 'no switch that names a server')
  assert.ok(asked.includes('--strict-mcp-config'), 'strict stays, so settings-named servers start nothing either')
  assert.ok(asked.includes('--setting-sources'), 'the settings that may move the config dir are still read')
  assert.deepEqual(asked.slice(asked.indexOf('--settings'), asked.indexOf('--settings') + 2), ['--settings', '/tmp/hooks-off.json'])
  assert.deepEqual(asked.slice(-SESSION_INIT_ARGS.length), [...SESSION_INIT_ARGS])
})
