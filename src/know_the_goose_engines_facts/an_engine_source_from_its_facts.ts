// An engine source tree that says the facts it is given, in the shapes the engine's own source spells them
// (macula-io/martha#541, package 10).
//
// This exists so the reader and the drift check are proven on every tip with no checkout of the engine: a test builds
// a tree from the committed recording, changes one fact, and sees the check name it. The shapes are the engine's
// (the `map.insert(...)` of its platform extension map, its `GooseMode` enum, its `vec![option(...)]`), cut to what
// the reader looks at. Extension keys are written three ways, as the engine writes them: a string, a module file's
// EXTENSION_NAME, and a constant kept in another file of a module directory.

import { join } from 'node:path'

import { ENGINE_PLACES, type EngineFacts, type EngineSource, type PlatformExtension } from './the_engines_facts_in_its_source.ts'

const pascalCase = (snake: string): string => snake.split('_').map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')

const EXTENSIONS_DIR = 'crates/goose/src/agents/platform_extensions'
const CRATE_DIR = 'crates/goose/src'

/** How an extension's key is written in the map, and the module file that holds it when it is a module's constant. */
function keyOf(extension: PlatformExtension, index: number): { readonly key: string; readonly files: Readonly<Record<string, string>> } {
  const constant = `pub static EXTENSION_NAME: &str = "${extension.key}";\n`
  if (index % 3 === 0) return { key: `"${extension.key}"`, files: {} }
  if (index % 3 === 1) return { key: `ext${index}::EXTENSION_NAME`, files: { [join(EXTENSIONS_DIR, `ext${index}.rs`)]: constant } }
  const module = join(CRATE_DIR, `ext${index}`)
  return { key: `crate::ext${index}::EXTENSION_NAME`, files: { [join(module, 'mod.rs')]: `pub use client::EXTENSION_NAME;\n`, [join(module, 'client.rs')]: constant } }
}

function platformExtensionMap(extensions: readonly PlatformExtension[]): Readonly<Record<string, string>> {
  const keyed = extensions.map(keyOf)
  const inserts = extensions.map((extension, index) => [
    extension.feature === null ? '' : `        #[cfg(feature = "${extension.feature}")]\n`,
    `        map.insert(\n            ${keyed[index]?.key ?? ''},\n            PlatformExtensionDef {\n`,
    `                default_enabled: ${String(extension.default_enabled)},\n                hidden: ${String(extension.hidden)},\n`,
    '            },\n        );\n',
  ].join(''))
  const map = `let mut map = HashMap::new();\n\n${inserts.join('\n')}`
  return Object.assign({ [ENGINE_PLACES.platform_extensions]: map }, ...keyed.map(({ files }) => files)) as Record<string, string>
}

/** Every file of a tree that says `facts`, by its path in the checkout. */
export function engineFilesSaying(facts: EngineFacts): Readonly<Record<string, string>> {
  const modes = facts.mode.values.map((mode) => `    #[strum(message = "a mode")]\n    ${pascalCase(mode)},\n`).join('')
  const options = facts.permission_options.map((kind) => `            option(PermissionOptionKind::${pascalCase(kind)}),\n`).join('')
  const settings = facts.openai_provider.settings.map((setting) => `                ConfigKey::new("${setting}", false, false, None, false),\n`).join('')
  return {
    [ENGINE_PLACES.workspace]: `[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nedition = "2024"\nversion = "${facts.engine_version}"\n`,
    [ENGINE_PLACES.engine_name]: `macro_rules! engine_name {\n    () => {\n        "${facts.engine_name}"\n    };\n}\n`,
    [ENGINE_PLACES.cli]: `        Some(Command::Acp { .. }) => "${facts.acp_command}",\n`,
    [ENGINE_PLACES.paths]: `    pub(crate) fn path_root() -> Option<PathBuf> {\n        Self::validated_path_root(std::env::var_os("${facts.path_root_variable}"))\n    }\n`,
    [ENGINE_PLACES.slash_commands]: `pub fn slash_commands_enabled() -> bool {\n    crate::config::Config::global()\n        .get_param::<bool>("${facts.slash_commands.setting}")\n        .unwrap_or(${String(facts.slash_commands.when_unset)})\n}\n`,
    [ENGINE_PLACES.modes]: `pub enum GooseMode {\n    #[default]\n${modes}}\n`,
    [ENGINE_PLACES.mode_when_unset]: `impl Config {\n    pub(crate) fn resolve_goose_mode(&self) -> Result<GooseMode, ConfigError> {\n        match self.get_param_strict("${facts.mode.setting}") {\n            Ok(mode) => Ok(mode),\n            Err(ConfigError::NotFound(_)) => Ok(GooseMode::${pascalCase(facts.mode.when_unset)}),\n            Err(error) => Err(error),\n        }\n    }\n}\n`,
    ...platformExtensionMap(facts.platform_extensions),
    [ENGINE_PLACES.acp_server]: `        let options = vec![\n${options}        ];\n`,
    [ENGINE_PLACES.openai_provider]: `pub const OPEN_AI_PROVIDER_NAME: &str = "${facts.openai_provider.name}";\npub const OPEN_AI_DEFAULT_BASE_PATH: &str = "${facts.openai_provider.default_base_path}";\n            vec![\n${settings}            ],\n`,
  }
}

/** The same tree as a reader, for a test that never touches the disk. */
export function anEngineSourceSaying(files: Readonly<Record<string, string>>): EngineSource {
  return {
    read: (path) => files[path],
    list: (directory) => Object.keys(files).filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1)).filter((rest) => !rest.includes('/')),
  }
}
