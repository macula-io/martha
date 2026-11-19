// The launch config offers the model the checkout's skills and none of the engine's built-ins (macula-io/martha#614).
//
// DECIDED 2026-11-18 "Approved skills on (Recommended)" and "Switch built-ins off (Recommended)". The rule these cases
// pin: the launch writes the engine's skills switch on and its built-ins switch off, whatever the engine does with
// either unset, with each setting's name read from the engine at hand and never typed here. An engine that renames or
// drops either switch is refused by that part's name.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { aPlaceFor, theSkillsLinesIn, writeTheConfig } from './a_launch_the_trial_writes.ts'
import { ENGINE_PLACES, SKILLS_SWITCH_READERS } from '../../src/know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const made: string[] = []

after(() => {
  for (const directory of made) removeTheTree(directory)
})

/** A fresh directory, removed when the file's cases are done. */
function aFreshDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'martha-614-'))
  made.push(directory)
  return directory
}

/** The engine's own source, as much of it as the config root is read from. */
function anEngineSource(files: Readonly<Record<string, string>>): string {
  const root = aFreshDirectory()
  for (const [path, text] of Object.entries(files)) {
    const at = join(root, path)
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
  }
  return root
}

/** The one platform extension every fixture engine declares: Developer, which the launch keeps. */
const THE_EXTENSIONS_MAP = [
  "pub fn platform_extensions() -> HashMap<&'static str, PlatformExtensionDef> {",
  '    map.insert(',
  '        developer::EXTENSION_NAME,',
  '        PlatformExtensionDef {',
  '            default_enabled: true,',
  '            hidden: false,',
  '        },',
  '    );',
  '    map',
  '}',
  '',
].join('\n')

const DEVELOPER = 'pub const EXTENSION_NAME: &str = "developer";\n'

/**
 * One of the engine's skills switches, spelled the way the engine spells it: a setting named by a constant, read with
 * its unset value. The names are the fixture's own, so a launch that typed the real ones instead of reading this file
 * cannot pass.
 */
function aSwitchDeclaring(reader: string, setting: string, whenUnset: boolean): string {
  const constant = `${reader.toUpperCase()}_SETTING`
  return [
    `pub const ${constant}: &str = "${setting}";`,
    '',
    `pub fn ${reader}(config: &Config) -> bool {`,
    `    config.get_param::<bool>(${constant}).unwrap_or(${String(whenUnset)})`,
    '}',
    '',
  ].join('\n')
}

const PLACES = {
  extensions: 'crates/goose/src/agents/platform_extensions/mod.rs',
  developer: 'crates/goose/src/agents/platform_extensions/developer.rs',
}

const THE_SKILLS_SETTING = 'THE_TRIAL_ENGINES_SKILLS_SETTING'
const THE_BUILTINS_SETTING = 'THE_TRIAL_ENGINES_BUILTINS_SETTING'

/** The files of an engine that declares both skills switches, each with its unset value as given. */
function theFilesOfAnEngine(skillsWhenUnset: boolean, builtinsWhenUnset: boolean): Record<string, string> {
  return {
    [PLACES.extensions]: THE_EXTENSIONS_MAP,
    [PLACES.developer]: DEVELOPER,
    [ENGINE_PLACES.skills_advertised]: aSwitchDeclaring(SKILLS_SWITCH_READERS.skills_advertised, THE_SKILLS_SETTING, skillsWhenUnset),
    [ENGINE_PLACES.builtin_skills_advertised]: aSwitchDeclaring(SKILLS_SWITCH_READERS.builtin_skills_advertised, THE_BUILTINS_SETTING, builtinsWhenUnset),
  }
}

/** The config root one launch writes against `engine`, and its text. */
function theConfigA(engine: string) {
  const place = aPlaceFor(9, aFreshDirectory(), aFreshDirectory())
  const at = writeTheConfig(place, 'the-trial-model', 'http://127.0.0.1:9', engine)
  return { place, at, text: readFileSync(at, 'utf8') }
}

test("the launch writes the skills switch on and the built-ins switch off, under the engine's names, whatever either does unset (martha#614)", () => {
  for (const skillsWhenUnset of [true, false]) {
    for (const builtinsWhenUnset of [true, false]) {
      const { text } = theConfigA(anEngineSource(theFilesOfAnEngine(skillsWhenUnset, builtinsWhenUnset)))
      const said = `skills unset ${String(skillsWhenUnset)}, built-ins unset ${String(builtinsWhenUnset)}`
      assert.deepEqual(text.split('\n').filter((line) => line.startsWith(`${THE_SKILLS_SETTING}:`)), [`${THE_SKILLS_SETTING}: true`], said)
      assert.deepEqual(text.split('\n').filter((line) => line.startsWith(`${THE_BUILTINS_SETTING}:`)), [`${THE_BUILTINS_SETTING}: false`], said)
      assert.doesNotMatch(text, /GOOSE_(BUILTIN_)?SKILLS_ADVERTISED/, 'a setting is read from the engine, never typed into the launch')
      assert.match(text, /^GOOSE_SLASH_COMMANDS_ENABLED: false$/m, 'and the rest of the root is written as before')
    }
  }
})

test('an engine that drops either skills switch is refused by that part\'s name, never launched with the other alone (martha#614)', () => {
  for (const [dropped, part] of [
    [ENGINE_PLACES.skills_advertised, 'skills switch'],
    [ENGINE_PLACES.builtin_skills_advertised, 'built-in skills switch'],
  ] as const) {
    const { [dropped]: _gone, ...rest } = theFilesOfAnEngine(true, true)
    assert.throws(() => theSkillsLinesIn(anEngineSource(rest)), new RegExp(`the engine's ${part} cannot be read`), part)
  }
})
