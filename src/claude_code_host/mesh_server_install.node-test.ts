// The mesh server version a Claude Code member installs, read from the approved
// server config (martha#49).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MESH_SERVER_PACKAGE } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { meshServerVersionsIn } from './mesh_server_install.ts'

const VERSION = '0.51.0'
const OTHER_PACKAGE = 'another-tool-server'
const SERVER_NAME = 'tools'
const config = (servers: Record<string, unknown>) => JSON.stringify({ mcpServers: servers })
const npx = (...args: string[]) => ({ command: 'npx', args: ['-y', ...args] })

test('a server pinned to an exact version reads as that version', () => {
  assert.deepEqual(meshServerVersionsIn(config({ macula: npx(`${MESH_SERVER_PACKAGE}@${VERSION}`) }), MESH_SERVER_PACKAGE), { versions: [VERSION] })
})

test('a config whose servers are pinned to other packages, or has no servers at all, installs no mesh server', () => {
  assert.deepEqual(meshServerVersionsIn(config({ other: npx(`${OTHER_PACKAGE}@${VERSION}`) }), MESH_SERVER_PACKAGE), { versions: [] })
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

// Every shape that starts code no exact release names is refused, naming the
// server, whether or not it looks like the mesh server (Neptunus's probe, PR 59 r=1).
const UNPINNED: Record<string, unknown> = {
  'a GitHub spec': npx(`github:${OTHER_PACKAGE}`),
  'a git+https spec': npx(`git+https://example.invalid/${OTHER_PACKAGE}.git`),
  'an http server': { type: 'http', url: 'https://mesh.example.invalid/mcp' },
  'an sse server': { type: 'sse', url: 'https://mesh.example.invalid/sse' },
  'a shell wrapper': { command: 'sh', args: ['-c', `npx -y "${MESH_SERVER_PACKAGE.slice(0, 3)}"${MESH_SERVER_PACKAGE.slice(3)}@latest`] },
  'a package named in a variable': { command: 'sh', args: ['-c', 'npx -y "$P"'], env: { P: `${MESH_SERVER_PACKAGE}@${VERSION}` } },
  'a bare installed bin': { command: OTHER_PACKAGE, args: [] },
  'the package as the command': { command: `${MESH_SERVER_PACKAGE}@${VERSION}` },
  'a pin with its registry changed': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { npm_config_registry: 'https://registry.example.invalid' } },
  'a pin with node options': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { NODE_OPTIONS: '--import=/x.mjs' } },
  'a pin with its PATH changed': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { PATH: '/x' } },
  'a pin with a library preloaded': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { LD_PRELOAD: '/x.so' } },
  'a pin with its library path changed': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { LD_LIBRARY_PATH: '/x' } },
  'a pin with its global prefix changed': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { PREFIX: '/x' } },
  'a pin through npm exec': { command: 'npm', args: ['exec', '-y', '-p', `${MESH_SERVER_PACKAGE}@${VERSION}`, '--', OTHER_PACKAGE] },
  'a pin with more arguments': npx(`${MESH_SERVER_PACKAGE}@${VERSION}`, '--package', `${MESH_SERVER_PACKAGE}@latest`),
  'a pin with a working directory': { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), cwd: '/x' },
  'an unpinned other package': npx(`${OTHER_PACKAGE}@latest`),
  'a command that does nothing': { command: 'true', args: [] },
}

for (const [shape, entry] of Object.entries(UNPINNED)) {
  test(`a server that is ${shape} is refused, naming the server: no exact pin, no proof`, () => {
    const read = meshServerVersionsIn(config({ [SERVER_NAME]: entry }), MESH_SERVER_PACKAGE)
    assert.ok('refusal' in read, JSON.stringify(read))
    assert.ok(read.refusal.includes(SERVER_NAME), read.refusal)
  })
}

test('one unpinned server refuses a config whose mesh server is pinned', () => {
  const read = meshServerVersionsIn(
    config({ macula: npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), [SERVER_NAME]: UNPINNED['a bare installed bin'] }),
    MESH_SERVER_PACKAGE,
  )
  assert.ok('refusal' in read && read.refusal.includes(SERVER_NAME), JSON.stringify(read))
})

test('an env key outside the allowlist is refused by name, beside an allowed one', () => {
  const entry = { ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { MACULA_MESH_REALMS: 'r', PREFIX: '/x', macula_lower: 'x' } }
  const read = meshServerVersionsIn(config({ [SERVER_NAME]: entry }), MESH_SERVER_PACKAGE)
  assert.ok('refusal' in read, JSON.stringify(read))
  assert.ok(read.refusal.includes('PREFIX') && read.refusal.includes('macula_lower') && !read.refusal.includes('MACULA_MESH_REALMS,'), read.refusal)
})

test('a pin may name the stdio transport and an env that leaves the install alone', () => {
  const entry = { type: 'stdio', ...npx(`${MESH_SERVER_PACKAGE}@${VERSION}`), env: { MACULA_MESH_REALMS: 'r' } }
  assert.deepEqual(meshServerVersionsIn(config({ macula: entry }), MESH_SERVER_PACKAGE), { versions: [VERSION] })
})

test('a config that is not a JSON object, or whose servers are not one, is refused', () => {
  for (const text of ['not json', '[]', JSON.stringify({ mcpServers: [] }), JSON.stringify({ mcpServers: { macula: 'npx' } })]) {
    assert.ok('refusal' in meshServerVersionsIn(text, MESH_SERVER_PACKAGE), text)
  }
})
