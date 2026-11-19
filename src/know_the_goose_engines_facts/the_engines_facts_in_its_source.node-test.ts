// The reader takes every fact the recording holds from an engine tree, and names the part it cannot read
// (macula-io/martha#541, package 10). The tree is built from the committed recording, so no fact is typed here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NOTE } from '../record_claude_code_host/carry_over_what_is_restated_by_hand.ts'
import { anEngineSourceSaying, engineFilesSaying, theOtherKindOf } from './an_engine_source_from_its_facts.ts'
import { RECORDED_GOOSE_ENGINE } from './recorded_goose_engine.ts'
import { CHECKOUT_ROOT_CARRIERS, ENGINE_PARTS, ENGINE_PLACES, engineFactsIn, HINT_FILE_CONSTANTS, SHELL_TOOL, SKILL_ROOT_READERS, SKILLS_SWITCH_READERS, TELEMETRY_READERS, TOOL_CALL_META, WORKING_DIRECTORY_AS_THE_ROOT, type EngineFacts } from './the_engines_facts_in_its_source.ts'

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

test('the telemetry switch is read through the constant the choice function passes, with the default the enabled function gives (#541 row 6)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.telemetry
  const { setting, when_unset } = RECORDED_FACTS.telemetry
  const decoy = `pub const A_DECOY_SETTING: &str = "${setting}_DECOY";\n`
  const flipped = (files[path] ?? '').replace(`unwrap_or(${String(when_unset)})`, `unwrap_or(${String(!when_unset)})`)
  assert.notEqual(flipped, files[path], 'the built tree gives no default to flip')
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: `${decoy}${flipped}` }))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.telemetry, { setting, when_unset: !when_unset })
})

test('a default the enabled function takes from anything but the choice function is unreadable, never the recorded default (#541 row 6)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.telemetry
  const elsewhere = (files[path] ?? '').replace(`${TELEMETRY_READERS.choice}().unwrap_or(`, 'another_choice().unwrap_or(')
  assert.notEqual(elsewhere, files[path], 'the built tree has no enabled function asking the choice to rename')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: elsewhere }))
  assert.equal(unreadable.length, 1)
  assert.match(unreadable[0]?.why ?? '', new RegExp(`the default ${TELEMETRY_READERS.enabled} gives`))
})

test('a telemetry file with no choice function is unreadable by its part, never a setting taken from the first constant (#541 row 6)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.telemetry
  const renamed = (files[path] ?? '').replace(`pub fn ${TELEMETRY_READERS.choice}(`, 'pub fn another_function(')
  assert.notEqual(renamed, files[path], 'the built tree has no choice function to rename')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: renamed }))
  assert.equal(unreadable.length, 1)
  assert.match(unreadable[0]?.why ?? '', new RegExp(`the function ${TELEMETRY_READERS.choice}`))
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

/**
 * Each place a checkout's root could build a skill folder the reader does not list, planted in the tree: the first is
 * the one Neptunus planted in the real engine at review (martha#614 r=1), a folder pushed from the working directory
 * after the list; the others hand the root to a folder the discovery, its settings loader or the plugin skill folders
 * build beside the ones the reader knows.
 */
const ROOTS_PLANTED_UNLISTED = [
  {
    what: 'a folder pushed from the working directory after the list',
    place: ENGINE_PLACES.skill_folders,
    at: '    dirs.extend(plugin_dirs',
    planted: '    if let Some(wd) = working_dir {\n        dirs.push(SkillDirectory { path: wd.join(".cursor").join("skills") });\n    }\n',
    fn: SKILL_ROOT_READERS.skill_folders,
  },
  {
    what: 'a second list of folders from the working directory inside the same if let (Mercurius on PR 882 r=2: only the exactly-once count refuses it)',
    place: ENGINE_PLACES.skill_folders,
    at: '    }\n    dirs.extend(plugin_dirs',
    planted: '        for path in [wd.join(".cursor").join("skills")] {\n            dirs.push(SkillDirectory { path });\n        }\n',
    fn: SKILL_ROOT_READERS.skill_folders,
  },
  {
    what: 'a plugin folder the discovery reads from the root beside the project one',
    place: ENGINE_PLACES.plugin_discovery,
    at: '        found.extend(list_dir_children(&project_plugins_dir)',
    planted: '        found.extend(list_dir_children(&root.join(".cursor").join("plugins")).into_iter().map(|(name, root)| DiscoveredPlugin { name, root, scope: PluginScope::Project }));\n',
    fn: CHECKOUT_ROOT_CARRIERS.plugin_discovery,
  },
  {
    what: 'a settings file the loader reads from the root beside the two',
    place: ENGINE_PLACES.plugin_discovery,
    at: '        paths.push((SettingsScope::Local,',
    planted: '        paths.push((SettingsScope::Local, root.join(".cursor").join("settings.json")));\n',
    fn: CHECKOUT_ROOT_CARRIERS.plugin_settings,
  },
  {
    what: 'the root handed by the plugin skill folders to something besides the discovery',
    place: ENGINE_PLACES.plugin_skill_dirs,
    at: '    let plugins_dir',
    planted: '    let more = project_root.map(|root| root.join(".cursor"));\n',
    fn: CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs,
  },
] as const

