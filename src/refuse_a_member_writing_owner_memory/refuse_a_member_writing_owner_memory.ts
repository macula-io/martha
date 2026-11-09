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
// It also refuses a member's write into what a later git run of the owner's
// reads (martha#168): a `.git` segment anywhere in the path, the checkout's own
// git directory (and the one a linked worktree shares), and the git
// configuration files of the owner's own runs. A hook, a config or an object a
// member put there starts or shapes the owner's next git command, and the
// member never typed one.
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
//   5. WHAT A LATER GIT RUN READS (martha#168). A path segment git would take for
//      its own `.git` directory — its own checks, not the name exactly — and the
//      checkout's git directory, found on disk and never by `rev-parse`, are
//      denied; so is the git configuration of the owner's own runs. The git
//      directory is read from disk at each call, so a checkout or a git
//      directory that appears during the session is covered from the next call.
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
import { checkoutOnDisk, realOrResolved, type LaunchHost } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import type { PathProbe } from '../check_every_path_is_gated/check_every_path_is_gated.ts'

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

/** The variable git takes its repository's git directory from, when the launcher's environment sets it. */
export const GIT_DIR_VARIABLE = 'GIT_DIR'
/** The variable git takes the git directory a repository shares its objects and hooks with from. */
export const GIT_COMMON_DIR_VARIABLE = 'GIT_COMMON_DIR'
/** The variable that names the one user-level git config file git reads instead of the default ones. */
export const GIT_CONFIG_GLOBAL_VARIABLE = 'GIT_CONFIG_GLOBAL'
/** The variable that names the system-level git config file git reads. */
export const GIT_CONFIG_SYSTEM_VARIABLE = 'GIT_CONFIG_SYSTEM'
/** The variable whose `git/config` is the user-level config file, when it is set. */
export const XDG_CONFIG_HOME_VARIABLE = 'XDG_CONFIG_HOME'

/** The user-level git config file, under the home git reads it from. */
const OWNERS_GITCONFIG = '.gitconfig'
/** The user-level git config file's path under `$XDG_CONFIG_HOME` (and under `~/.config` when that is unset). */
const GIT_CONFIG_UNDER_XDG = ['git', 'config'] as const
/** The file in a worktree's git dir that names the git dir it shares, relative to its own. */
const COMMONDIR = 'commondir'

/** Every place a member's file tool may not write. */
export interface OwnerMemoryPlaces {
  /** Roots whose `projects/<any>/memory/` is denied. */
  readonly memory_roots: readonly string[]
  /** Folders denied whole. */
  readonly folders: readonly string[]
  /** Files denied. */
  readonly files: readonly string[]
  /**
   * The git configuration files of the owner's own git runs, denied as files
   * (martha#168). The publish gate refuses them; no permission rule names them,
   * because the host runs no pass that writes one by itself.
   */
  readonly git_config_files: readonly string[]
  /** The git directories the launcher's environment names, denied whole (martha#168). */
  readonly git_dirs_named_at_launch: readonly string[]
}

