// The mesh server a Claude Code member runs is the tree its version was recorded
// with (martha#65).
//
// This exists so planted or substituted bytes cannot serve a member's mesh tools
// under a recorded version number (register row B1).
//
// The approved server config says `npx -y [-p] <package>@<x.y.z> [<bin>]`
// (../claude_code_host/mesh_server_install.ts). npx would decide where the bytes
// come from: the registry a user or global .npmrc names, a project .npmrc, a
// matching package already in a node_modules above the checkout, or one under
// the global prefix. None of those is approved. So the mesh server's entry is
// never started through npx:
//
//   1. INSTALL from the recorded lock alone, once per version, into
//      `<root>/<version>`: `npm ci --ignore-scripts` in a fresh directory, run by
//      the npm that ships with the node running the launcher, with user and
//      global config files that are empty, the recorded registry, its own prefix
//      and cache, and an environment
//      that holds nothing but its own HOME and PATH (an allow-list: no npm_config_*,
//      NODE_* or other variable reaches it). npm checks every tarball against the
//      lock, so other bytes fail the install, and the refusal names the package.
//   2. COMPARE the installed tree with the recorded one, file by file, before
//      every launch: a changed, missing or added file refuses the launch by path.
//      The record is the reviewed one in the repository, never a digest kept
//      beside the install, which whoever can edit the tree could rewrite too.
//   3. START it by path, confined to its tree: in the approved copy the host is
//      given, the entry becomes `<this node> --import <hook>?tree=<url>
//      <root>/<version>/node_modules/<package>/<file>`, with its own keys kept.
//      The hook (./confine_to_the_recorded_tree.ts, the launcher's own file)
//      refuses every module that resolves outside the tree, so a module the
//      tree lacks is not found above it or under HOME (martha#73). The file is the one the version's
//      record gives its server bin (`server_bin`, martha#49); an entry naming any
//      other bin is refused, whatever the launch gate let through.
//   4. BUILD its environment: a host starts a server with its own environment
//      under the entry's `env`, so whatever the launcher hands the host would
//      reach the server: a NODE_OPTIONS preload, a library for libc to preload,
//      a <NAME>_PREBUILD directory a dependency loads a native addon from. So the
//      entry's `env` names every variable the host is given: HOME and PATH
//      (SERVER_NEEDS) keep the host's values, the entry's own approved settings
//      keep theirs, and every other one is set empty. An allow-list: a variable
//      nobody thought of is emptied too. What the host adds by itself after it
//      starts is its own, not the launcher's.
//
// What this does not close: a member's shell runs as the same user, so it can
// edit the installed tree while a session runs. The next launch refuses that
// tree, naming the file; the server already running is not checked again. This
// is the same class as the contact-policy file (macula-io/macula-mcp#79).
//
// What every package of the tree reads from the environment is recorded with
// it (martha#72). A read of a name the server is started with (SERVER_NEEDS
// and the approved settings) that nobody reviewed for that package refuses
// the record, and refuses the launch too, so a name added to SERVER_NEEDS or
// to the settings later cannot reach a dependency that reads it unreviewed.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import process from 'node:process'

import {
  EXACT_VERSION,
  MESH_SERVER_PACKAGE,
  RECORDED_MESH_SERVERS,
  type PackageSource,
  type RecordedMeshServer,
} from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import {
  MESH_TREE_RECORDING,
  changesInTree,
  environmentReadsInTree,
  refusalOfEnvironmentReads,
  refusalOfLock,
  refusalOfSettings,
  settingsReadIn,
  sriOf,
  type EnvironmentReview,
  type MeshTreeRecording,
  type NpmLock,
  type RecordedMeshTree,
} from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { TREE_PARAMETER, treeUrlOf } from './confine_to_the_recorded_tree.ts'

/** Where npm's own program sits beside the node that runs this: `<prefix>/bin/node` and `<prefix>/lib/node_modules/npm`. */
const NPM_CLI_FROM_PREFIX = ['lib', 'node_modules', 'npm', 'bin', 'npm-cli.js']
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const PACKAGE_LOCK = 'package-lock.json'
/** npm's own record of what it installed, which only npm reads. */
const HIDDEN_LOCK = join(NODE_MODULES, '.package-lock.json')
/** The links npm makes to each bin, which nothing starts: the member starts its bin by path. */
const BIN_LINKS = '.bin'
/** npm's home, config and cache under the root, outside every tree. */
const NPM_HOME = '.npm'
const INSTALLING = '.installing-'
/** The name the recorded lock is made under, so every lock names the same project. */
const LOCK_PROJECT = 'mesh-server'
const CODE = /\.[cm]?js$/
/**
 * The host's variables the server keeps: HOME, where it keeps its identity and
 * its databases, and PATH, which the commands it runs for a served procedure
 * are found on. Every other variable the host is given is emptied.
 */
