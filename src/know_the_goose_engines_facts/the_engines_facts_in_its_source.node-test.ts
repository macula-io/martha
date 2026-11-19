// The reader takes every fact the recording holds from an engine tree, and names the part it cannot read
// (macula-io/martha#541, package 10). The tree is built from the committed recording, so no fact is typed here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NOTE } from '../record_claude_code_host/carry_over_what_is_restated_by_hand.ts'
import { anEngineSourceSaying, engineFilesSaying, theOtherKindOf } from './an_engine_source_from_its_facts.ts'
import { RECORDED_GOOSE_ENGINE } from './recorded_goose_engine.ts'
import { ENGINE_PARTS, ENGINE_PLACES, engineFactsIn, HINT_FILE_CONSTANTS, type EngineFacts } from './the_engines_facts_in_its_source.ts'

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
