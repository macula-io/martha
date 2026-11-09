// The mesh server a member runs is the tree its version was recorded with
// (martha#65): npm installs it from the recorded lock with no outside config,
// the member starts it by path, and a tree that changed since is refused.
//
// Every test runs npm against a registry on the loopback (../run_the_nodes_own_npm_alone/fake_npm_registry.ts)
// and counts what reached a second registry standing for every other source.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MESH_SERVER_PACKAGE, type RecordedMeshServer } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import {
  KNOWN_ENVIRONMENT_READS,
  KNOWN_MESH_SERVER_SETTINGS,
  RECORDED_MESH_TREES,
  refusalOfEnvironmentReads,
  type MeshTreeRecording,
} from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { fakeNpmRegistry, type FakePackage, type FakeRegistry } from '../run_the_nodes_own_npm_alone/fake_npm_registry.ts'
import { placeRecordedMeshServers, recordMeshTree, SERVER_NEEDS } from './install_the_recorded_mesh_server.ts'

const VERSION = '7.8.9'
const DEPENDENCY = 'mesh-dependency'
const BIN = 'macula-mcp'
const OTHER_BIN = 'macula-mcp-realm'
const SETTING = 'MACULA_MCP_AGENT'
const RECORDED_MARK = 'the recorded mesh server'
const PLANTED_MARK = 'planted bytes'
/** The dependency's one file: the server prints it, so a run shows which dependency bytes it had. */
const MARK_FILE = 'mark.txt'
/**
 * Modules the tree does not hold, which the server loads if it can, as an
 * optional dependency is loaded (martha#73): two node finds in a node_modules
 * above the tree (one required, one imported), one in HOME's .node_modules.
 */
const ABOVE_THE_TREE = 'mesh-optional-above'
const IMPORTED_ABOVE_THE_TREE = 'mesh-optional-imported'
const UNDER_HOME = 'mesh-optional-home'
/** The launcher's own hook that confines what the server loads to its tree. */
const CONFINING_HOOK = fileURLToPath(new URL('./confine_to_the_recorded_tree.ts', import.meta.url))
/** What the host is handed that must never reach the server: the stand-in is asked about each. */
const NEVER_REACHES_THE_SERVER = ['NODE_OPTIONS', 'SOME_ADDON_PREBUILD', 'LD_PRELOAD', 'MACULA_MCP_MODEL'] as const
/**
 * The only variables the stand-in server answers with: the ones a test asks
 * whether they reached it. Never its whole environment, which can be whatever
 * the person running the suite has, secrets included (martha#92).
 * It copies the environment by a spread, the one whole-environment read the
 * recorder lists (prove_the_mesh_server_bytes.ts), and picks from the copy.
 * It answers every name it is asked, null for one it was not started with, so a
 * check on a name it was never asked about fails instead of reading it as absent.
 */
const ASKED_OF_THE_SERVER = ['HOME', 'PATH', ...NEVER_REACHES_THE_SERVER, SETTING] as const

const serverOf = (mark: string, setting = SETTING): FakePackage => ({
  name: MESH_SERVER_PACKAGE,
  version: VERSION,
  dependencies: { [DEPENDENCY]: VERSION },
  bin: { [BIN]: 'dist/index.js', [OTHER_BIN]: 'dist/realm.js' },
  files: {
    'dist/index.js': [
      "const fs = process.getBuiltinModule('node:fs')",
      `const said = fs.readFileSync(__dirname + '/../../../${DEPENDENCY}/${MARK_FILE}', 'utf8').trim()`,
      `const agent = process.env.${setting}`,
      // An optional module: missing is fine, any other failure is not.
      `for (const name of ['${ABOVE_THE_TREE}', '${UNDER_HOME}']) { try { require(name) } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e } }`,
      `import('${IMPORTED_ABOVE_THE_TREE}').catch((e) => { if (e.code !== 'ERR_MODULE_NOT_FOUND') { console.error(e); process.exitCode = 1 } })`,
      `console.log(said + ' ${mark}')`,
      // What the server was started with, for the tests on its environment: only the names they ask about.
      `const asked = ${JSON.stringify(ASKED_OF_THE_SERVER)}`,
      'const started = { ...process.env }',
      'process.stderr.write(JSON.stringify(Object.fromEntries(asked.map((name) => [name, started[name] ?? null]))))',
      '',
    ].join('\n'),
    'dist/realm.js': 'console.log("realm")\n',
  },
})
const dependencyOf = (mark: string): FakePackage => ({
  name: DEPENDENCY,
  version: VERSION,
  files: { [MARK_FILE]: `${mark}\n` },
})

