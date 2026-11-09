// A member never writes the memory, the instructions or the code the owner's own
// Claude Code sessions load (martha#136, martha#187).
//
// This exists so text or code a member wrote cannot reach a later session, the
// owner's or another member's, as memory, as the owner's own instructions, or as
// something that session runs, with nothing recording where it came from.
//
// Claude Code keeps auto-memory in `<config dir>/projects/<project key>/memory/`
// and loads it into every session of that project. A session in a git worktree
// loads the MAIN clone's folder (measured on 2.1.319), so the key cannot be
// computed from the member's checkout: every project's memory folder is denied.
// The launcher turns the member's own memory off (CLAUDE_MEMORY_OFF) and drops
// the variables that move it (CLAUDE_MEMORY_ELSEWHERE); this is the other half,
// the publish gate refusing a member's file tool that writes there.
//
// Under the same config dirs the host also keeps places it RUNS (martha#187):
// the shell snapshots every Bash command runs first, the scripts session-env
// holds, the jobs and daemon services, plugins, hooks, workflows, routines,
// backups, `daemon.json`, `scheduled_tasks.json` and `launch.json`, the owner's
// user settings file, and the host's global config — `.claude.json`, which names
// the owner's user MCP servers, so a server entered there starts in the owner's
// next session without asking anyone. Each is a place where a member's write
// becomes code the owner's next session runs. The names are the
// recorded host's, never typed here (PROTECTED_NAME_OWNERS says who accounts for
// each), and a place the host records that no owner accounts for fails a test.
//
// Rules:
//
//   1. WHOSE CONFIG DIR. The launcher's, from its own environment: the folder the
//      owner's sessions load. The member's too, when its environment resolves
//      another. Both are denied.
//   2. WHAT IS DENIED. In each config dir: every `projects/*/memory/`, `rules/`,
//      and `CLAUDE.md`; every place the recorded host names as one it runs
//      (placesTheHostProtects); and the owner's user settings file. One place
//      sits outside those dirs: the host's global config — `.claude.json` beside
//      the home folder, or in the config dir when CLAUDE_CONFIG_DIR names one —
//      which names the owner's user MCP servers. The two
//      folders that override where memory lives, when the launcher's environment
//      sets them. Each `autoMemoryDirectory` the policy, user and carried
//      settings name.
//   3. AS THE HOST RESOLVES IT. A path is trimmed, a leading `~` resolves against
//      the host's home, the rest against the member's working directory
//      (../claude_code_host asTheHostResolves). It is denied when either the
//      path as spelled or its real path, links followed, falls inside a denied
//      place, each place taken both as named and as it leads. Every path here is
//      resolved by one function, pathToItsEnd, which follows a link at any level
//      to its end: a chain of links, a link whose target does not exist yet (read
//      from the link itself), and a `projects` folder that is a link to another
//      disk are all followed (martha#136 r=3, r=4). A chain whose end does not
//      exist yet is followed link by link, and past LINK_HOPS — or one that turns
//      on itself — it is REFUSED: the write is not allowed, since the guard cannot
//      tell which folder it lands in (martha#136 r=4, r=5). A chain that exists to
//      its end is resolved by the system in one step, up to the system's own
//      limit, and refused when the system cannot resolve it.
//   4. WRITES, NOT READS. Only the tools that write a file are refused. Reading a
//      memory file is not a path from a member to a later session.
//
// The permission rules (memoryDenyRules) carry the same places into the
// settings the host is started with: the host's own memory pass stands down
// when a permission rule refuses its write. Nothing here relies on the publish
// gate's hook firing for that pass, which runs as a fork (Pluto, martha#136 r=2).