export const SERVER_NEEDS: readonly string[] = ['HOME', 'PATH']
const INTEGRITY_FAILED = 'EINTEGRITY'
/** The launcher's own hook that confines what the server loads to its tree; never a file of the tree. */
const CONFINING_HOOK = new URL('./confine_to_the_recorded_tree.ts', import.meta.url)
const PRELOAD = '--import'

/** The arguments that start `file` with every module it loads confined to the tree at `dir`, a real path (provedTreeOf). */
function confinedStart(dir: string, file: string): readonly string[] {
  const hook = new URL(CONFINING_HOOK)
  hook.searchParams.set(TREE_PARAMETER, treeUrlOf(join(dir, NODE_MODULES)))
  return [PRELOAD, hook.href, file]
}

/** The npm program that ships with this node. */
export function npmBesideNode(node: string = process.execPath): string {
  return join(dirname(dirname(node)), ...NPM_CLI_FROM_PREFIX)
}

type Ran = { readonly ran: true } | { readonly ran: false; readonly why: string }

/**
 * Runs npm in `dir` with no config, setting or install but the ones given here.
 * npm is given `dir`'s real path: it resolves its working directory through
 * links but not `--prefix`, and a prefix reached through a link (macOS's default
 * TMPDIR, /var -> /private/var) makes it key the lock by a path that climbs out
 * and back in, so the server's entry is not found (martha#79).
 */
function runIsolatedNpm(args: readonly string[], linkedDir: string, registry: string, npmHome: string): Ran {
  const npm = npmBesideNode()
  const dir = realpathSync(linkedDir)
  if (!existsSync(npm)) return { ran: false, why: `the npm of this node is not at ${npm}` }
  mkdirSync(npmHome, { recursive: true, mode: 0o700 })
  // Two files: npm refuses to load one file as both.
  const [userConfig, globalConfig] = [join(npmHome, 'user-npmrc'), join(npmHome, 'global-npmrc')]
  for (const empty of [userConfig, globalConfig]) writeFileSync(empty, '')
  const isolated = [
    `--userconfig=${userConfig}`,
    `--globalconfig=${globalConfig}`,
    `--registry=${registry}`,
    `--prefix=${dir}`,
    `--cache=${join(npmHome, 'cache')}`,
    // A tarball that fails its integrity is not fetched again: other bytes are refused at once.
    '--fetch-retries=0',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
    '--loglevel=error',
  ]
  const run = spawnSync(process.execPath, [npm, ...args, ...isolated], {
    cwd: dir,
    env: { HOME: npmHome, PATH: dirname(process.execPath) },
    encoding: 'utf8',
  })
  if (run.status === 0) return { ran: true }
  return { ran: false, why: (run.stderr || run.error?.message || `npm ended with ${String(run.status)}`).trim() }
}

/** Every file of an installed tree, by path under `dir`, sorted, with its hash; refuses what is no plain file. */
export function filesOfTree(dir: string): { readonly files: Record<string, string> } | { readonly refusal: string } {
  const files: Record<string, string> = {}
  const top = join(dir, NODE_MODULES)
  if (!existsSync(top)) return { files }
  for (const entry of readdirSync(top, { recursive: true, withFileTypes: true })) {
    const path = relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/')
    if (path === HIDDEN_LOCK.split(sep).join('/') || path.split('/').includes(BIN_LINKS)) continue
    if (entry.isDirectory()) continue
    if (!entry.isFile()) return { refusal: `${path} in the mesh server tree is no plain file` }
    files[path] = sriOf(readFileSync(join(dir, path)))
  }
  return { files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) }
}

/** The package.json the lock was made for: the project the lock itself names. */
function manifestOfLock(lock: NpmLock): string {
  const project = lock.packages[''] ?? {}
  return `${JSON.stringify({ name: lock.name, private: true, dependencies: project.dependencies ?? {} }, null, 2)}\n`
}