test('a skill folder built from the checkout\'s root anywhere the reader does not list makes the skill roots unreadable by name, never the same list (martha#614 r=1, mutant: a use left uncounted)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  for (const { what, place, at, planted, fn } of ROOTS_PLANTED_UNLISTED) {
    const text = files[place] ?? ''
    assert.equal(text.split(at).length, 2, `${what}: the tree has no one place to plant it at, so this case would prove nothing`)
    const { facts, unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [place]: text.replace(at, `${planted}${at}`) }))
    assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'], what)
    assert.match(unreadable[0]?.why ?? '', new RegExp(`${place} uses \\w+ in ${fn} `), what)
    assert.equal(facts.checkout_skill_roots, undefined, what)
  }
})

test('each function that carries the checkout\'s root to the plugin skills, renamed, makes the skill roots unreadable by name (martha#614 r=1)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const places = { plugin_skill_dirs: ENGINE_PLACES.plugin_skill_dirs, plugin_discovery: ENGINE_PLACES.plugin_discovery, plugin_settings: ENGINE_PLACES.plugin_discovery }
  for (const [which, path] of Object.entries(places) as Array<[keyof typeof CHECKOUT_ROOT_CARRIERS, string]>) {
    const carrier = CHECKOUT_ROOT_CARRIERS[which]
    const renamed = (files[path] ?? '').replace(`fn ${carrier}(`, 'fn another_function(')
    assert.notEqual(renamed, files[path], `${carrier} is not in the tree`)
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: renamed }))
    assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'], carrier)
    assert.match(unreadable[0]?.why ?? '', new RegExp(carrier), carrier)
  }
})

/** Where a plant goes in each function a skill root is built in: after the line that opens what the function gathers. */
const AFTER = {
  skill_folders: '    let mut dirs = Vec::new();\n',
  plugin_skill_dirs: '        .filter(|(path, _)| seen.insert(path.clone()))\n',
  plugin_discovery: '    let mut found = Vec::new();\n',
  plugin_settings: '    let mut paths: Vec<(SettingsScope, PathBuf)> = Vec::new();\n',
  plugin_folder: `fn ${SKILL_ROOT_READERS.plugin_folder}(project_root: &Path) -> PathBuf {\n`,
  plugin_path: `fn ${SKILL_ROOT_READERS.plugin_settings}(project_root: &Path, local: bool) -> PathBuf {\n`,
} as const

const inSkillFolders = { place: 'skill_folders', fn: SKILL_ROOT_READERS.skill_folders, at: AFTER.skill_folders } as const

/**
 * A folder from a base the reader does not know, planted in each function a skill root is built in (martha#614 Done-when
 * 6), with the text the reader is to name it by. Neptunus's R2 on PR 882 is the first; his three on PR 893 at b820f8d6
 * (a constant read with `from_str`, a helper function's answer, a static's `to_path_buf`) follow. None uses the root, so
 * the accounting of its uses passes every one.
 */
