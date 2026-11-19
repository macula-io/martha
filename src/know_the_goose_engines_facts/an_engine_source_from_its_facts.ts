// An engine source tree that says the facts it is given, in the shapes the engine's own source spells them
// (macula-io/martha#541, package 10).
//
// This exists so the reader and the drift check are proven on every tip with no checkout of the engine: a test builds
// a tree from the committed recording, changes one fact, and sees the check name it. The shapes are the engine's
// (the `map.insert(...)` of its platform extension map, its `GooseMode` enum, its `vec![option(...)]`), cut to what
// the reader looks at. Extension keys are written three ways, as the engine writes them: a string, a module file's
// EXTENSION_NAME, and a constant kept in another file of a module directory.

import { dirname, join } from 'node:path'

import { CLOSED_VOCABULARY, OPEN_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { CHECKOUT_ROOT_CARRIERS, ENGINE_PLACES, GOOSE_CRATE, HINT_FILE_CONSTANTS, SHELL_TOOL, SKILL_ROOT_READERS, SKILLS_SWITCH_READERS, SPLITS_ONCE, TOOL_CALL_META, type ASkillsSwitch, type CheckoutSkillRoots, type EngineFacts, type EngineSource, type PlatformExtension, type ToolNaming } from './the_engines_facts_in_its_source.ts'

const pascalCase = (snake: string): string => snake.split('_').map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')

const EXTENSIONS_DIR = dirname(ENGINE_PLACES.platform_extensions)

/** How an extension's key is written in the map, and the module file that holds it when it is a module's constant. */
function keyOf(extension: PlatformExtension, index: number): { readonly key: string; readonly files: Readonly<Record<string, string>> } {
  const constant = `pub static EXTENSION_NAME: &str = "${extension.key}";\n`
  if (index % 3 === 0) return { key: `"${extension.key}"`, files: {} }
  if (index % 3 === 1) return { key: `ext${index}::EXTENSION_NAME`, files: { [join(EXTENSIONS_DIR, `ext${index}.rs`)]: constant } }
  const module = join(GOOSE_CRATE,`ext${index}`)
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

/** `models` turned to the other kind, closed when it is open and open when it is closed: the drift a test plants. */
export function theOtherKindOf(models: ModelVocabulary): ModelVocabulary {
  return models.kind === OPEN_VOCABULARY
    ? { kind: CLOSED_VOCABULARY, names: ['a-listed-model', 'another-listed-model'] }
    : { kind: OPEN_VOCABULARY, names: [] }
}

/** The delegate tool's schema as the engine writes it, its `model` a list when the vocabulary is closed. */
function delegateTool(models: EngineFacts['subagent_models']): string {
  const listed = models.kind === CLOSED_VOCABULARY ? `,\n                    "enum": [${models.names.map((name) => JSON.stringify(name)).join(', ')}]` : ''
  return [
    '    fn create_delegate_tool(&self) -> Tool {\n        let schema = serde_json::json!({\n            "type": "object",\n            "properties": {\n',
    '                "provider": {\n                    "type": "string",\n                    "description": "Override LLM provider."\n                },\n',
    `                "model": {\n                    "type": "string",\n                    "description": "Override model."${listed}\n                },\n`,
    '            }\n        });\n\n        Tool::new(\n            "delegate",\n',
  ].join('')
}

/** The engine's hint files as `load_hints.rs` writes them: two constants, and the list built from them (martha#785). */
function hintFiles(hints: EngineFacts['hint_files']): string {
  const constantOf = (name: string): string => {
    if (name === hints.goose_hints) return HINT_FILE_CONSTANTS.goose_hints
    if (name === hints.agents_md) return HINT_FILE_CONSTANTS.agents_md
    throw new Error(`a hint file ${name} is neither of the two the engine declares, so no tree can list it`)
  }
  const listed = hints.when_unset.map((name) => `                ${constantOf(name)}.to_string(),\n`).join('')
  return [
    `pub const ${HINT_FILE_CONSTANTS.goose_hints}: &str = "${hints.goose_hints}";\n`,
    `pub const ${HINT_FILE_CONSTANTS.agents_md}: &str = "${hints.agents_md}";\n\n`,
    `pub fn get_context_filenames() -> Vec<String> {\n    use crate::config::Config;\n\n    Config::global()\n`,
    `        .get_param::<Vec<String>>("${hints.setting}")\n        .unwrap_or_else(|_| {\n            vec![\n${listed}            ]\n        })\n}\n`,
  ].join('')
}

/**
 * The extension config as the engine writes it: the tagged enum, its stdio variant with a serde attribute over each
 * field after the first and a doc comment over one, then a second variant the reader must not read, and the `Envs`
 * list with a comment after each name, as the engine comments every one.
 */
function extensionConfig(stdio: EngineFacts['stdio_extension']): string {
  const fields = stdio.keys.map((key, index) => `${index === 0 ? '' : '        #[serde(default)]\n'}${index === 1 ? '        /// What the server is for.\n' : ''}        ${key}: String,\n`).join('')
  const names = stdio.disallowed_env.map((name) => `        "${name}", // a name the engine drops\n`).join('')
  return [
    `impl Envs {\n    const DISALLOWED_KEYS: [&'static str; ${String(stdio.disallowed_env.length)}] = [\n        // what each group is\n${names}    ];\n}\n\n`,
    `#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]\n#[serde(tag = "${stdio.tag}")]\npub enum ExtensionConfig {\n`,
    `    #[serde(rename = "${stdio.type}")]\n    Stdio {\n${fields}    },\n`,
    '    #[serde(rename = "streamable_http")]\n    StreamableHttp {\n        uri: String,\n    },\n}\n',
  ].join('')
}

/** A skills switch as the engine writes it (martha#839): a constant naming the setting, and the function reading it. */
function skillsSwitch(reader: string, switched: ASkillsSwitch): string {
  const constant = `SETTING_READ_BY_${reader}`
  return [
    `pub const ${constant}: &str = "${switched.setting}";\n\n`,
    `pub fn ${reader}(config: &Config) -> bool {\n    config\n        .get_param::<bool>(${constant})\n        .unwrap_or(${String(switched.when_unset)})\n}\n`,
  ].join('')
}

/** A path as the engine builds it: `<base>.join("a").join("b")` for "a/b". */
const joined = (base: string, path: string): string => `${base}${path.split('/').map((part) => `.join("${part}")`).join('')}`

/** The engine's skill folders as `skills/mod.rs` builds them from the working directory, then its home (martha#614). */
function skillFolders(roots: CheckoutSkillRoots): string {
  const listed = roots.skill_folders.map((folder) => `            ${joined('wd', folder)},\n`).join('')
  return [
    `fn ${SKILL_ROOT_READERS.skill_folders}(working_dir: Option<&Path>, config: &Config) -> Vec<SkillDirectory> {\n    let mut dirs = Vec::new();\n`,
    `    let plugin_dirs = ${CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs}(working_dir, config);\n\n`,
    `    if let Some(wd) = working_dir {\n        for path in [\n${listed}        ] {\n            dirs.push(SkillDirectory { path });\n        }\n    }\n`,
    `    dirs.extend(plugin_dirs.iter().map(|(path, _)| SkillDirectory { path: path.clone() }));\n`,
    `    if let Some(h) = dirs::home_dir().as_ref() {\n        dirs.push(SkillDirectory { path: ${joined('h', '.agents/skills')} });\n    }\n    dirs\n}\n`,
  ].join('')
}

/** The project plugin folder and the two settings files, as `plugins/discovery.rs` builds them (martha#614). */
function pluginDiscovery(roots: CheckoutSkillRoots): string {
  const [shared = '', local = ''] = roots.plugin_settings
  const folderOf = (file: string): string => file.slice(0, file.lastIndexOf('/'))
  const nameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1)
  if (folderOf(shared) !== folderOf(local)) throw new Error(`the two plugin settings files ${shared} and ${local} are in different folders, which the engine never builds`)
  return [
    `pub(crate) fn ${CHECKOUT_ROOT_CARRIERS.plugin_discovery}(\n    project_root: Option<&Path>,\n    config: &Config,\n) -> Vec<DiscoveredPlugin> {\n`,
    `    let scoped_settings = ${CHECKOUT_ROOT_CARRIERS.plugin_settings}(project_root);\n    let mut found = Vec::new();\n`,
    `    if let Some(root) = project_root {\n        let project_plugins_dir = ${SKILL_ROOT_READERS.plugin_folder}(root);\n`,
    `        found.extend(list_dir_children(&project_plugins_dir).into_iter().map(\n            |(name, root)| DiscoveredPlugin {\n                name,\n                root,\n                scope: PluginScope::Project,\n            },\n        ));\n    }\n`,
    `    found.extend(list_dir_children(&plugin_install_dir()).into_iter().map(|(name, root)| DiscoveredPlugin {\n        name,\n        root,\n        scope: PluginScope::User,\n    }));\n`,
    `    found.sort_by(|left, right| left.root.cmp(&right.root));\n    found\n}\n\n`,
    `fn ${CHECKOUT_ROOT_CARRIERS.plugin_settings}(project_root: Option<&Path>) -> Vec<(SettingsScope, PluginSettings)> {\n    let mut paths: Vec<(SettingsScope, PathBuf)> = Vec::new();\n`,
    `    if let Some(root) = project_root {\n        paths.push((SettingsScope::Project, ${SKILL_ROOT_READERS.plugin_settings}(root, false)));\n        paths.push((SettingsScope::Local, ${SKILL_ROOT_READERS.plugin_settings}(root, true)));\n    }\n    paths\n}\n\n`,
    `fn ${SKILL_ROOT_READERS.plugin_folder}(project_root: &Path) -> PathBuf {\n    ${joined('project_root', roots.plugin_folder)}\n}\n\n`,
    `fn ${SKILL_ROOT_READERS.plugin_settings}(project_root: &Path, local: bool) -> PathBuf {\n    let file = if local {\n        "${nameOf(local)}"\n    } else {\n        "${nameOf(shared)}"\n    };\n`,
    `    ${joined('project_root', folderOf(shared))}.join(file)\n}\n`,
  ].join('')
}

/** The plugin skill folders as `plugins/mod.rs` gathers them, handing the checkout's root to the discovery (martha#614). */
const pluginSkillDirs = (): string => [
  `pub(crate) fn ${CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs}(\n    project_root: Option<&Path>,\n    config: &Config,\n) -> Vec<(PathBuf, PluginScope)> {\n`,
  `    let plugins_dir = plugin_install_dir();\n    discovery::${CHECKOUT_ROOT_CARRIERS.plugin_discovery}(project_root, config)\n        .into_iter()\n`,
  `        .flat_map(|plugin| installed_skill_dirs(&plugin.root).into_iter().map(move |dir| (dir, plugin.scope)))\n        .collect()\n}\n`,
].join('')

/** Files that share a path are one file, their texts in the order given: two parts may be decided in the same file. */
function oneFilePerPath(files: ReadonlyArray<readonly [string, string]>): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {}
  for (const [path, text] of files) merged[path] = `${merged[path] ?? ''}${text}`
  return merged
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
    [ENGINE_PLACES.delegate_tool]: delegateTool(facts.subagent_models),
    [ENGINE_PLACES.hint_files]: hintFiles(facts.hint_files),
    [ENGINE_PLACES.stdio_extension]: extensionConfig(facts.stdio_extension),
    [ENGINE_PLACES.session_context]: `pub const SESSION_ID_HEADER: &str = "${facts.tool_call_session_key}";\n\npub const TOOL_CALL_REQUEST_ID_HEADER: &str = "another-key";\n`,
    [ENGINE_PLACES.skills_advertised]: skillsSwitch(SKILLS_SWITCH_READERS.skills_advertised, facts.skills_advertised),
    [ENGINE_PLACES.builtin_skills_advertised]: skillsSwitch(SKILLS_SWITCH_READERS.builtin_skills_advertised, facts.builtin_skills_advertised),
    [ENGINE_PLACES.tool_call_meta]: toolCallMeta(facts.tool_naming),
    [ENGINE_PLACES.tool_name_parts]: toolNameParts(facts.tool_naming),
    [ENGINE_PLACES.shell_tool]: developerTools(facts.shell_tool),
    ...oneFilePerPath([
      [ENGINE_PLACES.builtin_skills_advertised, skillsSwitch(SKILLS_SWITCH_READERS.builtin_skills_advertised, facts.builtin_skills_advertised)],
      [ENGINE_PLACES.skill_folders, skillFolders(facts.checkout_skill_roots)],
      [ENGINE_PLACES.plugin_discovery, pluginDiscovery(facts.checkout_skill_roots)],
    ]),
    [ENGINE_PLACES.plugin_skill_dirs]: pluginSkillDirs(),
    [ENGINE_PLACES.openai_provider]: `pub const OPEN_AI_PROVIDER_NAME: &str = "${facts.openai_provider.name}";\npub const OPEN_AI_DEFAULT_BASE_PATH: &str = "${facts.openai_provider.default_base_path}";\n            vec![\n${settings}            ],\n`,
  }
}

