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
// server entry must have one of the two shapes that say what it installs:
//
//   { "command": "npx", "args": ["-y", "<package>@<x.y.z>"], "env": { ... } }
//   { "command": "npx", "args": ["-y", "-p", "<package>@<x.y.z>", "<bin>"], "env": { ... } }
//
// with `"type": "stdio"` allowed and no other key. The second names the bin
// npx runs; the core proves it against the bins recorded for that version, so
// it is accepted only for the mesh server, whose bins are recorded. Any other
// package is started in the first shape, where npx picks its bin itself. Anything else is refused,
// naming the server, a server that is not the mesh server included: there is
// no list of servers exempt from the check. `env` may name only the variables
// a server is allowed to be given: the mesh server's own settings that someone
// has reviewed (known_settings, read from the reviewed record of
// ../prove_the_mesh_server_bytes; martha#65), not any MACULA_* name, since a
// new setting can change what the server loads. Any other key is refused by name: a variable can change
// what npx installs or what runs (NPM_CONFIG_REGISTRY, PREFIX, NODE_OPTIONS,
// LD_PRELOAD, PATH, HOME and more), and a list of the bad ones is never
// complete, so the pin would no longer say which code starts.
//
// What this does not see: the servers of an installed plugin, whose version
// sits in `node_modules`, which the launch fingerprint does not hash. Their
// tools are still judged at run time by the gate's prefix and allow-list,
// which refuse every mesh tool nobody decided.

import { KNOWN_MESH_SERVER_SETTINGS } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { EXACT_VERSION, type MeshServerInstall } from '../read_a_room_through_its_gate/mesh_server_tools.ts'

/** How the config's servers install the package, or why that cannot be told. */
export type MeshServerInstalls = { readonly installs: readonly MeshServerInstall[] } | { readonly refusal: string }

/** The one command a server may start with, and the switch it must pass first. */
export const PINNED_INSTALLER = 'npx'
export const INSTALL_WITHOUT_ASKING = '-y'
/** The switch that names the package when the bin to run is named after it. */
export const PACKAGE_SWITCH = '-p'
/** The one transport a pinned server may name; leaving it out means the same. */
export const PINNED_TRANSPORT = 'stdio'
/** The keys a pinned server entry may carry. */
const PINNED_ENTRY_KEYS: ReadonlySet<string> = new Set(['type', 'command', 'args', 'env'])
/** The only environment variables a server entry may set: the mesh server's reviewed settings. */
const SERVER_ENV_ALLOWED: ReadonlySet<string> = new Set(KNOWN_MESH_SERVER_SETTINGS)
/** A bin name: a plain command, no path, no switch. */
const BIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** A package name the npm registry accepts, scoped or not. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const SHAPE = `${PINNED_INSTALLER} ${INSTALL_WITHOUT_ASKING} <package>@<x.y.z> (or ${PINNED_INSTALLER} ${INSTALL_WITHOUT_ASKING} ${PACKAGE_SWITCH} <package>@<x.y.z> <bin>)`

type Pin = { readonly pkg: string; readonly version: string; readonly bin?: string }

/** The package spec and the bin a pinned server's arguments name, or undefined for any other shape. */
function specAndBin(args: unknown): { readonly spec: string; readonly bin?: string } | undefined {
  if (!isStringList(args)) return undefined
  const [first, second, third, fourth, ...rest] = args
  if (first !== INSTALL_WITHOUT_ASKING || second === undefined || rest.length > 0) return undefined
  if (third === undefined) return { spec: second }
  if (second === PACKAGE_SWITCH && fourth !== undefined && BIN_NAME.test(fourth)) return { spec: third, bin: fourth }
  return undefined
}

function isStringList(args: unknown): args is string[] {
  return Array.isArray(args) && args.every((arg): arg is string => typeof arg === 'string')
}

