// Hooks and plugins the owner's user or managed settings declare (martha#121, finding 1).

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { HOOKS_SPELLINGS, hooksAndPluginsDeclaredIn, hooksInFrontmatterOf, PLUGIN_DIRS_VARIABLE, pluginDirsIn, SKILLS_KIND, SYNCED_SKILLS_FOLDER, TRASH_FOLDER } from './hooks_and_plugins_the_owner_declares.ts'
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
  t.after(() => removeTheTree(dir))
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
  'a collection used as a key': '[other]: {}',
  'a backslash outside a double-quoted value': '"hoo\\x6bs": {}',
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

test('the key hooks is refused in each spelling the list names, a verbatim tag and githooks included', () => {
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

test('a collection used as the key is refused in every shape inside that class, a flow mapping and a tagged sequence included', () => {
  for (const frontmatter of [
    '[hooks]: {PreToolUse: []}',
    '[ hooks ]: {PreToolUse: []}',
    '["hooks"]: {PreToolUse: []}',
    '[hooks,]: {PreToolUse: []}',
    '[[hooks]]: {PreToolUse: []}',
    '[hooks] : {PreToolUse: []}',
    '{hooks: x}: {PreToolUse: []}',
    '!<tag:yaml.org,2002:seq>[hooks]: {PreToolUse: []}',
  ]) {
    const refusal = hooksInFrontmatterOf(md(withFrontmatter(frontmatter)), PATTERN) ?? ''
    assert.ok(refusal.includes(AGENT_FILE), `not refused: ${frontmatter}`)
    assert.ok(refusal.includes('a collection used as a key'), `refused without naming the rule: ${frontmatter}`)
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

// Two spellings the list above deliberately leaves out, because the host does
// not read either as the key `hooks`: the probe rows in ../probe_launch_hosts
// record what it does with each (martha#174). A widening of the list that
// refuses one of them fails here, and the plain key beside them is refused here,
// so this check is shown to be able to tell the two answers apart.
test('the two spellings the host does not read as the key hooks are passed, and the plain key beside them is refused (martha#174)', () => {
  for (const frontmatter of ['!!binary aG9va3M=: {SessionStart: []}', '[hooks] # c\n: {SessionStart: []}']) {
    assert.equal(hooksInFrontmatterOf(md(withFrontmatter(frontmatter)), PATTERN), undefined, `refused, but the host does not read it as hooks: ${frontmatter}`)
  }
  const plain = hooksInFrontmatterOf(md(withFrontmatter('hooks: {SessionStart: []}')), PATTERN) ?? ''
  assert.ok(plain.includes(AGENT_FILE) && plain.includes('the key hooks'), plain === '' ? 'not refused' : plain)
})

const HOOKED = withFrontmatter('hooks:\n  PreToolUse: []')

// --- a backslash is judged where YAML gives it meaning (martha#243) ----------
//
// Rule 2 of #146 refused a backslash anywhere, because a backslash can spell the
// key `hooks`. A description that quotes a phrase then stopped every member: the
// two skills a signed-in host syncs from the owner's account hold `\"` and
// `\u{2014}` inside a double-quoted description, and declare no hook. A backslash
// is an escape only inside a double-quoted scalar, and that scalar can only be
// the key when it opens where a key opens.

/** The two frontmatters a signed-in host actually served, as the clean-install run met them (martha#69, martha#243). */
const SERVED = [
  'description: "Read this before the first Google Drive call. Use it whenever the user wants to change a Google Doc, even \\"change it\\" or \\"add a tab\\"."',
  'description: "Use this any time a spreadsheet file is the primary input or output, by name or path \\u{2014} even casually (like \\"the xlsx in my downloads\\")."',
]

test('a backslash in a double-quoted value is no hook declaration: the two shapes a signed-in host serves pass, and so do the other value shapes', () => {
  for (const frontmatter of [
    ...SERVED,
    'description: "line\\nline"',
    'description: "first\nsecond \\u{2014}"',
    'description: "first\\\nsecond \\u{2014}"',
    'description: "a \\\\ backslash"',
    'description: "say \\"x: y\\" \\u{2014}"',
  ]) {
    assert.equal(hooksInFrontmatterOf(md(withFrontmatter(frontmatter)), PATTERN), undefined, `refused: ${frontmatter}`)
  }
})

test('a backslash that can spell the key is refused in every position a key opens, an anchor or a tag before it included', () => {
  for (const frontmatter of [
    '"hoo\\x6bs": {}',
    '"\\x68\\x6f\\x6f\\x6b\\x73": {}',
    '"hoo\\u{6b}s": {}',
    '"hoo\\\nks": {}',
    '"hoo\\x6bs"\n: {}',
    '&x: "hoo\\x6bs": {PreToolUse: []}',
    '!x: "hoo\\x6bs": {PreToolUse: []}',
    'a: {&x: "hoo\\x6bs": 1}',
    'a: {"hoo\\x6bs": 1}',
    '{a: 1, "hoo\\x6bs": 2}',
    '- "hoo\\x6bs": {}',
    'hoo\\x6bs: {}',
    "'a\\b': {}",
  ]) {
    const refusal = hooksInFrontmatterOf(md(withFrontmatter(frontmatter)), PATTERN) ?? ''
    assert.ok(refusal.includes(AGENT_FILE), `not refused: ${frontmatter}`)
    assert.ok(refusal.includes('a backslash outside a double-quoted value'), `refused without naming the rule: ${frontmatter}`)
  }
})

test('a double-quoted value that never closes is refused as cannot-be-told (martha#243)', () => {
  const refusal = hooksInFrontmatterOf(md(withFrontmatter('description: "text with \\u{2014}')), PATTERN)
  assert.ok(refusal?.includes(AGENT_FILE) && refusal.includes('never closes'), refusal ?? 'no refusal')
})

test('a synced skill is refused with the remedy its owner can carry out, and any other file with the one it can edit (martha#243)', () => {
  const synced = hooksInFrontmatterOf({ path: '/owner/.claude/skills/synced/acct-1/xlsx/SKILL.md', text: HOOKED, managed: false, synced: true }, PATTERN) ?? ''
  assert.ok(synced.includes('claude.ai'), synced === '' ? 'not refused' : synced)
  assert.ok(synced.includes('syncClaudeAiSkills'), synced)
  assert.ok(!synced.includes('move the hooks out of that file'), synced)
  const own = hooksInFrontmatterOf(md(HOOKED), PATTERN) ?? ''
  assert.ok(own.includes('move the hooks out of that file'), own === '' ? 'not refused' : own)
  assert.ok(!own.includes('syncClaudeAiSkills'), own)
})

test('the watch refuses a hooked agent, skill or command in each user and managed folder the host loads, a synced skill included, and lets it go once removed', (t) => {
  const root = scratch(t)
  const managed = { dir: join(root, 'managed'), file: 'managed.json', drop_in: 'drop-in' }
  const user = join(root, 'conf-dir', 'settings.json')
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
  const user = join(root, 'conf-dir', 'settings.json')
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

// --- what the host loads from the trash and from the account (martha#243) ---

/** The watch over a scratch config folder, with the owner's user settings written as given. */
function watchOver(t: TestContext, settings: unknown) {
  const root = scratch(t)
  const managed = { dir: join(root, 'managed'), file: 'managed.json', drop_in: 'drop-in' }
  const user = join(root, 'conf-dir', 'settings.json')
  mkdirSync(dirname(user), { recursive: true })
  writeFileSync(user, JSON.stringify(settings))
  const approved = join(root, 'approved.json')
  writeFileSync(approved, '{}')
  const watch = hookSettingsWatch({ user, home: root, approved, managed, switches: CLAUDE_CODE_HOOK_SWITCHES, markdown: CLAUDE_CODE_OWNERS_MARKDOWN })
  return { root, managed, user, approved, watch, skills: join(dirname(user), SKILLS_KIND) }
}

test('the trash is read where the host reads it: a SKILL.md directly in it is judged, and nothing below an entry of it is', (t) => {
  const { watch, skills } = watchOver(t, {})
  const top = join(skills, TRASH_FOLDER, 'SKILL.md')
  mkdirSync(dirname(top), { recursive: true })
  writeFileSync(top, HOOKED)
  assert.ok(watch.check()?.includes(top), watch.check() ?? 'the host loads this one, so it is judged')
  rmSync(top)
  const below = join(skills, TRASH_FOLDER, 'entry', 'SKILL.md')
  mkdirSync(dirname(below), { recursive: true })
  writeFileSync(below, HOOKED)
  assert.equal(watch.check(), undefined, 'the host loads nothing below an entry, so neither does the gate')
})

test('a synced skill is judged until the owner or the admin turns account sync off with a real false, which the host reads from any source', (t) => {
  const { watch, skills, user, managed, approved } = watchOver(t, {})
  const synced = join(skills, SYNCED_SKILLS_FOLDER, 'acct-1', 'xlsx', 'SKILL.md')
  mkdirSync(dirname(synced), { recursive: true })
  writeFileSync(synced, HOOKED)
  assert.ok(watch.check()?.includes(synced), 'no setting: the host may load it, so it is judged')

  for (const [what, settings] of [
    ['true', { syncClaudeAiSkills: true }],
    ['the string false', { syncClaudeAiSkills: 'false' }],
    ['zero', { syncClaudeAiSkills: 0 }],
    ['null', { syncClaudeAiSkills: null }],
  ] as const) {
    writeFileSync(user, JSON.stringify(settings))
    assert.ok(watch.check()?.includes(synced), `${what} is not the false the host reads, so the skill is still judged`)
  }

  writeFileSync(user, JSON.stringify({ syncClaudeAiSkills: false }))
  assert.equal(watch.check(), undefined, 'the owner turned sync off: the host hides the folder, and so does the gate')

  writeFileSync(user, '{}')
  assert.ok(watch.check()?.includes(synced))
  mkdirSync(join(managed.dir, managed.drop_in), { recursive: true })
  writeFileSync(join(managed.dir, managed.drop_in, '50-org.json'), JSON.stringify({ syncClaudeAiSkills: false }))
  assert.equal(watch.check(), undefined, 'the admin turned it off in a drop-in: any source holding false turns it off for the host')

  rmSync(join(managed.dir, managed.drop_in, '50-org.json'))
  writeFileSync(user, '{}')
  writeFileSync(approved, JSON.stringify({ syncClaudeAiSkills: false }))
  assert.ok(watch.check()?.includes(synced), "the approved copy is Martha's own: the setting there must not take the owner's account skills away without the owner")
})

test('the trash depth is the skills folder’s alone: a file below an entry of a trash under agents or commands is still read, because the host loads those at any depth', (t) => {
  const { watch, skills } = watchOver(t, {})
  const agents = join(dirname(skills), 'agents')
  const below = join(agents, TRASH_FOLDER, 'entry', 'helper.md')
  mkdirSync(dirname(below), { recursive: true })
  writeFileSync(below, HOOKED)
  assert.ok(watch.check()?.includes(below), watch.check() ?? 'not read')
})