export interface OwnerMemorySources {
  /** The launcher's own environment: what the owner's sessions resolve. */
  readonly launcher_env: Readonly<Record<string, string | undefined>>
  /** The environment the member's host is started with. */
  readonly member_env: Readonly<Record<string, string | undefined>>
  /** The host's home, which a leading `~` resolves against. */
  readonly home: string
  /** Where the launcher starts the member: the checkout a git dir is found from, and what a relative variable resolves against. */
  readonly launch_dir: string
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

/** Every place a member's file tool may not write, from what the launcher and the member's host resolve (rules 1, 2 and 5). */
export function ownerMemoryPlaces({ launcher_env, member_env, home, launch_dir, settings_files }: OwnerMemorySources): OwnerMemoryPlaces {
  const configDirs = unique([configDirOf(launcher_env), configDirOf(member_env)])
  const remote = launcher_env[REMOTE_MEMORY_ROOT]
  const override = launcher_env[MEMORY_FOLDER_OVERRIDE]
  const code = codePlacesIn(configDirs, unique([ownerConfigFileIn(launcher_env), ownerConfigFileIn(member_env)]))
  /** A path the launcher's environment names, resolved as the host resolves it. */
  const named = (variable: string): string | undefined => {
    const value = launcher_env[variable]
    return value !== undefined && value.trim() !== '' ? asTheHostResolves(value, launch_dir, home) : undefined
  }
  const xdg = named(XDG_CONFIG_HOME_VARIABLE)
  return {
    memory_roots: unique([...configDirs, remote !== undefined && remote.trim() !== '' ? asTheHostResolves(remote, home, home) : undefined]),
    folders: unique([
      ...configDirs.map((dir) => join(dir, OWNER_RULES)),
      override !== undefined && override.trim() !== '' ? asTheHostResolves(override, home, home) : undefined,
      ...settings_files.map((file) => memoryDirectoryIn(file, home)),
      ...code.folders,
    ]),
    files: unique([...configDirs.map((dir) => join(dir, OWNER_INSTRUCTIONS)), ...code.files]),
    // Every user-level git config file git 2.56.0 can read: the two the variables
    // name, `~/.gitconfig`, and the XDG one as `$XDG_CONFIG_HOME` spells it and as
    // its own default under `~/.config` (measured: with XDG_CONFIG_HOME unset, git
    // reads `~/.config/git/config`). Denying all of them costs nothing, and it
    // holds on a git whose default differs from this one's.
    git_config_files: unique([
      named(GIT_CONFIG_GLOBAL_VARIABLE),
      named(GIT_CONFIG_SYSTEM_VARIABLE),
      join(home, OWNERS_GITCONFIG),
      join(home, '.config', ...GIT_CONFIG_UNDER_XDG),
      xdg === undefined ? undefined : join(xdg, ...GIT_CONFIG_UNDER_XDG),
    ]),
    git_dirs_named_at_launch: unique([named(GIT_DIR_VARIABLE), named(GIT_COMMON_DIR_VARIABLE)]),
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

/** A string with the letters A-Z lowered and nothing else, as git's own comparison of an ASCII name does. */
const asciiLowered = (text: string): string => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase())

/**
 * The code points git 2.56.0's HFS+ reader drops before comparing a name:
 * `next_hfs_char` in utf8.c ignores 0x200c, 0x200d, 0x200e, 0x200f, 0x202a,
 * 0x202b, 0x202c, 0x202d, 0x202e, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e,
 * 0x206f and 0xfeff, and returns 0 on malformed UTF-8, which is never `.git`.
 */
const HFS_IGNORES = new Set([0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f, 0xfeff])

/** The name git's own check compares a `.git` segment against. */
const DOT_GIT = '.git'
/** The characters git's NTFS check ends a name at, besides the end: a `:` (an alternate data stream) and a `\` (a separator on NTFS). */
const NTFS_ENDS_A_SEGMENT = new Set([':', '\\'])
/** The separator git's NTFS check may see inside a path segment written on a POSIX machine (read-cache.c:1051, below). */
const NTFS_SEPARATOR = '\\'

/**
 * Whether a path segment is `.git` to git's HFS+ check (`is_hfs_dotgit` ->
 * `is_hfs_dot_generic`, utf8.c, 2.56.0): the code points HFS+ ignores dropped,
 * each remaining code point lowered only as `tolower()` lowers ASCII (one above
 * 127 is no `.git`), and then exactly `.git` to the end of the segment.
 */
function isGitOnHfs(segment: string): boolean {
  const kept = [...segment].filter((point) => !HFS_IGNORES.has(point.codePointAt(0) ?? 0))
  return asciiLowered(kept.join('')) === DOT_GIT
}

/**
 * Whether one name is `.git` to git's NTFS check (`is_ntfs_dotgit`, path.c,
 * 2.56.0): `.` then g, i, t in either ASCII case, or g, i, t in either ASCII
 * case then `~1`, followed by nothing but `.` and ` ` up to the end of the name,
 * a `:` or a `\`. `git~2` and the other short names git keeps for `.gitmodules`
 * and its like are not `.git`.
 */
function isGitOnNtfsName(name: string): boolean {
  const folded = asciiLowered(name)
  const rest = folded.startsWith(DOT_GIT) ? folded.slice(DOT_GIT.length) : folded.startsWith('git~1') ? folded.slice('git~1'.length) : undefined
  if (rest === undefined) return false
  for (const point of rest) {
    if (point === '.' || point === ' ') continue
    return NTFS_ENDS_A_SEGMENT.has(point)
  }
  return true
}

/**
 * Whether a path segment is `.git` to git's NTFS check as read-cache.c runs it
 * on a POSIX machine (2.56.0, verify_path_internal): a `\` inside the name is a
 * separator to git too, and the check runs again on what follows it —
 *
 *     } else if (c == '\\' &&
 *                repo_protect_ntfs(the_repository)) {
 *             if (is_ntfs_dotgit(path))
 *                     return PATH_INVALID;
 *
 * — so `src/a\.git` and `src/a\git~1` are `.git` although the name git would
 * find on this disk is not. Every part of the segment is checked.
 */
function isGitOnNtfs(segment: string): boolean {
  return segment.split(NTFS_SEPARATOR).some(isGitOnNtfsName)
}

/**
 * The segment of `path` git would take for its own `.git` directory, or
 * undefined (martha#168, design r=3). Both of git's checks are applied, on
 * every platform and whatever `core.protectHFS` and `core.protectNTFS` say
 * there: both default off on Linux, where the member runs, and the checkout can
 * be read later on a machine where they are on. A name git does not track is no
 * loss to a member, and it is exactly the name that becomes `.git` elsewhere.
 */
export function gitSegmentIn(path: string): string | undefined {
  return path.split(sep).find((segment) => isGitOnHfs(segment) || isGitOnNtfs(segment))
}

/** The checkout a member works in, as its git directory is found on disk (martha#168). */
export interface CheckoutGit {
  /** The checkout's top. */
  readonly top: string
  /** Its git directory, and the one a linked worktree shares with it. */
  readonly dirs: readonly string[]
}

/**
 * The git directory of the checkout holding `dir`, and the one it shares, read
 * from disk at each call and never by `rev-parse` (../refuse_launch_of_unapproved_config
 * finds the checkout the same way); or undefined when `dir` is in no checkout.
 */
export function checkoutGitOf(dir: string, host: LaunchHost): CheckoutGit | undefined {
  const found = checkoutOnDisk(dir, host)
  if (found === undefined) return undefined
  return { top: found.top, dirs: unique([found.git_dir, sharedGitDirOf(found.git_dir, host)]) }
}

/**
 * The git dir a linked worktree shares its objects and hooks with, from the
 * `commondir` file in its own (git 2.56.0: `<main>/.git/worktrees/<name>` holds
 * `commondir` with `../..`); or undefined for a checkout that has none.
 */
function sharedGitDirOf(git_dir: string, host: LaunchHost): string | undefined {
  try {
    const named = new TextDecoder().decode(host.stores.files.bytesOf(join(git_dir, COMMONDIR))).trim()
    return named === '' ? undefined : realOrResolved(host, resolve(git_dir, named))
  } catch {
    return undefined
  }
}

/** Why a write the member spells `value` reads or starts a later git run of the owner's, or undefined (rule 5). */
function gitDenialOf(value: string, path: string, git: CheckoutGit | undefined, places: OwnerMemoryPlaces): string | undefined {
  const segment = gitSegmentIn(path)
  if (segment !== undefined) {
    return `${value} names ${segment} as one of its path segments, and git takes that for the .git directory it reads from there: a member does not write there, so nothing a later git run starts is something the member put there (martha#168)`
  }
  const dir = git?.dirs.find((candidate) => (spellingsOf(candidate) ?? []).some((spelling) => within(path, spelling)))
  if (dir !== undefined) {
    return `${value} is in ${dir}, the git directory of the checkout at ${git?.top ?? dir}, which holds the hooks, the config and the objects a later git run of the owner's reads: a member does not write there, so nothing a later git run starts is something the member put there (martha#168)`
  }
  const named = places.git_dirs_named_at_launch.find((candidate) => (spellingsOf(candidate) ?? []).some((spelling) => within(path, spelling)))
  if (named !== undefined) {
    return `${value} is in ${named}, a git directory the launcher's environment names, which holds what a later git run of the owner's reads: a member does not write there, so nothing a later git run starts is something the member put there (martha#168)`
  }
  const file = places.git_config_files.find((candidate) => (spellingsOf(candidate) ?? []).includes(path))
  if (file !== undefined) {
    return `${value} is ${file}, one of the git configuration files the owner's own git runs read, and everything one names runs: a member does not write there, so nothing a later git run starts is something the member put there (martha#168)`
  }
  return undefined
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
function unfollowablePlace(places: OwnerMemoryPlaces, git: CheckoutGit | undefined): string | undefined {
  const named = unique([...places.memory_roots, ...places.folders, ...places.files])
  const place = named.find((candidate) => pathToItsEnd(candidate) === undefined)
  if (place !== undefined) return unfollowableMemory(place)
  // The projects folder itself, then every project folder and its memory: a chain of
  // links there is where a write would land, so it is refused like any other place.
  const projects = places.memory_roots
    .flatMap((root) => [join(root, PROJECTS), ...projectEntries(root)])
    .find((folder) => pathToItsEnd(folder) === undefined)
  if (projects !== undefined) return unfollowableMemory(projects)
  const linked = places.memory_roots.flatMap(projectMemoryLinks).find((link) => pathToItsEnd(link) === undefined)
  if (linked !== undefined) return unfollowableMemory(linked)
  // The git directory is checked the same way: a chain of links where it should be
  // is no git directory this guard can name, and a write is not allowed while it
  // stands (martha#168).
  const gitDir = unique([...(git?.dirs ?? []), ...places.git_dirs_named_at_launch]).find((dir) => pathToItsEnd(dir) === undefined)
  return gitDir === undefined
    ? undefined
    : `${gitDir} is a git directory a later git run of the owner's reads, and it is reached through a chain of links that cannot be followed to its end (past ${LINK_HOPS} links, or a link that turns on itself), so no write is allowed while it stands: which directory a write lands in cannot be told (martha#168)`
}

/** Why a memory place that cannot be followed to its end refuses every write, in the words of #136. */
function unfollowableMemory(place: string): string {
  return `${place} is reached through a chain of links that cannot be followed to its end (past ${LINK_HOPS} links, or a link that turns on itself), so no write is allowed while it stands: which folder a write lands in cannot be told (martha#136)`
}

/**
 * Why a member's tool call writes the owner's memory, instructions, or what a
 * later git run of the owner's reads, or undefined (rules 3, 4 and 5).
 */
export function writesTheOwnersMemory(
  tool: string,
  input: Readonly<Record<string, unknown>>,
  places: OwnerMemoryPlaces,
  cwd: string,
  home: string,
  host: LaunchHost,
): string | undefined {
  if (!(FILE_WRITING_TOOLS as readonly string[]).includes(tool)) return undefined
  // Read at each call, not at launch: a checkout or a git directory that appears
  // during the session is covered from the next call (martha#168).
  const git = checkoutGitOf(cwd, host)
  const unfollowable = unfollowablePlace(places, git)
  if (unfollowable !== undefined) return unfollowable
  for (const argument of FILE_ARGUMENTS) {
    const value = input[argument]
    if (typeof value !== 'string' || value.trim() === '') continue
    const spelled = asTheHostResolves(value, cwd, home)
    const end = pathToItsEnd(spelled)
    if (end === undefined) {
      return `${value} is behind a chain of links that cannot be followed to its end (past ${LINK_HOPS} links, or a link that turns on itself), so which folder it lands in cannot be told: a member does not write there (martha#136)`
    }
    const gitDenial = unique([spelled, end]).map((path) => gitDenialOf(value, path, git, places)).find((found) => found !== undefined)
    if (gitDenial !== undefined) return gitDenial
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

/**
 * The guard as the coverage check drives it (../check_every_path_is_gated,
 * martha#168): true only for a path a member's file tool may write, which is to
 * say not the owner's memory, not the owner's instructions, and nothing a later
 * git run of the owner's reads. It lives here, not beside the register, because
 * it reads the machine and a slice may import no adapter; whoever runs the check
 * passes it in.
 */
export function admitsAWriteNoLaterGitRunReads(probe: PathProbe): boolean {
  const env: Readonly<Record<string, string | undefined>> = { HOME: probe.home }
  const places = ownerMemoryPlaces({ launcher_env: env, member_env: env, home: probe.home, launch_dir: probe.cwd, settings_files: [] })
  return writesTheOwnersMemory('Write', { file_path: probe.path }, places, probe.cwd, probe.home, thisMachine) === undefined
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