/** The exact pin a server entry installs, or why it says no exact pin. */
function pinOf(name: string, entry: unknown, mesh: string): Pin | { readonly refusal: string } {
  const refused = (why: string) => ({ refusal: `its server ${name} ${why}: every server must start as ${SHAPE}, so the code it runs is named by one release` })
  if (!isObject(entry)) return refused('is not an object')
  const pin = pinIn(entry, mesh)
  return typeof pin === 'string' ? refused(pin) : pin
}

/** The exact pin an entry installs, or why not, checked in order: its shape, its spec, its bin, its env. */
function pinIn(entry: Record<string, unknown>, mesh: string): Pin | string {
  const not_pinned = whyShapeIsNoPin(entry)
  if (not_pinned !== undefined) return not_pinned
  const named = specAndBin(entry.args)
  if (named === undefined) return `starts ${PINNED_INSTALLER} with ${JSON.stringify(entry.args ?? [])}`
  const pin = pinNamed(named, mesh)
  if (typeof pin === 'string') return pin
  const env_refused = whyEnvIsRefused(entry.env)
  if (env_refused !== undefined) return env_refused
  return pin
}

/** Why an entry's keys, transport or command are not those of a pinned server, or undefined when they are. */
function whyShapeIsNoPin(entry: Record<string, unknown>): string | undefined {
  const extra = Object.keys(entry).filter((key) => !PINNED_ENTRY_KEYS.has(key))
  if (extra.length > 0) return `carries ${extra.join(', ')}`
  if (entry.type !== undefined && entry.type !== PINNED_TRANSPORT) return `is a ${String(entry.type)} server`
  if (entry.command !== PINNED_INSTALLER) return `starts ${String(entry.command)}`
  return undefined
}

/** The exact release a spec names, and its bin when only the mesh server's may be named; or why not. */
function pinNamed({ spec, bin }: { readonly spec: string; readonly bin?: string }, mesh: string): Pin | string {
  const at = spec.lastIndexOf('@')
  const [pkg, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, '']
  if (!PACKAGE_NAME.test(pkg) || !EXACT_VERSION.test(version)) return `installs ${spec}, which is no exact release`
  if (bin !== undefined && pkg !== mesh) return `names bin ${bin} of ${pkg}, whose bins nobody recorded, so what it runs is not proved`
  return bin === undefined ? { pkg, version } : { pkg, version, bin }
}

/** Why an entry's env may not be given, or undefined when it names only the mesh server's reviewed settings. */
function whyEnvIsRefused(env: unknown): string | undefined {
  if (env === undefined) return undefined
  if (!isObject(env)) return 'gives an env that is not an object'
  const unallowed = Object.keys(env).filter((key) => !SERVER_ENV_ALLOWED.has(key))
  if (unallowed.length > 0) return `sets ${unallowed.join(', ')}, which no server may be given (only the mesh server's reviewed settings, known_settings)`
  return undefined
}

/**
 * How a Claude Code server config (`.mcp.json`) installs `pkg`: each version
 * and the bin it names; refuses the config when any server is not an exact pin.
 */
export function meshServerInstallsIn(serverConfig: string, pkg: string): MeshServerInstalls {
  let config: unknown
  try {
    config = JSON.parse(serverConfig)
  } catch {
    return { refusal: 'its server config is not JSON, so the mesh server version it installs cannot be read' }
  }
  if (!isObject(config)) return { refusal: 'its server config is not a JSON object, so the mesh server version it installs cannot be read' }
  const servers = config.mcpServers ?? {}
  if (!isObject(servers)) return { refusal: 'its server config names its servers in something other than an object' }

  const installs: MeshServerInstall[] = []
  for (const [name, entry] of Object.entries(servers)) {
    const pin = pinOf(name, entry, pkg)
    if ('refusal' in pin) return pin
    if (pin.pkg === pkg) installs.push(pin.bin === undefined ? { server: name, version: pin.version } : { server: name, version: pin.version, bin: pin.bin })
  }
  return { installs }
}
