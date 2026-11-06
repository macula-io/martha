import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_MESH_SERVER, registeredToolsIn } from './mesh_server_tools.ts'

const SEMVER = /^\d+\.\d+\.\d+$/

test('the recording names the server, its version and a sorted, distinct tool list', () => {
  assert.equal(typeof RECORDED_MESH_SERVER.server, 'string')
  assert.match(RECORDED_MESH_SERVER.server_version, SEMVER)
  const tools = [...RECORDED_MESH_SERVER.tools]
  assert.deepEqual(tools, [...new Set(tools)].sort())
  assert.ok(tools.length > 0)
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