import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { USER_SETTINGS_FILE, userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'
import { asTheHostResolves } from '../claude_code_host/claude_code_file_tools.ts'
import { FILE_ARGUMENTS } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { HOST_TRUST_RECORD_FILE } from '../launch_a_claude_code_member/host_runs_the_relay.ts'
import type { ProtectedConfigPlaces } from '../claude_code_host/protected_config_places.ts'

/** The file tools a member writes a file with. */
export const FILE_WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const

/** The variable that moves the folder of every project's memory under another root. */
export const REMOTE_MEMORY_ROOT = 'CLAUDE_CODE_REMOTE_MEMORY_DIR'
/** The variable that names one folder memory is read from and written to instead. */
export const MEMORY_FOLDER_OVERRIDE = 'CLAUDE_COWORK_MEMORY_PATH_OVERRIDE'
/** The settings key that names the folder memory lives in. */
export const MEMORY_DIRECTORY_KEY = 'autoMemoryDirectory'

/** Inside a config dir: where each project's memory lives, as path segments. */
const PROJECTS = 'projects'
const MEMORY = 'memory'
/** Inside a config dir: the owner's instructions for every session. */
const OWNER_INSTRUCTIONS = 'CLAUDE.md'
const OWNER_RULES = 'rules'

/** How one name the host records among its protected config-dir places is accounted for (martha#187). */
export type ProtectedNameOwner =
  | { readonly denied_here: 'folder' | 'file' }
  | { readonly denied_by: string }
  | { readonly excluded: string }

/**
 * Who accounts for each name the recorded host holds among its protected
 * config-dir places (martha#187). This guard denies the names marked
 * `denied_here` and no others; a name the host records that no entry here
 * accounts for, or an entry for a name the host no longer records, fails a test
 * by that name, so a later host's new place goes red instead of sitting
 * uncovered, and a name the host drops leaves the map with it.
 */
export const PROTECTED_NAME_OWNERS: Readonly<Record<string, ProtectedNameOwner>> = {
  'shell-snapshots': { denied_here: 'folder' },
  'session-env': { denied_here: 'folder' },
  jobs: { denied_here: 'folder' },
  daemon: { denied_here: 'folder' },
  plugins: { denied_here: 'folder' },
  hooks: { denied_here: 'folder' },
  workflows: { denied_here: 'folder' },
  routines: { denied_here: 'folder' },
  backups: { denied_here: 'folder' },
  'daemon.json': { denied_here: 'file' },
  'scheduled_tasks.json': { denied_here: 'file' },
  'launch.json': { denied_here: 'file' },
  skills: { denied_by: "martha#154's markdown the host loads" },
  commands: { denied_by: "martha#154's markdown the host loads" },
  agents: { denied_by: "martha#154's markdown the host loads" },
  'output-styles': { denied_by: "martha#154's markdown the host loads" },
  rules: { denied_by: "martha#136's places, above" },
  'CLAUDE.md': { denied_by: "martha#136's places, above" },
  projects: { denied_by: "martha#136 each project's memory folder, and martha#154 the transcript streams" },
  'policy-limits.json': { excluded: "the organisation's policy, read only where its signature files verify, and a member's file tool cannot sign one" },
  'policy-limits.json.signature.json': { excluded: "a signature over the organisation's policy, which a member cannot produce" },
  'policy-limits.json.signature-iat.json': { excluded: "a signature over the organisation's policy, which a member cannot produce" },
  'policy-limits.json.stamp.json': { excluded: "a stamp over the organisation's policy, which a member cannot produce" },
}

const distinct = (names: readonly string[]): string[] => [...new Set(names)]

/** Every name the recording holds, from the host's protected array and the places its own statements name, without repeats. */
export function namesInTheRecording({ protected_config_names, config_code_places }: ProtectedConfigPlaces): string[] {
  return distinct([...protected_config_names, ...config_code_places.folders, ...config_code_places.files])
}

/** The recorded names no owner accounts for, and the map's entries for names the host no longer records (martha#187). */
export function gapsInTheNameMap(
  names: readonly string[],
  owners: Readonly<Record<string, ProtectedNameOwner>> = PROTECTED_NAME_OWNERS,
): { readonly unowned: string[]; readonly stale: string[] } {
  const recorded = new Set(names)
  return {
    unowned: [...recorded].filter((name) => owners[name] === undefined).sort(),
    stale: Object.keys(owners).filter((name) => !recorded.has(name)).sort(),
  }
}

/** The recorded places this guard denies, as folders and as files, taken from the map above and never typed again (martha#187). */
export function placesTheHostProtects(recorded: ProtectedConfigPlaces = RECORDED_HOST): { readonly folders: string[]; readonly files: string[] } {
  const owned = namesInTheRecording(recorded).flatMap((name) => {
    const owner = PROTECTED_NAME_OWNERS[name]
    return owner !== undefined && 'denied_here' in owner ? [{ name, place: owner.denied_here }] : []
  })
  const inPlace = (place: 'folder' | 'file') => owned.filter((one) => one.place === place).map((one) => one.name)
  return { folders: inPlace('folder'), files: inPlace('file') }
}

/** Every place a member's file tool may not write. */
export interface OwnerMemoryPlaces {
  /** Roots whose `projects/<any>/memory/` is denied. */
  readonly memory_roots: readonly string[]
  /** Folders denied whole. */
  readonly folders: readonly string[]
  /** Files denied. */
  readonly files: readonly string[]
}

export interface OwnerMemorySources {
  /** The launcher's own environment: what the owner's sessions resolve. */
  readonly launcher_env: Readonly<Record<string, string | undefined>>
  /** The environment the member's host is started with. */
  readonly member_env: Readonly<Record<string, string | undefined>>
  /** The host's home, which a leading `~` resolves against. */
  readonly home: string
  /** The settings files the host reads that may name a memory folder: policy, user, carried. */
  readonly settings_files: readonly string[]
}

/** The config dir an environment's host loads, or undefined when it cannot be told (userSettingsPath refuses it). */
function configDirOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const settings = userSettingsPath(env)
  return 'path' in settings ? dirname(settings.path) : undefined
}