/** The environment a host hands its servers in most tests: the test's own home and path. */
const HOST: Readonly<Record<string, string | undefined>> = { HOME: process.env.HOME, PATH: process.env.PATH }

const RECORDED = [serverOf(RECORDED_MARK), dependencyOf(RECORDED_MARK)]
/** The version's record of its bins, naming the server bin (martha#49). */
const SERVERS: readonly RecordedMeshServer[] = [
  { server: MESH_SERVER_PACKAGE, server_version: VERSION, server_bin: BIN, bins: serverOf(RECORDED_MARK).bin ?? {}, tools: [] },
]
const PLANTED = [serverOf(PLANTED_MARK), dependencyOf(PLANTED_MARK)]

const scratch = (t: TestContext, what: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `martha-65-${what}-`))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

async function registries(t: TestContext): Promise<{ good: FakeRegistry; evil: FakeRegistry }> {
  const good = await fakeNpmRegistry(RECORDED)
  const evil = await fakeNpmRegistry(PLANTED)
  t.after(() => Promise.all([good.stop(), evil.stop()]))
  return { good, evil }
}

const recordingAt = (
  registry: string,
  known_settings: readonly string[] = [SETTING],
  known_environment_reads: Readonly<Record<string, readonly string[]>> = {},
): MeshTreeRecording => ({
  _why: 'test',
  registry,
  known_settings,
  known_environment_reads,
  versions: [],
})

/** A recording holding this version's tree, recorded from the good registry. */
function recorded(t: TestContext, good: FakeRegistry): MeshTreeRecording {
  const recording = recordingAt(good.registry)
  const tree = recordMeshTree({ tarball: good.tarballOf(MESH_SERVER_PACKAGE), recording, scratch: scratch(t, 'record') })
  return { ...recording, versions: [tree] }
}

const pinnedConfig = (args: readonly string[] = ['-y', '-p', `${MESH_SERVER_PACKAGE}@${VERSION}`, BIN], env?: Record<string, string>) =>
  JSON.stringify({ mcpServers: { macula: { command: 'npx', args, ...(env === undefined ? {} : { env }) } } })

type Placed = ReturnType<typeof placeRecordedMeshServers>
const placedEntry = (placed: Placed) => {
  assert.ok('config' in placed, 'refusal' in placed ? placed.refusal : '')
  const entry = (JSON.parse(placed.config) as { mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> }).mcpServers.macula
  assert.ok(entry !== undefined, 'the mesh server entry is kept')
  return entry
}
const refusalOf = (placed: Placed): string => {
  assert.ok('refusal' in placed, 'the server was placed')
  return placed.refusal
}

/**
 * What the placed server prints on stdout when started the way the host would
 * start it. Its stderr is captured, never let through into the run (martha#92).
 */
