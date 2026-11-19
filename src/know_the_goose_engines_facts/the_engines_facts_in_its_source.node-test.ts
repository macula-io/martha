// The reader takes every fact the recording holds from an engine tree, and names the part it cannot read
// (macula-io/martha#541, package 10). The tree is built from the committed recording, so no fact is typed here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NOTE } from '../record_claude_code_host/carry_over_what_is_restated_by_hand.ts'
import { anEngineSourceSaying, engineFilesSaying, theOtherKindOf } from './an_engine_source_from_its_facts.ts'
import { RECORDED_GOOSE_ENGINE } from './recorded_goose_engine.ts'
import { ENGINE_PARTS, ENGINE_PLACES, engineFactsIn, HINT_FILE_CONSTANTS, SHELL_TOOL, SKILL_ROOT_READERS, SKILLS_SWITCH_READERS, TOOL_CALL_META, type EngineFacts } from './the_engines_facts_in_its_source.ts'

/** The recording's facts alone: what the reader is asked to give back. */
const { [NOTE]: _ignoredWhy, engine_commit: _ignoredCommit, ...RECORDED_FACTS } = RECORDED_GOOSE_ENGINE

/** The recorded subagent vocabulary turned the other way: closed when it is open, open when it is closed. */
const OTHER_SUBAGENT_MODELS = theOtherKindOf(RECORDED_FACTS.subagent_models)

test('a tree that says the recorded facts reads back as exactly those facts, every part read', () => {
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying(RECORDED_FACTS)))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts, RECORDED_FACTS)
})

test('the recording names at least one platform extension of each key shape, so all three readings are exercised', () => {
  assert.ok(RECORDED_FACTS.platform_extensions.length >= 3, 'fewer than three extensions: the module-directory reading of a key is never run')
})

test('an extension switched on by default in the tree is read as on, and the recording is not what it reads', () => {
  const [first, ...rest] = RECORDED_FACTS.platform_extensions
  assert.ok(first !== undefined)
  const flipped: EngineFacts = { ...RECORDED_FACTS, platform_extensions: [{ ...first, default_enabled: !first.default_enabled }, ...rest] }
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying(flipped)))
  assert.equal(facts.platform_extensions?.[0]?.default_enabled, !first.default_enabled)
  assert.notDeepEqual(facts.platform_extensions, RECORDED_FACTS.platform_extensions)
})

test('a mode the engine runs when the setting is absent is read from the engine, not assumed', () => {
  const other = RECORDED_FACTS.mode.values.find((mode) => mode !== RECORDED_FACTS.mode.when_unset)
  assert.ok(other !== undefined, 'the recording names one mode only, so a changed default cannot be shown')
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, mode: { ...RECORDED_FACTS.mode, when_unset: other } })))
  assert.equal(facts.mode?.when_unset, other)
})

test('a permission option the engine adds is read, so an answer the adapter never chose is seen', () => {
  const added = [...RECORDED_FACTS.permission_options, `${RECORDED_FACTS.permission_options[0] ?? ''}_for_a_while`]
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, permission_options: added })))
  assert.deepEqual(facts.permission_options, added)
})

test('each place that is gone makes its own parts unreadable by name, and leaves the others read', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  for (const place of Object.values(ENGINE_PLACES)) {
    const without = Object.fromEntries(Object.entries(files).filter(([path]) => path !== place))
    const { unreadable } = engineFactsIn(anEngineSourceSaying(without))
    assert.ok(unreadable.length > 0, `${place} is gone and every part still read`)
    assert.ok(unreadable.length < ENGINE_PARTS.length, `${place} is gone and no part read at all`)
    for (const { why } of unreadable) assert.match(why, /^no /, `${place}: a part failed for another reason than the file being gone: ${why}`)
  }
})

test('an extension keyed by a module with no EXTENSION_NAME is unreadable, never a guess at its key', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const moduleFile = Object.keys(files).find((path) => path.startsWith(ENGINE_PLACES.platform_extensions.replace(/mod\.rs$/, 'ext')))
  assert.ok(moduleFile !== undefined, 'the built tree keys no extension by a module file')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [moduleFile]: '' }))
  assert.deepEqual(unreadable.map(({ part }) => part), [ENGINE_PARTS.find(({ read }) => 'platform_extensions' in read(anEngineSourceSaying(files)))?.part])
})