/** The package an integrity failure is about, found by the integrity npm wanted. */
function failedPackageOf(lock: NpmLock, why: string): string {
  const failed = Object.entries(lock.packages).filter(([key, locked]) => key !== '' && typeof locked.integrity === 'string' && why.includes(locked.integrity))
  return failed.map(([key]) => key.slice(key.lastIndexOf(`${NODE_MODULES}/`) + NODE_MODULES.length + 1)).join(', ') || 'a package of the lock'
}

/** Installs the lock into `dir` with nothing but it. */
function installLock(lock: NpmLock, dir: string, registry: string, npmHome: string): string | undefined {
  writeFileSync(join(dir, PACKAGE_JSON), manifestOfLock(lock))
  writeFileSync(join(dir, PACKAGE_LOCK), `${JSON.stringify(lock, null, 2)}\n`)
  const ran = runIsolatedNpm(['ci'], dir, registry, npmHome)
  if (ran.ran) return undefined
  if (ran.why.includes(INTEGRITY_FAILED)) {
    return `the registry served other bytes for ${failedPackageOf(lock, ran.why)} than the recorded lock names (${INTEGRITY_FAILED})`
  }
  return `npm could not install the recorded lock: ${ran.why.split('\n').slice(0, 3).join(' ')}`
}

/** What judges a tree's environment reads: every name the server is started with a value for, and the reviewed reads. */
function environmentReviewOf(recording: MeshTreeRecording): EnvironmentReview {
  return {
    server: MESH_SERVER_PACKAGE,
    startedWith: [...SERVER_NEEDS, ...recording.known_settings],
    knownSettings: recording.known_settings,
    knownReads: recording.known_environment_reads,
  }
}

/** Why the tree at `dir` is not the recorded one, or undefined. */
function treeUnlike(tree: RecordedMeshTree, dir: string): string | undefined {
  const found = filesOfTree(dir)
  if ('refusal' in found) return found.refusal
  const changes = changesInTree(tree.files, found.files)
  return changes === undefined ? undefined : `the mesh server tree at ${dir} is not the one recorded for ${MESH_SERVER_PACKAGE} ${tree.server_version}: ${changes}. Remove ${dir} to install it again.`
}

/** The recorded tree of this version at `<root>/<version>`, installed if it is not there yet; or why it cannot run. */
function provedTreeOf(tree: RecordedMeshTree, given: string, registry: string): { readonly dir: string } | { readonly refusal: string } {
  // The root by its real path, once: node resolves every module to its real
  // path, so the tree is installed, compared and confined under the same name
  // even when the root sits behind a symlink (/home -> /var/home).
  mkdirSync(given, { recursive: true, mode: 0o700 })
  const root = realpathSync(given)
  const dir = join(root, tree.server_version)
  if (!existsSync(dir)) {
    const fresh = mkdtempSync(join(root, INSTALLING))
    const failed = installLock(tree.lock, fresh, registry, join(root, NPM_HOME))
    if (failed !== undefined) {
      rmSync(fresh, { recursive: true, force: true })
      return { refusal: failed }
    }
    try {
      renameSync(fresh, dir)
    } catch {
      // Another launch installed the same version first. Either tree is judged below, file by file.
      rmSync(fresh, { recursive: true, force: true })
    }
  }
  const unlike = treeUnlike(tree, dir)
  return unlike === undefined ? { dir } : { refusal: unlike }
}

type Entry = Record<string, unknown> & { readonly args?: unknown }

/** The package, version and bin a pinned entry asks npx for, or undefined when it is no such pin. */
function pinOf(entry: Entry): { readonly pkg: string; readonly version: string; readonly bin: string | undefined } | undefined {
  const args = Array.isArray(entry.args) ? (entry.args as unknown[]) : []
  const withPackage = args[1] === '-p'
  const spec = withPackage ? args[2] : args[1]
  if (typeof spec !== 'string') return undefined
  const at = spec.lastIndexOf('@')
  if (at <= 0) return undefined
  const bin = withPackage && typeof args[3] === 'string' ? args[3] : undefined
  return { pkg: spec.slice(0, at), version: spec.slice(at + 1), bin }
}

