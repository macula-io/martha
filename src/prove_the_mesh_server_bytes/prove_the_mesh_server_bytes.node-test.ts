// What proves the mesh server's bytes, not only its version (martha#65): the
// lock a version is recorded with, the settings its code reads, and the tree a
// member runs compared file by file with the reviewed record.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import {
  KNOWN_MESH_SERVER_SETTINGS,
  MESH_SERVER_REGISTRY,
  RECORDED_MESH_TREES,
  SETTING_PREFIX,
  changesInTree,
  environmentReadsInTree,
  refusalOfEnvironmentReads,
  refusalOfLock,
  refusalOfSettings,
  settingsReadIn,
  sriOf,
  withRecordedTree,
  type NpmLock,
  type RecordedMeshTree,
} from './prove_the_mesh_server_bytes.ts'

const VERSION = '1.2.3'
const DEPENDENCY = 'some-dependency'
const SERVER_KEY = `node_modules/${MESH_SERVER_PACKAGE}`
const DEPENDENCY_KEY = `node_modules/${DEPENDENCY}`
const SERVER_INTEGRITY = sriOf(new TextEncoder().encode('the server tarball'))
const DEPENDENCY_INTEGRITY = sriOf(new TextEncoder().encode('the dependency tarball'))
const tarballAt = (name: string) => `${MESH_SERVER_REGISTRY}${name}/-/${name.replace(/^@[^/]+\//, '')}-${VERSION}.tgz`

const lockWith = (changes: Record<string, Record<string, unknown>> = {}): NpmLock => ({
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { [MESH_SERVER_PACKAGE]: VERSION } },
    [SERVER_KEY]: { version: VERSION, resolved: tarballAt(MESH_SERVER_PACKAGE), integrity: SERVER_INTEGRITY, ...changes[SERVER_KEY] },
    [DEPENDENCY_KEY]: { version: VERSION, resolved: tarballAt(DEPENDENCY), integrity: DEPENDENCY_INTEGRITY, ...changes[DEPENDENCY_KEY] },
  },
})
const pinned = { server: MESH_SERVER_PACKAGE, version: VERSION, integrity: SERVER_INTEGRITY, registry: MESH_SERVER_REGISTRY }

// --- the lock a version is recorded with ---------------------------------------

test('a lock that resolves every package from the registry, each with its integrity, is accepted', () => {
  assert.equal(refusalOfLock(lockWith(), pinned), undefined)
})

test('a lock whose server tarball is not the one its tools were read from is refused, naming both', () => {
  const other = sriOf(new TextEncoder().encode('other bytes'))
  const refusal = refusalOfLock(lockWith(), { ...pinned, integrity: other }) ?? ''
  assert.ok(refusal.includes(SERVER_INTEGRITY) && refusal.includes(other), refusal)
})

test('a lock that does not hold the server at the recorded version is refused', () => {
  assert.ok(refusalOfLock(lockWith({ [SERVER_KEY]: { version: '1.2.4' } }), pinned)?.includes(MESH_SERVER_PACKAGE))
  const { [SERVER_KEY]: _server, ...rest } = lockWith().packages
  assert.ok(refusalOfLock({ lockfileVersion: 3, packages: rest }, pinned)?.includes(MESH_SERVER_PACKAGE))
})

