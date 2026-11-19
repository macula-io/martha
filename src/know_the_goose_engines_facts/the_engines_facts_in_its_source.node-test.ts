// The reader takes every fact the recording holds from an engine tree, and names the part it cannot read
// (macula-io/martha#541, package 10). The tree is built from the committed recording, so no fact is typed here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NOTE } from '../record_claude_code_host/carry_over_what_is_restated_by_hand.ts'
import { anEngineSourceSaying, engineFilesSaying, theOtherKindOf } from './an_engine_source_from_its_facts.ts'
import { RECORDED_GOOSE_ENGINE } from './recorded_goose_engine.ts'
import { A_TRUE_SWITCH_COUNTS, DEVELOPER_DIR, ENGINE_PARTS, ENGINE_PLACES, engineFactsIn, HINT_FILE_CONSTANTS, PATH_RESOLVER, SECRET_STORAGE, SHELL_TOOL, SKILLS_SWITCH_READERS, TELEMETRY_READERS, TOOL_CALL_META, type EngineFacts } from './the_engines_facts_in_its_source.ts'

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

/**
 * The part that reads the Developer extension's tools (#541 package A): a shell listed or run wrongly is one of those
 * tools listed or run wrongly, so both parts are unreadable, each by its own name.
 */
const DEVELOPER_PART = ENGINE_PARTS.find(({ read }) => 'developer_tools' in read(anEngineSourceSaying(engineFilesSaying(RECORDED_FACTS))))?.part

/** The tool the engine lists right after the shell, whose dispatch arm a second shell arm is put before. */
const AFTER_THE_SHELL = RECORDED_FACTS.developer_tools[RECORDED_FACTS.developer_tools.findIndex(({ params }) => params === SHELL_TOOL.params) + 1]?.name

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
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART, DEVELOPER_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists 0 tools on ${SHELL_TOOL.params}`))
})

test('a shell tool listed under one name and run under another is unreadable, never either name (#541 part C4)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const shell = RECORDED_FACTS.shell_tool
  const split = tools.replace(`"${shell}" => match`, `"${shell}_elsewhere" => match`)
  assert.notEqual(split, tools, 'the built tree dispatches no shell tool to rename')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: split }))
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART, DEVELOPER_PART])
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
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART, DEVELOPER_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists 2 tools on ${SHELL_TOOL.params}`))
})