/** The server's environment: every host variable emptied but SERVER_NEEDS, then the entry's own approved settings. */
function builtEnvironment(host: Readonly<Record<string, string | undefined>>, own: unknown): Record<string, string> {
  const emptied = Object.fromEntries(Object.keys(host).map((name) => [name, '']))
  const kept = Object.fromEntries(SERVER_NEEDS.flatMap((name) => (host[name] === undefined ? [] : [[name, host[name]]])))
  const settings = typeof own === 'object' && own !== null ? (own as Record<string, string>) : {}
  return { ...emptied, ...kept, ...settings }
}

export interface MeshServerPlacement {
  /** The approved server config, as JSON text. */
  readonly serverConfig: string
  /** Where the recorded trees are installed: a directory only the launcher writes. */
  readonly root: string
  /** Every variable the launcher hands the host, which the host would pass on to the server. */
  readonly hostEnvironment: Readonly<Record<string, string | undefined>>
  readonly recording?: MeshTreeRecording
  /** The recorded versions, each naming its server bin; the reviewed records unless a test gives its own. */
  readonly servers?: readonly RecordedMeshServer[]
}

/**
 * The approved server config with every mesh server entry started from its
 * recorded tree by path, or why the member must not start. Other servers are
 * kept as they are.
 */
export function placeRecordedMeshServers(placement: MeshServerPlacement): { readonly config: string } | { readonly refusal: string } {
  const recording = placement.recording ?? MESH_TREE_RECORDING
  const records = placement.servers ?? RECORDED_MESH_SERVERS
  let config: { mcpServers?: Record<string, Entry> }
  try {
    config = JSON.parse(placement.serverConfig) as typeof config
  } catch {
    return { refusal: 'its server config is not JSON, so the mesh server it starts cannot be placed' }
  }
  const servers: Record<string, Entry> = {}
  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    const pin = pinOf(entry)
    if (pin === undefined || pin.pkg !== MESH_SERVER_PACKAGE || !EXACT_VERSION.test(pin.version)) {
      servers[name] = entry
      continue
    }
    const tree = recording.versions.find((recorded) => recorded.server_version === pin.version)
    if (tree === undefined) {
      return { refusal: `its server ${name} installs ${MESH_SERVER_PACKAGE} ${pin.version}, whose tree is not recorded: the bytes it would run are not proved. Record that version, or install a recorded one.` }
    }
    const unreviewed = refusalOfEnvironmentReads(tree.environment_reads, environmentReviewOf(recording))
    if (unreviewed !== undefined) return { refusal: `its server ${name} installs ${MESH_SERVER_PACKAGE} ${pin.version}, whose tree is not reviewed: ${unreviewed}` }
    const record = records.find((recorded) => recorded.server_version === pin.version)
    if (record === undefined) {
      return { refusal: `its server ${name} installs ${MESH_SERVER_PACKAGE} ${pin.version}, whose bins are not recorded, so its server bin is not known.` }
    }
    if (pin.bin !== undefined && pin.bin !== record.server_bin) {
      return { refusal: `its server ${name} starts the bin ${pin.bin}, and the server bin recorded for ${MESH_SERVER_PACKAGE} ${pin.version} is ${record.server_bin}.` }
    }
    const binFile = record.bins[record.server_bin]
    if (binFile === undefined) return { refusal: `the record of ${MESH_SERVER_PACKAGE} ${pin.version} names the server bin ${record.server_bin}, which is none of its bins.` }
    const proved = provedTreeOf(tree, placement.root, recording.registry)
    if ('refusal' in proved) return { refusal: `its server ${name}: ${proved.refusal}` }
    const packageDir = join(proved.dir, NODE_MODULES, MESH_SERVER_PACKAGE)
    const file = join(packageDir, binFile)
    if (relative(packageDir, file).startsWith('..')) return { refusal: `its server ${name}: the bin of ${MESH_SERVER_PACKAGE} points outside the package` }
    servers[name] = { ...entry, command: process.execPath, args: confinedStart(proved.dir, file), env: builtEnvironment(placement.hostEnvironment, entry.env) }
  }
  return { config: `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n` }
}

// --- recording a version's tree --------------------------------------------------

export interface MeshTreeRecordRequest {
  /** The version's tarball, as `npm pack` hands it over: the same one its tools are read from. */
  readonly tarball: Uint8Array
  readonly recording: MeshTreeRecording
  /** An empty directory this may write into. */
  readonly scratch: string
}