test('an extension inserted in a shape the reader does not know makes the map unreadable, never a map without it', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const map = files[ENGINE_PLACES.platform_extensions] ?? ''
  const planted = `${map}\n        map.insert("newext", newext_def());\n`
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.platform_extensions]: planted }))
  assert.deepEqual(unreadable.map(({ part }) => part), [ENGINE_PARTS.find(({ read }) => 'platform_extensions' in read(anEngineSourceSaying(files)))?.part])
})

test('a delegate tool whose model changes kind is read as that kind, so the review model is never read against the old one', () => {
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, subagent_models: OTHER_SUBAGENT_MODELS })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.subagent_models, OTHER_SUBAGENT_MODELS)
})

test("a delegate tool's model that is neither a list nor a string is unreadable, never taken as open", () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tool = files[ENGINE_PLACES.delegate_tool] ?? ''
  const typed = tool.replace(/("model":\s*\{\s*"type":\s*)"string"/, '$1"integer"')
  assert.notEqual(typed, tool, 'the built delegate tool has no string model to retype')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.delegate_tool]: typed }))
  assert.deepEqual(unreadable.map(({ part }) => part), [ENGINE_PARTS.find(({ read }) => 'subagent_models' in read(anEngineSourceSaying(files)))?.part])
})

// The files the engine reads into every prompt (martha#785): their names, the setting that replaces them, and the list it
// loads when the setting is unset, all read from the engine's own source, so a launch that records them never types one.

/** The part that reads the hint files, by the field it gives. */
const THE_HINT_FILES_PART = (): string | undefined =>
  ENGINE_PARTS.find(({ read }) => {
    try {
      return 'hint_files' in read(anEngineSourceSaying(engineFilesSaying(RECORDED_FACTS)))
    } catch {
      return false
    }
  })?.part

test("a hints file the engine renames is read as renamed, and the list it loads follows the new name (martha#785)", () => {
  const recorded = RECORDED_FACTS.hint_files
  const renamed = `${recorded.goose_hints}-renamed`
  const hint_files = { ...recorded, goose_hints: renamed, when_unset: recorded.when_unset.map((name) => (name === recorded.goose_hints ? renamed : name)) }
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, hint_files })))
  assert.equal(facts.hint_files?.goose_hints, renamed, "the engine's hints file name was not read from its source")
  assert.deepEqual(facts.hint_files?.when_unset, hint_files.when_unset, 'the list the engine loads did not follow the renamed file')
})

test('the list the engine loads when the setting is unset is read from it, not assumed to be both names (martha#785)', () => {
  const recorded = RECORDED_FACTS.hint_files
  const hint_files = { ...recorded, when_unset: [recorded.agents_md] }
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, hint_files })))
  assert.deepEqual(facts.hint_files?.when_unset, [recorded.agents_md])
})

test('the setting that replaces the hint files is read from the engine (martha#785)', () => {
  const recorded = RECORDED_FACTS.hint_files
  const hint_files = { ...recorded, setting: `${recorded.setting}_MOVED` }
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, hint_files })))
  assert.equal(facts.hint_files?.setting, hint_files.setting)
})

test('a hint file the list names by a constant the file never declares is unreadable, never a shorter list (martha#785)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.hint_files] ?? ''
  const constant = HINT_FILE_CONSTANTS.agents_md
  assert.ok(text.includes(`${constant}.to_string()`), 'the built tree does not list the instruction file by its constant')
  const planted = text.replace(`${constant}.to_string()`, `${constant}_UNDECLARED.to_string()`)
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.hint_files]: planted }))
  assert.deepEqual(unreadable.map(({ part }) => part), [THE_HINT_FILES_PART()])
})

test('a hint file the list names in a shape the reader does not know is unreadable, never a list without it (martha#785)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.hint_files] ?? ''
  const constant = HINT_FILE_CONSTANTS.agents_md
  const planted = text.replace(`${constant}.to_string()`, `${constant}.to_string(),\n                String::from("NOTES.md")`)
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.hint_files]: planted }))
  assert.deepEqual(unreadable.map(({ part }) => part), [THE_HINT_FILES_PART()])
})

/** The part that reads the stdio entry, by the name a failed read reports. */
const STDIO_PART = ENGINE_PARTS.find(({ read }) => 'stdio_extension' in read(anEngineSourceSaying(engineFilesSaying(RECORDED_FACTS))))?.part

test("a field the stdio entry gains is read into its keys, and the next variant's fields are not", () => {
  const stdio = RECORDED_FACTS.stdio_extension
  const keys = [...stdio.keys, 'a_new_field']
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, stdio_extension: { ...stdio, keys } })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.stdio_extension?.keys, keys)
})

