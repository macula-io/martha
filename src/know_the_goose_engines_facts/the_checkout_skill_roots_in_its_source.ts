// Where a checkout gives the Goose engine skills, read from the engine's own source (macula-io/martha#614): the
// folders it joins onto the working directory and the plugin roots it finds there, every use of a base accounted for,
// so a skill root the reader does not know is a throw naming the function, never a shorter list.

import { captured, fileOf, functionBody, type EngineSource } from './read_an_engines_source.ts'

/** Where a checkout gives the engine skills, each path relative to the checkout (martha#614). */
export interface CheckoutSkillRoots {
  readonly skill_folders: readonly string[]
  readonly plugin_folder: string
  readonly plugin_settings: readonly string[]
}

/** Where in the engine each skill root is decided, relative to the checkout; spread into ENGINE_PLACES (martha#614). */
export const SKILL_ROOT_PLACES = {
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
export function checkoutSkillRootsIn(source: EngineSource): CheckoutSkillRoots {
  pluginRootsCarriedIn(source)
  const roots = { skill_folders: skillFoldersIn(source), ...pluginRootsIn(source) }
  for (const fromKnownBases of FOLDERS_FROM_KNOWN_BASES) fromKnownBases(source)
  workingDirectoryOnlyAsTheRoot(source)
  return roots
}

/**
 * A `.join("…")` chain of one or more strings, as the engine writes a folder under a base, spaces taken out. A string
 * holding `..` climbs out of the base, and one starting with `/` takes the base's place in `Path::join`, so neither is
 * a folder under it (Neptunus on PR 893 r=1, plant 09).
 */
const JOINS = '(?:\\.join\\("(?!/)(?:(?!\\.\\.)[^"])+"\\))+'

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
  const path = SKILL_ROOT_PLACES.skill_folders
  const fn = SKILL_ROOT_READERS.skill_folders
  const text = fileOf(source, path)
  const body = squeezed(functionBody(text, fn, path))
  const workingDir = boundFrom(functionBody(text, fn, path), rootParameterOf(text, fn, path), fn, path)
  const list = captured(body, /letmut(\w+)=Vec::new\(\);/, `the folders ${fn} gathers`, path)
  const plugins = captured(body, new RegExp(`let(\\w+)=${CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs}\\(${rootParameterOf(text, fn, path)},config\\);`), `the plugin folders ${fn} takes`, path)
  const home = captured(body, /let(\w+)=dirs::home_dir\(\);/, `the home ${fn} reads`, path)
  const homes = [...body.matchAll(new RegExp(`ifletSome\\((\\w+)\\)=${home}\\.as_ref\\(\\)\\{`, 'g'))].map((found) => found[1] ?? '')
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
  const expected = new Map<string, number>()
  const add = (name: string, times: number): void => void expected.set(name, (expected.get(name) ?? 0) + times)
  add(home, 1 + homes.length)
  for (const name of homes) add(name, 1)
  for (const name of new Set(homes)) add(name, [...lists, ...values].filter((folder) => new RegExp(`^${name}${JOINS}$`).test(folder)).length)
  add(plugins, 1 + timesIn(body, extended))
  add('path', values.length + timesIn(body, 'path:path\\b') + timesIn(body, 'forpathin\\[') + timesIn(body, '\\|\\(path,_\\)\\|SkillDirectory\\{path'))
  everyBaseUseKnown(functionBody(text, fn, path), expected, path, fn)
  const uses = timesIn(functionBody(text, fn, path), `(?<![.\\w])${list}\\b(?!::)`)
  if (uses !== 2 + timesIn(body, pushed) + timesIn(body, extended) || !body.endsWith(list)) throw unknownBase(path, fn, `${list}, used ${String(uses)} times`)
}

/**
 * Each name a folder is built from stands in `text` (the function's own text) exactly as often as the shapes this reader
 * knows put it there, or the check throws naming it (Neptunus on PR 893 r=2, plants 10 to 14). The names are:
 * - the home: its `let` and each `if let Some(<h>) = <home>.as_ref()`;
 * - each such `<h>`: that binding, and each folder joined onto it in a list or a push;
 * - the plugin folders: their `let` and each recognised `extend`;
 * - `path`: each SkillDirectory's field, each `path: path…` value, each `for path in [` and each `|(path, _)|` closure.
 * The plugin discovery counts its two plugin folders the same way, and the settings loader counts the user's file.
 * Every shape a binding is read from is anchored on what closes it (a `{` or a `;`), so a chain after it, a `.map(…)`
 * say, is no shape this reader knows (Neptunus on PR 893 r=3).
 *
 * The reader does not list the ways Rust can bind a name. A tuple, a match arm, a `ref`, a nested pattern or a slice
 * each write the name once more, so a binding of any shape is one use too many.
 */
function everyBaseUseKnown(text: string, known: ReadonlyMap<string, number>, path: string, fn: string): void {
  for (const [name, times] of known) {
    const uses = usesOf(text, name)
    if (uses !== times) throw unknownBase(path, fn, `${name}, which stands ${String(uses)} times where the shapes this reader knows put it ${String(times)}`)
  }
}

