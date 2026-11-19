// The values an engine member's calls are judged by (#541 package A, design G1, PASS r=7 issuecomment-7010033523):
// the engine's file tools as the host decisions take them, where each of its tools' results came from, the folders of
// the launch's own engine root no call may name, and the owner's own engine folders a member does not write.
//
// Every one of them is read from the recording (recorded_goose_engine.json), never typed: the Developer tools by their
// names, arguments and hints (`developer_tools`), the shell tool (`shell_tool`), how a path is resolved
// (`path_resolution`), and the folders the engine keeps for itself (`engine_folders`). A recording these values cannot
// be built from is a refusal, never a guess: a resolution that trims, expands `~` or puts anything but the session's
// working folder first, or a folder layout this file does not know.
//
// Where a result came from is placed by the engine's own hints, so no tool's name is typed here:
//   - the shell tool: a command run in the checkout, on its argument;
//   - a tool that may change what it touches and reaches nothing past the machine: one file, on its argument (and it
//     is a writing tool, its write the member's own);
//   - a tool that only reads and reaches nothing past the machine: every file below its argument;
//   - any other tool (today the image reader, which takes a local path or a web address): no row, so its result takes
//     the shell's handling, the strict side.
//
// The engine's write tool's content argument is not recorded, so `whole_file` is undefined: a write is judged as an
// edit is, by what lands on disk, never against bytes the call carried. Said plainly so no one reads it as a check.
//
// Linux only (DECIDED 2026-11-19 "we build for linux, not windows or macOS"): the owner's engine folders follow the
// XDG layout the engine's `etcetera` strategy takes on Linux (etcetera 0.11.0, the version the engine's Cargo.lock
// pins: base_strategy/xdg.rs reads each variable only when it holds an absolute path, else a folder under the home).

import { dirname, isAbsolute, join, sep } from 'node:path'

import type { HostFileTools } from '../host_contract/host_contract.ts'
import type { EngineFacts, DeveloperTool } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import type { DeniedPlace } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { XDG_CONFIG_HOME_VARIABLE } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { realPathOf } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import type { ToolResultReading, ToolResultRows } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** The facts these values are read from. */
export type TheFactsTheDecisionsRead = Pick<EngineFacts, 'developer_tools' | 'shell_tool' | 'path_resolution' | 'engine_folders' | 'engine_name'>

/** How the engine's results are placed, by the kind its hints give a tool. */
type AToolsKind = 'a_command' | 'a_file' | 'a_search'

/** The kind of one Developer tool, read from its hints; undefined when its result cannot be placed by one row. */
export function theKindOfATool(tool: DeveloperTool, shell: string): AToolsKind | undefined {
  if (tool.name === shell) return 'a_command'
  if (tool.hints.open_world) return undefined
  if (tool.hints.destructive) return 'a_file'
  if (tool.hints.read_only) return 'a_search'
  return undefined
}

/** One row of the table, on the tool's own argument. */
const ROW_OF: Readonly<Record<AToolsKind, (field: string) => ToolResultReading>> = {
  a_command: (field) => ({ reads: 'a_command', source: 'checkout_run', field }),
  a_file: (field) => ({ reads: 'a_file', source: 'checkout_file', field }),
  a_search: (field) => ({ reads: 'a_search', source: 'checkout_file', field }),
}

/** Where each of the engine's tools' results came from, by the tool's own name; a tool with no kind has no row. */
export function theEnginesToolResultRows(facts: Pick<EngineFacts, 'developer_tools' | 'shell_tool'>): ToolResultRows {
  return Object.freeze(
    Object.fromEntries(
      facts.developer_tools.flatMap((tool) => {
        const kind = theKindOfATool(tool, facts.shell_tool)
        return kind === undefined ? [] : [[tool.name, ROW_OF[kind](tool.argument)] as const]
      }),
    ),
  )
}

/** The engine's file tools, or why they cannot be built from this recording. */
export type TheEnginesFileTools = { readonly tools: HostFileTools } | { readonly refusal: string }

/** The base the engine joins a relative path to first: the session's working folder, which a launch sets to the checkout. */
const THE_SESSIONS_FOLDER = 'working_dir'

/**
 * The engine's file tools as the host decisions take them. The writing tools are the tools of kind `a_file`, each the
 * member's own write on its argument; the arguments a call names a file in are those of every file and search tool.
 */
export function theEnginesFileTools(facts: Pick<EngineFacts, 'developer_tools' | 'shell_tool' | 'path_resolution'>): TheEnginesFileTools {
  const resolution = facts.path_resolution
  if (resolution.trims || resolution.expands_home || resolution.bases[0] !== THE_SESSIONS_FOLDER) {
    return { refusal: `the recorded engine resolves a path in a way this launch does not resolve it (${JSON.stringify(resolution)}): its file tools are not built, so no call is judged against the wrong file` }
  }
  const kinds = facts.developer_tools.map((tool) => ({ tool, kind: theKindOfATool(tool, facts.shell_tool) }))
  const writing = kinds.filter(({ kind }) => kind === 'a_file').map(({ tool }) => tool)
  const naming = kinds.filter(({ kind }) => kind === 'a_file' || kind === 'a_search').map(({ tool }) => tool.argument)
  return {
    tools: Object.freeze({
      writing_tools: Object.freeze(writing.map((tool) => tool.name)),
      file_arguments: Object.freeze([...new Set(naming)]),
      own_writes: Object.freeze(Object.fromEntries(writing.map((tool) => [tool.name, tool.argument]))),
      whole_file: undefined,
      resolve: asTheEngineResolves,
    }),
  }
}