/**
 * The file the host keeps its global config in, where the owner's user MCP
 * servers live: `join(CLAUDE_CONFIG_DIR || homedir(), HOST_TRUST_RECORD_FILE)`,
 * the host's own `globalConfig` — in the config dir when the variable names one,
 * beside the home folder when it does not (martha#187 r=2). The name is the trust
 * record's, which is the same file, not typed again here. Undefined when the
 * variable cannot be told, as for the settings file.
 */
function ownerConfigFileIn(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const settings = userSettingsPath(env)
  if (!('path' in settings)) return undefined
  return join(env.CLAUDE_CONFIG_DIR ?? env.HOME ?? homedir(), HOST_TRUST_RECORD_FILE)
}

/** The memory folder a settings file names, or undefined. */
function memoryDirectoryIn(file: string, home: string): string | undefined {
  try {
    const settings: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const named = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>)[MEMORY_DIRECTORY_KEY] : undefined
    return typeof named === 'string' && named.trim() !== '' ? asTheHostResolves(named, home, home) : undefined
  } catch {
    return undefined
  }
}

const unique = (paths: ReadonlyArray<string | undefined>): string[] => [...new Set(paths.filter((path) => path !== undefined).map((path) => normalize(path)))]

/** The places the host runs as code under each config dir, the owner's settings file and global config, as paths (martha#187). */
function codePlacesIn(configDirs: readonly string[], ownerConfigs: readonly string[]): { readonly folders: string[]; readonly files: string[] } {
  const places = placesTheHostProtects()
  return {
    folders: configDirs.flatMap((dir) => places.folders.map((name) => join(dir, name))),
    files: unique([...configDirs.flatMap((dir) => [join(dir, USER_SETTINGS_FILE), ...places.files.map((name) => join(dir, name))]), ...ownerConfigs]),
  }
}