/** Every plugin `discover_enabled_plugins_with_config` finds is a child of the project or the user plugin folder (martha#614 Done-when 6). */
function pluginsFromKnownBases(source: EngineSource): void {
  const path = SKILL_ROOT_PLACES.plugin_discovery
  const fn = CHECKOUT_ROOT_CARRIERS.plugin_discovery
  const text = fileOf(source, path)
  const body = squeezed(functionBody(text, fn, path))
  const root = boundFrom(functionBody(text, fn, path), rootParameterOf(text, fn, path), fn, path)
  const project = captured(body, new RegExp(`let(\\w+)=${SKILL_ROOT_READERS.plugin_folder}\\(${root}\\);`), `the project plugin folder ${fn} reads`, path)
  const user = captured(body, /let(\w+)=plugin_install_dir\(\);/, `the user plugin folder ${fn} reads`, path)
  const listedFrom = (bases: string): string => `\\w+\\.extend\\(list_dir_children\\(&(?:${bases})\\)\\.into_iter\\(\\)\\.map\\(\\|\\((\\w+),(\\w+)\\)\\|DiscoveredPlugin\\{\\1,\\2,`
  const grown = leftOver(body, [listedFrom(`${project}|${user}`)], '\\.(?:push|extend|append|chain)\\(|list_dir_children\\(|DiscoveredPlugin\\{')
  if (grown !== undefined) throw unknownBase(path, fn, grown)
  // A plugin folder bound again under the same name (Neptunus on PR 893 r=3, the closed rule): each stands in its `let`,
  // each check that the two are not one folder, and each listing of its children, and nowhere else.
  const compared = timesIn(body, `equivalent_paths\\(&${project},&${user}\\)`)
  everyBaseUseKnown(functionBody(text, fn, path), new Map([project, user].map((base) => [base, 1 + compared + timesIn(body, listedFrom(base))])), path, fn)
}

/** Every settings file `load_all_settings` reads is the user's or one `project_settings_path` builds (martha#614 Done-when 6). */
function settingsFromKnownBases(source: EngineSource): void {
  const path = SKILL_ROOT_PLACES.plugin_discovery
  const fn = CHECKOUT_ROOT_CARRIERS.plugin_settings
  const text = fileOf(source, path)
  const raw = functionBody(text, fn, path)
  const body = squeezed(raw)
  const root = boundFrom(raw, rootParameterOf(text, fn, path), fn, path)
  const list = captured(body, /letmut(\w+):Vec<\(SettingsScope,PathBuf\)>=Vec::new\(\);/, `the settings files ${fn} gathers`, path)
  const binding = (name: string): string => `ifletSome\\(${name}\\)=user_settings_path\\(\\)\\{`
  const user = new RegExp(binding('(\\w+)')).exec(body)?.[1]
  const files = [...(user === undefined ? [] : [user]), `${SKILL_ROOT_READERS.plugin_settings}\\(${root},(?:true|false)\\)`].join('|')
  const pushedOf = (file: string): string => `${list}\\.push\\(\\(SettingsScope::\\w+,(?:${file})\\)\\);`
  const grown = leftOver(body, [pushedOf(files)], '\\.(?:push|extend|append|insert|chain)\\(')
  if (grown !== undefined) throw unknownBase(path, fn, grown)
  if (user === undefined) return
  // The user's file bound again under the same name (Neptunus on PR 893 r=3, S1 and S2): before the list is read back,
  // the name stands in each `if let` that binds it and each push of it, and nowhere else. What reads the list back
  // binds its own `path` in a closure, so it is not counted.
  const gathered = captured(raw, new RegExp(`^([\\s\\S]*)\\n {4}${list}\\b`), `where ${fn} reads its list back`, path)
  everyBaseUseKnown(gathered, new Map([[user, timesIn(body, binding(user)) + timesIn(body, pushedOf(user))]]), path, fn)
}

/** `project_plugin_dir` and `project_settings_path` are the root joined with strings and nothing else (martha#614 Done-when 6). */
function pluginPathsFromTheRoot(source: EngineSource): void {
  const path = SKILL_ROOT_PLACES.plugin_discovery
  const text = fileOf(source, path)
  for (const [fn, tail] of [[SKILL_ROOT_READERS.plugin_folder, ''], [SKILL_ROOT_READERS.plugin_settings, '\\.join\\(file\\)']] as const) {
    const root = captured(text, new RegExp(`fn ${fn}\\((\\w+): &Path`), `the root ${fn} takes`, path)
    const body = squeezed(functionBody(text, fn, path)).replace(/^letfile=iflocal\{"[^"]+"\}else\{"[^"]+"\};/, '')
    if (!new RegExp(`^${root}${JOINS}${tail}$`).test(body)) throw unknownBase(path, fn, body)
  }
}

/** The plugin skill folders `enabled_plugin_skill_dirs_with_config` gives back are each plugin's own, from the discovery (martha#614 Done-when 6). */
function pluginSkillFoldersFromThePlugins(source: EngineSource): void {
  const path = SKILL_ROOT_PLACES.plugin_skill_dirs
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
  const path = SKILL_ROOT_PLACES.skill_folders
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
  const carriers = SKILL_ROOT_PLACES.plugin_skill_dirs
  const carrierText = fileOf(source, carriers)
  const carrier = CHECKOUT_ROOT_CARRIERS.plugin_skill_dirs
  const finder = CHECKOUT_ROOT_CARRIERS.plugin_discovery
  const loader = CHECKOUT_ROOT_CARRIERS.plugin_settings
  const carried = rootParameterOf(carrierText, carrier, carriers)
  everyUseKnown(functionBody(carrierText, carrier, carriers), carried, [once(`\\b${finder}\\(${carried}, config\\)`)], carrier, carriers)

  const plugins = SKILL_ROOT_PLACES.plugin_discovery
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
  const skills = SKILL_ROOT_PLACES.skill_folders
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
  const plugins = SKILL_ROOT_PLACES.plugin_discovery
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
