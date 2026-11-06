// What proves the mesh server's bytes, not only its version (martha#65).
//
// This exists so the mesh server a member runs is the code its recorded version
// names: no registry, project config, local or global install can put other
// bytes under that number.
//
// A version number alone does not say which code runs. npx takes the bytes
// from whatever registry and install it finds, and @macula-io/mcp depends on
// caret ranges with no shrinkwrap, so even the right registry hands out other
// dependency code from week to week. So each recorded version carries its
// whole tree, in a reviewed commit (recorded_mesh_server_trees.json):
//
//   - `integrity`: the sha512 of the server's tarball, the one its tools were
//     read from (../read_a_room_through_its_gate/mesh_server_tools.ts);
//   - `lock`: npm's package-lock for that version alone, which npm checks every
//     tarball against when it installs (refusalOfLock says what it may hold);
//   - `files`: every file of the installed tree with its sha512, sorted by path,
//     so a re-record shows exactly which files changed. The launcher compares
//     the tree it starts with this, file by file (changesInTree);
//   - `settings`: the MACULA_* settings the server's code reads. A version that
//     reads one nobody reviewed is not recorded (refusalOfSettings): a new
//     setting could load code, and a new pin must not let it in silently.
//   - `environment_reads`: what every package of the tree reads from the
//     environment, by package: each name read by a literal key with the files
//     that read it, and the files that read by a key that is no literal
//     (martha#72). A package reading a name the server is started with (HOME,
//     PATH, an approved setting) is not recorded unless someone reviewed that
//     read (refusalOfEnvironmentReads), since a new release of any dependency
//     could otherwise act on a name nobody listed. A read by a computed key is
//     listed, not refused: common dependencies make them (node-gyp-build reads
//     `<NAME>_PREBUILD`), and every name the server is not started with is
//     emptied for it anyway.
//
// The registry is recorded once: every tarball of every lock comes from it.
// The host adapter that installs, compares and starts the tree is
// ../install_the_recorded_mesh_server. Hashes are sha512 in base64, as npm
// writes them.

import { createHash } from 'node:crypto'

import { olderFirst, type PackageSource } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import recording from './recorded_mesh_server_trees.json' with { type: 'json' }

/** One package as npm's lock holds it; only what this check reads is typed. */
export interface LockedPackage {
  readonly version?: string
  readonly resolved?: string
  readonly integrity?: string
  readonly link?: boolean
  readonly hasInstallScript?: boolean
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly optional?: boolean
  readonly [key: string]: unknown
}

/** npm's package-lock, kept verbatim. */
export interface NpmLock {
  readonly lockfileVersion: number
  readonly packages: Readonly<Record<string, LockedPackage>>
  readonly [key: string]: unknown
}

/** One version's tree, as recorded. */
export interface RecordedMeshTree {
  readonly server_version: string
  readonly integrity: string
  readonly settings: readonly string[]
  /** What each package of the tree reads from the environment, by package name (martha#72). */
  readonly environment_reads: Readonly<Record<string, PackageEnvironmentReads>>
  readonly lock: NpmLock
  /** Every installed file, by path under the install directory, with its sha512. */
  readonly files: Readonly<Record<string, string>>
}

/** The recording file. */
export interface MeshTreeRecording {
  readonly _why: string
  /** The registry every locked tarball comes from, as npm writes it (ending in a slash). */
  readonly registry: string
  /** The settings someone has reviewed: a version reading any other is not recorded. */
  readonly known_settings: readonly string[]
  /**
   * The reads of a name the server is started with that someone has reviewed,
   * by package: a package reading another one is not recorded (martha#72).
   */
  readonly known_environment_reads: Readonly<Record<string, readonly string[]>>
  readonly versions: readonly RecordedMeshTree[]
}

/** What one package reads from the environment. */
export interface PackageEnvironmentReads {
  /** Each name read by a literal key, with the files that read it, sorted. */
  readonly reads: Readonly<Record<string, readonly string[]>>
  /** The files that read by a key that is no literal, so the name cannot be listed, sorted. */
  readonly computed: readonly string[]
}

/** The hash every recorded file and tarball is named by. */
export const TREE_HASH = 'sha512'
/** What a setting of the mesh server is named with. */
export const SETTING_PREFIX = 'MACULA_'

const SRI = new RegExp(`^${TREE_HASH}-[A-Za-z0-9+/]+=*$`)
const NODE_MODULES = 'node_modules/'

/** The integrity string npm writes for these bytes. */
export const sriOf = (bytes: Uint8Array): string => `${TREE_HASH}-${createHash(TREE_HASH).update(bytes).digest('base64')}`

export const MESH_TREE_RECORDING = recording as MeshTreeRecording
export const MESH_SERVER_REGISTRY: string = MESH_TREE_RECORDING.registry
export const KNOWN_MESH_SERVER_SETTINGS: readonly string[] = MESH_TREE_RECORDING.known_settings
export const KNOWN_ENVIRONMENT_READS: Readonly<Record<string, readonly string[]>> = MESH_TREE_RECORDING.known_environment_reads
export const RECORDED_MESH_TREES: readonly RecordedMeshTree[] = MESH_TREE_RECORDING.versions

