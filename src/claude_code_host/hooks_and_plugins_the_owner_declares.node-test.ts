// Hooks and plugins the owner's user or managed settings declare (martha#121, finding 1).

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { HOOKS_SPELLINGS, hooksAndPluginsDeclaredIn, hooksInFrontmatterOf, PLUGIN_DIRS_VARIABLE, pluginDirsIn } from './hooks_and_plugins_the_owner_declares.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN } from './recorded_claude_code_host.ts'
import { hookSettingsWatch, markdownFolders } from './settings_that_turn_hooks_off.ts'

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
  const watch = hookSettingsWatch({ user, home: root, approved, managed, switches: CLAUDE_CODE_HOOK_SWITCHES, markdown: CLAUDE_CODE_OWNERS_MARKDOWN })
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

// --- hooks in an agent's, a skill's or a command's frontmatter (martha#146) ---

const AGENT_FILE = '/owner/.claude/agents/helper.md'
const PATTERN = CLAUDE_CODE_OWNERS_MARKDOWN.frontmatter_pattern
const md = (text: string) => ({ path: AGENT_FILE, text, managed: false })
const withFrontmatter = (frontmatter: string) => `---\nname: helper\n${frontmatter}\n---\nBody.\n`

/** Each spelling, as a frontmatter only that one rule catches; every rule has exactly one. */
const ONLY_BY: Readonly<Record<string, string>> = {
  'the key hooks': 'hooks: {}',
  'a backslash, which can spell any key': '"hoo\\x6bs": {}',
  'an explicit key (?)': '? name2\n: x',
  'a merge key (<<)': '<<: {}',
  'an alias used as a key': 'a: &k other\n*k : {}',
}

test('every spelling rule has a frontmatter only it catches, and the refusal names that rule alone, with the file', () => {
  assert.deepEqual(Object.keys(ONLY_BY).sort(), HOOKS_SPELLINGS.map(({ rule }) => rule).sort())
  for (const [rule, frontmatter] of Object.entries(ONLY_BY)) {
    const refusal = hooksInFrontmatterOf(md(withFrontmatter(frontmatter)), PATTERN)
    const named = HOOKS_SPELLINGS.filter((one) => refusal?.includes(one.rule)).map((one) => one.rule)
    assert.deepEqual(named, [rule], `${rule}: ${refusal ?? 'no refusal'}`)
    assert.ok(refusal?.includes(AGENT_FILE), refusal ?? 'no refusal')
  }
})

test('the key hooks is refused however YAML writes it, a verbatim tag and githooks included', () => {
  for (const frontmatter of [
    'hooks:\n  PreToolUse: []',
    '"hooks": {}',
    "'hooks': {}",
    'meta: {a: 1, hooks: {}}',
    '!!str hooks: {}',
    '!<tag:yaml.org,2002:str>"hooks": {PreToolUse: []}',
    '"hooks"\n  : {}',
    '  hooks :\n',
    'githooks: x',
    '"hoo\\u006bs": {}',
    '? hooks\n: {}',
    '<<: *base',
    'a: &k hooks\n*k: {}',
  ]) {
    assert.ok(hooksInFrontmatterOf(md(withFrontmatter(frontmatter)), PATTERN)?.includes(AGENT_FILE), `not refused: ${frontmatter}`)
  }
})

test("the frontmatter opens where the host's recorded pattern opens it: trailing spaces, CRLF, a byte-order mark, a blank line, a lone return", () => {
  for (const [variant, text] of [
    ['trailing spaces', '---   \nhooks: {}\n---\n'],
    ['CRLF', '---\r\nname: a\r\nhooks: {}\r\n---\r\nBody.\r\n'],
    ['byte-order mark', '﻿---\nhooks: {}\n---\n'],
    ['blank line after the opening', '---\n\nhooks: {}\n---\n'],
    ['a lone return before the newline', '---\r \nhooks: {}\n---\n'],
  ]) {
    assert.ok(hooksInFrontmatterOf(md(text ?? ''), PATTERN)?.includes(AGENT_FILE), `${variant ?? ''}: not refused`)
  }
})

