import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EXACT_VERSION,
  MESH_SERVER_PACKAGE,
  RECORDED_MESH_SERVERS,
  refusalOfInstalledMeshServers,
  registeredToolsIn,
  withRecordedVersion,
  type MeshServerRecording,
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

test('an installed version that is recorded is proved; no install at all needs no proof', () => {
  assert.ok(first !== undefined)
  assert.equal(refusalOfInstalledMeshServers([first.server_version]), undefined)
  assert.equal(refusalOfInstalledMeshServers([]), undefined)
})

test('an installed version the records do not hold is refused, naming it and every recorded version', () => {
  const refusal = refusalOfInstalledMeshServers([UNRECORDED]) ?? ''
  assert.match(refusal, new RegExp(`${MESH_SERVER_PACKAGE} ${UNRECORDED.replaceAll('.', '\\.')}`))
  for (const recorded of RECORDED_MESH_SERVERS) assert.ok(refusal.includes(recorded.server_version), recorded.server_version)
})

test('a retired version, its record removed, is refused by name', () => {
  assert.ok(first !== undefined)
  const remaining = RECORDED_MESH_SERVERS.filter((recorded) => recorded !== first)
  const refusal = refusalOfInstalledMeshServers([first.server_version], remaining) ?? ''
  assert.ok(refusal.includes(`${MESH_SERVER_PACKAGE} ${first.server_version}`), refusal)
})

// --- re-recording one version keeps every other one ------------------------------

const RECORDING: MeshServerRecording = {
  _why: 'why',
  server: MESH_SERVER_PACKAGE,
  versions: [
    { server_version: '0.9.0', tools: ['mesh_a'] },
    { server_version: '0.10.0', tools: ['mesh_a', 'mesh_b'] },
  ],
}

test('recording a new version adds it in version order and keeps the others', () => {
  const next = withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.5' }, ['mesh_c'])
  assert.deepEqual(next.versions.map((recorded) => recorded.server_version), ['0.9.0', '0.9.5', '0.10.0'])
  assert.equal(next._why, RECORDING._why)
})

test('recording a version again replaces only that version', () => {
  const next = withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '0.9.0' }, ['mesh_z'])
  assert.deepEqual(next.versions, [
    { server_version: '0.9.0', tools: ['mesh_z'] },
    { server_version: '0.10.0', tools: ['mesh_a', 'mesh_b'] },
  ])
})

test('a package of another name, or a version that is not exact, is refused', () => {
  assert.throws(() => withRecordedVersion(RECORDING, { name: '@someone/else', version: '1.0.0' }, ['mesh_a']), /@someone\/else/)
  assert.throws(() => withRecordedVersion(RECORDING, { name: MESH_SERVER_PACKAGE, version: '1.0.0-rc.1' }, ['mesh_a']), /1\.0\.0-rc\.1/)
})
