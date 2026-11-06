// The mesh server version a Claude Code member installs, read from the approved
// server config (martha#49).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MESH_SERVER_PACKAGE } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { meshServerVersionsIn } from './mesh_server_install.ts'

const VERSION = '0.51.0'
const config = (servers: Record<string, unknown>) => JSON.stringify({ mcpServers: servers })
const npx = (...args: string[]) => ({ command: 'npx', args: ['-y', ...args] })

test('a server pinned to an exact version reads as that version', () => {
  assert.deepEqual(meshServerVersionsIn(config({ macula: npx(`${MESH_SERVER_PACKAGE}@${VERSION}`) }), MESH_SERVER_PACKAGE), { versions: [VERSION] })
})

test('a config with no mesh server, or no servers at all, installs none', () => {
  assert.deepEqual(meshServerVersionsIn(config({ probe: { command: 'true', args: [] } }), MESH_SERVER_PACKAGE), { versions: [] })
  assert.deepEqual(meshServerVersionsIn(JSON.stringify({}), MESH_SERVER_PACKAGE), { versions: [] })
})

test('every mesh server in the config is read, each by its own version', () => {
  const read = meshServerVersionsIn(
    config({ a: npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), b: npx(`${MESH_SERVER_PACKAGE}@0.51.2`) }),
    MESH_SERVER_PACKAGE,
  )
  assert.deepEqual(read, { versions: [VERSION, '0.51.2'] })
})

for (const spec of [MESH_SERVER_PACKAGE, `${MESH_SERVER_PACKAGE}@latest`, `${MESH_SERVER_PACKAGE}@^${VERSION}`, `${MESH_SERVER_PACKAGE}@${VERSION}-rc.1`]) {
  test(`a server that names the package as ${spec} is refused, naming the server: no exact version, no proof`, () => {
    const read = meshServerVersionsIn(config({ macula: npx(spec) }), MESH_SERVER_PACKAGE)
    assert.ok('refusal' in read, JSON.stringify(read))
    assert.ok(read.refusal.includes('macula') && read.refusal.includes(spec), read.refusal)
  })
}

test('a server started from an installed copy of the package is refused: a path pins no version', () => {
  const read = meshServerVersionsIn(
    config({ macula: { command: 'node', args: [`node_modules/${MESH_SERVER_PACKAGE}/dist/index.js`] } }),
    MESH_SERVER_PACKAGE,
  )
  assert.ok('refusal' in read && read.refusal.includes('macula'), JSON.stringify(read))
})

test('a server whose command itself names the package is read too', () => {
  const read = meshServerVersionsIn(config({ macula: { command: `${MESH_SERVER_PACKAGE}@${VERSION}` } }), MESH_SERVER_PACKAGE)
  assert.deepEqual(read, { versions: [VERSION] })
})

test('a config that is not a JSON object, or whose servers are not one, is refused', () => {
  for (const text of ['not json', '[]', JSON.stringify({ mcpServers: [] }), JSON.stringify({ mcpServers: { macula: 'npx' } })]) {
    assert.ok('refusal' in meshServerVersionsIn(text, MESH_SERVER_PACKAGE), text)
  }
})
