// What Claude Code's settings files put in every server's environment (martha#65 r=3).

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { CLAUDE_CODE_OWN_VARIABLES, environmentFromSettings, userSettingsPath, USER_SETTINGS_FILE } from './settings_env_reaching_servers.ts'

const ALLOWED = ['HOME', 'PATH', 'MACULA_MESH_REALMS']
const USER = '/owner/.claude/settings.json'
const APPROVED = '/snapshot/.claude/settings.json'
const withEnv = (env: unknown) => JSON.stringify({ env })

test('a settings env name nobody approved is refused, naming the file and the name, beside an allowed one', () => {
  const read = environmentFromSettings([{ path: USER, text: withEnv({ FROM_SETTINGS: 'x', PATH: '/bin' }) }], ALLOWED)
  assert.ok('refusal' in read, JSON.stringify(read))
  assert.ok(read.refusal.includes(USER) && read.refusal.includes('sets FROM_SETTINGS for'), read.refusal)
})

test('the approved --settings copy is read too: a name it sets is refused, naming that file', () => {
  const read = environmentFromSettings([{ path: USER, text: undefined }, { path: APPROVED, text: withEnv({ NODE_OPTIONS: '--require /x' }) }], ALLOWED)
  assert.ok('refusal' in read, JSON.stringify(read))
  assert.ok(read.refusal.includes(APPROVED) && read.refusal.includes('NODE_OPTIONS') && !read.refusal.includes(USER), read.refusal)
})

test("CLAUDE_CODE_PLUGIN_DIRS, Claude Code's own variable, passes so the caller can empty it, not refuse the launch", () => {
  assert.ok(CLAUDE_CODE_OWN_VARIABLES.some((variable) => variable.name === 'CLAUDE_CODE_PLUGIN_DIRS'))
  const read = environmentFromSettings([{ path: USER, text: withEnv({ CLAUDE_CODE_PLUGIN_DIRS: '/plugins' }) }], ALLOWED)
  assert.deepEqual(read, { env: { CLAUDE_CODE_PLUGIN_DIRS: '/plugins' } })
})

test('allowed names pass with their values, and a later file wins, as the host loads them', () => {
  const read = environmentFromSettings(
    [
      { path: USER, text: withEnv({ PATH: '/user', MACULA_MESH_REALMS: 'a' }) },
      { path: APPROVED, text: withEnv({ PATH: '/approved' }) },
    ],
    ALLOWED,
  )
  assert.deepEqual(read, { env: { PATH: '/approved', MACULA_MESH_REALMS: 'a' } })
})

test('no file, a file with no env, and an empty env add nothing', () => {
  assert.deepEqual(environmentFromSettings([{ path: USER, text: undefined }, { path: APPROVED, text: '{}' }], ALLOWED), { env: {} })
  assert.deepEqual(environmentFromSettings([{ path: USER, text: withEnv({}) }], ALLOWED), { env: {} })
})

for (const [shape, text] of [
  ['no JSON', '{ env: '],
  ['no object', '[]'],
  ['an env that is no object', withEnv(['FROM_SETTINGS'])],
  ['a value that is no string', withEnv({ PATH: 1 })],
] as const) {
  test(`a settings file with ${shape} is refused, naming the file: what it gives a server cannot be told`, () => {
    const read = environmentFromSettings([{ path: USER, text }], ALLOWED)
    assert.ok('refusal' in read, JSON.stringify(read))
    assert.ok(read.refusal.includes(USER), read.refusal)
  })
}

test('the user settings file is under CLAUDE_CONFIG_DIR when it is set, else under HOME/.claude', () => {
  assert.deepEqual(userSettingsPath({ HOME: '/owner' }), { path: join('/owner', '.claude', USER_SETTINGS_FILE) })
  assert.deepEqual(userSettingsPath({ HOME: '/owner', CLAUDE_CONFIG_DIR: '/config' }), { path: join('/config', USER_SETTINGS_FILE) })
})

// The launcher and Claude Code must read the same file: an empty or relative
// CLAUDE_CONFIG_DIR could resolve one way here and another way in the host (martha#65 r=4).
for (const [shape, configDir] of [
  ['empty', ''],
  ['relative', 'config'],
  ['relative with a dot', './config'],
] as const) {
  test(`a CLAUDE_CONFIG_DIR that is ${shape} is refused, naming the variable: which settings file the host reads cannot be told`, () => {
    const read = userSettingsPath({ HOME: '/owner', CLAUDE_CONFIG_DIR: configDir })
    assert.ok('refusal' in read, JSON.stringify(read))
    assert.ok(read.refusal.includes('CLAUDE_CONFIG_DIR') && read.refusal.includes(JSON.stringify(configDir)), read.refusal)
  })
}
