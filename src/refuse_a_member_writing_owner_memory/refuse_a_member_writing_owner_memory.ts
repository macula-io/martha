// A member never writes the memory or the instructions the owner's own Claude
// Code sessions load (martha#136).
//
// This exists so text a member wrote cannot reach a later session, the owner's
// or another member's, as memory or as the owner's own instructions, with
// nothing recording where it came from.
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
//   2. WHAT IS DENIED. In each config dir: every `projects/*/memory/`, `rules/`,
//      and `CLAUDE.md`. The two folders that override where memory lives, when
//      the launcher's environment sets them. Each `autoMemoryDirectory` the
//      policy, user and carried settings name.
//   3. AS THE HOST RESOLVES IT. A path is trimmed, a leading `~` resolves against
//      the host's home, the rest against the member's working directory
//      (../claude_code_host asTheHostResolves). It is denied when either the
//      path as spelled or its real path, links followed, falls inside a denied
//      place, so a link into a memory folder and a memory folder that is itself
//      a link are both caught.
//   4. WRITES, NOT READS. Only the tools that write a file are refused. Reading a
//      memory file is not a path from a member to a later session.
//
// The permission rules (memoryDenyRules) carry the same places into the
// settings the host is started with: the host's own memory pass stands down
// when a permission rule refuses its write. Nothing here relies on the publish
// gate's hook firing for that pass, which runs as a fork (Pluto, martha#136 r=2).

import { readFileSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

import { userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'
import { asTheHostResolves, FILE_ARGUMENTS, realPathOf } from '../claude_code_host/settings_that_turn_hooks_off.ts'

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

/** Every place a member's file tool may not write, from what the launcher and the member's host resolve (rules 1 and 2). */
export function ownerMemoryPlaces({ launcher_env, member_env, home, settings_files }: OwnerMemorySources): OwnerMemoryPlaces {
  const configDirs = unique([configDirOf(launcher_env), configDirOf(member_env)])
  const remote = launcher_env[REMOTE_MEMORY_ROOT]
  const override = launcher_env[MEMORY_FOLDER_OVERRIDE]
  return {
    memory_roots: unique([...configDirs, remote !== undefined && remote.trim() !== '' ? asTheHostResolves(remote, home, home) : undefined]),
    folders: unique([
      ...configDirs.map((dir) => join(dir, OWNER_RULES)),
      override !== undefined && override.trim() !== '' ? asTheHostResolves(override, home, home) : undefined,
      ...settings_files.map((file) => memoryDirectoryIn(file, home)),
    ]),
    files: unique(configDirs.map((dir) => join(dir, OWNER_INSTRUCTIONS))),
  }
}

/** Whether `path` is `folder` or inside it. */
const within = (path: string, folder: string): boolean => path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`)

/** Whether `path` lies in some project's memory folder under `root`. */
function inProjectMemory(path: string, root: string): boolean {
  const [projects, project, memory] = relative(root, path).split(sep)
  return projects === PROJECTS && project !== undefined && project !== '' && project !== '..' && memory === MEMORY
}

/** The denied place one spelling of a path falls in, or undefined. */
function placeOf(path: string, places: OwnerMemoryPlaces): string | undefined {
  const root = places.memory_roots.find((candidate) => [candidate, realPathOf(candidate)].some((spelling) => inProjectMemory(path, spelling)))
  if (root !== undefined) return `a project's memory folder under ${root}`
  const folder = places.folders.find((candidate) => [candidate, realPathOf(candidate)].some((spelling) => within(path, spelling)))
  if (folder !== undefined) return folder
  return places.files.find((candidate) => [candidate, realPathOf(candidate)].includes(path))
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
  for (const argument of FILE_ARGUMENTS) {
    const value = input[argument]
    if (typeof value !== 'string' || value.trim() === '') continue
    const spelled = asTheHostResolves(value, cwd, home)
    const place = [spelled, realPathOf(spelled)].map((path) => placeOf(path, places)).find((found) => found !== undefined)
    if (place !== undefined) {
      return `${value} is in ${place}, which the owner's own Claude Code sessions load as memory or instructions: a member does not write there, so its text never reaches a later session unrecorded (martha#136)`
    }
  }
  return undefined
}

/** The permission rules that refuse the host's own writes into the same places (`Write(//<path>/**)`, `Edit(//<path>/**)`). */
export function memoryDenyRules(places: OwnerMemoryPlaces): string[] {
  const globs = [
    ...places.memory_roots.map((root) => `${join(root, PROJECTS)}/*/${MEMORY}/**`),
    ...places.folders.map((folder) => `${folder}/**`),
    ...places.files,
  ]
  return globs.flatMap((glob) => [`Write(/${glob})`, `Edit(/${glob})`])
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