const FOLDERS_PLANTED_FROM_UNKNOWN_BASES = [
  { what: 'Neptunus\'s R2: a folder from a relative path', ...inSkillFolders, planted: '    dirs.push(SkillDirectory { path: PathBuf::from(".cursor/skills") });\n', named: 'PathBuf::from(".cursor/skills")' },
  { what: 'Neptunus on 893: a constant read with from_str', ...inSkillFolders, planted: '    dirs.push(SkillDirectory { path: PathBuf::from_str(CURSOR_SKILLS).unwrap() });\n', named: 'PathBuf::from_str(CURSOR_SKILLS).unwrap()' },
  { what: 'Neptunus on 893: what a helper function returns', ...inSkillFolders, planted: '    dirs.push(SkillDirectory { path: cursor_skills() });\n', named: 'cursor_skills()' },
  { what: 'Neptunus on 893: a static turned into a path', ...inSkillFolders, planted: '    dirs.push(SkillDirectory { path: CURSOR_DIR.to_path_buf() });\n', named: 'CURSOR_DIR.to_path_buf()' },
  { what: 'a folder under the working directory', ...inSkillFolders, planted: '    dirs.push(SkillDirectory { path: std::env::current_dir().unwrap_or_default().join(".cursor") });\n', named: 'std::env::current_dir().unwrap_or_default().join(".cursor")' },
  { what: 'a for list holding a helper\'s answer', ...inSkillFolders, planted: '    for path in [cursor_skills()] {\n        dirs.push(SkillDirectory { path });\n    }\n', named: 'cursor_skills()' },
  { what: 'a path bound by a let', ...inSkillFolders, planted: '    let path = cursor_skills();\n    dirs.push(SkillDirectory { path });\n', named: 'letpath' },
  { what: 'the list grown by a helper', ...inSkillFolders, planted: '    dirs.extend(cursor_dirs());\n', named: '.extend(cursor_dirs())' },
  { what: 'the list handed to a helper', ...inSkillFolders, planted: '    add_cursor(&mut dirs);\n', named: 'dirs, used' },
  { what: 'a home that is not the user\'s', ...inSkillFolders, planted: '    let home = cursor_root();\n    if let Some(h) = home.as_ref() {\n        dirs.push(SkillDirectory { path: h.join(".x") });\n    }\n', named: 'a home that is not' },
  { what: 'plugins found in the working directory', place: 'plugin_discovery', fn: CHECKOUT_ROOT_CARRIERS.plugin_discovery, at: AFTER.plugin_discovery, planted: '    found.extend(list_dir_children(&std::env::current_dir().unwrap_or_default()).into_iter().map(|(name, root)| DiscoveredPlugin { name, root, scope: PluginScope::Project }));\n', named: '.extend(list_dir_children(&std::env::current_dir()' },
  { what: 'plugins a helper returns', place: 'plugin_discovery', fn: CHECKOUT_ROOT_CARRIERS.plugin_discovery, at: AFTER.plugin_discovery, planted: '    found.extend(cursor_plugins());\n', named: '.extend(cursor_plugins())' },
  { what: 'a settings file from a constant', place: 'plugin_discovery', fn: CHECKOUT_ROOT_CARRIERS.plugin_settings, at: AFTER.plugin_settings, planted: '    paths.push((SettingsScope::Local, PathBuf::from(CURSOR_SETTINGS)));\n', named: '.push((SettingsScope::Local,PathBuf::from(CURSOR_SETTINGS)))' },
  { what: 'a plugin folder a helper returns', place: 'plugin_discovery', fn: SKILL_ROOT_READERS.plugin_folder, at: AFTER.plugin_folder, planted: '    if !project_root.exists() {\n        return cursor_plugins_dir();\n    }\n', named: 'if!project_root.exists(){returncursor_plugins_dir();}' },
  { what: 'a settings file a helper returns', place: 'plugin_discovery', fn: SKILL_ROOT_READERS.plugin_settings, at: AFTER.plugin_path, planted: '    if local {\n        return cursor_settings();\n    }\n', named: 'iflocal{returncursor_settings();}' },
  { what: 'plugin skill folders chained from a helper', place: 'plugin_skill_dirs', fn: CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs, at: AFTER.plugin_skill_dirs, planted: '        .chain(cursor_dirs())\n', named: `discovery::${CHECKOUT_ROOT_CARRIERS.plugin_discovery}(project_root,config)` },
] as const

