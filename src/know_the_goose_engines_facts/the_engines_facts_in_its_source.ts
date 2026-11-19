// What the Goose engine says about itself, read from its own source tree (macula-io/martha#541, package 10).
//
// This exists so a member can work in Goose with nothing about the engine typed by hand: the launcher writes the
// engine's config root from these facts (which extension keys to switch off, which mode to pin, which variable moves
// the config root), the adapter answers permission requests from the kinds the engine offers, and the model stand-in
// listens on the path the engine's OpenAI provider posts to. The crew's tool server is written into the config root
// as the engine's own stdio entry, and answers each call in the session the engine names in the call's meta. Each fact is read from the place in the engine's source
// that decides it, so a change there is a difference the drift check names, never a launch that quietly trusts an
// old list.
//
// It is pure: the caller hands in a reader over one checkout of the engine, and every part either reads or throws,
// naming what it could not find. The recorder (src/record_the_goose_engine/) does the reading from disk.

import { dirname, join } from 'node:path'

import { CLOSED_VOCABULARY, OPEN_VOCABULARY, vocabularyOf, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'

/** One platform extension the engine declares, by the key its config switches it with (martha#541 trial, finding 4). */
export interface PlatformExtension {
  /** The key in the config root's `extensions` mapping: not always the extension's display name. */
  readonly key: string
  /** Whether the engine turns it on in a config that does not name it. */
  readonly default_enabled: boolean
  /** Whether the engine hides it from its own extension lists; a hidden extension still runs when enabled. */
  readonly hidden: boolean
  /** The cargo feature it is compiled under, or null when every build carries it. */
  readonly feature: string | null
}

/** Everything the recording holds about one engine, besides the commit it was read at. */
export interface EngineFacts {
  /** The engine's own name: its binary, and the folders it keeps for itself. */
  readonly engine_name: string
  /** The workspace version every crate of the engine carries. */
  readonly engine_version: string
  /** The subcommand that runs the engine as an ACP agent on stdio. */
  readonly acp_command: string
  /** The variable that moves every folder the engine reads through its paths to one root. */
  readonly path_root_variable: string
  /** The setting that turns `/` commands on and off, and what the engine does when it is not set. */
  readonly slash_commands: { readonly setting: string; readonly when_unset: boolean }
  /** The setting that names the mode, the modes it takes, and the mode the engine runs when it is not set. */
  readonly mode: { readonly setting: string; readonly values: readonly string[]; readonly when_unset: string }
  /** Every platform extension, in the order the engine declares them. */
  readonly platform_extensions: readonly PlatformExtension[]
  /** The answers the engine's ACP server offers a client for a tool call, as their wire ids, in its order. */
  readonly permission_options: readonly string[]
  /** The OpenAI provider: its name, the settings it reads, and the path it posts to under a host. */
  readonly openai_provider: { readonly name: string; readonly settings: readonly string[]; readonly default_base_path: string }
  /** The model names the delegate tool takes: closed when its schema lists them, open when it takes any text (#541 package 6). */
  readonly subagent_models: ModelVocabulary
  /**
   * The files the engine reads into every prompt from the folder it starts in (martha#785): its own hints file, the
   * instruction file, the setting whose value replaces the list, and the list it loads when that setting is unset, in
   * its order. A launch records exactly these, so none is typed by hand.
   */
  readonly hint_files: { readonly setting: string; readonly goose_hints: string; readonly agents_md: string; readonly when_unset: readonly string[] }
  /** The entry a config's `extensions` holds to start a tool server on stdio (#541 part C, C1). */
  readonly stdio_extension: StdioExtension
  /** The key of a tool call's `_meta` the engine names the calling session under, so a tool server answers in that session. */
  readonly tool_call_session_key: string
  /**
   * The setting that opts the engine into sending usage events to its makers, and what an unset one means (#541,
   * Jupiter's row 6): read from the function the engine asks before it sends anything, so a launch writes it off by name.
   */
  readonly telemetry: ATelemetrySwitch
  /** The setting that offers the model skills at all (`load_skill` and the list in the prompt), and its unset default (martha#839). */
  readonly skills_advertised: ASkillsSwitch
  /** The setting that offers the model the engine's compiled-in skills on their own, and its unset default (martha#839). */
  readonly builtin_skills_advertised: ASkillsSwitch
  /**
   * How the engine names a called tool to its client (#541 part C4): the path under a `tool_call` update's `_meta` that
   * holds the tool's name (its permission request carries only a title made for people), the separator between an
   * extension's name and its tool's own name, and the end of the name the engine splits at.
   */
  readonly tool_naming: ToolNaming
  /**
   * The own name of the shell tool of the extension a member keeps (#541 part C4): the tool the Developer extension
   * lists on its shell parameters and runs a command for, the name the shell hold reads while an agent runs (martha#562).
   */
  readonly shell_tool: string
  /**
   * The places in the checkout it starts in that the engine reads skills and plugins from (martha#614): its skill
   * folders, its project plugin folder (every child of it is a plugin, enabled unless a settings file says otherwise),
   * and the two project settings files that switch plugins. The gate reads its families from these, so a folder the
   * engine renames or adds is a drift the check names, never a skill that reaches the model past the gate.
   */
  readonly checkout_skill_roots: CheckoutSkillRoots
}

/** The engine's naming of a called tool: where a client reads it, and how it splits into an extension's and a tool's own name. */
export interface ToolNaming {
  readonly meta_path: readonly string[]
  readonly separator: string
  readonly split_at: 'first' | 'last'
}

/**
 * How the engine reads an entry that starts a tool server on stdio: the key its variant is tagged by and the value that
 * picks this variant, every key the variant reads, and the environment names the engine drops from the entry's `envs`
 * with only a warning, so a variable the launcher needs the server to see is never one the engine silently removes.
 */
export interface StdioExtension {
  readonly tag: string
  readonly type: string
  readonly keys: readonly string[]
  readonly disallowed_env: readonly string[]
}

/** Where a checkout gives the engine skills, each path relative to the checkout (martha#614). */
export interface CheckoutSkillRoots {
  readonly skill_folders: readonly string[]
  readonly plugin_folder: string
  readonly plugin_settings: readonly string[]
}

/** A switch the engine reads with `get_param::<bool>` through a constant: the setting it names, and what an unset one means. */
export interface ASkillsSwitch {
  readonly setting: string
  readonly when_unset: boolean
}

/** The engine's telemetry opt-in: the setting its choice is read from, and what the engine does when no choice is set. */
export interface ATelemetrySwitch {
  readonly setting: string
  readonly when_unset: boolean
}

/** Reads one checkout of the engine: a file's text, or undefined when there is none; a directory's entries, or []. */
export interface EngineSource {
  readonly read: (path: string) => string | undefined
  readonly list: (directory: string) => readonly string[]
}

/** Where in the engine each fact is decided, relative to the checkout. A file that moves makes its part unreadable. */
export const ENGINE_PLACES = {
  workspace: 'Cargo.toml',
  engine_name: 'crates/martha-engine-name/src/lib.rs',
  cli: 'crates/goose-cli/src/cli.rs',
  paths: 'crates/goose/src/config/paths.rs',
  slash_commands: 'crates/goose/src/agents/execute_commands.rs',
  modes: 'crates/goose-provider-types/src/goose_mode.rs',
  mode_when_unset: 'crates/goose/src/config/base.rs',
  platform_extensions: 'crates/goose/src/agents/platform_extensions/mod.rs',
  acp_server: 'crates/goose/src/acp/server.rs',
  openai_provider: 'crates/goose-providers/src/openai.rs',
  delegate_tool: 'crates/goose/src/agents/platform_extensions/summon.rs',
  hint_files: 'crates/goose/src/hints/load_hints.rs',
  stdio_extension: 'crates/goose-agent/src/extension.rs',
  session_context: 'crates/goose/src/session_context.rs',
  telemetry: 'crates/goose/src/posthog.rs',
  skills_advertised: 'crates/goose/src/agents/services.rs',
  builtin_skills_advertised: 'crates/goose/src/skills/mod.rs',
  tool_call_meta: 'crates/goose/src/acp/server/tool_calls/conversion.rs',
  tool_name_parts: 'crates/goose-provider-types/src/conversation/tool_request.rs',
  shell_tool: 'crates/goose/src/agents/platform_extensions/developer/mod.rs',
  skill_folders: 'crates/goose/src/skills/mod.rs',
  plugin_discovery: 'crates/goose/src/plugins/discovery.rs',
  plugin_skill_dirs: 'crates/goose/src/plugins/mod.rs',
} as const

/** The function that decides each of a checkout's skill roots, in the file ENGINE_PLACES names for it (martha#614). */
export const SKILL_ROOT_READERS = {
  skill_folders: 'all_skill_dirs_with_config',
  plugin_folder: 'project_plugin_dir',
  plugin_settings: 'project_settings_path',
} as const

/**
 * The functions a checkout's root is passed through on its way to the plugin skills (martha#614): the plugin skill
 * folders in ENGINE_PLACES.plugin_skill_dirs, and the discovery and the settings loader in ENGINE_PLACES.plugin_discovery.
 */
export const CHECKOUT_ROOT_CARRIERS = {
  plugin_skill_dirs: 'enabled_plugin_skill_dirs_with_config',
  plugin_discovery: 'discover_enabled_plugins_with_config',
  plugin_settings: 'load_all_settings',
} as const

/** The function that reads each skills switch, in the file ENGINE_PLACES names for it (martha#839). */
export const SKILLS_SWITCH_READERS = { skills_advertised: 'skills_advertised', builtin_skills_advertised: 'builtin_skills_advertised' } as const

/**
 * The two functions the engine's telemetry is decided by, in the file ENGINE_PLACES names: the one every send asks,
 * which falls back to a default, and the one it asks in turn, which reads the setting.
 */
export const TELEMETRY_READERS = { enabled: 'is_telemetry_enabled', choice: 'get_telemetry_choice' } as const

/** The constants the engine declares its two hint file names as, in the file that reads them (martha#785). */
export const HINT_FILE_CONSTANTS = { goose_hints: 'GOOSE_HINTS_FILENAME', agents_md: 'AGENTS_MD_FILENAME' } as const

/** The crate root the platform extension map's `crate::` paths start from. */
export const GOOSE_CRATE = 'crates/goose/src'
const RUST = '.rs'

/** Each part the reader takes from the engine, by the name a failed read reports. */
export const ENGINE_PARTS: ReadonlyArray<{ readonly part: string; readonly read: (source: EngineSource) => Partial<EngineFacts> }> = [
  { part: 'engine name', read: (source) => ({ engine_name: engineNameIn(source) }) },
  { part: 'engine version', read: (source) => ({ engine_version: engineVersionIn(source) }) },
  { part: 'acp command', read: (source) => ({ acp_command: acpCommandIn(source) }) },
  { part: 'path root variable', read: (source) => ({ path_root_variable: pathRootVariableIn(source) }) },
  { part: 'slash commands switch', read: (source) => ({ slash_commands: slashCommandsIn(source) }) },
  { part: 'mode setting', read: (source) => ({ mode: modeIn(source) }) },
  { part: 'platform extensions', read: (source) => ({ platform_extensions: platformExtensionsIn(source) }) },
  { part: 'permission options', read: (source) => ({ permission_options: permissionOptionsIn(source) }) },
  { part: 'openai provider', read: (source) => ({ openai_provider: openaiProviderIn(source) }) },
  { part: 'subagent models', read: (source) => ({ subagent_models: subagentModelsIn(source) }) },
  { part: 'hint files', read: (source) => ({ hint_files: hintFilesIn(source) }) },
  { part: 'stdio extension', read: (source) => ({ stdio_extension: stdioExtensionIn(source) }) },
  { part: 'tool call session key', read: (source) => ({ tool_call_session_key: toolCallSessionKeyIn(source) }) },
  { part: 'telemetry switch', read: (source) => ({ telemetry: telemetryIn(source) }) },
  { part: 'skills switch', read: (source) => ({ skills_advertised: skillsSwitchIn(source, 'skills_advertised') }) },
  { part: 'built-in skills switch', read: (source) => ({ builtin_skills_advertised: skillsSwitchIn(source, 'builtin_skills_advertised') }) },
  { part: 'tool naming', read: (source) => ({ tool_naming: toolNamingIn(source) }) },
  { part: 'shell tool', read: (source) => ({ shell_tool: shellToolIn(source) }) },
  { part: 'checkout skill roots', read: (source) => ({ checkout_skill_roots: checkoutSkillRootsIn(source) }) },
]

/** The function that builds a tool call's `_meta`, and the maps it fills from the outside in, in the file that builds it. */
export const TOOL_CALL_META = { builder: 'goose_tool_call_meta', maps: ['meta', 'goose_meta', 'tool_call_meta'] } as const

/** Where the Developer extension names its shell tool: the function that lists its tools, and the parameters the shell's are. */
export const SHELL_TOOL = { lister: 'get_tools', params: 'ShellParams' } as const

/** The two ways Rust's `str` splits once, by the end it splits at. */
export const SPLITS_ONCE = { first: 'split_once', last: 'rsplit_once' } as const

/** A file the part needs, or a throw that names it. */
function fileOf(source: EngineSource, path: string): string {
  const text = source.read(path)
  if (text === undefined) throw new Error(`no ${path}`)
  return text
}

/** The first group `pattern` captures in `text`, or a throw naming what was looked for and where. */
function captured(text: string, pattern: RegExp, what: string, path: string): string {
  const found = pattern.exec(text)?.[1]
  if (found === undefined) throw new Error(`${path} says nothing of ${what}`)
  return found
}

function engineNameIn(source: EngineSource): string {
  const path = ENGINE_PLACES.engine_name
  return captured(fileOf(source, path), /macro_rules!\s*engine_name\s*\{\s*\(\)\s*=>\s*\{\s*"([^"]+)"/, 'the engine name', path)
}

function engineVersionIn(source: EngineSource): string {
  const path = ENGINE_PLACES.workspace
  return captured(fileOf(source, path), /\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/, 'the workspace version', path)
}

function acpCommandIn(source: EngineSource): string {
  const path = ENGINE_PLACES.cli
  return captured(fileOf(source, path), /Some\(Command::Acp\s*\{\s*\.\.\s*\}\)\s*=>\s*"([^"]+)"/, 'the acp command', path)
}

function pathRootVariableIn(source: EngineSource): string {
  const path = ENGINE_PLACES.paths
  return captured(fileOf(source, path), /fn path_root\(\)[^{]*\{[^}]*?env::var_os\("([^"]+)"\)/, 'the path root variable', path)
}

function slashCommandsIn(source: EngineSource): EngineFacts['slash_commands'] {
  const path = ENGINE_PLACES.slash_commands
  const body = captured(fileOf(source, path), /fn slash_commands_enabled\(\)\s*->\s*bool\s*\{([^}]*)\}/, 'the slash commands switch', path)
  return {
    setting: captured(body, /get_param::<bool>\("([^"]+)"\)/, 'the slash commands setting', path),
    when_unset: captured(body, /unwrap_or\((true|false)\)/, 'the slash commands default', path) === 'true',
  }
}

/** A Rust variant name as serde's snake_case spells it on the wire. */
const snakeCase = (variant: string): string => variant.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase()

function modeIn(source: EngineSource): EngineFacts['mode'] {
  const modes = ENGINE_PLACES.modes
  const body = captured(fileOf(source, modes), /pub enum GooseMode\s*\{([^}]*)\}/, 'the modes', modes)
  // Attributes are dropped first: a variant is the word that ends a line with a comma once they are gone.
  const variants = body.replace(/#\[[^\]]*\]/g, '').split(',').map((part) => part.trim()).filter((part) => /^[A-Z]\w*$/.test(part))
  if (variants.length === 0) throw new Error(`${modes} names no mode`)
  const unset = ENGINE_PLACES.mode_when_unset
  const resolve = captured(fileOf(source, unset), /fn resolve_goose_mode\([^)]*\)[^{]*\{([\s\S]*?)\n {4}\}/, 'how an unset mode resolves', unset)
  return {
    setting: captured(resolve, /get_param_strict\("([^"]+)"\)/, 'the mode setting', unset),
    values: variants.map(snakeCase),
    when_unset: snakeCase(captured(resolve, /NotFound\(_\)\)\s*=>\s*Ok\(GooseMode::(\w+)\)/, 'the mode an unset setting runs', unset)),
  }
}