/** A package's name from its key in the lock: the part after the last node_modules/. */
const nameOfKey = (key: string): string => key.slice(key.lastIndexOf(NODE_MODULES) + NODE_MODULES.length)

/** What a locked package must not be, each with the words that name it. */
const REFUSED_IN_A_LOCK: readonly (readonly [string, (locked: LockedPackage) => boolean])[] = [
  ['is a link, not a package from the registry', (locked) => locked.link === true],
  ['runs an install script', (locked) => locked.hasInstallScript === true],
  ['is limited to some platforms, so the tree would differ by machine', (locked) => locked.os !== undefined || locked.cpu !== undefined],
  ['is optional, so the tree would differ by machine', (locked) => locked.optional === true],
]

/** Why one locked package cannot be part of a recorded tree, or undefined. */
function refusalOfLocked(key: string, locked: LockedPackage, registry: string): string | undefined {
  const refused = REFUSED_IN_A_LOCK.find(([, holds]) => holds(locked))
  if (refused !== undefined) return `${nameOfKey(key)} ${refused[0]}`
  if (typeof locked.resolved !== 'string' || !locked.resolved.startsWith(registry)) {
    return `${nameOfKey(key)} comes from ${String(locked.resolved)}, not from ${registry}`
  }
  if (typeof locked.integrity !== 'string' || !SRI.test(locked.integrity)) {
    return `${nameOfKey(key)} carries no ${TREE_HASH} integrity (${String(locked.integrity)})`
  }
  return undefined
}

/** The server, the version and tarball it was recorded from, and the registry every tarball must come from. */
export interface LockPin {
  readonly server: string
  readonly version: string
  readonly integrity: string
  readonly registry: string
}

/**
 * Why this lock cannot pin the server's tree, or undefined when it can: it
 * must hold the server at the recorded version with the tarball's own
 * integrity, and every package in it must come from the registry with a
 * sha512, and be the same on every machine.
 */
export function refusalOfLock(lock: NpmLock, pin: LockPin): string | undefined {
  const of = `the lock of ${pin.server} ${pin.version}`
  const server = lock.packages[`${NODE_MODULES}${pin.server}`]
  if (server === undefined || server.version !== pin.version) {
    return `${of} does not hold ${pin.server} at ${pin.version} (it holds ${String(server?.version)})`
  }
  if (server.integrity !== pin.integrity) {
    return `${of} holds ${pin.server} as ${String(server.integrity)}, and the tarball its tools were read from is ${pin.integrity}`
  }
  for (const [key, locked] of Object.entries(lock.packages)) {
    if (key === '') continue
    const refusal = refusalOfLocked(key, locked, pin.registry)
    if (refusal !== undefined) return `${of}: ${refusal}`
  }
  return undefined
}

