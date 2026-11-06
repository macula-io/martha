// The tools the mesh server registers, recorded from its published package.
//
// This exists so the mesh tools a member may call are proved against what the
// server really registers, not against a list typed by hand (martha#2, item 5).
//
// MESH_TOOLS_THAT_RUN and MESH_TOOLS_REFUSED (./read_a_room_through_its_gate.ts)
// are decisions, one per name. At run time the prefix and the allow-list fail
// closed on their own: a mesh tool nobody decided is refused. The record is what
// proves those decisions cover the server. The coverage check
// (../check_every_path_is_gated, gapsInMeshTools) fails CI by name when the
// server registers a tool nobody decided, a decided name the server no longer
// registers, or a tool outside the prefix, so a new release is decided rather
// than discovered.
//
// The record is read from the package's own code: every `registerTool("<name>"`
// call in its JavaScript. A call whose name is not a literal is refused by file,
// because the list could then not be complete. Re-record with
// `npm run record:mesh-tools` when the server is upgraded.

import recordedMeshServer from './recorded_mesh_server_tools.json' with { type: 'json' }

/** What the mesh server's package registers, as recorded. */
export interface RecordedMeshServer {
  /** The package's name, as its package.json gives it. */
  readonly server: string
  readonly server_version: string
  /** Every tool name it registers, sorted. */
  readonly tools: readonly string[]
}

/** One file of the package's code. */
export interface PackageSource {
  readonly path: string
  readonly text: string
}

// A registration with an argument: `registerTool(` followed by anything but `)`.
// A comment that names the method, `registerTool()`, passes nothing and is not one.
const A_REGISTRATION = /\bregisterTool\(\s*(?!\))/g
const A_NAMED_REGISTRATION = /\bregisterTool\(\s*"([^"\\]+)"/g

/** Every tool name the sources register, sorted; refuses a registration without a literal name. */
export function registeredToolsIn(sources: readonly PackageSource[]): readonly string[] {
  const names = new Set<string>()
  for (const { path, text } of sources) {
    const named = [...text.matchAll(A_NAMED_REGISTRATION)].map((match) => match[1] ?? '')
    const all = [...text.matchAll(A_REGISTRATION)].length
    if (all !== named.length) {
      throw new Error(`${path} registers a tool whose name is not a literal: the tool list cannot be read from the package`)
    }
    for (const name of named) names.add(name)
  }
  if (names.size === 0) throw new Error('The package registers no tool: this is not the mesh server')
  return [...names].sort()
}

/** The recording this repository carries. */
export const RECORDED_MESH_SERVER: RecordedMeshServer = recordedMeshServer as RecordedMeshServer
