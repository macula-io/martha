// What a Claude Code launch puts into a member's session by itself, at every
// session start (martha#121).
//
// This exists so text a checkout's approved config produces at run time is
// recorded, and the member loses its shell for as long as it is readable.
//
// The owner approved the checkout's config by content (the launch fingerprint,
// ../refuse_launch_of_unapproved_config). That pins what a hook runs and what a
// server is, never what either prints: the same approved script prints other
// text when it reads the network, the clock, a file git ignores or `gh`. So:
//
//   - A HOOK OR A PLUGIN IN THE CARRIED SETTINGS RECORDS A7. Which hook events
//     put text into the context is the host's behaviour, and the launcher does
//     not see another hook's output, so any declared hook counts. A plugin
//     brings hooks of its own, and so does a plugin folder the settings' env
//     names (CLAUDE_CODE_PLUGIN_DIRS, which the host reads from there). The
//     record lasts the whole session, so what a hook prints after a tool call
//     is covered too.
//   - A SERVER IN THE CARRIED SERVER CONFIG THAT IS NOT THE RECORDED MESH
//     SERVER RECORDS A11. A server hands the model its instruction block when
//     the session starts. The mesh server's block is code of the tree that
//     ../install_the_recorded_mesh_server compares with the recorded one, file
//     by file, before every launch (placeRecordedMeshServers), so its text is
//     bound by those bytes and records nothing. A plugin may bring servers of
//     its own, so a plugin records A11 too.
//
// A carried file that cannot be read as the host would read it records
// everything it could have brought: failing closed.
//
// The checkout's fixed text (its CLAUDE.md files and its agents) is not here:
// a planned launch switches project settings off, and with them the host does
// not load it (A16; `npm run probe:launch` shows it).

import type { TurnSource } from '../host_contract/host_contract.ts'
import { MESH_SERVER_PACKAGE } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { CLAUDE_SERVERS, CLAUDE_SETTINGS } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { loadsPlugins, PLUGIN_DIRS_VARIABLE } from './hooks_and_plugins_the_owner_declares.ts'
import { meshServerInstallsIn } from './mesh_server_install.ts'

/** The settings keys that make the host run something whose output can reach the model. */
const HOOKS_KEY = 'hooks'
const PLUGINS_KEY = 'enabledPlugins'
/** The settings key whose variables the host takes as its own environment. */
const ENV_KEY = 'env'
/** The server config key that names the servers. */
const SERVERS_KEY = 'mcpServers'

const HOOK_OUTPUT: TurnSource = 'checkout_hook'
const SERVER_INSTRUCTIONS: TurnSource = 'server_instructions'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The JSON object a carried file holds, or undefined when the host could read it some other way. */
function objectIn(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** True when a settings value names anything at all: a non-empty object or list, or any other value. */
function namesAnything(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.length > 0
  if (isObject(value)) return Object.values(value).some(namesAnything)
  return value !== false
}

/** What the carried settings make the host run: hook output, and a plugin's hooks and servers, enabled or loaded from a folder. */
function fromSettings(bytes: Uint8Array | undefined): readonly TurnSource[] {
  if (bytes === undefined) return []
  const settings = objectIn(bytes)
  if (settings === undefined) return [HOOK_OUTPUT, SERVER_INSTRUCTIONS]
  const env = settings[ENV_KEY]
  const plugins = namesAnything(settings[PLUGINS_KEY]) || (isObject(env) && loadsPlugins(env[PLUGIN_DIRS_VARIABLE]))
  return [
    ...(plugins || namesAnything(settings[HOOKS_KEY]) ? [HOOK_OUTPUT] : []),
    ...(plugins ? [SERVER_INSTRUCTIONS] : []),
  ]
}

/** Whether the carried server config starts a server whose bytes no recorded tree binds. */
function fromServers(bytes: Uint8Array | undefined): readonly TurnSource[] {
  if (bytes === undefined) return []
  const config = objectIn(bytes)
  const servers = config?.[SERVERS_KEY] ?? {}
  if (config === undefined || !isObject(servers)) return [SERVER_INSTRUCTIONS]
  const installs = meshServerInstallsIn(new TextDecoder().decode(bytes), MESH_SERVER_PACKAGE)
  if ('refusal' in installs) return [SERVER_INSTRUCTIONS]
  const recorded = new Set(installs.installs.map((install) => install.server))
  return Object.keys(servers).some((name) => !recorded.has(name)) ? [SERVER_INSTRUCTIONS] : []
}

/**
 * The turn sources a launch on these carried files puts into every session it
 * starts, each once: what the owner approved but no bytes bind.
 */
export function sourcesALaunchHandsTheModel(carried_files: Readonly<Record<string, Uint8Array>>): readonly TurnSource[] {
  return [...new Set([...fromSettings(carried_files[CLAUDE_SETTINGS]), ...fromServers(carried_files[CLAUDE_SERVERS])])]
}
