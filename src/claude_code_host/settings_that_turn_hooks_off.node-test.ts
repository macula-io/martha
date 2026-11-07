// Settings that turn Martha's relay off, as the recorded host reads them (martha#122).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST, CLAUDE_CODE_HOOK_SWITCHES } from './recorded_claude_code_host.ts'
import {
  hookExitCallsIn,
  hookSettingsWatch,
  hookSwitchesOf,
  hookSwitchesSourceIn,
  managedSettingsPlaceIn,
  namesTheOwnersSettings,
  settingsTurningHooksOff,
  type HookSwitches,
} from './settings_that_turn_hooks_off.ts'

const USER = '/owner/.claude/settings.json'
const MANAGED = '/etc/claude-code/managed-settings.json'

/** The host's function as 2.1.318 spells it, the shape the recorder cuts. */
const HOOK_SET_FUNCTION =
  'function r(){let o=Se("policySettings");if(o?.disableAllHooks===!0)return{};if(o?.allowManagedHooksOnly===!0||Yr())return o?.hooks??{};' +
  'if(ad("hooks"))return o?.hooks??{};let t=br();if(t.disableAllHooks===!0){if(!qwr())return o?.hooks??{};return S()}return a(t.hooks??{})}'

/** The two functions 2.1.318's hook-set function calls on its way to a smaller hook set: safe mode, and the policy's strict customization. */
const SAFE_MODE_FUNCTION = 'function Yr(){return Oe(process.env.CLAUDE_CODE_SAFE_MODE)||i("--safe-mode")}'
const STRICT_FUNCTION =
  'function ad(o){let t=Se("policySettings")?.strictPluginOnlyCustomization;if(t===!0)return!0;if(Array.isArray(t))return t.includes(o);return!1}'
/** Host text as the recorder sees it: the functions it needs among others of the same names, as a minified host holds them. */
const HOST_TEXT = `function Yr(e){let n=[];return n}var x=1;${HOOK_SET_FUNCTION}${SAFE_MODE_FUNCTION}function ad(e){return e.restricted?[]:e.paths}${STRICT_FUNCTION}`
const EXIT_CALLS = [SAFE_MODE_FUNCTION, STRICT_FUNCTION]

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-122-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the recorded host turns hooks off by disableAllHooks from any settings file, by allowManagedHooksOnly and strictPluginOnlyCustomization from managed settings, and in safe mode', () => {
  assert.deepEqual(CLAUDE_CODE_HOOK_SWITCHES, {
    managed: ['allowManagedHooksOnly', 'disableAllHooks', 'strictPluginOnlyCustomization'],
    every_source: ['disableAllHooks'],
    safe_mode: { variables: ['CLAUDE_CODE_SAFE_MODE'], flags: ['--safe-mode'] },
  })
  assert.deepEqual(hookSwitchesOf(RECORDED_HOST.hooks_switches, RECORDED_HOST.hooks_switch_calls), CLAUDE_CODE_HOOK_SWITCHES)
})

test('the recorder cuts each function an exit of the hook set calls, by its shape, among others of the same name', () => {
  assert.deepEqual(hookExitCallsIn(HOST_TEXT, HOOK_SET_FUNCTION), EXIT_CALLS)
  assert.deepEqual(hookSwitchesOf(HOOK_SET_FUNCTION, EXIT_CALLS).safe_mode, { variables: ['CLAUDE_CODE_SAFE_MODE'], flags: ['--safe-mode'] })
})

test('an exit of the hook set that calls a function of no known shape fails the recording, naming the call', () => {
  // 2.1.319 adds such an exit; a recording must not pass it in silence.
  const added = HOOK_SET_FUNCTION.replace('if(ad("hooks"))', 'if(a$e())return o?.hooks??{};if(ad("hooks"))')
  const text = `${HOST_TEXT}function a$e(){return Kt("tengu_hooks_off")}`
  assert.throws(() => hookExitCallsIn(text.replace(HOOK_SET_FUNCTION, added), added), /a\$e\(\)/)
  assert.throws(() => hookSwitchesOf(added, EXIT_CALLS), /a\$e\(\)/)
})

test('a hook-set function with a statement of no known shape fails the recording, naming it', () => {
  const added = HOOK_SET_FUNCTION.replace('let t=br();', 'let t=br();q.hooks=null;')
  assert.throws(() => hookExitCallsIn(HOST_TEXT.replace(HOOK_SET_FUNCTION, added), added), /q\.hooks=null/)
  assert.throws(() => hookSwitchesOf(added, EXIT_CALLS), /q\.hooks=null/)
})

test('the recorder cuts the one function that builds the hook set out of the host, whole, by its shape', () => {
  const text = `var x=1;${HOOK_SET_FUNCTION}var f=["userSettings"];function q(){let o=Se("policySettings");return o}`
  assert.equal(hookSwitchesSourceIn(text), HOOK_SET_FUNCTION)
  const renamed = HOOK_SET_FUNCTION.replaceAll('o?.', 'p?.').replace('let o=', 'let p=').replace('function r(', 'function Q(')
  assert.equal(hookSwitchesSourceIn(`;${renamed};`), renamed)
})

