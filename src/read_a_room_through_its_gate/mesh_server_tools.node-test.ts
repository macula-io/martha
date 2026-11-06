import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  binNpxRuns,
  EXACT_VERSION,
  MESH_SERVER_PACKAGE,
  RECORDED_MESH_SERVERS,
  refusalOfInstalledMeshServers,
  registeredToolsIn,
  withRecordedVersion,
  type MeshServerRecording,
  type RecordedMeshServer,
} from './mesh_server_tools.ts'

test('every recorded version names the server, an exact version, and a sorted, distinct tool list', () => {
  assert.ok(RECORDED_MESH_SERVERS.length > 0)
  for (const recorded of RECORDED_MESH_SERVERS) {
    assert.equal(recorded.server, MESH_SERVER_PACKAGE)
    assert.match(recorded.server_version, EXACT_VERSION)
    const tools = [...recorded.tools]
    assert.deepEqual(tools, [...new Set(tools)].sort())
    assert.ok(tools.length > 0)
  }
})

test('every recorded version has a bin, each a plain name to a file in its package', () => {
  for (const recorded of RECORDED_MESH_SERVERS) {
    assert.ok(Object.keys(recorded.bins).length > 0, recorded.server_version)
    for (const [bin, file] of Object.entries(recorded.bins)) assert.ok(!bin.includes('/') && file.length > 0, `${bin}: ${file}`)
  }
})

test('each version is recorded once', () => {
  const versions = RECORDED_MESH_SERVERS.map((recorded) => recorded.server_version)
  assert.deepEqual(versions, [...new Set(versions)])
})

test('the tools are read from every registerTool call with a literal name, comments ignored', () => {
  const sources = [
    { path: 'a.js', text: 'server.registerTool("mesh_b", { description }, cb); server.registerTool( "mesh_a" , {}, cb)' },
    { path: 'b.js', text: '/** what server.registerTool() is passed */ export const x = 1' },
  ]
  assert.deepEqual(registeredToolsIn(sources), ['mesh_a', 'mesh_b'])
})

test('a registerTool call whose name is not a literal is refused by file: the list could not be complete', () => {
  const sources = [{ path: 'dynamic.js', text: 'for (const n of names) server.registerTool(n, {}, cb)' }]
  assert.throws(() => registeredToolsIn(sources), /dynamic\.js/)
})

test('a package that registers no tool at all is refused', () => {
  assert.throws(() => registeredToolsIn([{ path: 'empty.js', text: 'export {}' }]), /no tool/)
})

// --- the installed version against the records (martha#49) ----------------------

const [first] = RECORDED_MESH_SERVERS
const UNRECORDED = '999.0.0'
const SERVER = 'macula'

const toolsOf = (recorded: RecordedMeshServer): readonly string[] => Object.keys(recorded.bins).filter((bin) => bin !== recorded.server_bin)

test('every recorded version names its server bin among its bins', () => {
  for (const recorded of RECORDED_MESH_SERVERS) assert.ok(Object.hasOwn(recorded.bins, recorded.server_bin), recorded.server_version)
})

test('an installed version that is recorded, started as its server bin, is proved; no install at all needs no proof', () => {
  for (const recorded of RECORDED_MESH_SERVERS) {
    assert.equal(refusalOfInstalledMeshServers([{ server: SERVER, version: recorded.server_version, bin: recorded.server_bin }]), undefined)
  }
  assert.equal(refusalOfInstalledMeshServers([]), undefined)
})

// The package's other bins are its tools (PR 59 r=4, Neptunus): the doctor
// spawns the commands every MCP client config names; register and uninstall
// rewrite host configs. Each is refused, naming it and the server bin.
test('every other bin of a recorded version is refused as one of its tools, naming the server bin', () => {
  for (const recorded of RECORDED_MESH_SERVERS) {
    assert.ok(toolsOf(recorded).length > 0, recorded.server_version)
    for (const tool of toolsOf(recorded)) {
      const refusal = refusalOfInstalledMeshServers([{ server: SERVER, version: recorded.server_version, bin: tool }]) ?? ''
      assert.ok(refusal.includes(tool) && refusal.includes('not the server') && refusal.includes(recorded.server_bin), refusal)
    }
  }
})

// The real recorded bin map (PR 59 r=3, Uranus): several bins, none named after
// the package, so npx told no bin runs nothing ("could not determine executable to run").
test('a recorded version with several bins, none named after the package, is refused when no bin is named', () => {
  for (const recorded of RECORDED_MESH_SERVERS) {
    assert.ok(Object.keys(recorded.bins).length > 1, recorded.server_version)
    assert.equal(binNpxRuns(recorded.bins, recorded.server), undefined, recorded.server_version)
    const refusal = refusalOfInstalledMeshServers([{ server: SERVER, version: recorded.server_version }]) ?? ''
    assert.ok(refusal.includes(`${MESH_SERVER_PACKAGE} ${recorded.server_version}`) && refusal.includes(`npx would not run its server bin ${recorded.server_bin}`) && refusal.includes(`server ${SERVER}`), refusal)
  }
})

test('a bin the recorded version does not have is refused, naming the bin and the server bin', () => {
  assert.ok(first !== undefined)
  const missing = `${first.server_bin}-not-there`
  const refusal = refusalOfInstalledMeshServers([{ server: SERVER, version: first.server_version, bin: missing }]) ?? ''
  assert.ok(refusal.includes(missing) && refusal.includes('no bin it has') && refusal.includes(first.server_bin), refusal)
})

