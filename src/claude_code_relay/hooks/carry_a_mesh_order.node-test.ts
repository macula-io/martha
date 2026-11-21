// A crew tool's answer that orders a mesh call (martha#1016): the relay makes the call as the member and hands the
// reply to the launcher's next tool; any other answer passes through untouched.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { carryAMeshOrder, meshOrderIn, MOST_MESH_CALLS_PER_TOOL_CALL, TOO_MANY_MESH_CALLS } from './carry_a_mesh_order.ts'
import type { MeshCallEngine } from './call_the_mesh_as_the_member.ts'

const PROCEDURE = 'a_provider/keep_a_note'
const ARGS = { text: 'a note' }
const REALM = 'ab'.repeat(32)
const THEN = 'a_tool_that_reads_the_reply'
const KEEP = { wanted: 3 }
const TIMEOUT_MS = 20

type Answer = Awaited<ReturnType<MeshCallEngine['mcp']['call']>>

const anOrder = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ mesh_order: { procedure: PROCEDURE, args: ARGS, realm: REALM, timeout_ms: TIMEOUT_MS, then: THEN, keep: KEEP, ...over } })

/** A stand-in engine whose mesh server answers `reply`, keeping what it was asked. */
function anEngine(reply: () => Promise<Answer>): { readonly $: MeshCallEngine; readonly asked: unknown[][] } {
  const asked: unknown[][] = []
  return {
    asked,
    $: {
      mcp: { call: (...call) => (asked.push(call), reply()) },
      clock: { after: (ms, fn) => { const timer = setTimeout(fn, ms); return { cancel: () => clearTimeout(timer) } } },
    },
  }
}

const sealed = (result: unknown): (() => Promise<Answer>) => () => Promise.resolve({ content: [{ type: 'text', text: JSON.stringify({ result, seal: { sealed: 1 } }) }] })

/** A stand-in launcher that keeps each tool it was asked, and answers `said`. */
function aLauncher(said = 'the words the model is shown'): { readonly ask: (tool: string, args: Readonly<Record<string, unknown>>) => Promise<string>; readonly asked: [string, unknown][] } {
  const asked: [string, unknown][] = []
  return { asked, ask: (tool, args) => (asked.push([tool, args]), Promise.resolve(said)) }
}

test('#1016: an ordered call is made as the member, and its sealed reply is handed to the next tool with what the order keeps', async () => {
  const engine = anEngine(sealed({ id: 'n1' }))
  const launcher = aLauncher()

  const shown = await carryAMeshOrder(engine.$, anOrder(), launcher.ask)

  assert.equal(shown, 'the words the model is shown')
  assert.deepEqual(engine.asked, [['macula', 'mesh_call', { procedure: PROCEDURE, args: ARGS, confidential: 'required', timeout_ms: TIMEOUT_MS, realm: REALM }]])
  assert.deepEqual(launcher.asked, [[THEN, { keep: KEEP, answer: { result: { id: 'n1' } } }]])
})

test('#1016: an unsealed reply reaches the next tool as a refusal, never as a result', async () => {
  const engine = anEngine(() => Promise.resolve({ content: [{ type: 'text', text: JSON.stringify({ result: { id: 'n1' }, seal: { sealed: 0 } }) }] }))
  const launcher = aLauncher()

  await carryAMeshOrder(engine.$, anOrder(), launcher.ask)

  assert.deepEqual(launcher.asked, [[THEN, { keep: KEEP, answer: { refusal: `${PROCEDURE}: the answer came back unsealed, so it is not used` } }]])
})

test('#1016: an answer that orders nothing is shown as it is, and nothing is called', async () => {
  for (const said of ['Crew memory is off.', '{"not_an_order":1}', '', anOrder({ then: '' }), anOrder({ procedure: 7 }), anOrder({ timeout_ms: 0 }), anOrder({ args: [] }), anOrder({ realm: 'not hex' })]) {
    const engine = anEngine(sealed({}))
    const launcher = aLauncher()
    assert.equal(await carryAMeshOrder(engine.$, said, launcher.ask), said, said)
    assert.deepEqual(engine.asked, [], `called for ${said}`)
    assert.deepEqual(launcher.asked, [], `asked again for ${said}`)
  }
})

test('#1016: an order may name no realm, and then the call asks none', async () => {
  const order = meshOrderIn(JSON.stringify({ mesh_order: { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS, then: THEN, keep: null } }))
  assert.deepEqual(order, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS, then: THEN, keep: null })
})

test('#1016: a next tool may order the next call, and a chain is stopped at its bound, the model never shown an order', async () => {
  const engine = anEngine(sealed({}))
  const second = anOrder({ then: 'the_second_tool' })
  const chained: string[] = []
  const twoHops = await carryAMeshOrder(engine.$, anOrder(), (tool) => (chained.push(tool), Promise.resolve(tool === THEN ? second : 'the second answer')))
  assert.equal(twoHops, 'the second answer')
  assert.deepEqual(chained, [THEN, 'the_second_tool'])

  const endless = anEngine(sealed({}))
  const shown = await carryAMeshOrder(endless.$, anOrder(), () => Promise.resolve(anOrder()))
  assert.equal(shown, TOO_MANY_MESH_CALLS)
  assert.equal(endless.asked.length, MOST_MESH_CALLS_PER_TOOL_CALL)
})
