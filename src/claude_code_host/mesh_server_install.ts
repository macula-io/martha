// The mesh server version a Claude Code member installs (martha#49).
//
// This exists so the mesh tools a member's gate judges are proved against the
// server version that member runs: the launcher refuses a member whose version
// is not recorded (../read_a_room_through_its_gate/mesh_server_tools.ts).
//
// A Claude Code member starts only the servers of its approved `.mcp.json`: the
// launch gate passes `--strict-mcp-config` and `--mcp-config` on the approved
// copy (../refuse_launch_of_unapproved_config). So the version is read from the
// bytes the owner approved, where it is pinned (`npx -y <package>@<version>`),
// and from nowhere else. Every string of every server entry that names the
// package must be exactly `<package>@<version>`, one release: a bare package, a
// tag, a range, a pre-release, a `--package=` form or a path into an installed
// copy is refused, naming the server, since none of them says which tools will
// register.
//
// What this does not see: a mesh server started from a copy that never names
// the package (a checkout of its source, say), and the servers of an installed
// plugin, whose version sits in `node_modules`, which the launch fingerprint
// does not hash. Their tools are still judged at run time by the gate's prefix
// and allow-list, which refuse every mesh tool nobody decided; what is missing
// there is the proof, not the refusal.

import { EXACT_VERSION } from '../read_a_room_through_its_gate/mesh_server_tools.ts'

/** The versions of the package the config's servers install, or why they cannot be told. */
export type MeshServerVersions = { readonly versions: readonly string[] } | { readonly refusal: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every string a server entry starts its process with: its command and its arguments. */
function startedWith(entry: Record<string, unknown>): readonly unknown[] {
  return [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])]
}

/** The versions of `pkg` that a Claude Code server config (`.mcp.json`) installs. */
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

  const pinned = `${pkg}@`
  const versions: string[] = []
  for (const [name, entry] of Object.entries(servers)) {
    if (!isObject(entry)) return { refusal: `its server ${name} is not an object, so what it starts cannot be read` }
    for (const part of startedWith(entry)) {
      if (typeof part !== 'string' || !part.includes(pkg)) continue
      const version = part.startsWith(pinned) ? part.slice(pinned.length) : ''
      if (!EXACT_VERSION.test(version)) {
        return { refusal: `its server ${name} starts ${part}, which names ${pkg} with no exact version: pin it as ${pkg}@<version>` }
      }
      versions.push(version)
    }
  }
  return { versions }
}