test('a Developer extension that runs the shell parameters for a second name, after the listed one, is unreadable, never the first of them (#541 part C4 r=2 review; mutant: the dispatch count dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const shell = RECORDED_FACTS.shell_tool
  assert.ok(AFTER_THE_SHELL !== undefined, 'the recording lists no tool after the shell to put a second arm before')
  const another = `"${AFTER_THE_SHELL}" => match`
  const second = `"${shell}_also" => match Self::parse_args::<${SHELL_TOOL.params}>(arguments) {\n                Ok(params) => run(params),\n                Err(error) => fail(error),\n            },\n            ${another}`
  const twice = tools.replace(another, second)
  assert.notEqual(twice, tools, 'the built tree dispatches no other tool to put a second shell arm before')
  assert.ok(twice.indexOf(`"${shell}" => match`) < twice.indexOf(`"${shell}_also" => match`), 'the second arm is not after the listed one, so the name comparison alone would refuse it')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: twice }))
  assert.deepEqual(unreadable.map(({ part }) => part), [SHELL_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists the shell tool as ${shell} but runs`))
})

/** The part that reads a fact, by the name a failed read reports. */
const partReading = (fact: keyof EngineFacts): string | undefined => ENGINE_PARTS.find(({ read }) => fact in read(anEngineSourceSaying(engineFilesSaying(RECORDED_FACTS))))?.part

test('a secret the provider starts reading, and a keyring switch and secrets file the engine renames, are read under their new names (#541 package A)', () => {
  const another = RECORDED_FACTS.openai_provider.settings.find((setting) => !RECORDED_FACTS.openai_provider.secrets.includes(setting))
  assert.ok(another !== undefined, 'every provider setting is already a secret, so no secret can be added')
  const changed: EngineFacts = {
    ...RECORDED_FACTS,
    openai_provider: { ...RECORDED_FACTS.openai_provider, secrets: [...RECORDED_FACTS.openai_provider.secrets, another] },
    secret_storage: { keyring_switch: `${RECORDED_FACTS.secret_storage.keyring_switch}_RENAMED`, file: `moved-${RECORDED_FACTS.secret_storage.file}` },
  }
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying(changed)))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.openai_provider, changed.openai_provider)
  assert.deepEqual(facts.secret_storage, changed.secret_storage)
})

test('a provider that reads its secrets twice is unreadable by name, never the first list (#541 package A)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.openai_secrets] ?? ''
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.openai_secrets]: `${text}${text}` }))
  assert.deepEqual(unreadable.map(({ part }) => part), [partReading('openai_provider')])
  assert.match(unreadable[0]?.why ?? '', /reads secrets 2 times and 2 are in a shape this reader knows, not once/)
})

test('a secret the provider reads that is none of its settings is unreadable, so no secret escapes the config allow-list (#541 package A)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const [first] = RECORDED_FACTS.openai_provider.secrets
  assert.ok(first !== undefined)
  const text = (files[ENGINE_PLACES.openai_secrets] ?? '').replace(`"${first}"`, '"A_SECRET_NO_SETTING_NAMES"')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.openai_secrets]: text }))
  assert.deepEqual(unreadable.map(({ part }) => part), [partReading('openai_provider')])
  assert.match(unreadable[0]?.why ?? '', /reads a secret A_SECRET_NO_SETTING_NAMES that is none of the provider's settings/)
})

test('a keyring switch the engine no longer reads as off when it is true is unreadable, never a switch a launch writes for nothing (#541 package A)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.secret_storage] ?? ''
  const stricter = text.replace(A_TRUE_SWITCH_COUNTS, 'false')
  assert.notEqual(stricter, text, 'the built tree reads no true switch to take away')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.secret_storage]: stricter }))
  assert.deepEqual(unreadable.map(({ part }) => part), [partReading('secret_storage')])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`no longer reads a true ${RECORDED_FACTS.secret_storage.keyring_switch} as off`))
})

test('a secrets file built some other way than beside the config file is unreadable by name (#541 package A)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.secret_storage] ?? ''
  const elsewhere = text.replace(`config_dir.join("${RECORDED_FACTS.secret_storage.file}")`, `home_dir().join("${RECORDED_FACTS.secret_storage.file}")`)
  assert.notEqual(elsewhere, text, 'the built tree joins no secrets file to move')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.secret_storage]: elsewhere }))
  assert.deepEqual(unreadable.map(({ part }) => part), [partReading('secret_storage')])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`the secrets file beside the config file`))
})

test('the secret storage and the mode default are both read from the one config file the engine keeps them in (#541 package A)', () => {
  assert.equal(ENGINE_PLACES.secret_storage, ENGINE_PLACES.mode_when_unset, 'the two facts moved apart: the tree no longer needs to write them into one file')
  const text = engineFilesSaying(RECORDED_FACTS)[ENGINE_PLACES.secret_storage] ?? ''
  assert.ok(text.includes('fn resolve_goose_mode(') && text.includes(`fn ${SECRET_STORAGE.file}(`))
})

/** The tools the recording lists that are not the shell, the ones a test may rename or break without touching the shell part. */
const NOT_THE_SHELL = RECORDED_FACTS.developer_tools.filter(({ params }) => params !== SHELL_TOOL.params)

test('every Developer tool is read with its name, its parameters and the first text field of those, as the engine lists them (#541 package A; mutants: a field read past the first text one, a name taken from the dispatch alone)', () => {
  assert.ok(NOT_THE_SHELL.length > 0, 'the recording lists no tool beside the shell, so this case reads only one')
  const developer_tools = RECORDED_FACTS.developer_tools.map((tool) => (tool.params === SHELL_TOOL.params ? tool : { ...tool, name: `${tool.name}_renamed`, argument: `${tool.argument}_renamed` }))
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, developer_tools })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.developer_tools, developer_tools)
})

test('a Developer tool listed on one set of parameters and run on another is unreadable by name, never a tool with either (#541 package A)', () => {
  const [tool] = NOT_THE_SHELL
  assert.ok(tool !== undefined, 'the recording lists no tool beside the shell')
  const files = engineFilesSaying(RECORDED_FACTS)
  const tools = files[ENGINE_PLACES.shell_tool] ?? ''
  const other = tools.replace(`"${tool.name}" => match Self::parse_args::<${tool.params}>`, `"${tool.name}" => match Self::parse_args::<AnotherParams>`)
  assert.notEqual(other, tools, 'the built tree dispatches no such tool to change')
  const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: other }))
  assert.deepEqual(unreadable.map(({ part }) => part), [DEVELOPER_PART])
  assert.match(unreadable[0]?.why ?? '', new RegExp(`lists the tool ${tool.name} on ${tool.params} but runs it on \\["AnotherParams"\\]`))
})

test('Developer parameters declared in two files, or with no text field, are unreadable by name, never an argument guessed (#541 package A)', () => {
  const [tool] = NOT_THE_SHELL
  assert.ok(tool !== undefined, 'the recording lists no tool beside the shell')
  const files = engineFilesSaying(RECORDED_FACTS)
  const params = `${DEVELOPER_DIR}/params.rs`
  const declared = files[params] ?? ''
  const twice = engineFactsIn(anEngineSourceSaying({ ...files, [`${DEVELOPER_DIR}/again.rs`]: declared }))
  assert.deepEqual(twice.unreadable.map(({ part }) => part), [DEVELOPER_PART])
  assert.match(twice.unreadable[0]?.why ?? '', new RegExp(`declares ${RECORDED_FACTS.developer_tools[0]?.params ?? ''} in 2 files`))
  const textless = declared.replace(`pub ${tool.argument}: String,\n    pub another_text: String,`, `pub ${tool.argument}: u32,\n    pub another_text: u64,`)
  assert.notEqual(textless, declared, 'the built tree declares no such parameters to change')
  const none = engineFactsIn(anEngineSourceSaying({ ...files, [params]: textless }))
  assert.deepEqual(none.unreadable.map(({ part }) => part), [DEVELOPER_PART])
  assert.match(none.unreadable[0]?.why ?? '', new RegExp(`the first text field of ${tool.params}`))
})

/** The part that reads the engine's path resolution (#541 package A). */
const RESOLUTION_PART = partReading('path_resolution')

test("the engine's path resolution is read as it is written: a trim, a `~` and the order of its places each read back, never assumed (#541 package A, design r=4 R3; mutants: the trim never seen, the places read in the reader's order)", () => {
  const recorded = RECORDED_FACTS.path_resolution
  const changed = { ...recorded, bases: [...recorded.bases].reverse(), trims: !recorded.trims, expands_home: !recorded.expands_home }
  assert.notDeepEqual(changed.bases, recorded.bases, 'the recording names one place only, so its order reads nothing')
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, path_resolution: changed })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.path_resolution, changed)
})

test('a resolver that does not return an absolute path as given, or joins a relative one to a place this reader does not know, is unreadable by name (#541 package A)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const path = ENGINE_PLACES.path_resolution
  const written = files[path] ?? ''
  const rooted = written.replace('if path.is_absolute() {\n        path\n    }', 'if path.is_absolute() {\n        root.join(path)\n    }')
  const elsewhere = written.replace(`fn ${PATH_RESOLVER}(path: &str, working_dir: Option<&Path>) -> PathBuf {`, `fn ${PATH_RESOLVER}(path: &str, working_dir: Option<&Path>) -> PathBuf {\n    let working_dir = another_place();`).replace('        working_dir\n', '        another_place()\n')
  for (const [why, broken] of [['does not return an absolute path as given', rooted], ['names no place this reader knows first', elsewhere]] as const) {
    assert.notEqual(broken, written, `the built resolver has nothing to change for: ${why}`)
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: broken }))
    assert.deepEqual(unreadable.map(({ part }) => part), [RESOLUTION_PART], why)
    assert.match(unreadable[0]?.why ?? '', new RegExp(why), why)
  }
})

/** The part that reads the engine's session store (#541 package A). */
const STORE_PART = partReading('session_store')

test("the engine's session store is read as it is written: its file, its journal mode, the sessions table's columns past another table, and every state key (#541 package A, design r=5 R1'; mutants: the first table's columns, a state left out)", () => {
  const recorded = RECORDED_FACTS.session_store
  const changed = { ...recorded, file: `moved_${recorded.file}`, journal_mode: `${recorded.journal_mode}Moved`, columns: [...recorded.columns.map((column) => `${column}_renamed`), 'a_new_column'], extension_states: ['a_new_state.v7', ...recorded.extension_states] }
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, session_store: changed })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.session_store, changed)
})

test('a store opened in two journal modes, or an extension state declared in a shape this reader does not know, is unreadable by name (#541 package A; mutants: either count dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const store = files[ENGINE_PLACES.session_store] ?? ''
  const twice = `${store}        let more = options.journal_mode(sqlx::sqlite::SqliteJournalMode::Delete);\n`
  const states = files[ENGINE_PLACES.extension_states] ?? ''
  const odd = `${states}impl ExtensionState for AnOddState {\n    const VERSION: &'static str = "v1";\n    const EXTENSION_NAME: &'static str = "odd";\n}\n`
  for (const [why, path, broken] of [['journal modes, not one', ENGINE_PLACES.session_store, twice], ['are in a shape this reader knows', ENGINE_PLACES.extension_states, odd]] as const) {
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: broken }))
    assert.deepEqual(unreadable.map(({ part }) => part), [STORE_PART], why)
    assert.match(unreadable[0]?.why ?? '', new RegExp(why), why)
  }
})

/** The part that reads what approve mode runs unasked (#541 package A), asked inside a test so a broken reader fails that test by name. */
const unaskedPart = (): string | undefined => partReading('approve_mode_unasked')

test("what approve mode runs unasked is read as the engine writes it: each user permission level that allows, past a level that asks and a smart-approve-only allow, and the filter before the check (#541 package A, design r=6 R1''; mutants: the smart-approve allow counted, every level read)", () => {
  const recorded = RECORDED_FACTS.approve_mode_unasked
  const changed = { user_permissions: [...recorded.user_permissions, 'ask_before_too'], unadvertised: `${recorded.unadvertised}_too` }
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, approve_mode_unasked: changed })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.approve_mode_unasked, changed)
})

test('an approve-mode allow this reader does not know, or an approval that no longer allows what its filter keeps out, is unreadable by name (#541 package A; mutants: either throw dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const inspector = files[ENGINE_PLACES.permission_inspector] ?? ''
  const another = inspector.replace('                        } else {\n', '                        } else if tool_name == "a_tool" {\n                            InspectionAction::Allow\n                        } else {\n')
  const approval = files[ENGINE_PLACES.tool_approval] ?? ''
  const asks = approval.replace('ApprovalDecision::Allow', 'ApprovalDecision::Ask { prompt: None }')
  for (const [why, path, broken] of [['ways this reader does not know', ENGINE_PLACES.permission_inspector, another], ['no longer allows the calls', ENGINE_PLACES.tool_approval, asks]] as const) {
    assert.notEqual(broken, files[path], `${why}: the tree did not change`)
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [path]: broken }))
    assert.deepEqual(unreadable.map(({ part }) => part), [unaskedPart()], why)
    assert.match(unreadable[0]?.why ?? '', new RegExp(why), why)
  }
})

/** The part that reads the engine's own folders (#541 package A), asked inside a test so a broken reader fails that test by name. */
const foldersPart = (): string | undefined => partReading('engine_folders')

test("the engine's own folders are read as its paths module picks them: each kind joined to a path root, and the layout's folder or one under the home without one (#541 package A, design G1; mutants: a join dropped, the layout's folder read as the home)", () => {
  const recorded = RECORDED_FACTS.engine_folders
  const changed = {
    under_root: { ...Object.fromEntries(Object.entries(recorded.under_root).map(([kind, parts]) => [kind, [...parts, `${kind}_moved`]])), a_new_kind: ['a_new_folder'] },
    without_root: { ...Object.fromEntries(Object.entries(recorded.without_root).map(([kind, place]) => [kind, 'layout' in place ? { layout: `${place.layout}_moved` } : { home: [...place.home, `${kind}_moved`] }])), a_new_kind: { home: ['a_new_folder'] } },
  }
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, engine_folders: changed })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.engine_folders, changed)
})

test('a folder kind only one arm names, or a folder picked in a shape this reader does not know, makes the folders unreadable by name (#541 package A; mutants: each throw dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const paths = files[ENGINE_PLACES.paths] ?? ''
  const [kind] = Object.keys(RECORDED_FACTS.engine_folders.under_root)
  assert.ok(kind !== undefined)
  const arm = `                DirType::${kind.charAt(0).toUpperCase()}${kind.slice(1)} => `
  const at = paths.indexOf(`        } else {\n            let strategy`)
  const withRoot = paths.indexOf(arm)
  const withoutRoot = paths.indexOf(arm, at)
  assert.ok(at > 0 && withRoot > 0 && withoutRoot > at, 'the tree names the kind in both arms')
  const lineAt = (from: number): string => paths.slice(from, paths.indexOf('\n', from) + 1)
  const cases = [
    ['under a path root and', paths.replace(lineAt(withRoot), '')],
    ['under a path root as', paths.replace(lineAt(withRoot), `${arm}elsewhere.join("${kind}"),\n`)],
    ['without a path root as', `${paths.slice(0, withoutRoot)}${arm}PathBuf::from("/${kind}"),\n${paths.slice(withoutRoot + lineAt(withoutRoot).length)}`],
  ] as const
  for (const [why, broken] of cases) {
    assert.notEqual(broken, paths, `${why}: the tree did not change`)
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.paths]: broken }))
    assert.deepEqual(unreadable.map(({ part }) => part), [foldersPart()], why)
    assert.match(unreadable[0]?.why ?? '', new RegExp(why), why)
  }
})

test("each Developer tool's hints are read in from_raw's order, so a hint the engine turns is read turned (#541 package A, design G1; mutants: two hints read in each other's place, a hint read as always false)", () => {
  const turned = RECORDED_FACTS.developer_tools.map((tool, at) => ({ ...tool, hints: at % 2 === 0 ? { read_only: !tool.hints.read_only, destructive: tool.hints.destructive, open_world: !tool.hints.open_world } : { ...tool.hints, destructive: !tool.hints.destructive } }))
  const { facts, unreadable } = engineFactsIn(anEngineSourceSaying(engineFilesSaying({ ...RECORDED_FACTS, developer_tools: turned })))
  assert.deepEqual(unreadable, [])
  assert.deepEqual(facts.developer_tools, turned)
})

test('a Developer tool listed without its hints, or with a hint that is not Some(true) or Some(false), makes the tools unreadable by name (#541 package A; mutant: the throw dropped)', () => {
  const files = engineFilesSaying(RECORDED_FACTS)
  const text = files[ENGINE_PLACES.shell_tool] ?? ''
  const [first] = RECORDED_FACTS.developer_tools
  assert.ok(first !== undefined)
  const annotation = /\n {12}\.annotate\(ToolAnnotations::from_raw\([\s\S]*?\n {12}\)\),/.exec(text)?.[0] ?? ''
  assert.notEqual(annotation, '', 'the tree annotates its tools')
  for (const broken of [text.replace(annotation, ','), text.replace(annotation, annotation.replace(/Some\((true|false)\)/, 'None'))]) {
    assert.notEqual(broken, text)
    const { unreadable } = engineFactsIn(anEngineSourceSaying({ ...files, [ENGINE_PLACES.shell_tool]: broken }))
    assert.ok(unreadable.some(({ part, why }) => part === partReading('developer_tools') && why.includes(`lists the tool ${first.name} without the hints`)), JSON.stringify(unreadable))
  }
})