test('a skill folder from a base the reader does not know makes the skill roots unreadable, naming it, in every function a root is built in (martha#614 Done-when 6, mutants: each rule left out)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  for (const { what, place, fn, at, planted, named } of FOLDERS_PLANTED_FROM_UNKNOWN_BASES) {
    const path = ENGINE_PLACES[place]
    const text = files[path] ?? ''
    assert.equal(text.split(at).length, 2, `${what}: the tree has no one place to plant it at, so this case would prove nothing`)
    const { facts, unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: text.replace(at, `${at}${planted}`) }))
    assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'], what)
    assert.ok((unreadable[0]?.why ?? '').startsWith(`${path} builds a folder in ${fn} from ${named}`), `${what}: ${unreadable[0]?.why ?? ''}`)
    assert.equal(facts.checkout_skill_roots, undefined, what)
  }
  const planted = FOLDERS_PLANTED_FROM_UNKNOWN_BASES.map(({ fn }) => String(fn))
  const builders = [...Object.values(SKILL_ROOT_READERS), ...Object.values(CHECKOUT_ROOT_CARRIERS)]
  assert.deepEqual(builders.filter((fn) => !planted.includes(fn)), [], 'a function a root is built in has no plant')
})

test('skill folders given back beside the list the function gathers make the skill roots unreadable, naming the list (martha#614 Done-when 6, mutant: the end not read)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.skill_folders
  const text = files[path] ?? ''
  const end = '    dirs\n}\n'
  assert.equal(text.split(end).length, 2, 'the tree has no one end of the skill folders function')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: text.replace(end, '    [dirs, cursor_dirs()].concat()\n}\n') }))
  assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'])
  assert.ok((unreadable[0]?.why ?? '').startsWith(`${path} builds a folder in ${SKILL_ROOT_READERS.skill_folders} from dirs, used`), unreadable[0]?.why ?? '')
})

test('the working directory taken anywhere in the skills file but as the root itself makes the skill roots unreadable by name (martha#614 Done-when 6, mutant: the file not read)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.skill_folders
  const text = files[path] ?? ''
  const at = '    dirs\n}\n'
  assert.equal(text.split(at).length, 2, 'the tree has no one end of the skill folders function to plant after')
  const planted = text.replace(at, `${at}\nfn another_root() -> Option<PathBuf> {\n    std::env::current_dir().ok()\n}\n`)
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: planted }))
  assert.deepEqual(unreadable.map(({ part }) => part), ['checkout skill roots'])
  assert.ok((unreadable[0]?.why ?? '').startsWith(`${path} takes the working directory 1 times outside ${WORKING_DIRECTORY_AS_THE_ROOT}'s fallback`), unreadable[0]?.why ?? '')
})

test('the bases the engine builds its folders from are read as known: each shape the real engine writes stands in the tree and reads clean (martha#614 Done-when 6, mutant: a base dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const shapes = [
    [ENGINE_PLACES.skill_folders, new RegExp(`fn ${WORKING_DIRECTORY_AS_THE_ROOT}\\([\\s\\S]*current_dir\\(\\)`), 'the working directory as the root itself'],
    [ENGINE_PLACES.skill_folders, /let home = dirs::home_dir\(\);\s+if let Some\(h\) = home\.as_ref\(\)/, 'the home'],
    [ENGINE_PLACES.skill_folders, /Paths::config_dir\(\)\.join\(/, 'the config folder'],
    [ENGINE_PLACES.skill_folders, /for path in \[h\.join\(/, 'a for list under the home'],
    [ENGINE_PLACES.skill_folders, /\.filter\(\|\(_, scope\)\| \*scope == PluginScope::Project\)\.map\(\|\(path, _\)\|/, 'the project plugin skill folders'],
    [ENGINE_PLACES.plugin_discovery, /let user_plugins_dir = plugin_install_dir\(\);/, 'the user plugin folder'],
    [ENGINE_PLACES.plugin_discovery, /if let Some\(path\) = user_settings_path\(\)/, 'the user settings file'],
    [ENGINE_PLACES.plugin_discovery, /let file = if local \{\s*"/, 'the settings file choice'],
    [ENGINE_PLACES.plugin_skill_dirs, /let plugin_dir = plugin\.root;[\s\S]*\.filter\(\|\(path, _\)\| seen\.insert\(path\.clone\(\)\)\)/, 'each plugin\'s own folders, seen once'],
  ] as const
  for (const [path, shape, what] of shapes) assert.match(files[path] ?? '', shape, `the tree has no ${what}, so this test would prove nothing`)
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(files))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.checkout_skill_roots, RECORDED_FACTS.checkout_skill_roots)
})