/** Every place a member's file tool may not write, from what the launcher and the member's host resolve (rules 1 and 2). */
export function ownerMemoryPlaces({ launcher_env, member_env, home, settings_files }: OwnerMemorySources): OwnerMemoryPlaces {
  const configDirs = unique([configDirOf(launcher_env), configDirOf(member_env)])
  const remote = launcher_env[REMOTE_MEMORY_ROOT]
  const override = launcher_env[MEMORY_FOLDER_OVERRIDE]
  const code = codePlacesIn(configDirs, unique([ownerConfigFileIn(launcher_env), ownerConfigFileIn(member_env)]))
  return {
    memory_roots: unique([...configDirs, remote !== undefined && remote.trim() !== '' ? asTheHostResolves(remote, home, home) : undefined]),
    folders: unique([
      ...configDirs.map((dir) => join(dir, OWNER_RULES)),
      override !== undefined && override.trim() !== '' ? asTheHostResolves(override, home, home) : undefined,
      ...settings_files.map((file) => memoryDirectoryIn(file, home)),
      ...code.folders,
    ]),
    files: unique([...configDirs.map((dir) => join(dir, OWNER_INSTRUCTIONS)), ...code.files]),
  }
}

/** Whether `path` is `folder` or inside it. */
const within = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)

/** How many links a chain is followed through when its end does not exist yet: at the cap followed, one past it refused (martha#136 r=4, r=5). */
export const LINK_HOPS = 8

/** The target of the link at `path`, or undefined when `path` is not a link (martha#136 r=4). */
function whereALinkAt(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined
  } catch {
    return undefined
  }
}

/** A path as far as it exists and resolves, and the segments after that, which may not exist yet (martha#136 r=4). */
function existingPartOf(path: string): { readonly at: string; readonly missing: readonly string[] } {
  try {
    return { at: realpathSync(path), missing: [] }
  } catch {
    const parent = dirname(path)
    if (parent === path) return { at: path, missing: [] }
    const above = existingPartOf(parent)
    return { at: above.at, missing: [...above.missing, basename(path)] }
  }
}

/**
 * One step of following a path to its end: the segment at the head of the queue,
 * taken as a folder when it is one, or replaced by the target of the link it is,
 * resolved as far as it exists; or the path reached when the queue runs out, or
 * undefined once the chain has run past LINK_HOPS, which is what a chain that is
 * too long and a link that turns on itself both do (martha#136 r=4).
 */
function followOneStep(queue: readonly string[], reached: string, hops: number): string | undefined {
  const [segment, ...rest] = queue
  if (segment === undefined) return reached
  const next = join(reached, segment)
  const target = whereALinkAt(next)
  if (target === undefined) return followOneStep(rest, next, hops)
  if (hops + 1 > LINK_HOPS) return undefined
  const landed = existingPartOf(resolve(reached, target))
  return followOneStep([...landed.missing, ...rest], landed.at, hops + 1)
}

/**
 * A path with every link in it, at any level, followed to its end — including a
 * link whose target does not exist yet, which is read from the link itself — or
 * undefined when the chain runs past LINK_HOPS or turns on itself, which the
 * caller refuses rather than allows (martha#136 r=4). This is the one function a
 * path is resolved with here.
 */
export function pathToItsEnd(path: string): string | undefined {
  const start = existingPartOf(resolve(path))
  return followOneStep(start.missing, start.at, 0)
}

/** The `projects` folder under a memory root as the host resolves it: it may itself be a link to another disk, followed to its end (martha#136 r=3, r=4). */
const projectsOf = (root: string): string | undefined => pathToItsEnd(join(root, PROJECTS))

/** Whether `path` lies in some project's memory folder under `root`: the projects folder as spelled and as it leads. */
function inProjectMemory(path: string, root: string): boolean {
  return unique([join(root, PROJECTS), projectsOf(root)]).some((folder) => {
    const [project, memory] = relative(folder, path).split(sep)
    return project !== undefined && project !== '' && project !== '..' && memory === MEMORY
  })
}