test('the two-argument form passes only where npx would run the server bin itself', () => {
  const record = (server_bin: string, bins: Record<string, string>): RecordedMeshServer => ({ server: MESH_SERVER_PACKAGE, server_version: UNRECORDED, server_bin, bins, tools: [] })
  const install = [{ server: SERVER, version: UNRECORDED }]
  assert.equal(refusalOfInstalledMeshServers(install, [record('only', { only: 'a.js' })]), undefined)
  assert.ok(refusalOfInstalledMeshServers(install, [record('server', { tool: 'a.js', server: 'b.js' })]) !== undefined)
  // npm would run the first of two names for one file; this fails closed instead.
  assert.ok(refusalOfInstalledMeshServers(install, [record('first', { first: 'a.js', second: 'a.js' })]) !== undefined)
})

test('binNpxRuns names the only bin, or the one named after the package, and nothing else', () => {
  assert.equal(binNpxRuns({ one: 'a.js' }, '@scope/pkg'), 'one')
  assert.equal(binNpxRuns({ pkg: 'a.js', other: 'b.js' }, '@scope/pkg'), 'pkg')
  assert.equal(binNpxRuns({ pkg: 'a.js', other: 'b.js' }, 'pkg'), 'pkg')
  assert.equal(binNpxRuns({ one: 'a.js', other: 'b.js' }, '@scope/pkg'), undefined)
  assert.equal(binNpxRuns({}, 'pkg'), undefined)
})

test('an installed version the records do not hold is refused, naming it and every recorded version', () => {
  const refusal = refusalOfInstalledMeshServers([{ server: SERVER, version: UNRECORDED }]) ?? ''
  assert.match(refusal, new RegExp(`${MESH_SERVER_PACKAGE} ${UNRECORDED.replaceAll('.', '\\.')}`))
  for (const recorded of RECORDED_MESH_SERVERS) assert.ok(refusal.includes(recorded.server_version), recorded.server_version)
})

test('a retired version, its record removed, is refused by name', () => {
  assert.ok(first !== undefined)
  const remaining = RECORDED_MESH_SERVERS.filter((recorded) => recorded !== first)
  const refusal = refusalOfInstalledMeshServers([{ server: SERVER, version: first.server_version, bin: first.server_bin }], remaining) ?? ''
  assert.ok(refusal.includes(`${MESH_SERVER_PACKAGE} ${first.server_version}`), refusal)
})

// --- re-recording one version keeps every other one ------------------------------

const SERVER_BIN = 'a-server'
const BINS = { [SERVER_BIN]: 'dist/index.js', 'a-tool': 'dist/tool.js' }
const RECORDING: MeshServerRecording = {
  _why: 'why',
  server: MESH_SERVER_PACKAGE,
  versions: [
    { server_version: '0.9.0', server_bin: SERVER_BIN, bins: BINS, tools: ['mesh_a'] },
    { server_version: '0.10.0', server_bin: SERVER_BIN, bins: BINS, tools: ['mesh_a', 'mesh_b'] },
  ],
}
const MANIFEST_BIN = { [SERVER_BIN]: 'dist/index.js' }

test('recording a new version adds it in version order and keeps the others', () => {
  const next = withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.5', bin: MANIFEST_BIN }, ['mesh_c'], SERVER_BIN)
  assert.deepEqual(next.versions.map((recorded) => recorded.server_version), ['0.9.0', '0.9.5', '0.10.0'])
  assert.equal(next._why, RECORDING._why)
})

test('recording a version again replaces only that version', () => {
  const next = withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.0', bin: MANIFEST_BIN }, ['mesh_z'], SERVER_BIN)
  assert.deepEqual(next.versions, [
    { server_version: '0.9.0', server_bin: SERVER_BIN, bins: MANIFEST_BIN, tools: ['mesh_z'] },
    { server_version: '0.10.0', server_bin: SERVER_BIN, bins: BINS, tools: ['mesh_a', 'mesh_b'] },
  ])
})

test('a package whose bin is one path records it under the package name, and a package with no bin is refused', () => {
  const unscopedName = MESH_SERVER_PACKAGE.slice(MESH_SERVER_PACKAGE.lastIndexOf('/') + 1)
  const next = withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.5', bin: 'dist/index.js' }, ['mesh_c'], unscopedName)
  assert.deepEqual(next.versions.find((recorded) => recorded.server_version === '0.9.5')?.bins, { [unscopedName]: 'dist/index.js' })
  assert.throws(() => withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.5' }, ['mesh_c'], SERVER_BIN), /no bin/)
})

test('a server bin the package does not have is refused, naming the bins it has', () => {
  assert.throws(
    () => withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.5', bin: BINS }, ['mesh_c'], 'not-a-bin'),
    /no bin not-a-bin.*a-tool/,
  )
})

test('a package of another name, or a version that is not exact, is refused', () => {
  assert.throws(() => withRecordedVersion(RECORDING, { name: '@someone/else', version: '1.0.0' }, ['mesh_a'], SERVER_BIN), /@someone\/else/)
  assert.throws(() => withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '1.0.0-rc.1' }, ['mesh_a'], SERVER_BIN), /1\.0\.0-rc\.1/)
})
