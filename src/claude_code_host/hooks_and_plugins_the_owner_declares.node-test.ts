// Hooks and plugins the owner's user or managed settings declare (martha#121, finding 1).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { hooksAndPluginsDeclaredIn, PLUGIN_DIRS_VARIABLE, pluginDirsIn } from './hooks_and_plugins_the_owner_declares.ts'
import { CLAUDE_CODE_HOOK_SWITCHES } from './recorded_claude_code_host.ts'
import { hookSettingsWatch } from './settings_that_turn_hooks_off.ts'

const USER = '/owner/.claude/settings.json'
const HOOK = { matcher: '', hooks: [{ type: 'command', command: 'echo from-the-owner' }] }
const PLUGIN = 'formatter@tools'
const file = (settings: unknown) => ({ path: USER, text: JSON.stringify(settings), managed: false })

test('a hook declared for any event is refused, naming the file and every event that has one', () => {
  const refusal = hooksAndPluginsDeclaredIn(file({ hooks: { SessionStart: [HOOK], PreToolUse: [HOOK], Stop: [] } }))
  assert.ok(refusal !== undefined && refusal.includes(USER), refusal ?? 'no refusal')
  assert.ok(refusal.includes('SessionStart') && refusal.includes('PreToolUse'), refusal)
  assert.ok(!refusal.includes('Stop'), `an event with no hook is not named: ${refusal}`)
})

test('a plugin enabled by true or by a version constraint is refused, naming the file and the plugin; one set false or null passes', () => {
  for (const value of [true, '^1.0.0', ['1.0.0']]) {
    const refusal = hooksAndPluginsDeclaredIn(file({ enabledPlugins: { [PLUGIN]: value } }))
    assert.ok(refusal?.includes(USER) && refusal.includes(PLUGIN), refusal ?? `no refusal for ${JSON.stringify(value)}`)
  }
  assert.equal(hooksAndPluginsDeclaredIn(file({ enabledPlugins: { [PLUGIN]: false, other: null } })), undefined)
})

test(`a plugin folder in the file's env (${PLUGIN_DIRS_VARIABLE}) is refused, naming the file and the variable; a blank one, which the host skips, passes`, () => {
  const refusal = hooksAndPluginsDeclaredIn(file({ env: { [PLUGIN_DIRS_VARIABLE]: '/somewhere/plugins' } }))
  assert.ok(refusal?.includes(USER) && refusal.includes(PLUGIN_DIRS_VARIABLE), refusal ?? 'no refusal')
  assert.equal(hooksAndPluginsDeclaredIn(file({ env: { [PLUGIN_DIRS_VARIABLE]: '  ' } })), undefined)
})

test('a hooks or enabledPlugins value of no known shape is refused, naming the file and the key', () => {
  for (const [key, value] of [
    ['hooks', 'echo'],
    ['hooks', [HOOK]],
    ['enabledPlugins', [PLUGIN]],
    ['enabledPlugins', PLUGIN],
  ] as const) {
    const refusal = hooksAndPluginsDeclaredIn(file({ [key]: value }))
    assert.ok(refusal?.includes(USER) && refusal.includes(key), refusal ?? `no refusal for ${key}: ${JSON.stringify(value)}`)
  }
})

test('no file, an empty file, empty hooks and plugins, and every other key pass', () => {
  assert.equal(hooksAndPluginsDeclaredIn({ path: USER, text: undefined, managed: false }), undefined)
  for (const settings of [{}, { hooks: {}, enabledPlugins: {} }, { hooks: null, enabledPlugins: null }, { model: 'x', env: { OTHER: '1' } }]) {
    assert.equal(hooksAndPluginsDeclaredIn(file(settings)), undefined, JSON.stringify(settings))
  }
})

test(`${PLUGIN_DIRS_VARIABLE} in the launcher's environment is refused, naming it; a blank one passes`, () => {
  assert.ok(pluginDirsIn({ [PLUGIN_DIRS_VARIABLE]: '/p' })?.includes(PLUGIN_DIRS_VARIABLE))
  assert.equal(pluginDirsIn({ [PLUGIN_DIRS_VARIABLE]: '' }), undefined)
  assert.equal(pluginDirsIn({}), undefined)
})

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-121-owner-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the watch refuses a hook or plugin in the user file, the managed file and a drop-in, never in the approved copy, which carries the relay hooks', (t) => {
  const root = scratch(t)
  const managed = { dir: join(root, 'managed'), file: 'managed.json', drop_in: 'drop-in' }
  mkdirSync(join(managed.dir, managed.drop_in), { recursive: true })
  const user = join(root, 'settings.json')
  const approved = join(root, 'approved.json')
  const watch = hookSettingsWatch({ user, home: root, approved, managed, switches: CLAUDE_CODE_HOOK_SWITCHES })
  const declaring = JSON.stringify({ hooks: { SessionStart: [HOOK] }, enabledPlugins: { [PLUGIN]: true } })

  writeFileSync(approved, declaring)
  writeFileSync(user, '{}')
  assert.equal(watch.check(), undefined)

  for (const path of [user, join(managed.dir, managed.file), join(managed.dir, managed.drop_in, '50-org.json')]) {
    writeFileSync(path, declaring)
    const refusal = watch.check()
    assert.ok(refusal?.includes(path) && refusal.includes('SessionStart') && refusal.includes(PLUGIN), refusal ?? `no refusal for ${path}`)
    writeFileSync(path, '{}')
    assert.equal(watch.check(), undefined)
  }
})