/** A place as named and as its links lead to the end; or undefined when a chain is too long or turns on itself (martha#136 r=4). */
function spellingsOf(place: string): string[] | undefined {
  const end = pathToItsEnd(place)
  return end === undefined ? undefined : unique([place, end])
}

/**
 * Where a link leads: its target followed to the end, so a link to a folder that
 * does not exist yet, or a chain of links, is still denied where it will write
 * (martha#136 r=3, r=4); or undefined when `link` is not a link.
 */
function whereALinkLeads(link: string): string | undefined {
  return whereALinkAt(link) === undefined ? undefined : pathToItsEnd(link)
}

/** Where each project's memory folder under `root` leads now, links followed: a folder that is a link is denied where it leads. */
function projectMemoryLeadsTo(root: string): string[] {
  const projects = join(root, PROJECTS)
  try {
    return unique(
      readdirSync(projects).map((project) => {
        const memory = join(projects, project, MEMORY)
        return whereALinkLeads(memory) ?? pathToItsEnd(memory)
      }),
    )
  } catch {
    return []
  }
}

/** The denied place one spelling of a path falls in, or undefined. */
function placeOf(path: string, places: OwnerMemoryPlaces): string | undefined {
  const root = places.memory_roots.find(
    (candidate) =>
      (spellingsOf(candidate) ?? []).some((spelling) => inProjectMemory(path, spelling)) ||
      projectMemoryLeadsTo(candidate).some((folder) => within(path, folder)),
  )
  if (root !== undefined) return `a project's memory folder under ${root}`
  const folder = places.folders.find((candidate) => (spellingsOf(candidate) ?? []).some((spelling) => within(path, spelling)))
  if (folder !== undefined) return folder
  return places.files.find((candidate) => (spellingsOf(candidate) ?? []).includes(path))
}

/** Every project's memory folder under `root` that is a link, whether or not its target exists yet (martha#136 r=4). */
function projectMemoryLinks(root: string): string[] {
  try {
    return readdirSync(join(root, PROJECTS))
      .map((project) => join(root, PROJECTS, project, MEMORY))
      .filter((memory) => whereALinkAt(memory) !== undefined)
  } catch {
    return []
  }
}

/** Every project's folder and memory folder under `root`, as named: each is followed before a write is allowed (martha#136 r=5). */
function projectEntries(root: string): string[] {
  try {
    return readdirSync(join(root, PROJECTS)).flatMap((project) => {
      const folder = join(root, PROJECTS, project)
      return [folder, join(folder, MEMORY)]
    })
  } catch {
    return []
  }
}

/**
 * A place the guard must check that cannot be followed to its end — past LINK_HOPS
 * with no end yet, or a link that turns on itself — or undefined when every place
 * resolves. A write is refused while one stands, never allowed, since the guard
 * cannot tell which folder it lands in (martha#136 r=4, r=5).
 */
function unfollowablePlace(places: OwnerMemoryPlaces): string | undefined {
  const named = unique([...places.memory_roots, ...places.folders, ...places.files])
  const place = named.find((candidate) => pathToItsEnd(candidate) === undefined)
  if (place !== undefined) return place
  // The projects folder itself, then every project folder and its memory: a chain of
  // links there is where a write would land, so it is refused like any other place.
  const projects = places.memory_roots
    .flatMap((root) => [join(root, PROJECTS), ...projectEntries(root)])
    .find((folder) => pathToItsEnd(folder) === undefined)
  if (projects !== undefined) return projects
  return places.memory_roots.flatMap(projectMemoryLinks).find((link) => pathToItsEnd(link) === undefined)
}