const runPlaced = (entry: { command: string; args: string[] }, cwd: string, env: NodeJS.ProcessEnv = {}): string => {
  const run = spawnSync(entry.command, entry.args, { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(run.status, 0, `the placed server failed: ${run.stderr}`)
  return run.stdout.trim()
}

/**
 * A config file naming the other registry and sending every request through it
 * as a proxy: if npm reads the file at all, the other registry sees a request.
 */
const plantedConfig = (evil: FakeRegistry): string => `registry=${evil.registry}\nreplace-registry-host=always\nproxy=${evil.registry}\n`

/** Sets variables for one test and puts the old values back after it. */
function withEnvironment(t: TestContext, values: Record<string, string>): void {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

// --- recording ------------------------------------------------------------------

test('a recorded tree names the server\'s integrity, the settings it reads and every file, sorted', async (t) => {
  const { good } = await registries(t)
  const [tree] = recorded(t, good).versions
  assert.ok(tree !== undefined)
  assert.equal(tree.server_version, VERSION)
  assert.deepEqual(tree.settings, [SETTING])
  const paths = Object.keys(tree.files)
  assert.deepEqual(paths, [...paths].sort())
  assert.ok(paths.includes(`node_modules/${MESH_SERVER_PACKAGE}/dist/index.js`), paths.join(' '))
  assert.ok(paths.includes(`node_modules/${DEPENDENCY}/${MARK_FILE}`), paths.join(' '))
  for (const path of paths) assert.match(tree.files[path] ?? '', /^sha512-[A-Za-z0-9+/]+=*$/, path)
})

test('a scratch reached through a symlink records the same tree, as under the macOS default TMPDIR (martha#79)', async (t) => {
  const { good } = await registries(t)
  const real = scratch(t, 'linked-real')
  const linked = `${real}-link`
  symlinkSync(real, linked)
  t.after(() => rmSync(linked, { force: true }))
  const recording = recordingAt(good.registry)
  const through_link = recordMeshTree({ tarball: good.tarballOf(MESH_SERVER_PACKAGE), recording, scratch: linked })
  const [direct] = recorded(t, good).versions
  assert.ok(direct !== undefined)
  assert.equal(through_link.integrity, direct.integrity)
  assert.deepEqual(through_link.files, direct.files)
})

test('recording a tarball that is not what the registry serves for that version fails, naming both integrities', async (t) => {
  const { good, evil } = await registries(t)
  assert.throws(
    () => recordMeshTree({ tarball: evil.tarballOf(MESH_SERVER_PACKAGE), recording: recordingAt(good.registry), scratch: scratch(t, 'record') }),
    /sha512-.*sha512-/s,
  )
})

test('recording a version that reads a setting nobody has reviewed fails, naming the setting', async (t) => {
  const { good } = await registries(t)
  assert.throws(
    () => recordMeshTree({ tarball: good.tarballOf(MESH_SERVER_PACKAGE), recording: recordingAt(good.registry, []), scratch: scratch(t, 'record') }),
    new RegExp(SETTING),
  )
})

// --- what every package of the tree reads (martha#72) ----------------------------

/** A name the server keeps from the host, which the dependency below reads. */
const KEPT = SERVER_NEEDS[0] ?? ''
const READING_FILE = 'reads.js'
/** The dependency, now also reading a kept name and a name it puts together, as node-gyp-build does. */
const readingDependency: FakePackage = {
  ...dependencyOf(RECORDED_MARK),
  files: { ...dependencyOf(RECORDED_MARK).files, [READING_FILE]: `const home = process.env.${KEPT}\nconst built = process.env[name + '_PREBUILD']\n` },
}
const READING_PATH = `node_modules/${DEPENDENCY}/${READING_FILE}`

async function readingRegistry(t: TestContext): Promise<FakeRegistry> {
  const registry = await fakeNpmRegistry([serverOf(RECORDED_MARK), readingDependency])
  t.after(() => registry.stop())
  return registry
}

test('recording a version whose dependency reads a kept name nobody reviewed fails, naming the package, the name and the file', async (t) => {
  const registry = await readingRegistry(t)
  assert.throws(
    () => recordMeshTree({ tarball: registry.tarballOf(MESH_SERVER_PACKAGE), recording: recordingAt(registry.registry), scratch: scratch(t, 'record') }),
    (error: Error) => error.message.includes(`${DEPENDENCY} reads ${KEPT} in ${READING_PATH}`),
  )
})

test('a reviewed read is recorded by package with its file, and a computed read is listed by file', async (t) => {
  const registry = await readingRegistry(t)
  const recording = recordingAt(registry.registry, [SETTING], { [DEPENDENCY]: [KEPT] })
  const tree = recordMeshTree({ tarball: registry.tarballOf(MESH_SERVER_PACKAGE), recording, scratch: scratch(t, 'record') })
  assert.deepEqual(tree.environment_reads[DEPENDENCY], { reads: { [KEPT]: [READING_PATH] }, computed: [READING_PATH] })
  assert.deepEqual(tree.environment_reads[MESH_SERVER_PACKAGE]?.reads[SETTING], [`node_modules/${MESH_SERVER_PACKAGE}/dist/index.js`])
})

test('a recorded tree whose read is no longer reviewed is not started, naming the package, the name and the file', async (t) => {
  const registry = await readingRegistry(t)
  const reviewed = recordingAt(registry.registry, [SETTING], { [DEPENDENCY]: [KEPT] })
  const tree = recordMeshTree({ tarball: registry.tarballOf(MESH_SERVER_PACKAGE), recording: reviewed, scratch: scratch(t, 'record') })
  const root = scratch(t, 'servers')
  const place = (recording: MeshTreeRecording) => placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording: { ...recording, versions: [tree] } })
  placedEntry(place(reviewed))
  const refusal = refusalOf(place({ ...reviewed, known_environment_reads: {} }))
  assert.ok(refusal.includes(`${DEPENDENCY} reads ${KEPT} in ${READING_PATH}`), refusal)
})

test('a recording that leaves out a read the bytes hold is not started, naming the package, the name and the file', async (t) => {
  const registry = await readingRegistry(t)
  const reviewed = recordingAt(registry.registry, [SETTING], { [DEPENDENCY]: [KEPT] })
  const tree = recordMeshTree({ tarball: registry.tarballOf(MESH_SERVER_PACKAGE), recording: reviewed, scratch: scratch(t, 'record') })
  // The dependency's reads struck from the record and its review removed: a record checked only against itself would pass.
  const { [DEPENDENCY]: _struck, ...rest } = tree.environment_reads
  const recording = { ...reviewed, known_environment_reads: {}, versions: [{ ...tree, environment_reads: rest }] }
  const refusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root: scratch(t, 'servers'), recording }))
  assert.ok(refusal.includes(`${DEPENDENCY} reads ${KEPT} in ${READING_PATH}`), refusal)
})