/**
 * A tool call's `_meta` as the engine builds it: each map filled from the inside out, a second key beside the name, as
 * the engine puts the extension's name there, and another function before it filling a map of the same name, which is not this one.
 */
function toolCallMeta(naming: ToolNaming): string {
  const [outer, middle, inner] = TOOL_CALL_META.maps
  const [outerKey, middleKey, innerKey] = naming.meta_path
  return [
    `fn another_meta() -> Meta {\n    ${outer}.insert("another_outer_key".to_string(), value);\n}\n\n`,
    `pub(crate) fn ${TOOL_CALL_META.builder}(tool_request: &ToolRequest) -> Option<Meta> {\n`,
    `    let mut ${inner} = serde_json::Map::new();\n    ${inner}.insert("${innerKey ?? ''}".to_string(), name);\n    ${inner}.insert("another_key".to_string(), extension);\n`,
    `    let mut ${middle} = serde_json::Map::new();\n    ${middle}.insert("${middleKey ?? ''}".to_string(), serde_json::Value::Object(${inner}));\n`,
    `    let mut ${outer} = serde_json::Map::new();\n    ${outer}.insert("${outerKey ?? ''}".to_string(), serde_json::Value::Object(${middle}));\n    Some(${outer})\n}\n`,
  ].join('')
}