/** Why a member's tool call writes the owner's memory or instructions, or undefined (rules 3 and 4). */
export function writesTheOwnersMemory(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  places: OwnerMemoryPlaces,
  cwd: string,
  home: string,
): string | undefined {
  if (!(FILE_WRITING_TOOLS as readonly string[]).includes(tool)) return undefined
  const unfollowable = unfollowablePlace(places)
  if (unfollowable !== undefined) {
    return `${unfollowable} is reached through a chain of links that cannot be followed to its end (past ${LINK_HOPS} links, or a link that turns on itself), so no write is allowed while it stands: which folder a write lands in cannot be told (martha#136)`
  }
  for (const argument of FILE_ARGUMENTS) {
    const value = input[argument]
    if (typeof value !== 'string' || value.trim() === '') continue
    const spelled = asTheHostResolves(value, cwd, home)
    const end = pathToItsEnd(spelled)
    if (end === undefined) {
      return `${value} is behind a chain of links that cannot be followed to its end (past ${LINK_HOPS} links, or a link that turns on itself), so which folder it lands in cannot be told: a member does not write there (martha#136)`
    }
    const place = unique([spelled, end]).map((path) => placeOf(path, places)).find((found) => found !== undefined)
    if (place !== undefined) {
      return `${value} is in ${place}, which the owner's own Claude Code sessions load as memory or instructions or run as code: a member does not write there, so neither its text nor its code reaches a later session unrecorded (martha#136, martha#187)`
    }
  }
  return undefined
}

/**
 * The permission rules that refuse the host's own writes into the same places
 * (`Write(//<path>/**)`, `Edit(//<path>/**)`), each place as named and as its
 * links lead, and each project's memory folder that is a link where it leads at
 * launch. A folder linked later is the gate's alone, which follows it at each
 * write.
 */
export function memoryDenyRules(places: OwnerMemoryPlaces): string[] {
  const rootSpellings = places.memory_roots.flatMap((root) => spellingsOf(root) ?? [root])
  // A projects folder that is a link to another disk is named by where it leads too,
  // so a write by the real path into a project with no folder yet is refused (martha#136 r=3).
  const projectLeads = places.memory_roots.flatMap((root) => {
    const folder = projectsOf(root)
    return folder === undefined ? [] : [folder]
  })
  const projectFolders = unique([...rootSpellings.map((root) => join(root, PROJECTS)), ...projectLeads])
  const linkedAway = places.memory_roots
    .flatMap(projectMemoryLeadsTo)
    .filter((folder) => !rootSpellings.some((root) => inProjectMemory(folder, root)))
  const globs = new Set([
    ...projectFolders.map((folder) => `${folder}/*/${MEMORY}/**`),
    ...[...linkedAway, ...places.folders.flatMap((folder) => spellingsOf(folder) ?? [folder])].map((folder) => `${folder}/**`),
    ...places.files.flatMap((file) => spellingsOf(file) ?? [file]),
  ])
  return [...globs].flatMap((glob) => [`Write(/${glob})`, `Edit(/${glob})`])
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The settings the host is started with: the approved copy, or none, with
 * `rules` added to its `permissions.deny` after the rules it already has; or
 * why it cannot be, naming `name`. Every other key is kept as approved.
 */
export function settingsWithMemoryDenied(approved: string | undefined, rules: readonly string[], name: string): { readonly text: string } | { readonly refusal: string } {
  let settings: unknown = {}
  try {
    if (approved !== undefined) settings = JSON.parse(approved)
  } catch {
    return { refusal: `${name} is not JSON, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  }
  if (!isRecord(settings)) return { refusal: `${name} is not a JSON object, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  const permissions = settings.permissions ?? {}
  if (!isRecord(permissions)) return { refusal: `${name} has a permissions that is not an object, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  const deny = permissions.deny ?? []
  if (!Array.isArray(deny)) return { refusal: `${name} has a permissions.deny that is not a list, so the rules that keep a member out of the owner's memory cannot be added to it (martha#136)` }
  return { text: JSON.stringify({ ...settings, permissions: { ...permissions, deny: [...(deny as unknown[]), ...rules] } }) }
}
