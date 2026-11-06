// The tools the mesh server registers, recorded from its published package,
// one record per version a member may install.
//
// This exists so the mesh tools a member may call are proved against what the
// server it runs really registers, not against a list typed by hand (martha#2,
// item 5), nor against a version no member runs (martha#49).
//
// MESH_TOOLS_THAT_RUN and MESH_TOOLS_REFUSED (./read_a_room_through_its_gate.ts)
// are decisions, one per name. At run time the prefix and the allow-list fail
// closed on their own: a mesh tool nobody decided is refused. The records are
// what prove those decisions cover the server. The coverage check
// (../check_every_path_is_gated, gapsInMeshTools) fails CI by name when any
// recorded version registers a tool nobody decided, a decided name no recorded
// version registers, or a tool outside the prefix, so a new release is decided
// rather than discovered.
//
// Which version a member installs is its host's to read (for Claude Code,
// ../claude_code_host/mesh_server_install.ts, from the approved server config),
// and the launcher refuses to start a member whose version is not recorded
// (refusalOfInstalledMeshServers). So a version is retired by removing its
// record in a reviewed commit: a host still on it is then refused by name.
//
// A record also holds the version's bins, read from its package.json, because
// npx runs one of them: told none (`npx -y <pkg>@<v>`), it runs the only bin or
// the one named after the package, and refuses when there are several and none
// is (libnpmexec's getBinFromManifest); told one (`npx -y -p <pkg>@<v> <bin>`),
// it runs that bin. Only one of the bins is the server; the others are the
// package's own tools (a doctor that spawns the commands every MCP client
// config names, a register that rewrites host configs). So each record names
// its server bin (`server_bin`), chosen by whoever records the version and
// visible in the reviewed record, and a launch is refused unless the bin it
// would run is that one (refusalOfInstalledMeshServers, binNpxRuns).
//
// The records are read from the package's own code: every
// `registerTool("<name>"` call in its JavaScript. A call whose name is not a
// literal is refused by file, because the list could then not be complete.
// Record a version with `npm run record:mesh-tools`; it adds or replaces that
// version's record and keeps every other one.

import recording from './recorded_mesh_server_tools.json' with { type: 'json' }

/** What one version of the mesh server's package registers, as recorded. */
export interface RecordedMeshServer {
  /** The package's name, as its package.json gives it. */
  readonly server: string
  readonly server_version: string
  /** The one bin that is the server: the only bin a member may start. */
  readonly server_bin: string
  /** Its bins, as its package.json names them, each to the file it runs. */
  readonly bins: Readonly<Record<string, string>>
  /** Every tool name it registers, sorted. */
  readonly tools: readonly string[]
}

/** How one member's config installs the mesh server: the server's name there, the version, and the bin it names, if any. */
export interface MeshServerInstall {
  readonly server: string
  readonly version: string
  readonly bin?: string
}

/** The recording file: the package once, then each recorded version. */
export interface MeshServerRecording {
  readonly _why: string
  readonly server: string
  readonly versions: readonly {
    readonly server_version: string
    readonly server_bin: string
    readonly bins: Readonly<Record<string, string>>
    readonly tools: readonly string[]
  }[]
}

/** A version that names one release: no range, no tag, no pre-release. */
export const EXACT_VERSION = /^\d+\.\d+\.\d+$/
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

const RECORDING = recording as MeshServerRecording

/** The mesh server's package, as the recording names it. */
export const MESH_SERVER_PACKAGE: string = RECORDING.server

/** Every recorded version, oldest first. */
export const RECORDED_MESH_SERVERS: readonly RecordedMeshServer[] = RECORDING.versions.map((recorded) => ({
  server: RECORDING.server,
  ...recorded,
}))

/** A package's name without its scope: the bin npx runs when it is told none. */
const unscoped = (pkg: string): string => pkg.slice(pkg.lastIndexOf('/') + 1)

/**
 * The bin `npx -y <pkg>@<version>` runs when it is told none: the only one, or
 * the one named after the package; otherwise undefined. npm also runs the first
 * name when several names point at one file; this returns undefined there too,
 * so such a launch is refused: it fails closed, never open.
 */