/** How the engine parts a tool's name, at the end the recording says. */
const toolNameParts = (naming: ToolNaming): string =>
  `impl<'a> From<&'a str> for ToolNameParts<'a> {\n    fn from(name: &'a str) -> Self {\n        match name.${SPLITS_ONCE[naming.split_at]}("${naming.separator}") {\n            Some((extension_name, tool_name)) => Self { extension_name: Some(extension_name), tool_name },\n            None => Self { extension_name: None, tool_name: name },\n        }\n    }\n}\n`

/**
 * The Developer extension's tools as the engine writes them: another tool before the shell, the shell built in a block
 * of its own on its parameters, and the call dispatch parsing those parameters for the shell's name.
 */
const developerTools = (shell: string): string =>
  [
    `impl DeveloperClient {\n    pub(crate) fn ${SHELL_TOOL.lister}() -> Vec<Tool> {\n        vec![\n`,
    `            Tool::new(\n                "another_tool".to_string(),\n                "What another tool does.".to_string(),\n                Self::schema::<AnotherParams>(),\n            ),\n`,
    `            {\n                let description = format!("Execute a command.");\n                Tool::new("${shell}".to_string(), description, Self::schema::<${SHELL_TOOL.params}>())\n            }\n            .with_output_schema::<ShellOutput>(),\n`,
    `        ]\n    }\n}\n\n`,
    `impl PlatformExtension for DeveloperClient {\n    async fn call_tool(&self, name: &str) -> Result<CallToolResult, Error> {\n        match name {\n`,
    `            "${shell}" => match Self::parse_args::<${SHELL_TOOL.params}>(arguments) {\n                Ok(params) => run(params),\n                Err(error) => fail(error),\n            },\n`,
    `            "another_tool" => match Self::parse_args::<AnotherParams>(arguments) {\n                Ok(params) => other(params),\n                Err(error) => fail(error),\n            },\n        }\n    }\n}\n`,
  ].join('')

/** The same tree as a reader, for a test that never touches the disk. */
export function anEngineSourceSaying(files: Readonly<Record<string, string>>): EngineSource {
  return {
    read: (path) => files[path],
    list: (directory) => Object.keys(files).filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1)).filter((rest) => !rest.includes('/')),
  }
}

/**
 * The two skills switch files of a tree that says `facts`, by their paths in the checkout (martha#614): what a stand-in
 * fork needs so a launch can read both switch names from it, and nothing else of the engine.
 */
export function skillsSwitchFilesSaying(facts: EngineFacts): Readonly<Record<string, string>> {
  const files = engineFilesSaying(facts)
  const places = [ENGINE_PLACES.skills_advertised, ENGINE_PLACES.builtin_skills_advertised]
  return Object.fromEntries(places.map((place) => [place, files[place] ?? '']))
}