test('a frontmatter that opens and never closes is refused as cannot-be-told; a file with no frontmatter, or one with no spelling, passes', () => {
  const unclosed = hooksInFrontmatterOf(md('---\nname: helper\nBody with no close.\n'), PATTERN)
  assert.ok(unclosed?.includes(AGENT_FILE) && unclosed.includes('never closes'), unclosed ?? 'no refusal')
  assert.equal(hooksInFrontmatterOf(md('# Helper\n\nhooks: {} in the body is no frontmatter.\n'), PATTERN), undefined)
  assert.equal(hooksInFrontmatterOf(md(' ---\nhooks: {}\n---\n'), PATTERN), undefined)
  assert.equal(hooksInFrontmatterOf(md(withFrontmatter('description: checks the git hooks folder')), PATTERN), undefined)
  assert.equal(hooksInFrontmatterOf({ path: AGENT_FILE, text: undefined, managed: false }, PATTERN), undefined)
})

const HOOKED = withFrontmatter('hooks:\n  PreToolUse: []')

test('the watch refuses a hooked agent, skill or command in each user and managed folder the host loads, a synced skill included, and lets it go once removed', (t) => {
  const root = scratch(t)
  const managed = { dir: join(root, 'managed'), file: 'managed.json', drop_in: 'drop-in' }
  const user = join(root, 'config', 'settings.json')
  const watch = hookSettingsWatch({ user, home: root, approved: undefined, managed, switches: CLAUDE_CODE_HOOK_SWITCHES, markdown: CLAUDE_CODE_OWNERS_MARKDOWN })
  const folders = markdownFolders(user, managed, CLAUDE_CODE_OWNERS_MARKDOWN.kinds)
  assert.equal(folders.length, 2 * CLAUDE_CODE_OWNERS_MARKDOWN.kinds.length)
  assert.equal(watch.check(), undefined)
  for (const folder of folders) {
    for (const path of [join(folder, 'helper.md'), join(folder, 'synced', 'id-1', 'deep', 'SKILL.md')]) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, HOOKED)
      const refusal = watch.check()
      assert.ok(refusal?.includes(path), `${path}: ${refusal ?? 'no refusal'}`)
      rmSync(path)
      assert.equal(watch.check(), undefined, path)
    }
  }
})

test('the watch follows a link to a folder, reads only .md files, and refuses a folder it cannot read', (t) => {
  const root = scratch(t)
  const managed = { dir: join(root, 'managed'), file: 'managed.json', drop_in: 'drop-in' }
  const user = join(root, 'config', 'settings.json')
  const watch = hookSettingsWatch({ user, home: root, approved: undefined, managed, switches: CLAUDE_CODE_HOOK_SWITCHES, markdown: CLAUDE_CODE_OWNERS_MARKDOWN })
  const [agents] = markdownFolders(user, managed, CLAUDE_CODE_OWNERS_MARKDOWN.kinds)
  assert.ok(agents !== undefined)
  const elsewhere = join(root, 'elsewhere')
  mkdirSync(elsewhere)
  mkdirSync(agents, { recursive: true })
  symlinkSync(elsewhere, join(agents, 'linked'))
  symlinkSync(agents, join(elsewhere, 'back'))
  writeFileSync(join(elsewhere, 'notes.txt'), HOOKED)
  assert.equal(watch.check(), undefined)
  writeFileSync(join(elsewhere, 'helper.md'), HOOKED)
  assert.ok(watch.check()?.includes(join(agents, 'linked', 'helper.md')))
  rmSync(join(elsewhere, 'helper.md'))
  chmodSync(elsewhere, 0o000)
  let refusal: string | undefined
  try {
    refusal = watch.check()
  } finally {
    chmodSync(elsewhere, 0o700)
  }
  assert.ok(refusal?.includes(join(agents, 'linked')) && refusal.includes('cannot be read'), refusal ?? 'no refusal')
})
