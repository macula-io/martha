// The mesh server a member runs is the tree its version was recorded with
// (martha#65): npm installs it from the recorded lock with no outside config,
// the member starts it by path, and a tree that changed since is refused.
//
// Every test runs npm against a registry on the loopback (./fake_mesh_registry.ts)
// and counts what reached a second registry standing for every other source.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { MESH_SERVER_PACKAGE, type RecordedMeshServer } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import type { MeshTreeRecording } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { fakeMeshRegistry, type FakePackage, type FakeRegistry } from './fake_mesh_registry.ts'
import { placeRecordedMeshServers, recordMeshTree } from './install_the_recorded_mesh_server.ts'

const VERSION = '7.8.9'
const DEPENDENCY = 'mesh-dependency'
const BIN = 'macula-mcp'
const OTHER_BIN = 'macula-mcp-realm'
const SETTING = 'MACULA_MCP_AGENT'
const RECORDED_MARK = 'the recorded mesh server'
const PLANTED_MARK = 'planted bytes'
/** The dependency's one file: the server prints it, so a run shows which dependency bytes it had. */
const MARK_FILE = 'mark.txt'

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
      `console.log(said + ' ${mark}')`,
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
  const good = await fakeMeshRegistry(RECORDED)
  const evil = await fakeMeshRegistry(PLANTED)
  t.after(() => Promise.all([good.stop(), evil.stop()]))
  return { good, evil }
}

const recordingAt = (registry: string, known_settings: readonly string[] = [SETTING]): MeshTreeRecording => ({
  _why: 'test',
  registry,
  known_settings,
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

/** What the placed server prints when started the way the host would start it. */
const runPlaced = (entry: { command: string; args: string[] }, cwd: string, env: NodeJS.ProcessEnv = {}): string =>
  execFileSync(entry.command, entry.args, { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }).trim()

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

// --- placing --------------------------------------------------------------------

test('a recorded version is installed from its lock and started by path, with the node that runs the launcher', async (t) => {
  const { good } = await registries(t)
  const root = scratch(t, 'servers')
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(undefined, { [SETTING]: 'x' }), root, recording: recorded(t, good) }))
  assert.equal(entry.command, process.execPath)
  assert.deepEqual(entry.args, [join(root, VERSION, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js')])
  assert.deepEqual(entry.env, { [SETTING]: 'x' }, 'the entry keeps its own settings')
  assert.equal(runPlaced(entry, root), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('the bin started is the server bin the version\'s record names, and an entry naming another bin is refused', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  const server = join(root, VERSION, 'node_modules', MESH_SERVER_PACKAGE, 'dist', 'index.js')
  // The launch gate decides which shapes may start; whichever passed, the server bin is what runs.
  const withoutBin = placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(['-y', `${MESH_SERVER_PACKAGE}@${VERSION}`]), root, recording }))
  assert.deepEqual(withoutBin.args, [server])
  const other = refusalOf(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(['-y', '-p', `${MESH_SERVER_PACKAGE}@${VERSION}`, OTHER_BIN]), root, recording }))
  assert.ok(other.includes(OTHER_BIN) && other.includes(BIN), other)
  const unrecorded = refusalOf(placeRecordedMeshServers({ servers: [], serverConfig: pinnedConfig(), root, recording }))
  assert.ok(unrecorded.includes(`${MESH_SERVER_PACKAGE} ${VERSION}`), unrecorded)
})

test('a version whose tree is not recorded is refused, naming it', async (t) => {
  const { good } = await registries(t)
  const refusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root: scratch(t, 'servers'), recording: recordingAt(good.registry) }))
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
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
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
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
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
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  assert.equal(evil.requests(), 0, 'nothing reached the other registry')
  assert.equal(runPlaced(entry, root), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('code the launcher\'s environment would preload into npm is not loaded', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const planted = scratch(t, 'preload')
  const ran = join(planted, 'ran')
  writeFileSync(join(planted, 'preload.cjs'), `require('node:fs').appendFileSync(${JSON.stringify(ran)}, 'x')\n`)
  withEnvironment(t, { NODE_OPTIONS: `--require ${join(planted, 'preload.cjs')}` })
  const root = scratch(t, 'servers')
  placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  assert.throws(() => execFileSync('ls', [ran], { stdio: 'ignore' }), 'the preload never ran')
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
  const entry = placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  assert.equal(runPlaced(entry, checkout, { npm_config_prefix: prefix }), `${RECORDED_MARK} ${RECORDED_MARK}`)
})

test('a registry that now serves other bytes for a locked package refuses the install, naming it, and leaves no tree', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  good.swap(dependencyOf(PLANTED_MARK))
  const root = scratch(t, 'servers')
  const refusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(refusal.includes(DEPENDENCY), refusal)
  assert.throws(() => execFileSync('ls', [join(root, VERSION)], { stdio: 'ignore' }), 'no tree is left to start')
})

test('an installed file changed, removed or added since the install refuses the next placement, naming it', async (t) => {
  const { good } = await registries(t)
  const recording = recorded(t, good)
  const root = scratch(t, 'servers')
  placedEntry(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  const installed = join(root, VERSION, 'node_modules')

  const changed = join(installed, DEPENDENCY, MARK_FILE)
  appendFileSync(changed, '// edited\n')
  const changedRefusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(changedRefusal.includes(`node_modules/${DEPENDENCY}/${MARK_FILE}`), changedRefusal)

  writeFileSync(changed, `${RECORDED_MARK}\n`)
  assert.ok('config' in placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }), 'the recorded bytes put back pass again')

  const planted = join(installed, MESH_SERVER_PACKAGE, 'dist', 'preload.js')
  writeFileSync(planted, 'evil()\n')
  const plantedRefusal = refusalOf(placeRecordedMeshServers({ servers: SERVERS, serverConfig: pinnedConfig(), root, recording }))
  assert.ok(plantedRefusal.includes(`node_modules/${MESH_SERVER_PACKAGE}/dist/preload.js`), plantedRefusal)
})
