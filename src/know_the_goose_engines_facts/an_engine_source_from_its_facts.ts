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
import { A_TRUE_SWITCH_COUNTS, DEVELOPER_DIR, ENGINE_PLACES, GOOSE_CRATE, HINT_FILE_CONSTANTS, SECRET_STORAGE, SHELL_TOOL, PATH_RESOLVER, RESOLUTION_BASES, SKILLS_SWITCH_READERS, SPLITS_ONCE, TOOL_CALL_META, type ASkillsSwitch, type DeveloperTool, type EngineFacts, type EngineSource, type PathResolution, type PlatformExtension, type SecretStorage, type ToolNaming } from './the_engines_facts_in_its_source.ts'

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

/** The provider's one secrets read as the engine writes it (#541 package A): the first secret, then the list after it. */
function openaiSecrets(secrets: readonly string[]): string {
  const [first, ...rest] = secrets
  if (first === undefined) throw new Error('a provider that reads no secret cannot be written as one get_secrets call')
  return `    let is_openai = is_direct_openai_host(&parsed.host);\n    let secrets = config\n        .get_secrets("${first}", &[${rest.map((secret) => `"${secret}"`).join(', ')}])\n        .unwrap_or_default();\n`
}

/** The secret storage's three functions as the engine's config module writes them (#541 package A). */
const secretStorage = (storage: SecretStorage): string =>
  [
    `\nfn ${SECRET_STORAGE.switch_value}(value: &serde_yaml::Value) -> bool {\n    ${A_TRUE_SWITCH_COUNTS} || value.as_str().is_some_and(|s| s == "true" || s == "1")\n}\n\n`,
    `fn ${SECRET_STORAGE.switch_in_config}(config_path: &Path) -> bool {\n    std::fs::read_to_string(config_path)\n        .ok()\n        .and_then(|s| parse_yaml_content(&s).ok())\n`,
    `        .and_then(|m| m.get("${storage.keyring_switch}").map(${SECRET_STORAGE.switch_value}))\n        .unwrap_or(false)\n}\n\n`,
    `fn ${SECRET_STORAGE.file}(config_dir: &Path) -> PathBuf {\n    config_dir.join("${storage.file}")\n}\n`,
  ].join('')

/** Files of a tree by path, where two facts the engine decides in one file are written into that one file, in order. */
function oneFilePerPath(parts: ReadonlyArray<readonly [string, string]>): Readonly<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const [path, text] of parts) files[path] = `${files[path] ?? ''}${text}`
  return files
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
    ...oneFilePerPath([
      [ENGINE_PLACES.mode_when_unset, `impl Config {\n    pub(crate) fn resolve_goose_mode(&self) -> Result<GooseMode, ConfigError> {\n        match self.get_param_strict("${facts.mode.setting}") {\n            Ok(mode) => Ok(mode),\n            Err(ConfigError::NotFound(_)) => Ok(GooseMode::${pascalCase(facts.mode.when_unset)}),\n            Err(error) => Err(error),\n        }\n    }\n}\n`],
      [ENGINE_PLACES.secret_storage, secretStorage(facts.secret_storage)],
    ]),
    [ENGINE_PLACES.openai_secrets]: openaiSecrets(facts.openai_provider.secrets),
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
    [ENGINE_PLACES.shell_tool]: developerTools(facts.shell_tool, facts.developer_tools),
    [`${DEVELOPER_DIR}/params.rs`]: developerParams(facts.developer_tools),
    [ENGINE_PLACES.path_resolution]: pathResolution(facts.path_resolution),
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
 * The Developer extension's tools as the engine writes them: each listed tool on its parameters, the shell built in a
 * block of its own and named as the recording names the shell, and the call dispatch parsing each tool's parameters for
 * its name. The tool on the shell's parameters takes the shell's name, so a recording that renames the shell renames it here.
 */
function developerTools(shell: string, tools: readonly DeveloperTool[]): string {
  const named = tools.map((tool) => (tool.params === SHELL_TOOL.params ? { ...tool, name: shell } : tool))
  const listed = named.map(({ name, params }) =>
    params === SHELL_TOOL.params
      ? `            {\n                let description = format!("Execute a command.");\n                Tool::new("${name}".to_string(), description, Self::schema::<${params}>())\n            }\n            .with_output_schema::<ShellOutput>(),\n`
      : `            Tool::new(\n                "${name}".to_string(),\n                "What ${name} does.".to_string(),\n                Self::schema::<${params}>(),\n            ),\n`,
  )
  const dispatched = named.map(({ name, params }) => `            "${name}" => match Self::parse_args::<${params}>(arguments) {\n                Ok(params) => run(params),\n                Err(error) => fail(error),\n            },\n`)
  return [
    `impl DeveloperClient {\n    pub(crate) fn ${SHELL_TOOL.lister}() -> Vec<Tool> {\n        vec![\n`,
    ...listed,
    `        ]\n    }\n}\n\n`,
    `impl PlatformExtension for DeveloperClient {\n    async fn call_tool(&self, name: &str) -> Result<CallToolResult, Error> {\n        match name {\n`,
    ...dispatched,
    `        }\n    }\n}\n`,
  ].join('')
}

/**
 * The Developer extension's parameters, each declared once: a number before the argument and a second text field after
 * it, so only the first text field is the argument.
 */
const developerParams = (tools: readonly DeveloperTool[]): string =>
  tools.map(({ params, argument }) => `pub struct ${params} {\n    #[serde(default)]\n    pub a_count: u32,\n    pub ${argument}: String,\n    pub another_text: String,\n}\n\n`).join('')

/**
 * The engine's `resolve_path` as it writes it (#541 package A): another function first that joins to another place, then
 * the resolver, with a trim or a `~` only when the recording says the engine has one, and its bases chained in order.
 */
function pathResolution(resolution: PathResolution): string {
  const words = (base: string): string => Object.entries(RESOLUTION_BASES).find(([, named]) => named === base)?.[0] ?? base
  const [first, ...rest] = resolution.bases.map(words)
  const chain = [`${first ?? ''}\n            .map(Path::to_path_buf)`, ...rest.map((base) => `\n            .or_else(|| ${base}.ok())`)].join('')
  return [
    'fn another_resolver(path: &str) -> PathBuf {\n    another_place().join(path)\n}\n\n',
    `pub(super) fn ${PATH_RESOLVER}(path: &str, working_dir: Option<&Path>) -> PathBuf {\n`,
    resolution.trims ? '    let path = path.trim();\n' : '',
    resolution.expands_home ? '    if path.starts_with("~") {\n        return home_dir();\n    }\n' : '',
    '    let path = PathBuf::from(path);\n    if path.is_absolute() {\n        path\n    } else {\n',
    `        ${chain}\n            .join(path)\n    }\n}\n`,
  ].join('')
}

/** The same tree as a reader, for a test that never touches the disk. */
export function anEngineSourceSaying(files: Readonly<Record<string, string>>): EngineSource {
  return {
    read: (path) => files[path],
    list: (directory) => Object.keys(files).filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1)).filter((rest) => !rest.includes('/')),
  }
}
