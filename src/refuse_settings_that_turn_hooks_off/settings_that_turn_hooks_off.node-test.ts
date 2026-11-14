// The refusal of settings that turn Martha's relay off, and the watch that reads
// them for a member's whole life (martha#122, martha#443).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN } from '../claude_code_host/recorded_claude_code_host.ts'
import type { HookSwitches } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CLAUDE_FOLDER, USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { hookSettingsWatch, namesTheOwnersSettings, settingsTurningHooksOff } from './settings_that_turn_hooks_off.ts'

const USER = '/owner/.claude/settings.json'
const MANAGED = '/etc/claude-code/managed-settings.json'

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-122-'))
  t.after(() => removeTheTree(dir))
  return dir
}

const SWITCHES: HookSwitches = CLAUDE_CODE_HOOK_SWITCHES
const file = (path: string, settings: unknown, managed = false) => ({ path, text: JSON.stringify(settings), managed })

for (const key of SWITCHES.every_source) {
  test(`${key} in the owner's user settings is refused, naming the file and the key`, () => {
    const refusal = settingsTurningHooksOff([file(USER, { [key]: true })], SWITCHES)
    assert.ok(refusal?.includes(USER) && refusal.includes(key), refusal ?? 'no refusal')
  })
}

for (const key of SWITCHES.managed) {
  test(`${key} in managed settings is refused, naming the file and the key`, () => {
    const refusal = settingsTurningHooksOff([file(MANAGED, { [key]: true }, true)], SWITCHES)
    assert.ok(refusal?.includes(MANAGED) && refusal.includes(key), refusal ?? 'no refusal')
  })
}

test('a key the host honours only from managed settings passes in the user settings, which the host ignores it in', () => {
  const managedOnly = SWITCHES.managed.filter((key) => !SWITCHES.every_source.includes(key))
  assert.ok(managedOnly.length > 0)
  assert.equal(settingsTurningHooksOff([file(USER, Object.fromEntries(managedOnly.map((key) => [key, true])))], SWITCHES), undefined)
})

test('only false passes: a switch set to a string or a number is refused, since the host reads some of those as on', () => {
  const [key] = SWITCHES.every_source
  assert.ok(key !== undefined)
  assert.equal(settingsTurningHooksOff([file(USER, { [key]: false })], SWITCHES), undefined)
  for (const value of ['true', 1, 'yes']) assert.ok(settingsTurningHooksOff([file(USER, { [key]: value })], SWITCHES)?.includes(key))
})

test("a safe mode variable in a settings file's env is refused whatever its value, naming the file and the variable", () => {
  const [variable] = SWITCHES.safe_mode.variables
  assert.ok(variable !== undefined)
  for (const value of ['1', '0', '']) {
    const refusal = settingsTurningHooksOff([file(USER, { env: { [variable]: value } })], SWITCHES)
    assert.ok(refusal?.includes(USER) && refusal.includes(variable), refusal ?? 'no refusal')
  }
  assert.equal(settingsTurningHooksOff([file(USER, { env: { OTHER: '1' } })], SWITCHES), undefined)
})

test('no file, or a file without a switch, passes; a file that is no JSON object is refused, naming it', () => {
  assert.equal(settingsTurningHooksOff([{ path: USER, text: undefined, managed: false }, file(MANAGED, { hooks: {} }, true)], SWITCHES), undefined)
  for (const text of ['{ "disableAllHooks": ', '[]']) {
    assert.ok(settingsTurningHooksOff([{ path: USER, text, managed: false }], SWITCHES)?.includes(USER))
  }
})

test('the watch reads the user file, the approved copy, the managed file and each .json in the drop-in folder, each time it is asked', (t) => {
  const root = scratch(t)
  const managedDir = join(root, 'managed')
  mkdirSync(join(managedDir, 'drop-in'), { recursive: true })
  const user = join(root, USER_SETTINGS_FILE)
  const approved = join(root, 'approved.json')
  const watch = hookSettingsWatch({
    user,
    home: root,
    approved,
    managed: { dir: managedDir, file: 'managed.json', drop_in: 'drop-in' },
    switches: SWITCHES,
    markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
  })
  assert.equal(watch.check(), undefined)
  const [key] = SWITCHES.every_source
  assert.ok(key !== undefined)
  for (const path of [user, approved, join(managedDir, 'managed.json'), join(managedDir, 'drop-in', '10-org.json')]) {
    writeFileSync(path, JSON.stringify({ [key]: true }))
    const refusal = watch.check()
    assert.ok(refusal?.includes(path) && refusal.includes(key), refusal ?? 'no refusal')
    rmSync(path)
  }
  writeFileSync(join(managedDir, 'drop-in', 'notes.txt'), JSON.stringify({ [key]: true }))
  assert.equal(watch.check(), undefined)
})

test("a file tool call naming the owner's user settings file is named, directly, relatively, and through a link to its folder", (t) => {
  const root = scratch(t)
  const config = join(root, 'conf-dir')
  mkdirSync(config)
  const owners = join(config, USER_SETTINGS_FILE)
  symlinkSync(config, join(root, 'linked'))
  const cwd = join(root, 'checkout')
  mkdirSync(cwd)
  assert.ok(namesTheOwnersSettings({ file_path: owners }, owners, cwd, root))
  assert.ok(namesTheOwnersSettings({ file_path: join(root, 'linked', USER_SETTINGS_FILE) }, owners, cwd, root))
  assert.ok(namesTheOwnersSettings({ notebook_path: join(root, 'linked', USER_SETTINGS_FILE) }, owners, cwd, root))
  assert.ok(namesTheOwnersSettings({ file_path: '../conf-dir/settings.json' }, owners, cwd, root))
  writeFileSync(owners, '{}')
  symlinkSync(owners, join(cwd, 'innocent.json'))
  assert.ok(namesTheOwnersSettings({ file_path: join(cwd, 'innocent.json') }, owners, cwd, root))
  assert.equal(namesTheOwnersSettings({ file_path: join(config, 'other.json') }, owners, cwd, root), undefined)
  assert.equal(namesTheOwnersSettings({ command: `echo > ${owners}` }, owners, cwd, root), undefined)
})

test("a file tool call naming the owner's file the way the host spells it is named: ~/ against the host's home, and white space around the path", (t) => {
  const root = scratch(t)
  const home = join(root, 'home')
  const owners = join(home, CLAUDE_FOLDER, USER_SETTINGS_FILE)
  mkdirSync(dirname(owners), { recursive: true })
  const cwd = join(root, 'checkout')
  mkdirSync(cwd)
  for (const spelling of ['~/.claude/settings.json', ` ${owners}`, `${owners} `, ` ~/.claude/settings.json\n`]) {
    assert.ok(namesTheOwnersSettings({ file_path: spelling }, owners, cwd, home), JSON.stringify(spelling))
  }
  assert.equal(namesTheOwnersSettings({ file_path: '~/.claude/other.json' }, owners, cwd, home), undefined)
})