// How the code reads the environment. A literal key, `process.env.X` or
// `process.env["X"]`, can be listed; so can a spread, `...process.env`, which
// hands the whole environment to a child and reads no setting itself. Anything
// else (a computed key, a destructure, the object kept under another name or
// passed along) could read a setting nobody can list, so it is refused by file.
const ANY_READ = /\bprocess\.env\b/g
const DOT_READ = /\bprocess\.env\.([A-Za-z_$][\w$]*)/g
const BRACKET_READ = /\bprocess\.env\[\s*(["'])([^"'\\]+)\1\s*\]/g
const SPREAD = /\.\.\.\s*process\.env\b(?!\s*[.[?])/g

/** The names one file's code reads by a literal key, and whether it reads any by a key that is no literal. */
function environmentReadOf(text: string): { readonly names: readonly string[]; readonly computed: boolean } {
  const dotted = [...text.matchAll(DOT_READ)].map((match) => match[1] ?? '')
  const bracketed = [...text.matchAll(BRACKET_READ)].map((match) => match[2] ?? '')
  const spreads = [...text.matchAll(SPREAD)].length
  return { names: [...dotted, ...bracketed], computed: [...text.matchAll(ANY_READ)].length !== dotted.length + bracketed.length + spreads }
}

/** Every setting the sources read, sorted; refuses a read whose key cannot be listed. */
export function settingsReadIn(sources: readonly PackageSource[], prefix: string = SETTING_PREFIX): readonly string[] {
  const read = new Set<string>()
  for (const { path, text } of sources) {
    const { names, computed } = environmentReadOf(text)
    if (computed) {
      throw new Error(`${path} reads the environment by a key that is not a literal: the settings the server reads cannot be listed`)
    }
    for (const key of names) if (key.startsWith(prefix)) read.add(key)
  }
  return [...read].sort()
}

const byName = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number => (a < b ? -1 : a > b ? 1 : 0)

/** The package a file of the installed tree belongs to: the deepest package of the lock whose directory holds it. */
function packageOfFile(path: string, lock: NpmLock): string {
  const holders = Object.keys(lock.packages).filter((key) => key !== '' && path.startsWith(`${key}/`))
  const deepest = holders.sort((a, b) => b.length - a.length)[0]
  if (deepest === undefined) throw new Error(`${path} is in no package of the lock, so whose reads it holds cannot be told`)
  return nameOfKey(deepest)
}

/**
 * What every package of an installed tree reads from the environment, by
 * package name: each name read by a literal key with its files, and the files
 * that read by a key that is no literal. Only packages that read something are
 * listed; names, packages and files are sorted, so a re-record shows exactly
 * which read is new. The sources are the tree's code, by path under the
 * install directory, as `files` names them.
 */
export function environmentReadsInTree(sources: readonly PackageSource[], lock: NpmLock): Record<string, PackageEnvironmentReads> {
  const found = new Map<string, { reads: Map<string, Set<string>>; computed: Set<string> }>()
  for (const { path, text } of sources) {
    const { names, computed } = environmentReadOf(text)
    if (names.length === 0 && !computed) continue
    const name = packageOfFile(path, lock)
    const of = found.get(name) ?? { reads: new Map<string, Set<string>>(), computed: new Set<string>() }
    found.set(name, of)
    for (const read of names) of.reads.set(read, (of.reads.get(read) ?? new Set<string>()).add(path))
    if (computed) of.computed.add(path)
  }
  return Object.fromEntries(
    [...found.entries()].sort(byName).map(([name, { reads, computed }]) => [
      name,
      { reads: Object.fromEntries([...reads.entries()].sort(byName).map(([read, files]) => [read, [...files].sort()])), computed: [...computed].sort() },
    ]),
  )
}

/** What decides whether a tree's environment reads may be recorded and run. */
export interface EnvironmentReview {
  /** The server's own package, whose reads of its reviewed settings those settings already cover. */
  readonly server: string
  /** Every name the server is started with a value for: the ones it keeps from the host and its approved settings. */
  readonly startedWith: readonly string[]
  /** The server's reviewed settings (known_settings). */
  readonly knownSettings: readonly string[]
  /** The reviewed reads, by package (known_environment_reads). */
  readonly knownReads: Readonly<Record<string, readonly string[]>>
}

/**
 * Why a tree whose packages read these names may not be recorded or run, or
 * undefined: every read of a name the server is started with is reviewed for
 * that package. Names each unreviewed read with its package and files.
 */
export function refusalOfEnvironmentReads(reads: Readonly<Record<string, PackageEnvironmentReads>>, review: EnvironmentReview): string | undefined {
  const unreviewed = Object.entries(reads).flatMap(([name, of]) =>
    Object.entries(of.reads)
      .filter(([read]) => review.startedWith.includes(read))
      .filter(([read]) => !(name === review.server && review.knownSettings.includes(read)))
      .filter(([read]) => !(review.knownReads[name] ?? []).includes(read))
      .map(([read, files]) => `${name} reads ${read} in ${files.join(', ')}`),
  )
  if (unreviewed.length === 0) return undefined
  return `${unreviewed.join('; ')}, and the server is started with that name, so nobody has reviewed what the package does with it. Review each read, then add the name under the package in known_environment_reads in a reviewed commit.`
}

/** Why a version reading these settings may not be recorded yet, or undefined when each is known. */
export function refusalOfSettings(read: readonly string[], known: readonly string[]): string | undefined {
  const unknown = read.filter((setting) => !known.includes(setting))
  if (unknown.length === 0) return undefined
  return `it reads ${unknown.join(', ')}, which nobody has reviewed: a setting can change what the server loads. Review what each one does, then add it to known_settings in a reviewed commit.`
}

/** How many paths of one kind a refusal names before it counts the rest. */
const NAMED_PATHS = 5

const listed = (what: string, paths: readonly string[]): string[] =>
  paths.length === 0 ? [] : [`${what} ${paths.slice(0, NAMED_PATHS).join(', ')}${paths.length > NAMED_PATHS ? ` and ${paths.length - NAMED_PATHS} more` : ''}`]

/**
 * What differs between a recorded tree and the files found, naming each
 * changed, missing and added path, or undefined when they are the same.
 */
export function changesInTree(recorded: Readonly<Record<string, string>>, found: Readonly<Record<string, string>>): string | undefined {
  const paths = Object.keys(recorded)
  const changed = paths.filter((path) => found[path] !== undefined && found[path] !== recorded[path])
  const missing = paths.filter((path) => found[path] === undefined)
  const added = Object.keys(found).filter((path) => recorded[path] === undefined)
  const all = [...listed('changed', changed), ...listed('missing', missing), ...listed('added', added)]
  return all.length === 0 ? undefined : all.join('; ')
}

const sortedByPath = (files: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** The recording with this tree recorded: added in version order or replacing that version, its files sorted by path. */
export function withRecordedTree(current: MeshTreeRecording, tree: RecordedMeshTree): MeshTreeRecording {
  const others = current.versions.filter((recorded) => recorded.server_version !== tree.server_version)
  const versions = [...others, { ...tree, files: sortedByPath(tree.files) }].sort((a, b) => olderFirst(a.server_version, b.server_version))
  return { ...current, versions }
}