test('a host with no such function, or two that differ, is refused: the switches cannot be derived', () => {
  assert.throws(() => hookSwitchesSourceIn('function r(){return{}}'), /No function that builds the hook set/)
  const other = HOOK_SET_FUNCTION.replace('allowManagedHooksOnly', 'onlyManagedHooks')
  assert.throws(() => hookSwitchesSourceIn(`${HOOK_SET_FUNCTION};${other}`), /two different/)
})

test('a recorded function that reads a new key turns that key into a switch, with no list typed here', () => {
  const added = HOOK_SET_FUNCTION.replace('let t=br();', 'let t=br();if(t.noHooksAtAll===!0)return{};')
  // The merged settings the host tests include the managed ones, so a key it reads there is a managed switch too.
  assert.deepEqual(hookSwitchesOf(added, EXIT_CALLS), {
    managed: ['allowManagedHooksOnly', 'disableAllHooks', 'noHooksAtAll', 'strictPluginOnlyCustomization'],
    every_source: ['disableAllHooks', 'noHooksAtAll'],
    safe_mode: { variables: ['CLAUDE_CODE_SAFE_MODE'], flags: ['--safe-mode'] },
  })
  assert.throws(() => hookSwitchesOf('function r(){let o=Se("policySettings");return a(o.hooks??{})}', []), /no settings key/)
  assert.throws(() => hookSwitchesOf('function r(){let t=br();if(t.noHooks===!0)return{};return a(t.hooks??{})}', []), /reads no policy settings/)
})

test('the recorded managed settings place is the folder, file and drop-in folder the host reads on Linux', () => {
  assert.deepEqual(RECORDED_HOST.managed_settings, { dir: '/etc/claude-code', file: 'managed-settings.json', drop_in: 'managed-settings.d' })
  const text =
    'switch(P()){case"macos":return"/Library/Application Support/ClaudeCode";case"windows":return"C:\\\\Program Files\\\\ClaudeCode";default:return"/etc/claude-code"}' +
    'getDropInDir(){return this.dropInDir??=qC(LS(),"managed-settings.d")' +
    'function d6t(){return lie(LS(),"managed-mcp.json")}function jw(){return Ce(LS(),"managed-settings.json")}'
  assert.deepEqual(managedSettingsPlaceIn(text), RECORDED_HOST.managed_settings)
})

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
  const user = join(root, 'settings.json')
  const approved = join(root, 'approved.json')
  const watch = hookSettingsWatch({
    user,
    home: root,
    approved,
    managed: { dir: managedDir, file: 'managed.json', drop_in: 'drop-in' },
    switches: SWITCHES,
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
  const config = join(root, 'config')
  mkdirSync(config)
  const owners = join(config, 'settings.json')
  symlinkSync(config, join(root, 'linked'))
  const cwd = join(root, 'checkout')
  mkdirSync(cwd)
  assert.ok(namesTheOwnersSettings({ file_path: owners }, owners, cwd, root))
  assert.ok(namesTheOwnersSettings({ file_path: join(root, 'linked', 'settings.json') }, owners, cwd, root))
  assert.ok(namesTheOwnersSettings({ notebook_path: join(root, 'linked', 'settings.json') }, owners, cwd, root))
  assert.ok(namesTheOwnersSettings({ file_path: '../config/settings.json' }, owners, cwd, root))
  writeFileSync(owners, '{}')
  symlinkSync(owners, join(cwd, 'innocent.json'))
  assert.ok(namesTheOwnersSettings({ file_path: join(cwd, 'innocent.json') }, owners, cwd, root))
  assert.equal(namesTheOwnersSettings({ file_path: join(config, 'other.json') }, owners, cwd, root), undefined)
  assert.equal(namesTheOwnersSettings({ command: `echo > ${owners}` }, owners, cwd, root), undefined)
})

test("a file tool call naming the owner's file the way the host spells it is named: ~/ against the host's home, and white space around the path", (t) => {
  const root = scratch(t)
  const home = join(root, 'home')
  const owners = join(home, '.claude', 'settings.json')
  mkdirSync(dirname(owners), { recursive: true })
  const cwd = join(root, 'checkout')
  mkdirSync(cwd)
  for (const spelling of ['~/.claude/settings.json', ` ${owners}`, `${owners} `, ` ~/.claude/settings.json\n`]) {
    assert.ok(namesTheOwnersSettings({ file_path: spelling }, owners, cwd, home), JSON.stringify(spelling))
  }
  assert.equal(namesTheOwnersSettings({ file_path: '~/.claude/other.json' }, owners, cwd, home), undefined)
})