test('every recorded version: each package\'s read of a name the server is started with is reviewed for that package', () => {
  const review = { server: MESH_SERVER_PACKAGE, startedWith: [...SERVER_NEEDS, ...KNOWN_MESH_SERVER_SETTINGS], knownSettings: KNOWN_MESH_SERVER_SETTINGS, knownReads: KNOWN_ENVIRONMENT_READS }
  for (const tree of RECORDED_MESH_TREES) {
    assert.ok(Object.keys(tree.environment_reads).length > 0, `${tree.server_version} lists no package's environment reads`)
    assert.equal(refusalOfEnvironmentReads(tree.environment_reads, review), undefined, tree.server_version)
  }
})

// --- placing --------------------------------------------------------------------

test('a recorded version is installed from its lock and started by path, with the node that runs the launcher', async (t) => {
  const { good } = await registries(t)
  const root = scratch(t, 'servers')
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(undefined, { [SETTING]: 'x' }), root, recording: recorded(t, good) }))
  assert.equal(entry.command, process.execPath)
  // The tree sits under the root's real path (a tmpdir may be a symlink, as /var is on macOS).
  assert.equal(entry.args.at(-1), join(realpathSync(root), VERSION, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js'))
  assert.deepEqual(entry.env, { ...HOST, [SETTING]: 'x' }, 'the entry keeps its own settings, and HOME and PATH from the host')
  assert.equal(runPlaced(entry, root), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('the bin started is the server bin the version\'s record names, and an entry naming another bin is refused', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  const server = join(realpathSync(root), VERSION, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js')
  // The launch gate decides which shapes may start; whichever passed, the server bin is what runs.
  const withoutBin = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(['-y', `${MESH_SERVER_PACKAGE}@${VERSION}`]), root, recording }))
  assert.equal(withoutBin.args.at(-1), server)
  const other = refusalOf(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(['-y', '-p', `${MESH_SERVER_PACKAGE}@${VERSION}`, OTHER_BIN]), root, recording }))
  assert.ok(other.includes(OTHER_BIN) && other.includes(BIN), other)
  const unrecorded = refusalOf(placeRecordedMeshServers({ servers: [], hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(unrecorded.includes(`${MESH_SERVER_PACKAGE} ${VERSION}`), unrecorded)
})

test('the server starts with HOME, PATH and its approved settings: every other variable the host was given is emptied', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  const planted = scratch(t, 'planted')
  const ran = join(planted, 'ran')
  writeFileSync(join(planted, 'preload.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(ran)}, 'x')\n`)
  // What the launcher hands the host: a preload, a native addon's directory as node-gyp-build reads it,
  // a library for libc to preload, and a mesh setting nobody approved for this server.
  const host = {
    HOME: planted,
    PATH: process.env.PATH,
    NODE_OPTIONS: `--require ${join(planted, 'preload.cjs')}`,
    SOME_ADDON_PREBUILD: planted,
    LD_PRELOAD: join(planted, 'no-such-library.so'),
    MACULA_MCP_MODEL: 'inherited',
  }
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: host, serverConfig: pinnedConfig(undefined, { [SETTING]: 'approved' }), root, recording }))
  // The host starts a server with its own environment under the entry's env, as Claude Code does.
  const run = spawnSync(entry.command, entry.args, { cwd: root, env: { ...host, ...entry.env }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), `${RECORDED_MARK} ${RECORDED_MARK}`, run.stderr)
  assert.throws(() => execFileSync('ls', [ran], { stdio: 'ignore' }), 'the preload never ran')
  const seen = JSON.parse(run.stderr.trim().split('\n').at(-1) ?? '{}') as Record<string, string | null>
  for (const name of NEVER_REACHES_THE_SERVER) {
    assert.ok(Object.hasOwn(seen, name), `the stand-in was never asked about ${name}`)
    assert.ok(!seen[name], `${name} reached the server as ${seen[name]}`)
  }
  assert.equal(seen[SETTING], 'approved')
  assert.equal(seen.HOME, planted)
  assert.equal(seen.PATH, process.env.PATH)
})

