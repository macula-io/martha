// What Claude Code's settings files put in the environment of every server it
// starts (martha#65 r=3).
//
// Claude Code starts a tool server with its own environment, then the `env`
// block of every settings file it loaded, then the server entry's own `env` on
// top. With `--setting-sources user` it still loads two: the owner's user
// settings file and the approved copy passed by `--settings`. A name in either
// reaches the mesh server although no reviewer approved it, past the
// environment the launcher builds for the server from the host's
// (../install_the_recorded_mesh_server).
//
// So a launch is refused, naming the file and the variable, when either file
// sets a name the server may not be given: anything but the few it keeps
// (HOME, PATH: SERVER_NEEDS) and its reviewed settings (known_settings). Not
// emptied in silence: the owner put the name there for a reason, and a server
// that quietly lacks it is a puzzle; a refusal says what to move.
//
// One exception, defined once below: Claude Code's own variables, which
// configure Claude Code and which the server's code never reads. Those are
// emptied for the server instead of refused, so an owner who keeps one in the
// user settings file can still launch.
//
// Admin-managed settings (on Linux /etc/claude-code/managed-settings.json) are
// loaded too; they are root's, not the owner's or a checkout's, and are not read
// here.

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** One of Claude Code's own variables, which its settings may carry and the mesh server never reads. */
export interface ClaudeCodeOwnVariable {
  readonly name: string
  /** What it does in Claude Code, and how it was shown the server never reads it. */
  readonly why: string
}

/**
 * Claude Code's own variables, emptied for the server rather than refused.
 * Each was checked against every file of every recorded mesh server tree
 * (recorded_mesh_server_trees.json); a name added here needs the same check.
 * Emptying is what keeps it from the server, so a read the check missed still
 * finds nothing.
 */
export const CLAUDE_CODE_OWN_VARIABLES: readonly ClaudeCodeOwnVariable[] = [
  {
    name: 'CLAUDE_CODE_PLUGIN_DIRS',
    why: 'the directories Claude Code loads plugins from; no file of the recorded trees of 0.51.0 or 0.51.2 names it',
  },
]

/** Where Claude Code reads the owner's user settings: CLAUDE_CONFIG_DIR, else ~/.claude. */
export const USER_SETTINGS_FILE = 'settings.json'
const DEFAULT_CONFIG_DIR = '.claude'

/**
 * The user settings file the host started with this environment reads; or a
 * refusal when CLAUDE_CONFIG_DIR is set but empty or not absolute. Such a value
 * may resolve one way here and another way in the host (an empty one, or one
 * against a different working directory), so the file checked would not be
 * the file loaded (martha#65 r=4).
 */
export function userSettingsPath(env: Readonly<Record<string, string | undefined>>): { readonly path: string } | { readonly refusal: string } {
  const configDir = env.CLAUDE_CONFIG_DIR
  if (configDir === undefined) return { path: join(env.HOME ?? homedir(), DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE) }
  if (!isAbsolute(configDir)) {
    return {
      refusal: `CLAUDE_CONFIG_DIR is ${JSON.stringify(configDir)}, not an absolute directory, so which user settings file Claude Code reads cannot be told; set it to an absolute path or unset it`,
    }
  }
  return { path: join(configDir, USER_SETTINGS_FILE) }
}

/** A settings file the host loads; `text` is undefined when there is no such file. */
export interface SettingsFile {
  readonly path: string
  readonly text: string | undefined
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** One file's env block, or why it cannot be told. */
function envOf(file: SettingsFile): { readonly env: Readonly<Record<string, unknown>> } | { readonly refusal: string } {
  if (file.text === undefined) return { env: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(file.text)
  } catch {
    return { refusal: `${file.path} is not JSON, so what it puts in a server's environment cannot be told` }
  }
  if (!isObject(parsed)) return { refusal: `${file.path} is not a JSON object, so what it puts in a server's environment cannot be told` }
  if (parsed.env === undefined) return { env: {} }
  if (!isObject(parsed.env)) return { refusal: `${file.path} gives an env that is not an object` }
  return { env: parsed.env }
}

const OWN: ReadonlySet<string> = new Set(CLAUDE_CODE_OWN_VARIABLES.map((variable) => variable.name))

/**
 * What the settings files, in the order the host loads them (a later one wins),
 * add to every server's environment; or a refusal naming each file and each
 * variable the server may not be given. `allowed` is what the server may be
 * given; Claude Code's own variables pass, to be emptied by the caller.
 */
export function environmentFromSettings(
  files: readonly SettingsFile[],
  allowed: readonly string[],
): { readonly env: Readonly<Record<string, string>> } | { readonly refusal: string } {
  const permitted = new Set([...allowed, ...OWN])
  const env: Record<string, string> = {}
  const refusals: string[] = []
  for (const file of files) {
    const read = envOf(file)
    if ('refusal' in read) {
      refusals.push(read.refusal)
      continue
    }
    const notString = Object.keys(read.env).filter((name) => typeof read.env[name] !== 'string')
    const unallowed = Object.keys(read.env).filter((name) => !permitted.has(name))
    if (notString.length > 0) refusals.push(`${file.path} gives ${notString.join(', ')} a value that is not a string`)
    if (unallowed.length > 0) {
      refusals.push(
        `${file.path} sets ${unallowed.join(', ')} for every server Claude Code starts, the mesh server included, which no reviewer approved (only ${allowed.join(', ')} and Claude Code's own ${[...OWN].join(', ')}); remove it from that file's env`,
      )
    }
    for (const [name, value] of Object.entries(read.env)) if (typeof value === 'string') env[name] = value
  }
  return refusals.length > 0 ? { refusal: refusals.join('; ') } : { env }
}
