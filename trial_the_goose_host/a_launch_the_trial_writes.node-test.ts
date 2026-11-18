// The launch config keeps skills away from the member's model (macula-io/martha#614).
//
// This exists because the engine stopped switching skills off through a platform extension: the extensions
// mapping in the config root reaches no skills any more, so the model is offered every skill on the box and
// the `load_skill` tool with them. The rule these cases pin: the launch writes the engine's own skills switch
// off, with the setting's name and its unset value read from the engine at hand and never typed here.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { aPlaceFor, skillsSwitchIn, skillsSwitchedOffIn, writeTheConfig } from './a_launch_the_trial_writes.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

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
 * The engine's skills switch, spelled the way the engine spells it: a setting named by a constant, read
 * with its unset value. The name is the fixture's own, so a launch that typed the real one instead of
 * reading this file cannot pass.
 */
function servicesDeclaring(setting: string, whenUnset: boolean): string {
  return [
    `pub const SKILLS_ADVERTISED_SETTING: &str = "${setting}";`,
    '',
    'pub fn skills_advertised(config: &Config) -> bool {',
    '    config',
    '        .get_param::<bool>(SKILLS_ADVERTISED_SETTING)',
    `        .unwrap_or(${String(whenUnset)})`,
    '}',
    '',
  ].join('\n')
}

const PLACES = {
  extensions: 'crates/goose/src/agents/platform_extensions/mod.rs',
  developer: 'crates/goose/src/agents/platform_extensions/developer.rs',
  services: 'crates/goose/src/agents/services.rs',
}

/** An engine that declares the skills switch, with its name and its unset value as given. */
function anEngineWithASkillsSwitch(setting: string, whenUnset: boolean): string {
  return anEngineSource({
    [PLACES.extensions]: THE_EXTENSIONS_MAP,
    [PLACES.developer]: DEVELOPER,
    [PLACES.services]: servicesDeclaring(setting, whenUnset),
  })
}

/** The extensions map of an engine from before the switch: Developer, and Skills as an extension of its own. */
const THE_EXTENSIONS_MAP_WITH_SKILLS = THE_EXTENSIONS_MAP.replace(
  '    map\n',
  [
    '    map.insert(',
    '        crate::skills::EXTENSION_NAME,',
    '        PlatformExtensionDef {',
    '            default_enabled: true,',
    '            hidden: false,',
    '        },',
    '    );',
    '    map',
    '',
  ].join('\n'),
)

/** The engine before the switch existed: no such setting, and skills switched off as an extension. */
function anEngineWithNoSkillsSwitch(): string {
  return anEngineSource({
    [PLACES.extensions]: THE_EXTENSIONS_MAP_WITH_SKILLS,
    [PLACES.developer]: DEVELOPER,
    'crates/goose/src/skills/client.rs': 'pub static EXTENSION_NAME: &str = "skills";\n',
  })
}

/** An engine after upstream dropped the extension but without the port: neither a setting nor an extension. */
function anEngineWithNeither(): string {
  return anEngineSource({
    [PLACES.extensions]: THE_EXTENSIONS_MAP,
    [PLACES.developer]: DEVELOPER,
  })
}

/** The config root one launch writes against `engine`, and its text. */
function theConfigA(engine: string) {
  const place = aPlaceFor(9, aFreshDirectory(), aFreshDirectory())
  const at = writeTheConfig(place, 'the-trial-model', 'http://127.0.0.1:9', engine)
  return { place, at, text: readFileSync(at, 'utf8') }
}

test("the launch writes the engine's skills switch off, under the name the engine gives it (martha#614)", () => {
  const engine = anEngineWithASkillsSwitch('THE_TRIAL_ENGINES_SKILLS_SETTING', true)
  const { text } = theConfigA(engine)

  assert.match(text, /^THE_TRIAL_ENGINES_SKILLS_SETTING: false$/m,
    "the launch keeps the model from picking a skill, with the engine's own setting name")
  assert.doesNotMatch(text, /GOOSE_SKILLS_ADVERTISED/,
    'the setting is read from the engine, never typed into the launch')
  assert.match(text, /^GOOSE_SLASH_COMMANDS_ENABLED: false$/m, 'and the rest of the root is written as before')
})

test('an engine whose skills are already away when the setting is unset needs no line (martha#614)', () => {
  const engine = anEngineWithASkillsSwitch('THE_TRIAL_ENGINES_SKILLS_SETTING', false)
  assert.deepEqual(skillsSwitchedOffIn(engine), [], 'there is nothing to switch off')
  assert.doesNotMatch(theConfigA(engine).text, /THE_TRIAL_ENGINES_SKILLS_SETTING/)
})

test("an engine with no skills setting gets no line: the extensions mapping is that engine's switch (martha#614)", () => {
  const engine = anEngineWithNoSkillsSwitch()
  assert.equal(skillsSwitchIn(engine), undefined, 'the engine declares no such setting')
  const { text } = theConfigA(engine)
  assert.doesNotMatch(text, /SKILLS/, 'no skills line is invented for an engine that has none')
  assert.match(text, /^  developer:$/m, 'and the engine still gets its extension switches')
  assert.match(text, /^  skills:\n    enabled: false$/m, 'skills switched off as that engine spells it')
})

test('an engine with neither the skills setting nor the skills extension is refused by name (martha#614)', () => {
  const engine = anEngineWithNeither()
  assert.throws(() => theConfigA(engine), /declares no skills switch .* and no skills extension: its model would be offered every skill/)
})

test('a setting named by a constant the engine never defines is said out loud, not skipped (martha#614)', () => {
  const engine = anEngineSource({
    [PLACES.extensions]: THE_EXTENSIONS_MAP,
    [PLACES.developer]: DEVELOPER,
    [PLACES.services]: [
      'pub fn skills_advertised(config: &Config) -> bool {',
      '    config',
      '        .get_param::<bool>(SKILLS_ADVERTISED_SETTING)',
      '        .unwrap_or(true)',
      '}',
      '',
    ].join('\n'),
  })
  assert.throws(() => skillsSwitchIn(engine), /reads SKILLS_ADVERTISED_SETTING, which it never defines/)
})

test('the setting is read with the value the engine runs an unset one with (martha#614)', () => {
  assert.deepEqual(skillsSwitchIn(anEngineWithASkillsSwitch('THE_TRIAL_ENGINES_SKILLS_SETTING', true)),
    { setting: 'THE_TRIAL_ENGINES_SKILLS_SETTING', whenUnset: true })
  assert.deepEqual(skillsSwitchIn(anEngineWithASkillsSwitch('THE_TRIAL_ENGINES_SKILLS_SETTING', false)),
    { setting: 'THE_TRIAL_ENGINES_SKILLS_SETTING', whenUnset: false })
})