/** A module that, when loaded, writes its name into `marker`. */
function plantModule(dir: string, marker: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.js'), `require('node:fs').appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(`${dir}\n`)})\n`)
}

test('the server is started with the launcher\'s own confining hook, naming its tree: the hook is never taken from the tree or HOME (martha#73)', async (t) => {
  const { good } = await registries(t)
  const root = scratch(t, 'servers')
  // The HOME the host hands the server; the launcher's own checkout may sit under the owner's real one.
  const home = scratch(t, 'home')
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: { ...HOST, HOME: home }, serverConfig: pinnedConfig(), root, recording: recorded(t, good) }))
  assert.equal(entry.command, process.execPath)
  assert.equal(entry.args.length, 3, JSON.stringify(entry.args))
  const [preload, hook, server] = entry.args as [string, string, string]
  assert.equal(preload, '--import')
  const hookUrl = new URL(hook)
  const hookFile = fileURLToPath(new URL(hookUrl.pathname, hookUrl))
  assert.equal(hookFile, CONFINING_HOOK)
  for (const outside of [root, home]) assert.ok(relative(outside, hookFile).startsWith('..'), `the hook ${hookFile} sits under ${outside}`)
  assert.ok(decodeURIComponent(hookUrl.search).includes(pathToFileURL(join(realpathSync(root), VERSION, 'node_modules')).href), hookUrl.search)
  assert.equal(server, join(realpathSync(root), VERSION, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js'))
})

test('a module the tree lacks is not loaded from a node_modules above it or from HOME, by require or by import (martha#73)', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  const home = scratch(t, 'home')
  const loaded = join(home, 'loaded')
  plantModule(join(root, 'node_modules', ABOVE_THE_TREE), loaded)
  plantModule(join(root, 'node_modules', IMPORTED_ABOVE_THE_TREE), loaded)
  plantModule(join(home, '.node_modules', UNDER_HOME), loaded)
  const host = { HOME: home, PATH: process.env.PATH }
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: host, serverConfig: pinnedConfig(), root, recording }))
  const env = { ...host, ...entry.env }
  // Started bare, node finds both plants: the test plants them where node looks.
  const bare = spawnSync(entry.command, [entry.args.at(-1) ?? ''], { cwd: root, env, encoding: 'utf8' })
  assert.equal(bare.status, 0, bare.stderr)
  const found = readFileSync(loaded, 'utf8')
  for (const name of [ABOVE_THE_TREE, IMPORTED_ABOVE_THE_TREE, UNDER_HOME]) assert.ok(found.includes(name), `${name} not found bare: ${found}`)
  rmSync(loaded)
  // Started as placed, neither loads, and the server runs on as without an optional module.
  const run = spawnSync(entry.command, entry.args, { cwd: root, env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), `${RECORDED_MARK} ${RECORDED_MARK}`, run.stderr)
  assert.ok(!existsSync(loaded), `loaded from outside the tree: ${existsSync(loaded) ? readFileSync(loaded, 'utf8') : ''}`)
})

test('a root reached through a symlink still starts the confined server: the tree is named as node resolves it (martha#73 r=2)', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const real = scratch(t, 'real-root')
  const link = join(scratch(t, 'linked'), 'servers')
  symlinkSync(real, link)
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root: link, recording }))
  // The bin and the confined tree are named by the real path, as a test's expectations must name them.
  assert.equal(entry.args.at(-1), join(realpathSync(link), VERSION, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js'))
  assert.ok(decodeURIComponent(entry.args[1] ?? '').includes(pathToFileURL(join(realpathSync(real), VERSION, 'node_modules')).href), String(entry.args[1]))
  const run = spawnSync(entry.command, entry.args, { cwd: real, env: { ...HOST, ...entry.env }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), `${RECORDED_MARK} ${RECORDED_MARK}`, run.stderr)
})