/**
 * The file a path in an engine call names, as the engine's file system calls reach it: an absolute path as given, a
 * relative one joined to the session's working folder, nothing trimmed and no `~` read. A `..` is taken where the
 * file system takes it, from where the links before it lead, not by cutting the text, so a link in the path cannot
 * make the spelled place differ from the reached one. The home is not read: the engine does not expand it.
 */
export function asTheEngineResolves(value: string, cwd: string, _home: string): string {
  const [start, rest] = isAbsolute(value) ? [sep, value] : [cwd, value]
  // An empty segment or a `.` joins to where it stands, so only a `..` needs the file system.
  return rest.split(sep).reduce((at, segment) => (segment === '..' ? dirname(realPathOf(at)) : join(at, segment)), start)
}

/** The folders the engine keeps under a path root, each refused whole: the first folder of each kind it joins to the root. */
export function theRootsFolders(facts: Pick<EngineFacts, 'engine_folders'>, root: string): string[] {
  const first = Object.values(facts.engine_folders.under_root).flatMap((segments) => segments.slice(0, 1))
  return [...new Set(first)].map((folder) => join(root, folder))
}

/** Whether `path` is `folder` or inside it. */
const within = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}${sep}`)

/**
 * Why a call names a folder of the launch's own engine root, or undefined (design G1 row `refusesAWriteToTheOwnersSettings`
 * (b)). Every argument a file names a file in is read, whatever the tool: the decision the entry asks is given the
 * call's input only, so a read of the root (a tree of the secrets' folder) is refused with a write, the strict side.
 */
export function namesTheLaunchsRoot(input: Readonly<Record<string, unknown>>, folders: readonly string[], cwd: string, home: string, tools: HostFileTools): string | undefined {
  const real = folders.map((folder) => ({ folder, real: realPathOf(folder) }))
  for (const argument of tools.file_arguments) {
    const value = input[argument]
    if (typeof value !== 'string' || value.trim() === '') continue
    const reached = realPathOf(tools.resolve(value, cwd, home))
    const hit = real.find(({ real: folder }) => within(reached, folder))
    if (hit !== undefined) {
      return `${value} is in ${hit.folder}, a folder of this launch's own engine root: the engine reads its config, its secrets, its hints and its session store from there, so a member names none of it (#541 package A)`
    }
  }
  return undefined
}

/** The variables the XDG layout reads its data and state folders from; the config one is the owner-memory slice's. */
export const XDG_DATA_HOME_VARIABLE = 'XDG_DATA_HOME'
export const XDG_STATE_HOME_VARIABLE = 'XDG_STATE_HOME'

/** Each layout folder the engine names, by the variable that moves it and where it is under the home without one. */
const THE_LINUX_LAYOUT: Readonly<Record<string, { readonly variable: string; readonly under_home: readonly string[] }>> = {
  config_dir: { variable: XDG_CONFIG_HOME_VARIABLE, under_home: ['.config'] },
  data_dir: { variable: XDG_DATA_HOME_VARIABLE, under_home: ['.local', 'share'] },
  state_dir: { variable: XDG_STATE_HOME_VARIABLE, under_home: ['.local', 'state'] },
}

/** The owner's own engine folders, or why they cannot be told. */
export type TheOwnersEngineFolders = { readonly folders: readonly DeniedPlace[] } | { readonly refusal: string }

/** The issue that denies the owner's own engine folders, and whose sessions load them. */
const THE_OWNERS_ENGINE_ISSUE = 'martha#541'
const THE_OWNERS_ENGINE = "the owner's own engine sessions"

/** The engine's name as the layout spells a folder with it (etcetera 0.11.0 `AppStrategyArgs::unixy_name`). */
const unixyNameOf = (name: string): string => name.toLowerCase().replaceAll(' ', '-')

/**
 * The folders the owner's own engine reads when it runs without a path root, each denied whole (design G1 row
 * `refusesAWriteToTheOwnersMemory`): a layout folder under its variable when that is an absolute path, else under the
 * home, joined with the engine's name; a home folder under the home.
 */
export function theOwnersEngineFolders(facts: Pick<EngineFacts, 'engine_folders' | 'engine_name'>, launcher_env: Readonly<Record<string, string | undefined>>, home: string): TheOwnersEngineFolders {
  const folders: DeniedPlace[] = []
  for (const [kind, place] of Object.entries(facts.engine_folders.without_root)) {
    if ('home' in place) {
      folders.push({ what: join(home, ...place.home), issue: THE_OWNERS_ENGINE_ISSUE, loaded_by: THE_OWNERS_ENGINE })
      continue
    }
    const layout = THE_LINUX_LAYOUT[place.layout]
    if (layout === undefined) return { refusal: `the recorded engine puts its ${kind} folder in the layout's ${place.layout}, which this launch cannot place: the owner's engine folders are not told, so no member starts` }
    const named = launcher_env[layout.variable]
    const base = named !== undefined && isAbsolute(named) ? named : join(home, ...layout.under_home)
    folders.push({ what: join(base, unixyNameOf(facts.engine_name)), issue: THE_OWNERS_ENGINE_ISSUE, loaded_by: THE_OWNERS_ENGINE })
  }
  const seen = new Set<string>()
  return { folders: folders.filter((folder) => (seen.has(folder.what) ? false : (seen.add(folder.what), true))) }
}