function platformExtensionsIn(source: EngineSource): readonly PlatformExtension[] {
  const path = ENGINE_PLACES.platform_extensions
  const text = fileOf(source, path)
  const inserts = [...text.matchAll(/(#\[cfg\(feature = "([^"]+)"\)\]\s*)?map\.insert\(\s*([^,]+?),\s*PlatformExtensionDef\s*\{([\s\S]*?)\n\s*\},?\s*\);/g)]
  if (inserts.length === 0) throw new Error(`${path} inserts no platform extension`)
  // An insert in any other shape would be dropped by the pattern above and the drift check would pass: count them all.
  const written = text.split('map.insert(').length - 1
  if (written !== inserts.length) throw new Error(`${path} inserts ${String(written)} platform extensions and ${String(inserts.length)} are in a shape this reader knows`)
  return inserts.map((insert) => {
    const fields = insert[4] ?? ''
    return {
      key: extensionKeyOf(source, (insert[3] ?? '').trim()),
      default_enabled: captured(fields, /default_enabled:\s*(true|false)/, 'an extension default', path) === 'true',
      hidden: captured(fields, /hidden:\s*(true|false)/, 'whether an extension is hidden', path) === 'true',
      feature: insert[2] ?? null,
    }
  })
}

/** A key of the map: a string as written, or a module's EXTENSION_NAME read from that module. */
function extensionKeyOf(source: EngineSource, key: string): string {
  if (key.startsWith('"')) return key.slice(1, -1)
  const segments = key.split('::')
  if (segments.at(-1) !== 'EXTENSION_NAME') throw new Error(`a platform extension is keyed by ${key}, which is neither a string nor a module's EXTENSION_NAME`)
  const modules = segments.slice(0, -1)
  const base = modules[0] === 'crate' ? GOOSE_CRATE : dirname(ENGINE_PLACES.platform_extensions)
  const module = join(base, ...modules.filter((segment) => segment !== 'crate'))
  // A module is one file or a directory of them; the constant may sit in any file of the directory (skills keeps it in client.rs).
  const files = [`${module}${RUST}`, ...source.list(module).filter((entry) => entry.endsWith(RUST)).map((entry) => join(module, entry))]
  for (const file of files) {
    const name = /EXTENSION_NAME: &str = "([^"]+)"/.exec(source.read(file) ?? '')?.[1]
    if (name !== undefined) return name
  }
  throw new Error(`no EXTENSION_NAME in ${module}`)
}

function permissionOptionsIn(source: EngineSource): readonly string[] {
  const path = ENGINE_PLACES.acp_server
  const list = captured(fileOf(source, path), /let options = vec!\[([^\]]*)\]/, 'the permission options', path)
  const kinds = [...list.matchAll(/option\(PermissionOptionKind::(\w+)\)/g)].map((found) => snakeCase(found[1] ?? ''))
  if (kinds.length === 0) throw new Error(`${path} offers no permission option`)
  return kinds
}