const REFUSED_LOCK_ENTRIES: Record<string, Record<string, unknown>> = {
  'a tarball from another registry': { resolved: `https://mirror.example.invalid/${DEPENDENCY}/-/${DEPENDENCY}-${VERSION}.tgz` },
  'a git dependency': { resolved: 'git+ssh://git@example.invalid/x.git#abc' },
  'a local file': { resolved: 'file:../x.tgz' },
  'a link into the tree': { link: true, resolved: undefined },
  'no integrity': { integrity: undefined },
  'an integrity that is not sha512': { integrity: 'sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
  'an install script': { hasInstallScript: true },
  'a platform it is limited to': { os: ['linux'] },
  'a processor it is limited to': { cpu: ['x64'] },
  'an optional dependency': { optional: true },
}

for (const [what, change] of Object.entries(REFUSED_LOCK_ENTRIES)) {
  test(`a lock holding ${what} is refused, naming the package`, () => {
    const refusal = refusalOfLock(lockWith({ [DEPENDENCY_KEY]: change }), pinned)
    assert.ok(refusal?.includes(DEPENDENCY), refusal ?? 'accepted')
  })
}

// --- the settings its code reads -----------------------------------------------

const source = (text: string, path = 'dist/a.js') => ({ path, text })

test('the settings a package reads are every literal process.env key with the prefix, sorted', () => {
  const read = settingsReadIn([
    source('const b = process.env.MACULA_B; const a = process.env["MACULA_A"]'),
    source("const again = process.env.MACULA_B; const home = process.env.HOME; const c = process.env['MACULA_C']", 'dist/b.js'),
  ])
  assert.deepEqual(read, ['MACULA_A', 'MACULA_B', 'MACULA_C'])
})

test('passing the whole environment to a child is no read of a setting', () => {
  assert.deepEqual(settingsReadIn([source('spawn(x, { env: { ...process.env, MACULA_X: "1" } })')]), [])
})

const UNREADABLE_READS = {
  'a computed key': 'const v = process.env[name]',
  'a key put together': 'const v = process.env["MACULA_" + name]',
  'a destructured read': 'const { MACULA_A } = process.env',
  'the environment kept under another name': 'const env = process.env; env.MACULA_A',
  'the environment handed to a function': 'readAll(process.env)',
}

for (const [what, text] of Object.entries(UNREADABLE_READS)) {
  test(`${what} is refused, naming the file: the settings could then not be listed`, () => {
    assert.throws(() => settingsReadIn([source(text, 'dist/hidden.js')]), /dist\/hidden\.js/)
  })
}

test('a setting nobody has reviewed yet is refused by name; the known ones pass', () => {
  assert.equal(refusalOfSettings(['MACULA_A'], ['MACULA_A', 'MACULA_B']), undefined)
  const refusal = refusalOfSettings(['MACULA_A', 'MACULA_NEW_PLUGIN_PATH'], ['MACULA_A']) ?? ''
  assert.ok(refusal.includes('MACULA_NEW_PLUGIN_PATH') && !refusal.includes('MACULA_A,'), refusal)
})

test('the known settings are the prefix\'s own, sorted, and cover what every recorded version reads', () => {
  assert.ok(KNOWN_MESH_SERVER_SETTINGS.length > 0)
  for (const setting of KNOWN_MESH_SERVER_SETTINGS) assert.ok(setting.startsWith(SETTING_PREFIX), setting)
  assert.deepEqual([...KNOWN_MESH_SERVER_SETTINGS].sort(), KNOWN_MESH_SERVER_SETTINGS)
  for (const tree of RECORDED_MESH_TREES) assert.equal(refusalOfSettings(tree.settings, KNOWN_MESH_SERVER_SETTINGS), undefined, tree.server_version)
})

// --- what every package of the tree reads (martha#72) --------------------------

const NESTED = 'nested-dependency'
const NESTED_KEY = `${DEPENDENCY_KEY}/node_modules/${NESTED}`
const lockWithNested = (): NpmLock => ({ ...lockWith(), packages: { ...lockWith().packages, [NESTED_KEY]: { version: VERSION } } })
const KEPT = 'HOME'
const APPROVED = 'MACULA_A'
const EMPTIED = 'SOME_OTHER_NAME'
const review = (knownReads: Record<string, readonly string[]> = {}) => ({
  server: MESH_SERVER_PACKAGE,
  startedWith: [KEPT, APPROVED],
  knownSettings: [APPROVED],
  knownReads,
})

test('the reads of every package are listed by package, each name with its files, a nested package apart from the one holding it', () => {
  const reads = environmentReadsInTree(
    [
      source(`const h = process.env.${KEPT}; const o = process.env['${EMPTIED}']`, `${DEPENDENCY_KEY}/b.js`),
      source(`const h = process.env.${KEPT}`, `${DEPENDENCY_KEY}/a.js`),
      source(`const a = process.env.${APPROVED}`, `${NESTED_KEY}/index.js`),
      source(`const a = process.env.${APPROVED}`, `${SERVER_KEY}/dist/index.js`),
      source('const nothing = 1', `${DEPENDENCY_KEY}/quiet.js`),
    ],
    lockWithNested(),
  )
  assert.deepEqual(reads, {
    [MESH_SERVER_PACKAGE]: { reads: { [APPROVED]: [`${SERVER_KEY}/dist/index.js`] }, computed: [] },
    [DEPENDENCY]: { reads: { [EMPTIED]: [`${DEPENDENCY_KEY}/b.js`], [KEPT]: [`${DEPENDENCY_KEY}/a.js`, `${DEPENDENCY_KEY}/b.js`] }, computed: [] },
    [NESTED]: { reads: { [APPROVED]: [`${NESTED_KEY}/index.js`] }, computed: [] },
  })
})

test('a dependency reading by a key that is no literal is listed by file, not refused', () => {
  const reads = environmentReadsInTree([source("const p = process.env[name + '_PREBUILD']", `${DEPENDENCY_KEY}/build.js`)], lockWith())
  assert.deepEqual(reads, { [DEPENDENCY]: { reads: {}, computed: [`${DEPENDENCY_KEY}/build.js`] } })
  assert.equal(refusalOfEnvironmentReads(reads, review()), undefined)
})

test('a file in no package of the lock is refused, naming it', () => {
  assert.throws(() => environmentReadsInTree([source(`process.env.${KEPT}`, 'node_modules/stray/index.js')], lockWith()), /node_modules\/stray\/index\.js/)
})

const readsOf = (name: string, read: string, file = `node_modules/${name}/index.js`) => ({ [name]: { reads: { [read]: [file] }, computed: [] } })

for (const [what, read] of [['a name it keeps from the host', KEPT], ['an approved setting', APPROVED]] as const) {
  test(`a dependency reading ${what} that nobody reviewed is refused, naming the package, the name and the file`, () => {
    const refusal = refusalOfEnvironmentReads(readsOf(DEPENDENCY, read), review()) ?? ''
    assert.ok(refusal.includes(`${DEPENDENCY} reads ${read} in node_modules/${DEPENDENCY}/index.js`), refusal)
    assert.equal(refusalOfEnvironmentReads(readsOf(DEPENDENCY, read), review({ [DEPENDENCY]: [read] })), undefined)
  })
}

test('a review of one package does not cover the same read in another', () => {
  const refusal = refusalOfEnvironmentReads({ ...readsOf(DEPENDENCY, KEPT), ...readsOf(NESTED, KEPT) }, review({ [DEPENDENCY]: [KEPT] })) ?? ''
  assert.ok(refusal.includes(NESTED) && !refusal.includes(`${DEPENDENCY} reads`), refusal)
})

test('the server reading its reviewed settings needs no other review; reading a kept name does', () => {
  assert.equal(refusalOfEnvironmentReads(readsOf(MESH_SERVER_PACKAGE, APPROVED), review()), undefined)
  assert.ok(refusalOfEnvironmentReads(readsOf(MESH_SERVER_PACKAGE, KEPT), review())?.includes(`${MESH_SERVER_PACKAGE} reads ${KEPT}`))
})

test('a read of a name the server is never started with is listed, not refused: it is emptied for the server', () => {
  assert.equal(refusalOfEnvironmentReads(readsOf(DEPENDENCY, EMPTIED), review()), undefined)
})

// --- the tree a member runs ----------------------------------------------------

const FILES = { 'node_modules/a/index.js': sriOf(new TextEncoder().encode('a')), 'node_modules/b/index.js': sriOf(new TextEncoder().encode('b')) }

test('a tree equal to its record has no change', () => {
  assert.equal(changesInTree(FILES, { ...FILES }), undefined)
})

test('a changed, a missing and a planted file are each named', () => {
  const changed = changesInTree(FILES, { ...FILES, 'node_modules/a/index.js': sriOf(new TextEncoder().encode('evil')) }) ?? ''
  assert.ok(changed.includes('node_modules/a/index.js') && !changed.includes('node_modules/b/index.js'), changed)
  const { 'node_modules/b/index.js': _b, ...missing } = FILES
  assert.ok(changesInTree(FILES, missing)?.includes('node_modules/b/index.js'))
  const planted = changesInTree(FILES, { ...FILES, 'node_modules/a/preload.js': sriOf(new TextEncoder().encode('x')) }) ?? ''
  assert.ok(planted.includes('node_modules/a/preload.js'), planted)
})

// --- the record is reviewable ---------------------------------------------------

const treeAt = (server_version: string, files: Record<string, string> = FILES): RecordedMeshTree => ({
  server_version,
  integrity: SERVER_INTEGRITY,
  settings: [],
  lock: lockWith(),
  files,
  environment_reads: {},
})

test('recording a tree keeps every other version, in version order, with its files sorted by path', () => {
  const empty = { _why: '', registry: MESH_SERVER_REGISTRY, known_settings: [], known_environment_reads: {}, versions: [] }
  const reversed = Object.fromEntries(Object.entries(FILES).reverse())
  const recorded = withRecordedTree(withRecordedTree(withRecordedTree(empty, treeAt('1.10.0')), treeAt('1.9.0', reversed)), treeAt('1.10.0'))
  assert.deepEqual(recorded.versions.map((tree) => tree.server_version), ['1.9.0', '1.10.0'])
  assert.deepEqual(Object.keys(recorded.versions[0]?.files ?? {}), Object.keys(FILES).sort())
})

test('every version whose tools are recorded has its tree recorded, from the one registry', () => {
  assert.deepEqual(
    RECORDED_MESH_TREES.map((tree) => tree.server_version),
    RECORDED_MESH_SERVERS.map((server) => server.server_version),
  )
  for (const tree of RECORDED_MESH_TREES) {
    const pin = { server: MESH_SERVER_PACKAGE, version: tree.server_version, integrity: tree.integrity, registry: MESH_SERVER_REGISTRY }
    assert.equal(refusalOfLock(tree.lock, pin), undefined, tree.server_version)
    assert.deepEqual(Object.keys(tree.files), Object.keys(tree.files).sort(), tree.server_version)
    assert.ok(Object.keys(tree.files).length > 0, tree.server_version)
  }
})