test('a dropped environment name in a shape the reader does not know makes the entry unreadable, never a shorter list', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const [first] = RECORDED_FACTS.stdio_extension.disallowed_env
  assert.ok(first !== undefined, 'the recording names no dropped environment name')
  const config = files[ENGINE_PLACES.stdio_extension] ?? ''
  const unquoted = config.replace(`"${first}",`, 'A_CONSTANT_NAME,')
  assert.notEqual(unquoted, config, 'the built tree holds no quoted name to unquote')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.stdio_extension]: unquoted }))
  assert.deepEqual(unreadable.map(({ part }) => part), [STDIO_PART])
})

test('an extension config with no stdio variant is unreadable, never an entry with no keys', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const config = files[ENGINE_PLACES.stdio_extension] ?? ''
  const renamed = config.replace(/\bStdio \{/, 'Pipe {')
  assert.notEqual(renamed, config, 'the built tree holds no stdio variant to rename')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.stdio_extension]: renamed }))
  assert.deepEqual(unreadable.map(({ part }) => part), [STDIO_PART])
})

test('each skills switch is read through the constant its function passes, never the first constant in the file (martha#839)', () => {
  for (const which of ['skills_advertised', 'builtin_skills_advertised'] as const) {
    const files = engineFilesSaying(RECORDED_FACTS)
    const path = ENGINE_PLACES[which]
    const decoy = `pub const A_DECOY_SETTING: &str = "${RECORDED_FACTS[which].setting}_DECOY";\n`
    const flipped = (files[path] ?? '').replace(`unwrap_or(${String(RECORDED_FACTS[which].when_unset)})`, `unwrap_or(${String(!RECORDED_FACTS[which].when_unset)})`)
    const { facts, unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: `${decoy}${flipped}` }))
    assert.deepEqual(unreadable, [], which)
    assert.deepEqual(facts[which], { setting: RECORDED_FACTS[which].setting, when_unset: !RECORDED_FACTS[which].when_unset }, which)
  }
})

test('a skills switch whose function is gone is unreadable by its own part, never taken as unset (martha#839)', () => {
  for (const which of ['skills_advertised', 'builtin_skills_advertised'] as const) {
    const files = engineFilesSaying(RECORDED_FACTS)
    const path = ENGINE_PLACES[which]
    const renamed = (files[path] ?? '').replace(`pub fn ${SKILLS_SWITCH_READERS[which]}(`, 'pub fn another_switch(')
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: renamed }))
    assert.equal(unreadable.length, 1, which)
    assert.match(unreadable[0]?.why ?? '', new RegExp(`the ${SKILLS_SWITCH_READERS[which]} switch`), which)
  }
})

test('the tool-naming path is read map by map from the meta builder, never a key another map or function fills (#541 part C4)', () => {
  const naming = RECORDED_FACTS.tool_naming
  for (const at of naming.meta_path.keys()) {
    const meta_path = naming.meta_path.map((key, index) => (index === at ? `${key}Renamed` : key))
    const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, tool_naming: { ...naming, meta_path } })))
    assert.deepEqual(unreadable, [], String(at))
    assert.deepEqual(facts.tool_naming?.meta_path, meta_path, String(at))
  }
})

test('a tool name split at the other end is read as that end, with the separator the engine splits at (#541 part C4)', () => {
  const naming = RECORDED_FACTS.tool_naming
  const other = { split_at: naming.split_at === 'first' ? 'last' : 'first', separator: `${naming.separator}:` } as const
  const { facts } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, tool_naming: { ...naming, ...other } })))
  assert.deepEqual(facts.tool_naming, { ...naming, ...other })
})

test('a meta builder that is gone makes the tool naming unreadable by name, never a path guessed (#541 part C4)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const renamed = (files[ENGINE_PLACES.tool_call_meta] ?? '').replace(`fn ${TOOL_CALL_META.builder}(`, 'fn another_builder(')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.tool_call_meta]: renamed }))
  assert.equal(unreadable.length, 1)
  assert.match(unreadable[0]?.why ?? '', new RegExp(`the function ${TOOL_CALL_META.builder}`))
})

/** The part that reads the shell tool, by the name a failed read reports. */
const SHELL_PART = ENGINE_PARTS.find(({ read }) => 'shell_tool' in read(anEngineSourceSaying(engineFilesSaying(RECORDED_FACTS))))?.part

test('a shell tool the engine renames is read under its new name, from the list and the dispatch both (#541 part C4)', () => {
  const shell_tool = `${RECORDED_FACTS.shell_tool}_renamed`
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, shell_tool })))
  assert.deepEqual(unreadable, [])
  assert.equal(facts.shell_tool, shell_tool)
})