function openaiProviderIn(source: EngineSource): EngineFacts['openai_provider'] {
  const path = ENGINE_PLACES.openai_provider
  const text = fileOf(source, path)
  const settings = [...text.matchAll(/ConfigKey::new\(\s*"([^"]+)"/g)].map((found) => found[1] ?? '')
  if (settings.length === 0) throw new Error(`${path} reads no setting`)
  return {
    name: captured(text, /pub const OPEN_AI_PROVIDER_NAME: &str = "([^"]+)"/, 'the provider name', path),
    settings,
    default_base_path: captured(text, /pub const OPEN_AI_DEFAULT_BASE_PATH: &str = "([^"]+)"/, 'the default base path', path),
  }
}

/**
 * The models a delegate may name, read from the `model` property of the delegate tool's schema: an `enum` there is a
 * closed list and any other string is open. A property in neither shape is unreadable, never taken as open.
 */
function subagentModelsIn(source: EngineSource): ModelVocabulary {
  const path = ENGINE_PLACES.delegate_tool
  const tool = captured(fileOf(source, path), /fn create_delegate_tool\(&self\) -> Tool \{([\s\S]*?)Tool::new\(/, 'the delegate tool', path)
  const model = captured(tool, /"model":\s*\{([^}]*)\}/, "the delegate tool's model", path)
  const listed = /"enum":\s*\[([^\]]*)\]/.exec(model)?.[1]
  if (listed !== undefined) return vocabularyOf(CLOSED_VOCABULARY, [...listed.matchAll(/"([^"]+)"/g)].map((found) => found[1] ?? ''))
  if (/"type":\s*"string"/.test(model)) return vocabularyOf(OPEN_VOCABULARY, [])
  throw new Error(`${path} gives the delegate tool's model neither a list nor a string`)
}

/**
 * The files the engine reads into every prompt (martha#785), from `get_context_filenames`: the setting whose value
 * replaces the list, and the list built from the two constants when it is unset. Every entry of that list is one of the
 * file's declared constants, or the list is unreadable: a name in another shape would be dropped from it unseen.
 */
function hintFilesIn(source: EngineSource): EngineFacts['hint_files'] {
  const path = ENGINE_PLACES.hint_files
  const text = fileOf(source, path)
  const declared = new Map([...text.matchAll(/pub const (\w+): &str = "([^"]+)";/g)].map((found) => [found[1] ?? '', found[2] ?? '']))
  const valueOf = (constant: string): string => {
    const value = declared.get(constant)
    if (value === undefined) throw new Error(`${path} declares no ${constant}`)
    return value
  }
  const chosen = captured(text, /fn get_context_filenames\(\)[^{]*\{([\s\S]*?)\n\}/, 'how the hint files are chosen', path)
  const listed = captured(chosen, /vec!\[([^\]]*)\]/, 'the hint files loaded when the setting is unset', path)
  const constants = [...listed.matchAll(/(\w+)\.to_string\(\)/g)].map((found) => found[1] ?? '')
  const written = listed.split(',').filter((entry) => entry.trim() !== '').length
  if (written !== constants.length) throw new Error(`${path} lists ${String(written)} hint files and ${String(constants.length)} are in a shape this reader knows`)
  return {
    setting: captured(chosen, /get_param::<Vec<String>>\("([^"]+)"\)/, 'the hint files setting', path),
    goose_hints: valueOf(HINT_FILE_CONSTANTS.goose_hints),
    agents_md: valueOf(HINT_FILE_CONSTANTS.agents_md),
    when_unset: constants.map(valueOf),
  }
}

/** Rust text with its attributes and line comments taken out: what is left of a field is its name and its type. */
const withoutAttributesOrComments = (text: string): string => text.replace(/#\[[^\]]*\]/g, '').replace(/\/\/[^\n]*/g, '')

/**
 * The stdio variant of the engine's extension config: the serde tag of the enum, the name the variant is renamed to on
 * the wire, the field names it reads, and the list of environment names `Envs` drops. The list's declared length is
 * held against the names read, so a name in a shape this reader misses is unreadable, never a shorter list.
 */
function stdioExtensionIn(source: EngineSource): StdioExtension {
  const path = ENGINE_PLACES.stdio_extension
  const text = fileOf(source, path)
  const tag = captured(text, /#\[serde\(tag = "([^"]+)"\)\]\s*pub enum ExtensionConfig\b/, 'the tag of the extension config', path)
  const variant = /#\[serde\(rename = "([^"]+)"\)\]\s*Stdio\s*\{([\s\S]*?)\n {4}\},/.exec(text)
  if (variant?.[1] === undefined || variant[2] === undefined) throw new Error(`${path} says nothing of the stdio variant`)
  const keys = [...withoutAttributesOrComments(variant[2]).matchAll(/^\s*(\w+)\s*:/gm)].map((found) => found[1] ?? '')
  if (keys.length === 0) throw new Error(`${path} gives the stdio variant no field`)
  const listed = /const DISALLOWED_KEYS: \[&'static str; (\d+)\] = \[([\s\S]*?)\];/.exec(text)
  if (listed?.[1] === undefined || listed[2] === undefined) throw new Error(`${path} says nothing of the disallowed environment names`)
  const disallowed_env = [...withoutAttributesOrComments(listed[2]).matchAll(/"([^"]+)"/g)].map((found) => found[1] ?? '')
  if (disallowed_env.length !== Number(listed[1])) {
    throw new Error(`${path} declares ${listed[1]} disallowed environment names and ${String(disallowed_env.length)} are in a shape this reader knows`)
  }
  return { tag, type: variant[1], keys, disallowed_env }
}

function toolCallSessionKeyIn(source: EngineSource): string {
  const path = ENGINE_PLACES.session_context
  return captured(fileOf(source, path), /pub const SESSION_ID_HEADER: &str = "([^"]+)"/, "the session key of a tool call's meta", path)
}

/**
 * The telemetry opt-in, read as the engine decides it: the default comes from the function every send asks, and only
 * when that function falls back on the choice function; the setting comes from the constant the choice function passes,
 * never from the first constant in the file.
 */
function telemetryIn(source: EngineSource): ATelemetrySwitch {
  const path = ENGINE_PLACES.telemetry
  const text = fileOf(source, path)
  const { enabled, choice } = TELEMETRY_READERS
  const enabledBody = captured(text, new RegExp(`pub fn ${enabled}\\(\\)\\s*->\\s*bool\\s*\\{([^}]*)\\}`), `the function ${enabled}`, path)
  const when_unset = captured(enabledBody, new RegExp(`${choice}\\(\\)\\s*\\.unwrap_or\\((true|false)\\)`), `the default ${enabled} gives when ${choice} has none`, path)
  const choiceBody = captured(text, new RegExp(`pub fn ${choice}\\(\\)\\s*->\\s*Option<bool>\\s*\\{([\\s\\S]*?)\\n\\}`), `the function ${choice}`, path)
  const constant = captured(choiceBody, /get_param::<bool>\((\w+)\)/, `the constant ${choice} reads`, path)
  return {
    setting: captured(text, new RegExp(`pub const ${constant}: &str = "([^"]+)";`), `the value of ${constant}`, path),
    when_unset: when_unset === 'true',
  }
}

/**
 * A skills switch (martha#839): the body of the function that reads it, the constant it passes to `get_param::<bool>`,
 * that constant's value in the same file, and the default `unwrap_or` gives an unset one.
 */
function skillsSwitchIn(source: EngineSource, which: keyof typeof SKILLS_SWITCH_READERS): ASkillsSwitch {
  const path = ENGINE_PLACES[which]
  const text = fileOf(source, path)
  const reader = SKILLS_SWITCH_READERS[which]
  const body = captured(text, new RegExp(`pub fn ${reader}\\(config: &Config\\)\\s*->\\s*bool\\s*\\{([^}]*)\\}`), `the ${reader} switch`, path)
  const constant = captured(body, /get_param::<bool>\((\w+)\)/, `the constant ${reader} reads`, path)
  return {
    setting: captured(text, new RegExp(`pub const ${constant}: &str = "([^"]+)";`), `the value of ${constant}`, path),
    when_unset: captured(body, /unwrap_or\((true|false)\)/, `the default of ${reader}`, path) === 'true',
  }
}

/**
 * The engine's naming of a called tool (#541 part C4). The path is read from the function that builds a tool call's
 * `_meta`: the first key each of its maps is filled under, from the outside in. The split is read from how the engine
 * parts a name, `split_once` (at the first separator) or `rsplit_once` (at the last).
 */
function toolNamingIn(source: EngineSource): ToolNaming {
  const metaPath = ENGINE_PLACES.tool_call_meta
  const builder = captured(fileOf(source, metaPath), new RegExp(`fn ${TOOL_CALL_META.builder}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`), `the function ${TOOL_CALL_META.builder}`, metaPath)
  const meta_path = TOOL_CALL_META.maps.map((map) => captured(builder, new RegExp(`\\b${map}\\.insert\\(\\s*"([^"]+)"`), `the key ${map} is filled under`, metaPath))
  const partsPath = ENGINE_PLACES.tool_name_parts
  const parting = captured(fileOf(source, partsPath), /for ToolNameParts<'a> \{([\s\S]*?)\n\}/, 'how a tool name is parted', partsPath)
  const split = /\bname\.(r?split_once)\("([^"]+)"\)/.exec(parting)
  if (split?.[1] === undefined || split[2] === undefined) throw new Error(`${partsPath} says nothing of where a tool name is split`)
  return { meta_path, separator: split[2], split_at: split[1] === SPLITS_ONCE.last ? 'last' : 'first' }
}

/**
 * The own name of the Developer extension's shell tool (#541 part C4): the one tool its lister builds on the shell's
 * parameters, which must be the one name its call dispatch parses those parameters for. No such tool, two, or a list
 * and a dispatch that disagree, is unreadable by name, never a name guessed.
 */
function shellToolIn(source: EngineSource): string {
  const path = ENGINE_PLACES.shell_tool
  const text = fileOf(source, path)
  const listing = captured(text, new RegExp(`fn ${SHELL_TOOL.lister}\\(\\)[^{]*\\{([\\s\\S]*?)\\n {4}\\}`), `the function ${SHELL_TOOL.lister}`, path)
  const listed = [...listing.matchAll(/Tool::new\(\s*"([^"]+)"\.to_string\(\),([\s\S]*?)(?=Tool::new\(|$)/g)]
    .filter((found) => (found[2] ?? '').includes(`schema::<${SHELL_TOOL.params}>`))
    .map((found) => found[1] ?? '')
  const dispatched = [...text.matchAll(new RegExp(`"([^"]+)"\\s*=>\\s*match\\s+Self::parse_args::<${SHELL_TOOL.params}>`, 'g'))].map((found) => found[1] ?? '')
  const [name] = listed
  if (listed.length !== 1 || name === undefined) throw new Error(`${path} lists ${String(listed.length)} tools on ${SHELL_TOOL.params} in ${SHELL_TOOL.lister}, not one shell tool`)
  if (dispatched.length !== 1 || dispatched[0] !== name) throw new Error(`${path} lists the shell tool as ${name} but runs ${SHELL_TOOL.params} for ${JSON.stringify(dispatched)}`)
  return name
}

/** The body of `fn <name>(`, up to the first line that closes a top-level item, or a throw naming the function. */
function functionBody(text: string, name: string, path: string): string {
  return captured(text, new RegExp(`fn ${name}\\([\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`), `the function ${name}`, path)
}

/** The path a chain `<base>.join("a").join("b")` builds, as "a/b", or undefined when the text holds no such chain. */
function joinedFrom(text: string, base: string): string | undefined {
  const chain = new RegExp(`\\b${base}((?:\\.join\\("[^"]+"\\))+)`).exec(text)?.[1]
  return chain === undefined ? undefined : [...chain.matchAll(/\.join\("([^"]+)"\)/g)].map((found) => found[1] ?? '').join('/')
}

/**
 * A checkout's skill roots (martha#614), each from the function that decides it: the folders
 * `all_skill_dirs_with_config` joins onto the working directory, the folder `project_plugin_dir` joins onto the project
 * root, and the two files `project_settings_path` builds there. A shape this reader does not know is a throw that names
 * the function, never a shorter list.
 */
function checkoutSkillRootsIn(source: EngineSource): CheckoutSkillRoots {
  pluginRootsCarriedIn(source)
  const roots = { skill_folders: skillFoldersIn(source), ...pluginRootsIn(source) }
  for (const fromKnownBases of FOLDERS_FROM_KNOWN_BASES) fromKnownBases(source)
  workingDirectoryOnlyAsTheRoot(source)
  return roots
}

/** A `.join("…")` chain of one or more strings, as the engine writes a folder under a base, spaces taken out. */
const JOINS = '(?:\\.join\\("[^"]+"\\))+'

/** How often `pattern` stands in `text`. */
const timesIn = (text: string, pattern: string): number => [...text.matchAll(new RegExp(pattern, 'g'))].length

/** `text` with every space and line break taken out, so a shape is matched however the engine lays it out. */
const squeezed = (text: string): string => text.replace(/\s+/g, '')

/**
 * A throw naming the function and what it builds a folder from (martha#614 Done-when 6): a folder from anything but the
 * bases this reader knows may be relative, a constant, or what another function returns, and none of those is listed.
 */
function unknownBase(path: string, fn: string, what: string): Error {
  return new Error(`${path} builds a folder in ${fn} from ${what.slice(0, 80)}, none of the bases this reader knows, so a skill root there would never be listed`)
}

/** The first text in `body` that `pattern` finds once every `known` shape is taken out, or nothing when none is left. */
function leftOver(body: string, known: readonly string[], pattern: string): string | undefined {
  const rest = known.reduce((text, shape) => text.replace(new RegExp(shape, 'g'), ''), body)
  return new RegExp(`(?:${pattern})[^;]*`).exec(rest)?.[0]
}

/**
 * Every skill folder `all_skill_dirs_with_config` gathers comes from a base this reader knows (martha#614 Done-when 6):
 * the working directory or the home joined with strings, the engine's config folder joined with strings, a `for` list
 * of those, or the plugin skill folders. The list grows only by those, and is what the function gives back.
 */
function skillFoldersFromKnownBases(source: EngineSource): void {
  const path = ENGINE_PLACES.skill_folders
  const fn = SKILL_ROOT_READERS.skill_folders
  const text = fileOf(source, path)
  const body = squeezed(functionBody(text, fn, path))
  const workingDir = boundFrom(functionBody(text, fn, path), rootParameterOf(text, fn, path), fn, path)
  const list = captured(body, /letmut(\w+)=Vec::new\(\);/, `the folders ${fn} gathers`, path)
  const plugins = captured(body, new RegExp(`let(\\w+)=${CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs}\\(`), `the plugin folders ${fn} takes`, path)
  const home = captured(body, /let(\w+)=dirs::home_dir\(\);/, `the home ${fn} reads`, path)
  if (timesIn(body, `let(?:mut)?${home}=`) !== 1) throw unknownBase(path, fn, `a ${home} that is not dirs::home_dir()`)
  const homes = [...body.matchAll(new RegExp(`ifletSome\\((\\w+)\\)=${home}\\.as_ref\\(\\)`, 'g'))].map((found) => found[1] ?? '')
  const rooted = `(?:${[workingDir, ...homes].join('|')})${JOINS}`
  const pushed = `${list}\\.push\\(SkillDirectory\\{`
  const extended = `${list}\\.extend\\(${plugins}\\.(?:iter|into_iter)\\(\\)(?:\\.filter\\(\\|\\(_,\\w+\\)\\|\\*\\w+==PluginScope::\\w+\\))?\\.map\\(\\|\\(path,_\\)\\|SkillDirectory\\{`
  const grown = leftOver(body, [pushed, extended], '\\.(?:push|extend|append|insert|chain)\\(')
  if (grown !== undefined) throw unknownBase(path, fn, grown)
  const lists = [...body.matchAll(/for(\w+)in([^{]*)\{/g)].flatMap((found) => (found[2] ?? '').replace(/^\[|,?\]$/g, '').split(','))
  const unlisted = lists.find((entry) => !new RegExp(`^${rooted}$`).test(entry))
  if (unlisted !== undefined) throw unknownBase(path, fn, unlisted)
  const values = [...body.matchAll(/SkillDirectory(\{path(?::([^,}]+))?)?/g)].map((found) => (found[1] === undefined ? 'SkillDirectory' : (found[2] ?? 'path')))
  const known = `^(?:path|path\\.clone\\(\\)|${rooted}|Paths::config_dir\\(\\)${JOINS})$`
  const value = values.find((folder) => !new RegExp(known).test(folder))
  if (value !== undefined) throw unknownBase(path, fn, value)
  const binder = leftOver(body, [`for(\\w+)in\\[`, '\\|\\(path,_\\)\\|SkillDirectory'], '(?:letpath|letmutpath|Some\\(path\\)|\\|path\\||\\|\\(path,|forpathin)')
  if (binder !== undefined) throw unknownBase(path, fn, binder)
  const uses = timesIn(functionBody(text, fn, path), `(?<![.\\w])${list}\\b(?!::)`)
  if (uses !== 2 + timesIn(body, pushed) + timesIn(body, extended) || !body.endsWith(list)) throw unknownBase(path, fn, `${list}, used ${String(uses)} times`)
}

/** Every plugin `discover_enabled_plugins_with_config` finds is a child of the project or the user plugin folder (martha#614 Done-when 6). */
function pluginsFromKnownBases(source: EngineSource): void {
  const path = ENGINE_PLACES.plugin_discovery
  const fn = CHECKOUT_ROOT_CARRIERS.plugin_discovery
  const text = fileOf(source, path)
  const body = squeezed(functionBody(text, fn, path))
  const root = boundFrom(functionBody(text, fn, path), rootParameterOf(text, fn, path), fn, path)
  const project = captured(body, new RegExp(`let(\\w+)=${SKILL_ROOT_READERS.plugin_folder}\\(${root}\\);`), `the project plugin folder ${fn} reads`, path)
  const user = captured(body, /let(\w+)=plugin_install_dir\(\);/, `the user plugin folder ${fn} reads`, path)
  const bases = `${project}|${user}`
  const listed = `\\w+\\.extend\\(list_dir_children\\(&(?:${bases})\\)\\.into_iter\\(\\)\\.map\\(\\|\\((\\w+),(\\w+)\\)\\|DiscoveredPlugin\\{\\1,\\2,`
  const grown = leftOver(body, [listed], '\\.(?:push|extend|append|chain)\\(|list_dir_children\\(|DiscoveredPlugin\\{')
  if (grown !== undefined) throw unknownBase(path, fn, grown)
}

/** Every settings file `load_all_settings` reads is the user's or one `project_settings_path` builds (martha#614 Done-when 6). */
function settingsFromKnownBases(source: EngineSource): void {
  const path = ENGINE_PLACES.plugin_discovery
  const fn = CHECKOUT_ROOT_CARRIERS.plugin_settings
  const text = fileOf(source, path)
  const body = squeezed(functionBody(text, fn, path))
  const root = boundFrom(functionBody(text, fn, path), rootParameterOf(text, fn, path), fn, path)
  const user = /ifletSome\((\w+)\)=user_settings_path\(\)/.exec(body)?.[1]
  const files = [...(user === undefined ? [] : [user]), `${SKILL_ROOT_READERS.plugin_settings}\\(${root},(?:true|false)\\)`].join('|')
  const grown = leftOver(body, [`\\w+\\.push\\(\\(SettingsScope::\\w+,(?:${files})\\)\\);`], '\\.(?:push|extend|append|insert|chain)\\(')
  if (grown !== undefined) throw unknownBase(path, fn, grown)
}

/** `project_plugin_dir` and `project_settings_path` are the root joined with strings and nothing else (martha#614 Done-when 6). */
function pluginPathsFromTheRoot(source: EngineSource): void {
  const path = ENGINE_PLACES.plugin_discovery
  const text = fileOf(source, path)
  for (const [fn, tail] of [[SKILL_ROOT_READERS.plugin_folder, ''], [SKILL_ROOT_READERS.plugin_settings, '\\.join\\(file\\)']] as const) {
    const root = captured(text, new RegExp(`fn ${fn}\\((\\w+): &Path`), `the root ${fn} takes`, path)
    const body = squeezed(functionBody(text, fn, path)).replace(/^letfile=iflocal\{"[^"]+"\}else\{"[^"]+"\};/, '')
    if (!new RegExp(`^${root}${JOINS}${tail}$`).test(body)) throw unknownBase(path, fn, body)
  }
}

/** The plugin skill folders `enabled_plugin_skill_dirs_with_config` gives back are each plugin's own, from the discovery (martha#614 Done-when 6). */
function pluginSkillFoldersFromThePlugins(source: EngineSource): void {
  const path = ENGINE_PLACES.plugin_skill_dirs
  const fn = CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs
  const text = fileOf(source, path)
  const root = rootParameterOf(text, fn, path)
  const finder = CHECKOUT_ROOT_CARRIERS.plugin_discovery
  const tail = squeezed(captured(functionBody(text, fn, path), new RegExp(`\\n    ((?:\\w+::)?${finder}\\([\\s\\S]*)$`), `what ${fn} gives back`, path))
  const plugin = `(?:\\w+::)?${finder}\\(${root},config\\)\\.into_iter\\(\\)\\.flat_map\\(\\|(\\w+)\\|\\{let(\\w+)=\\1\\.root;(?:\\w+::)*installed_skill_dirs\\(&\\2\\)\\.into_iter\\(\\)\\.map\\(move\\|(\\w+)\\|\\(\\3,\\1\\.scope\\)\\)\\}\\)`
  if (!new RegExp(`^${plugin}(?:\\.filter\\(\\|\\((\\w+),_\\)\\|\\w+\\.insert\\(\\4\\.clone\\(\\)\\)\\))?\\.collect\\(\\)$`).test(tail)) throw unknownBase(path, fn, tail)
}

/** Each check that a function builds its folders only from bases this reader knows (martha#614 Done-when 6). */
const FOLDERS_FROM_KNOWN_BASES = [skillFoldersFromKnownBases, pluginsFromKnownBases, settingsFromKnownBases, pluginPathsFromTheRoot, pluginSkillFoldersFromThePlugins] as const
/**
 * The function that takes the working directory as the checkout's root itself when it is given none: the engine then
 * reads the same folders from it, and the launch starts the engine in the checkout (martha#614 Done-when 6).
 */
export const WORKING_DIRECTORY_AS_THE_ROOT = 'list_installed_skills'

/** The working directory taken anywhere in the skills file but as the root in WORKING_DIRECTORY_AS_THE_ROOT is a throw. */
function workingDirectoryOnlyAsTheRoot(source: EngineSource): void {
  const path = ENGINE_PLACES.skill_folders
  const fn = WORKING_DIRECTORY_AS_THE_ROOT
  const text = fileOf(source, path)
  const body = new RegExp(`fn ${fn}\\(`).test(text) ? functionBody(text, fn, path) : ''
  const asTheRoot = /None => \{\s*(\w+) = std::env::current_dir\(\)\.ok\(\);\s*\1\.as_deref\(\)\s*\}/
  const left = [...text.replace(body, body.replace(asTheRoot, '')).matchAll(/\bcurrent_dir\b/g)].length
  if (left > 0) throw new Error(`${path} takes the working directory ${String(left)} times outside ${fn}'s fallback to it as the root, so a skill root built from it would never be listed`)
}

/** A use of a name that a reader accounts for: its shape, and whether it stands exactly once or any number of times. */
interface AKnownUse {
  readonly shape: string
  readonly once: boolean
}

const once = (shape: string): AKnownUse => ({ shape, once: true })
const anyNumberOf = (shape: string): AKnownUse => ({ shape, once: false })

/** How often `name` stands in `text` as a name of its own: never as part of a longer name, nor as a field after a dot. */
const usesOf = (text: string, name: string): number => [...text.matchAll(new RegExp(`(?<![.\\w])${name}\\b`, 'g'))].length

/**
 * Every use of the checkout's root `name` in the body of `fn`, accounted for by `known`, each `once` shape standing
 * exactly once. A use anywhere else is a throw naming the function: a folder built from the root there is a skill root
 * this reader would never list, so the gate would never ask for it (martha#614).
 */
function everyUseKnown(body: string, name: string, known: readonly AKnownUse[], fn: string, path: string): void {
  let rest = body
  for (const { shape, once: standsOnce } of known) {
    const found = [...rest.matchAll(new RegExp(shape, 'g'))].length
    if (standsOnce && found !== 1) throw new Error(`${path} uses ${name} in ${fn} ${String(found)} times as /${shape}/, and this reader knows it once`)
    rest = rest.replace(new RegExp(shape, 'g'), '')
  }
  const left = usesOf(rest, name)
  if (left > 0) throw new Error(`${path} uses ${name} in ${fn} ${String(left)} more times than this reader knows, so a skill root built from it there would never be listed`)
}

/** The parameter `fn` takes the checkout's root in: its first, an `Option<&Path>`. */
const rootParameterOf = (text: string, fn: string, path: string): string => captured(text, new RegExp(`fn ${fn}\\(\\s*(\\w+): Option<&Path>`), `the root ${fn} takes`, path)

/** The name `if let Some(<name>) = <root> {` binds the root to in the body of `fn`. */
const boundFrom = (body: string, root: string, fn: string, path: string): string => captured(body, new RegExp(`if let Some\\((\\w+)\\) = ${root} \\{`), `the name ${fn} binds ${root} to`, path)

/**
 * The checkout's root on its way to the plugin skills, every use accounted for (martha#614): the plugin skill folders
 * pass it only to the discovery; the discovery only to the settings loader and, bound, to project_plugin_dir; the loader
 * only, bound, to the two settings files. Any other use is a throw, never a root left unlisted. A closure the discovery
 * gives a plugin's own folder under the same name rebinds it, and is no use of the root.
 */
function pluginRootsCarriedIn(source: EngineSource): void {
  const carriers = ENGINE_PLACES.plugin_skill_dirs
  const carrierText = fileOf(source, carriers)
  const carrier = CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs
  const finder = CHECKOUT_ROOT_CARRIERS.plugin_discovery
  const loader = CHECKOUT_ROOT_CARRIERS.plugin_settings
  const carried = rootParameterOf(carrierText, carrier, carriers)
  everyUseKnown(functionBody(carrierText, carrier, carriers), carried, [once(`\\b${finder}\\(${carried}, config\\)`)], carrier, carriers)

  const plugins = ENGINE_PLACES.plugin_discovery
  const discovery = fileOf(source, plugins)
  const found = rootParameterOf(discovery, finder, plugins)
  const finderBody = functionBody(discovery, finder, plugins)
  const root = boundFrom(finderBody, found, finder, plugins)
  everyUseKnown(finderBody, found, [once(`\\b${loader}\\(${found}\\)`), once(`if let Some\\(${root}\\) = ${found} \\{`)], finder, plugins)
  const rebound = `\\|\\((\\w+), ${root}\\)\\|\\s*DiscoveredPlugin \\{\\s*\\1,\\s*${root},`
  everyUseKnown(finderBody, root, [once(`if let Some\\(${root}\\)`), once(`\\b${SKILL_ROOT_READERS.plugin_folder}\\(${root}\\)`), anyNumberOf(rebound)], finder, plugins)

  const loaded = rootParameterOf(discovery, loader, plugins)
  const loaderBody = functionBody(discovery, loader, plugins)
  const settingsRoot = boundFrom(loaderBody, loaded, loader, plugins)
  everyUseKnown(loaderBody, loaded, [once(`if let Some\\(${settingsRoot}\\) = ${loaded} \\{`)], loader, plugins)
  const settingsFile = (local: boolean): AKnownUse => once(`\\b${SKILL_ROOT_READERS.plugin_settings}\\(${settingsRoot}, ${String(local)}\\)`)
  everyUseKnown(loaderBody, settingsRoot, [once(`if let Some\\(${settingsRoot}\\)`), settingsFile(false), settingsFile(true)], loader, plugins)
}

/**
 * The folders `all_skill_dirs_with_config` joins onto the working directory, or a throw naming the function. Every use
 * of the working directory is accounted for: the one `if let` that binds it, and the call that hands it to the plugin
 * skill folders; and every use of its binding is the binding itself or an entry of the list. A folder pushed from it
 * anywhere else is a throw, never a list that leaves it out.
 */
function skillFoldersIn(source: EngineSource): readonly string[] {
  const skills = ENGINE_PLACES.skill_folders
  const reader = SKILL_ROOT_READERS.skill_folders
  const text = fileOf(source, skills)
  const dirs = functionBody(text, reader, skills)
  const root = rootParameterOf(text, reader, skills)
  const workingDir = boundFrom(dirs, root, reader, skills)
  const list = `for path in \\[\\s*${workingDir}\\b[^\\]]*\\]`
  const listed = captured(dirs, new RegExp(`if let Some\\(${workingDir}\\) = ${root} \\{\\s*(${list})`), `the skill folders ${reader} reads from ${root}`, skills)
  everyUseKnown(dirs, root, [once(`if let Some\\(${workingDir}\\) = ${root} \\{`), once(`\\b${CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs}\\(${root}, config\\)`)], reader, skills)
  everyUseKnown(dirs, workingDir, [once(`if let Some\\(${workingDir}\\)`), once(list)], reader, skills)
  const entries = listed.slice(listed.indexOf('[') + 1, listed.lastIndexOf(']')).split(',').filter((entry) => entry.trim() !== '')
  const skill_folders = entries.map((entry) => joinedFrom(entry, workingDir)).filter((folder) => folder !== undefined)
  if (skill_folders.length !== entries.length) throw new Error(`${skills} lists ${String(entries.length)} skill folders and ${String(skill_folders.length)} are in a shape this reader knows`)
  return skill_folders
}

/** The folder `project_plugin_dir` joins onto the project root and the two files `project_settings_path` builds there. */
function pluginRootsIn(source: EngineSource): Pick<CheckoutSkillRoots, 'plugin_folder' | 'plugin_settings'> {
  const plugins = ENGINE_PLACES.plugin_discovery
  const discovery = fileOf(source, plugins)
  const pluginBody = functionBody(discovery, SKILL_ROOT_READERS.plugin_folder, plugins)
  const plugin_folder = joinedFrom(pluginBody, 'project_root')
  if (plugin_folder === undefined) throw new Error(`${plugins} says nothing of the folder ${SKILL_ROOT_READERS.plugin_folder} joins`)
  const settingsBody = functionBody(discovery, SKILL_ROOT_READERS.plugin_settings, plugins)
  const [, local, shared] = /let file = if local \{\s*"([^"]+)"\s*\} else \{\s*"([^"]+)"\s*\};/.exec(settingsBody) ?? []
  const folder = /project_root((?:\.join\("[^"]+"\))+)\.join\(file\)/.exec(settingsBody)?.[1]
  if (local === undefined || shared === undefined || folder === undefined) throw new Error(`${plugins} says nothing of the files ${SKILL_ROOT_READERS.plugin_settings} builds`)
  const settingsFolder = joinedFrom(`project_root${folder}`, 'project_root') ?? ''
  return { plugin_folder, plugin_settings: [`${settingsFolder}/${shared}`, `${settingsFolder}/${local}`] }
}

/** What one checkout says, part by part, and the parts that could not be read with why. */
export function engineFactsIn(source: EngineSource): { readonly facts: Partial<EngineFacts>; readonly unreadable: ReadonlyArray<{ readonly part: string; readonly why: string }> } {
  const read = ENGINE_PARTS.map(({ part, read: readPart }) => {
    try {
      return { part, fields: readPart(source), why: '' }
    } catch (error) {
      return { part, fields: undefined, why: error instanceof Error ? error.message : String(error) }
    }
  })
  return {
    facts: Object.assign({}, ...read.map(({ fields }) => fields ?? {})) as Partial<EngineFacts>,
    unreadable: read.filter(({ fields }) => fields === undefined).map(({ part, why }) => ({ part, why })),
  }
}
