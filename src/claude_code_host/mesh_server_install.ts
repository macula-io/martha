// The mesh server version a Claude Code member installs (martha#49).
//
// This exists so the mesh tools a member's gate judges are proved against the
// server version that member runs: the launcher refuses a member whose version
// is not recorded (../read_a_room_through_its_gate/mesh_server_tools.ts).
//
// A Claude Code member starts only the servers of its approved `.mcp.json`: the
// launch gate passes `--strict-mcp-config` and `--mcp-config` on the approved
// copy (../refuse_launch_of_unapproved_config). The gate judges a mesh tool by
// its own name, whichever server registers it, so a server cannot be let
// through because it does not seem to be the mesh server: a git or GitHub
// spec, a URL server, a shell wrapper, a package named in a variable or a bare
// installed bin all start code no version names. So this fails closed. Every
// server entry must have the one shape that says what it installs:
//
//   { "command": "npx", "args": ["-y", "<package>@<x.y.z>"], "env": { ... } }
//
// with `"type": "stdio"` allowed and no other key. Anything else is refused,
// naming the server, a server that is not the mesh server included: there is
// no list of servers exempt from the check. `env` may name only the variables
// a server is allowed to be given (SERVER_ENV_ALLOWED: the mesh server's own
// MACULA_* settings). Any other key is refused by name: a variable can change
// what npx installs or what runs (NPM_CONFIG_REGISTRY, PREFIX, NODE_OPTIONS,
// LD_PRELOAD, PATH, HOME and more), and a list of the bad ones is never
// complete, so the pin would no longer say which code starts.
//
// What this does not see: the servers of an installed plugin, whose version
// sits in `node_modules`, which the launch fingerprint does not hash. Their
// tools are still judged at run time by the gate's prefix and allow-list,
// which refuse every mesh tool nobody decided.

import { EXACT_VERSION } from '../read_a_room_through_its_gate/mesh_server_tools.ts'

/** The versions of the package the config's servers install, or why they cannot be told. */
export type MeshServerVersions = { readonly versions: readonly string[] } | { readonly refusal: string }

/** The one command a server may start with, and the switch it must pass first. */
export const PINNED_INSTALLER = 'npx'
export const INSTALL_WITHOUT_ASKING = '-y'
/** The one transport a pinned server may name; leaving it out means the same. */
export const PINNED_TRANSPORT = 'stdio'
/** The keys a pinned server entry may carry. */
const PINNED_ENTRY_KEYS: ReadonlySet<string> = new Set(['type', 'command', 'args', 'env'])
/** The only environment variables a server entry may set: the mesh server's own settings. */
export const SERVER_ENV_ALLOWED = /^MACULA_[A-Z0-9_]+$/
/** A package name the npm registry accepts, scoped or not. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const SHAPE = `${PINNED_INSTALLER} ${INSTALL_WITHOUT_ASKING} <package>@<x.y.z>`

/** The exact pin a server entry installs, or why it says no exact pin. */
function pinOf(name: string, entry: unknown): { readonly pkg: string; readonly version: string } | { readonly refusal: string } {
  const refused = (why: string) => ({ refusal: `its server ${name} ${why}: every server must start as ${SHAPE}, so the code it runs is named by one release` })
  if (!isObject(entry)) return refused('is not an object')
  const extra = Object.keys(entry).filter((key) => !PINNED_ENTRY_KEYS.has(key))
  if (extra.length > 0) return refused(`carries ${extra.join(', ')}`)
  if (entry.type !== undefined && entry.type !== PINNED_TRANSPORT) return refused(`is a ${String(entry.type)} server`)
  if (entry.command !== PINNED_INSTALLER) return refused(`starts ${String(entry.command)}`)
  const args = entry.args
  if (!Array.isArray(args) || args.length !== 2 || args[0] !== INSTALL_WITHOUT_ASKING || typeof args[1] !== 'string') {
    return refused(`starts ${PINNED_INSTALLER} with ${JSON.stringify(args ?? [])}`)
  }
  const spec = args[1]
  const at = spec.lastIndexOf('@')
  const [pkg, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, '']
  if (!PACKAGE_NAME.test(pkg) || !EXACT_VERSION.test(version)) return refused(`installs ${spec}, which is no exact release`)
  if (entry.env !== undefined) {
    if (!isObject(entry.env)) return refused('gives an env that is not an object')
    const unallowed = Object.keys(entry.env).filter((key) => !SERVER_ENV_ALLOWED.test(key))
    if (unallowed.length > 0) return refused(`sets ${unallowed.join(', ')}, which no server may be given (only ${SERVER_ENV_ALLOWED.source})`)
  }
  return { pkg, version }
}

/**
 * The versions of `pkg` that a Claude Code server config (`.mcp.json`)
 * installs; refuses the config when any server is not an exact pin.
 */
export function meshServerVersionsIn(serverConfig: string, pkg: string): MeshServerVersions {
  let config: unknown
  try {
    config = JSON.parse(serverConfig)
  } catch {
    return { refusal: 'its server config is not JSON, so the mesh server version it installs cannot be read' }
  }
  if (!isObject(config)) return { refusal: 'its server config is not a JSON object, so the mesh server version it installs cannot be read' }
  const servers = config.mcpServers ?? {}
  if (!isObject(servers)) return { refusal: 'its server config names its servers in something other than an object' }

  const versions: string[] = []
  for (const [name, entry] of Object.entries(servers)) {
    const pin = pinOf(name, entry)
    if ('refusal' in pin) return pin
    if (pin.pkg === pkg) versions.push(pin.version)
  }
  return { versions }
}