test('a Developer extension that lists no tool on the shell parameters makes the shell tool unreadable by name, never a name guessed (#541 part C4)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const gone = tools.replace(`Self::schema::<${SHELL_TOOL.params}>()`, 'Self::schema::<AnotherParams>()')
  assert.notEqual(gone, tools, 'the built tree lists no shell tool to take away')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: gone }))
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists 0 tools on ${SHELL_TOOL.params}`))
})

test('a shell tool listed under one name and run under another is unreadable, never either name (#541 part C4)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const shell = RECORDED_FACTS.shell_tool
  const split = tools.replace(`"${shell}" => match`, `"${shell}_elsewhere" => match`)
  assert.notEqual(split, tools, 'the built tree dispatches no shell tool to rename')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: split }))
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists the shell tool as ${shell} but runs`))
})

test('a Developer extension that lists two tools on the shell parameters is unreadable, never the first of them (#541 part C4)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const shell = RECORDED_FACTS.shell_tool
  const listed = `Tool::new("${shell}".to_string(), description, Self::schema::<${SHELL_TOOL.params}>())`
  const twice = tools.replace(listed, `Tool::new("${shell}_too".to_string(), description, Self::schema::<${SHELL_TOOL.params}>())\n${listed}`)
  assert.notEqual(twice, tools, 'the built tree lists no shell tool to list twice')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: twice }))
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists 2 tools on ${SHELL_TOOL.params}`))
})

test('a Developer extension that runs the shell parameters for a second name, after the listed one, is unreadable, never the first of them (#541 part C4 r=2 review; mutant: the dispatch count dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const shell = RECORDED_FACTS.shell_tool
  const another = '"another_tool" => match'
  const second = `"${shell}_also" => match Self::parse_args::<${SHELL_TOOL.params}>(arguments) {\n                Ok(params) => run(params),\n                Err(error) => fail(error),\n            },\n            ${another}`
  const twice = tools.replace(another, second)
  assert.notEqual(twice, tools, 'the built tree dispatches no other tool to put a second shell arm before')
  assert.ok(twice.indexOf(`"${shell}" => match`) < twice.indexOf(`"${shell}_also" => match`), 'the second arm is not after the listed one, so the name comparison alone would refuse it')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: twice }))
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists the shell tool as ${shell} but runs`))
})

test('a skill folder the engine adds or renames is read from the engine, not taken from the recording (martha#614)', () => {
  const roots = RECORDED_FACTS.checkout_skill_roots
  const [first = '', ...rest] = roots.skill_folders
  const changed = { ...roots, skill_folders: [`${first}-renamed`, ...rest, '.another/skills'], plugin_folder: `${roots.plugin_folder}-renamed` }
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, checkout_skill_roots: changed })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.checkout_skill_roots, changed)
})

test('a skill folder the engine reads from the home is never read as one of the checkout\'s (martha#614)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.skill_folders] ?? ''
  assert.match(text, /dirs::home_dir\(\)/, 'the tree has no home folder, so this test would prove nothing')
  const { facts } = engineFactsIn(anEngineSourceSaying(files))
  assert.deepEqual(facts.checkout_skill_roots?.skill_folders, RECORDED_FACTS.checkout_skill_roots.skill_folders)
})

test('each function that decides a skill root, renamed, makes the skill roots unreadable by name, never a shorter list (martha#614)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const places = { skill_folders: ENGINE_PLACES.skill_folders, plugin_folder: ENGINE_PLACES.plugin_discovery, plugin_settings: ENGINE_PLACES.plugin_discovery }
  for (const [which, path] of Object.entries(places) as Array<[keyof typeof SKILL_ROOT_READERS, string]>) {
    const reader = SKILL_ROOT_READERS[which]
    const renamed = (files[path] ?? '').replace(`fn ${reader}(`, 'fn another_function(')
    assert.notEqual(renamed, files[path], `${reader} is not in the tree`)
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: renamed }))
    assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'], reader)
    assert.match(unreadable[0]?.why ?? '', new RegExp(reader), reader)
  }
})

test('a skill folder in a shape the reader does not know makes the skill roots unreadable, never a shorter list (martha#614)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.skill_folders
  const planted = (files[path] ?? '').replace('for path in [\n', 'for path in [\n            wd.join(format!(".{}/skills", name)),\n')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: planted }))
  assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'])
  assert.match(unreadable[0]?.why ?? '', /in a shape this reader knows/)
})