/** Every code file of an extracted package, for the settings it reads. */
function codeOf(dir: string): PackageSource[] {
  return (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((path) => CODE.test(path))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(dir, path), 'utf8') }))
}

/** Every code file of an installed tree, by the path its record names it with. */
function codeOfTree(dir: string, files: Readonly<Record<string, string>>): PackageSource[] {
  return Object.keys(files)
    .filter((path) => CODE.test(path))
    .map((path) => ({ path, text: readFileSync(join(dir, path), 'utf8') }))
}

/**
 * The tree of the version this tarball holds: its integrity, the settings its
 * code reads, a lock made from the registry alone, every file npm installs
 * from that lock, and what each package of it reads from the environment.
 * Throws, naming why, when the tarball is not what the registry serves, a
 * setting is unknown, the lock cannot pin the tree, or a package reads a name
 * the server is started with and nobody reviewed that read.
 */
export function recordMeshTree(request: MeshTreeRecordRequest): RecordedMeshTree {
  const { tarball, recording, scratch } = request
  const extracted = join(scratch, 'extracted')
  mkdirSync(extracted, { recursive: true })
  const packed = join(scratch, 'server.tgz')
  writeFileSync(packed, tarball)
  const untar = spawnSync('tar', ['-xzf', packed, '-C', extracted], { encoding: 'utf8' })
  if (untar.status !== 0) throw new Error(`The tarball cannot be read: ${untar.stderr.trim()}`)
  const packageDir = join(extracted, 'package')
  const manifest = JSON.parse(readFileSync(join(packageDir, PACKAGE_JSON), 'utf8')) as { name: string; version: string }
  if (manifest.name !== MESH_SERVER_PACKAGE) throw new Error(`The tarball holds ${manifest.name}, not ${MESH_SERVER_PACKAGE}`)
  if (!EXACT_VERSION.test(manifest.version)) throw new Error(`The tarball's version ${manifest.version} names no single release`)

  const settings = settingsReadIn(codeOf(packageDir))
  const unknown = refusalOfSettings(settings, recording.known_settings)
  if (unknown !== undefined) throw new Error(`${MESH_SERVER_PACKAGE} ${manifest.version} is not recorded: ${unknown}`)

  const npmHome = join(scratch, NPM_HOME)
  const project = join(scratch, LOCK_PROJECT)
  mkdirSync(project)
  writeFileSync(join(project, PACKAGE_JSON), `${JSON.stringify({ name: LOCK_PROJECT, private: true, dependencies: { [MESH_SERVER_PACKAGE]: manifest.version } }, null, 2)}\n`)
  const locked = runIsolatedNpm(['install', '--package-lock-only'], project, recording.registry, npmHome)
  if (!locked.ran) throw new Error(`npm could not lock ${MESH_SERVER_PACKAGE} ${manifest.version}: ${locked.why}`)
  const lock = JSON.parse(readFileSync(join(project, PACKAGE_LOCK), 'utf8')) as NpmLock
  const integrity = sriOf(tarball)
  const refusal = refusalOfLock(lock, { server: MESH_SERVER_PACKAGE, version: manifest.version, integrity, registry: recording.registry })
  if (refusal !== undefined) throw new Error(`${MESH_SERVER_PACKAGE} ${manifest.version} is not recorded: ${refusal}`)

  const installed = join(scratch, 'tree')
  mkdirSync(installed)
  const failed = installLock(lock, installed, recording.registry, npmHome)
  if (failed !== undefined) throw new Error(`${MESH_SERVER_PACKAGE} ${manifest.version} is not recorded: ${failed}`)
  const files = filesOfTree(installed)
  if ('refusal' in files) throw new Error(`${MESH_SERVER_PACKAGE} ${manifest.version} is not recorded: ${files.refusal}`)
  const environment_reads = environmentReadsInTree(codeOfTree(installed, files.files), lock)
  const unreviewed = refusalOfEnvironmentReads(environment_reads, environmentReviewOf(recording))
  if (unreviewed !== undefined) throw new Error(`${MESH_SERVER_PACKAGE} ${manifest.version} is not recorded: ${unreviewed}`)
  return { server_version: manifest.version, integrity, settings, lock, files: files.files, environment_reads }
}
