// A member never writes the memory, the instructions or the text the owner's own Claude Code sessions load, from the
// owner's user scope or the member's (martha#136, martha#154).
//
// This exists so text a member wrote cannot reach a later session, the owner's or another member's, as memory, as the
// owner's own instructions, as a skill's description in every session, as an agent's body when it runs, as a command,
// as an output style, or as a resumed transcript read back as the conversation so far: nothing records where it came
// from, and the owner's next session loads it as its own.
//
// Claude Code keeps auto-memory in `<config dir>/projects/<project key>/memory/`
// and loads it into every session of that project. A session in a git worktree
// loads the MAIN clone's folder (measured on 2.1.319), so the key cannot be
// computed from the member's checkout: every project's memory folder is denied.
// The launcher turns the member's own memory off (CLAUDE_MEMORY_OFF) and drops
// the variables that move it (CLAUDE_MEMORY_ELSEWHERE); this is the other half,
// the publish gate refusing a member's file tool that writes there.
//
// Rules:
//
//   1. WHOSE CONFIG DIR. The launcher's, from its own environment: the folder the
//      owner's sessions load. The member's too, when its environment resolves
//      another. Both are denied.
//   2. WHAT IS DENIED. In each config dir: every project's own folder,
//      `projects/<any>/**` (a session folder holds its transcript, `subagents/`,
//      `tool-results/` and its memory), `rules/`, `CLAUDE.md`, and the folders
//      the host loads the owner's own text from — the markdown kinds the
//      recording names (`agents`, `commands`, `skills`), and the output-styles
//      folder it names (martha#154) — with the folder the member's own session
//      init reports for output styles, which a settings env block may move. The
//      two folders that override where memory lives, when the launcher's
//      environment sets them. Each `autoMemoryDirectory` the policy, user and
//      carried settings name. No name is typed here: the markdown kinds and the
//      styles folder come from `RECORDED_HOST`, cut from the host's binary.
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
import { basename, dirname, join, normalize, relative, resolve, sep } from 'node:path'

import { userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'
import { asTheHostResolves } from '../claude_code_host/claude_code_file_tools.ts'
import { FILE_ARGUMENTS } from '../claude_code_host/settings_that_turn_hooks_off.ts'

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

/** A place a member's file tool may not write, and the issue that put it there. */
export interface DeniedPlace {
  readonly what: string
  readonly issue: string
}

/** Every place a member's file tool may not write. */
export interface OwnerMemoryPlaces {
  /** The config dirs whose whole `projects/` area is denied: the owner's and the member's (martha#154). */
  readonly config_dirs: readonly string[]
  /** Roots whose `projects/<any>/memory/` is denied. */
  readonly memory_roots: readonly string[]
  /** Folders denied whole, each with the issue that denies it. */
  readonly folders: readonly DeniedPlace[]
  /** Files denied. */
  readonly files: readonly string[]
}

/**
 * What the recording says the host loads from the owner's user scope, and where the member's own session reports the
 * styles folder (martha#154). Nothing here is typed by this repository: the kinds and the folder are the recorded
 * host's own words, and the reported folder is the path the session's init answered with.
 */
export interface OwnerUserScope {
  /** The folders under each config dir the host loads markdown from, by name (`RECORDED_HOST.markdown_kinds`, #146). */
  readonly markdown_kinds: readonly string[]
  /** The folder under each config dir the host lists the owner's user output styles from (#154). */
  readonly output_styles_folder: string
  /** The folder the member's session init reported for user output styles, after its settings env blocks (#154). */
  readonly reported_output_styles_dir: string
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
  /** The places the host loads from the owner's user scope, from the recording and the member's own init (#154). */
  readonly user_scope: OwnerUserScope
}

/** The config dir an environment's host loads, or undefined when it cannot be told (userSettingsPath refuses it). */
function configDirOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const settings = userSettingsPath(env)
  return 'path' in settings ? dirname(settings.path) : undefined
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

/** The places, each path once, the first issue that denies it kept, and none left empty. */
const deniedPlaces = (places: ReadonlyArray<DeniedPlace | string | undefined>): DeniedPlace[] => {
  const named = places.flatMap((place) => {
    const one = typeof place === 'string' ? { what: place, issue: '' } : place
    return one === undefined || one.what.trim() === '' ? [] : [one]
  })
  const seen = new Set<string>()
  return named.filter((place) => (seen.has(normalize(place.what)) ? false : (seen.add(normalize(place.what)), true)))
}

/** Every place a member's file tool may not write, from what the launcher and the member's host resolve (rules 1 and 2). */
export function ownerMemoryPlaces({ launcher_env, member_env, home, settings_files, user_scope }: OwnerMemorySources): OwnerMemoryPlaces {
  const configDirs = unique([configDirOf(launcher_env), configDirOf(member_env)])
  const remote = launcher_env[REMOTE_MEMORY_ROOT]
  const override = launcher_env[MEMORY_FOLDER_OVERRIDE]
  // The folders under each config dir the host loads the owner's own text from (martha#154): the markdown kinds the
  // recording names and the output-styles folder it names. None of the two names is typed here.
  const loaded = configDirs.flatMap((dir) => [...user_scope.markdown_kinds, user_scope.output_styles_folder].map((kind) => join(dir, kind)))
  return {
    config_dirs: configDirs,
    memory_roots: unique([...configDirs, remote !== undefined && remote.trim() !== '' ? asTheHostResolves(remote, home, home) : undefined]),
    folders: deniedPlaces([
      ...loaded.map((what): DeniedPlace => ({ what, issue: 'martha#154' })),
      { what: user_scope.reported_output_styles_dir, issue: 'martha#154' },
      ...configDirs.map((dir): DeniedPlace => ({ what: join(dir, OWNER_RULES), issue: 'martha#136' })),
      ...(override !== undefined && override.trim() !== '' ? [{ what: asTheHostResolves(override, home, home), issue: 'martha#136' }] : []),
      ...settings_files.map((file): DeniedPlace | undefined => {
        const folder = memoryDirectoryIn(file, home)
        return folder === undefined ? undefined : { what: folder, issue: 'martha#136' }
      }),
    ]),
    files: unique(configDirs.map((dir) => join(dir, OWNER_INSTRUCTIONS))),
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

/**
 * Whether `path` lies inside some project's own folder under a `projects` folder: its transcript, the side files a
 * session keeps beside it, and its `memory/` — for any project key, one that does not exist yet included (martha#154).
 */
function inAProject(path: string, projects: string): boolean {
  const [project, ...inside] = relative(projects, path).split(sep)
  return inside.length > 0 && project !== undefined && project !== '' && !project.startsWith('..')
}

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

/**
 * Where each project's own folder under `root` leads now, when it is a link: the folder a write into the project
 * would really land in, denied whole like the folder it was named by (martha#154).
 */
function projectFolderLeadsTo(root: string): string[] {
  const projects = join(root, PROJECTS)
  try {
    return unique(
      readdirSync(projects).flatMap((project) => {
        const leads = whereALinkLeads(join(projects, project))
        return leads === undefined ? [] : [leads]
      }),
    )
  } catch {
    return []
  }
}

/** The denied place one spelling of a path falls in, or undefined. */
function placeOf(path: string, places: OwnerMemoryPlaces): DeniedPlace | undefined {
  const root = places.memory_roots.find(
    (candidate) =>
      (spellingsOf(candidate) ?? []).some((spelling) => inProjectMemory(path, spelling)) ||
      projectMemoryLeadsTo(candidate).some((folder) => within(path, folder)),
  )
  if (root !== undefined) return { what: `a project's memory folder under ${root}`, issue: 'martha#136' }
  // Each project's own folder, denied whole: a session folder holds its transcript and the side files beside it,
  // which a later `--resume` reads (martha#154).
  const projects = places.config_dirs.find(
    (dir) =>
      (spellingsOf(join(dir, PROJECTS)) ?? []).some((folder) => inAProject(path, folder)) ||
      projectFolderLeadsTo(dir).some((folder) => within(path, folder)),
  )
  if (projects !== undefined) return { what: `a project's folder under ${projects}`, issue: 'martha#154' }
  const folder = places.folders.find((candidate) => (spellingsOf(candidate.what) ?? []).some((spelling) => within(path, spelling)))
  if (folder !== undefined) return folder
  const file = places.files.find((candidate) => (spellingsOf(candidate) ?? []).includes(path))
  return file === undefined ? undefined : { what: file, issue: 'martha#136' }
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
  const named = unique([...places.memory_roots, ...places.config_dirs.map((dir) => join(dir, PROJECTS)), ...places.folders.map((folder) => folder.what), ...places.files])
  const place = named.find((candidate) => pathToItsEnd(candidate) === undefined)
  if (place !== undefined) return place
  // The projects folder itself, then every project folder and its memory: a chain of
  // links there is where a write would land, so it is refused like any other place.
  const projects = unique([...places.memory_roots, ...places.config_dirs])
    .flatMap((root) => [join(root, PROJECTS), ...projectEntries(root)])
    .find((folder) => pathToItsEnd(folder) === undefined)
  if (projects !== undefined) return projects
  return unique([...places.memory_roots, ...places.config_dirs]).flatMap(projectMemoryLinks).find((link) => pathToItsEnd(link) === undefined)
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
      return `${value} is in ${place.what}, which the owner's own Claude Code sessions load as their own: a member does not write there, so its text never reaches a later session unrecorded (${place.issue})`
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
  // Each config dir's projects folder denies every project's own folder whole (martha#154); a root memory was moved
  // to keeps the memory folder as its one denied place (martha#136).
  const configProjectFolders = unique(places.config_dirs.flatMap((dir) => spellingsOf(join(dir, PROJECTS)) ?? [join(dir, PROJECTS)]))
  const otherProjects = projectFolders.filter((folder) => !configProjectFolders.includes(folder))
  const linkedAway = unique([...places.memory_roots.flatMap(projectMemoryLeadsTo), ...places.config_dirs.flatMap(projectFolderLeadsTo)]).filter(
    (folder) => !rootSpellings.some((root) => inProjectMemory(folder, root)) && !configProjectFolders.some((projects) => inAProject(folder, projects)),
  )
  const globs = new Set([
    ...configProjectFolders.map((folder) => `${folder}/*/**`),
    // The memory folder under each config dir's projects stays a place of its own (martha#136): a project's own folder
    // is denied whole above, and this names the folder #136 already closed, where a config dir is reached by a link.
    ...configProjectFolders.map((folder) => `${folder}/*/${MEMORY}/**`),
    ...otherProjects.map((folder) => `${folder}/*/${MEMORY}/**`),
    ...[...linkedAway, ...places.folders.flatMap((folder) => spellingsOf(folder.what) ?? [folder.what])].map((folder) => `${folder}/**`),
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