export function binNpxRuns(bins: Readonly<Record<string, string>>, pkg: string): string | undefined {
  const names = Object.keys(bins)
  if (names.length === 1) return names[0]
  return names.includes(unscoped(pkg)) ? unscoped(pkg) : undefined
}

/** Why one recorded version cannot be started the way it is installed, or undefined. */
function refusalOfBin(install: MeshServerInstall, record: RecordedMeshServer): string | undefined {
  const shape = `npx -y -p ${record.server}@${record.server_version} ${record.server_bin}`
  if (install.bin === undefined) {
    if (binNpxRuns(record.bins, record.server) === record.server_bin) return undefined
    return `its server ${install.server} starts ${record.server} ${record.server_version} without naming a bin, and npx would not run its server bin ${record.server_bin} from its bins (${Object.keys(record.bins).join(', ')}): start it as ${shape}.`
  }
  if (install.bin === record.server_bin) return undefined
  const what = install.bin in record.bins ? 'one of its tools, not the server' : 'no bin it has'
  return `its server ${install.server} starts bin ${install.bin} of ${record.server} ${record.server_version}, which is ${what}: start it as ${shape}.`
}

/**
 * Why a member that installs the mesh server this way must not start, or
 * undefined when every install is a recorded version and a bin it has. An
 * install of none needs no proof.
 */
export function refusalOfInstalledMeshServers(
  installed: readonly MeshServerInstall[],
  recorded: readonly RecordedMeshServer[] = RECORDED_MESH_SERVERS,
): string | undefined {
  const recordOf = (install: MeshServerInstall) => recorded.find((record) => record.server_version === install.version)
  const unrecorded = installed.filter((install) => recordOf(install) === undefined)
  if (unrecorded.length > 0) {
    const held = recorded.map((record) => record.server_version).join(', ') || 'none'
    const named = unrecorded.map((install) => `${MESH_SERVER_PACKAGE} ${install.version}`).join(' and ')
    return `it installs ${named}, and the recorded versions are ${held}: the mesh tools it would register are not proved against the gate's decisions. Record that version, or install a recorded one.`
  }
  for (const install of installed) {
    const record = recordOf(install)
    const refusal = record === undefined ? undefined : refusalOfBin(install, record)
    if (refusal !== undefined) return refusal
  }
  return undefined
}

const partsOf = (version: string): readonly number[] => version.split('.').map(Number)

function olderFirst(a: string, b: string): number {
  const [left, right] = [partsOf(a), partsOf(b)]
  for (let at = 0; at < left.length; at++) {
    const order = (left[at] ?? 0) - (right[at] ?? 0)
    if (order !== 0) return order
  }
  return 0
}

/**
 * The recording with one version's server bin, bins and tools recorded: added in version order, or
 * replacing that version's record, every other version kept. A package of
 * another name, or a version that names no single release, is refused.
 */
export function withRecordedVersion(
  current: MeshServerRecording,
  manifest: { readonly name: string; readonly version: string; readonly bin?: string | Readonly<Record<string, string>> },
  tools: readonly string[],
  serverBin: string,
): MeshServerRecording {
  if (manifest.name !== current.server) {
    throw new Error(`The package is ${manifest.name}, and the recording is of ${current.server}: record ${current.server} only`)
  }
  if (!EXACT_VERSION.test(manifest.version)) {
    throw new Error(`The package's version ${manifest.version} names no single release: record an exact version`)
  }
  const bins = typeof manifest.bin === 'string' ? { [unscoped(manifest.name)]: manifest.bin } : { ...(manifest.bin ?? {}) }
  if (Object.keys(bins).length === 0) {
    throw new Error(`The package ${manifest.name} ${manifest.version} has no bin, so npx can start nothing from it: this is not the mesh server`)
  }
  if (!Object.hasOwn(bins, serverBin)) {
    throw new Error(`The package ${manifest.name} ${manifest.version} has no bin ${serverBin} (it has ${Object.keys(bins).join(', ')}): name its server bin`)
  }
  const others = current.versions.filter((recorded) => recorded.server_version !== manifest.version)
  const versions = [...others, { server_version: manifest.version, server_bin: serverBin, bins, tools }].sort((a, b) => olderFirst(a.server_version, b.server_version))
  return { ...current, versions }
}