test('a version whose tree is not recorded is refused, naming it', async (t) => {
  const { good } = await registries(t)
  const refusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root: scratch(t, 'servers'), recording: recordingAt(good.registry) }))
  assert.ok(refusal.includes(`${MESH_SERVER_PACKAGE} ${VERSION}`), refusal)
})

test('a user config, a global config and npm settings in the environment are not read', async (t) => {
  const { good, evil } = await registries(t)
  const recording = recorded(t, good)
  const home = scratch(t, 'home')
  const rc = join(home, '.npmrc')
  writeFileSync(rc, plantedConfig(evil))
  withEnvironment(t, {
    HOME: home,
    npm_config_userconfig: rc,
    npm_config_globalconfig: rc,
    npm_config_registry: evil.registry,
    npm_config_replace_registry_host: 'always',
    NPM_CONFIG_REGISTRY: evil.registry,
  })
  const root = scratch(t, 'servers')
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.equal(evil.requests(), 0, 'nothing reached the other registry')
  assert.equal(runPlaced(entry, root), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('a project .npmrc where the launcher runs, above the install or in the checkout, is not read', async (t) => {
  const { good, evil } = await registries(t)
  const recording = recorded(t, good)
  const above = scratch(t, 'above')
  const root = join(above, 'servers')
  mkdirSync(root)
  const checkout = scratch(t, 'checkout')
  for (const dir of [above, root, checkout]) writeFileSync(join(dir, '.npmrc'), plantedConfig(evil))
  const before = process.cwd()
  process.chdir(checkout)
  t.after(() => process.chdir(before))
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.equal(evil.requests(), 0, 'nothing reached the other registry')
  assert.equal(runPlaced(entry, checkout), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('a config planted where the launcher keeps npm\'s own home is not read', async (t) => {
  const { good, evil } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  // The launcher's npm home sits under its root, which the member's user can write.
  mkdirSync(join(root, '.npm'), { recursive: true })
  writeFileSync(join(root, '.npm', '.npmrc'), plantedConfig(evil))
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.equal(evil.requests(), 0, 'nothing reached the other registry')
  assert.equal(runPlaced(entry, root), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('a planted install in the checkout\'s node_modules or under the global prefix is never what starts', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const checkout = scratch(t, 'checkout')
  const prefix = scratch(t, 'prefix')
  for (const dir of [join(checkout, 'node_modules', MESH_SERVER_PACKAGE), join(prefix, 'lib', 'node_modules', MESH_SERVER_PACKAGE)]) {
    mkdirSync(join(dir, 'dist'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: MESH_SERVER_PACKAGE, version: VERSION, bin: { [BIN]: 'dist/index.js' } }))
    writeFileSync(join(dir, 'dist', 'index.js'), `console.log('${PLANTED_MARK}')\n`)
  }
  withEnvironment(t, { npm_config_prefix: prefix, NPM_CONFIG_PREFIX: prefix })
  const root = scratch(t, 'servers')
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.equal(runPlaced(entry, checkout, { npm_config_prefix: prefix }), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('a registry that now serves other bytes for a locked package refuses the install, naming it, and leaves no tree', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  good.swap(dependencyOf(PLANTED_MARK))
  const root = scratch(t, 'servers')
  const refusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(refusal.includes(DEPENDENCY), refusal)
  assert.throws(() => execFileSync('ls', [join(root, VERSION)], { stdio: 'ignore' }), 'no tree is left to start')
})

test('an installed file changed, removed or added since the install refuses the next placement, naming it', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  placedEntry(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  const installed = join(root, VERSION, 'node_modules')

  const changed = join(installed, DEPENDENCY, MARK_FILE)
  appendFileSync(changed, '// edited\n')
  const changedRefusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(changedRefusal.includes(`node_modules/${DEPENDENCY}/${MARK_FILE}`), changedRefusal)

  writeFileSync(changed, `${RECORDED_MARK}\n`)
  assert.ok('config' in placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }), 'the recorded bytes put back pass again')

  const planted = join(installed, MESH_SERVER_PACKAGE, 'dist', 'preload.js')
  writeFileSync(planted, 'evil()\n')
  const plantedRefusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, hostEnvironment: HOST, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(plantedRefusal.includes(`node_modules/${MESH_SERVER_PACKAGE}/dist/preload.js`), plantedRefusal)
})
