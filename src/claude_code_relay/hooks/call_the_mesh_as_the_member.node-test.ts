// One mesh procedure called as the member through its own server (martha#1016): what is asked, and every answer that is
// refused (T7 of the design): unsealed, a provider's error, the host's error, a rejected call, no answer in time.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { callTheMeshAsTheMember, meshReplyOf, type MeshCallEngine } from './call_the_mesh_as_the_member.ts'

const PROCEDURE = 'a_provider/read_the_box'
const ARGS = { box: 'a-box' }
const TIMEOUT_MS = 20
const REALM = 'cd'.repeat(32)

type Answer = Awaited<ReturnType<MeshCallEngine['mcp']['call']>>

/** A stand-in engine: its server answers `answer`, and it keeps every call it was asked. */
function anEngine(answer: () => Promise<Answer>): { readonly $: MeshCallEngine; readonly asked: unknown[][]; readonly timers: { cancelled: number } } {
  const asked: unknown[][] = []
  const timers = { cancelled: 0 }
  const $: MeshCallEngine = {
    mcp: { call: (...call) => (asked.push(call), answer()) },
    clock: {
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms)
        return { cancel: () => (timers.cancelled++, clearTimeout(timer)) }
      },
    },
  }
  return { $, asked, timers }
}

const replying = (reply: unknown): (() => Promise<Answer>) => () => Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(reply) }], isError: false })

test('#1016: a sealed reply is the result, asked of the member\'s own mesh server as a sealed-only call with its realm and time', async () => {
  const engine = anEngine(replying({ result: { letters: 2 }, seal: { sealed: 1 } }))
  const answer = await callTheMeshAsTheMember(engine.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS, realm: REALM })
  assert.deepEqual(answer, { result: { letters: 2 } })
  assert.deepEqual(engine.asked, [['macula', 'mesh_call', { procedure: PROCEDURE, args: ARGS, confidential: 'required', timeout_ms: TIMEOUT_MS, realm: REALM }]])
  assert.equal(engine.timers.cancelled, 1, 'the wait is cancelled once the answer is in')
})

test('#1016: a call that names no realm asks none', async () => {
  const engine = anEngine(replying({ result: {}, seal: { sealed: 1 } }))
  await callTheMeshAsTheMember(engine.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS })
  assert.equal(Object.hasOwn(engine.asked[0]![2] as object, 'realm'), false)
})

test('#1016 T7: an answer that came back unsealed is refused, whatever its seal says if not 1', async () => {
  for (const seal of [{ sealed: 0 }, { sealed: '1' }, { sealed: true }, {}, undefined]) {
    const engine = anEngine(replying({ result: { letters: 2 }, seal }))
    assert.deepEqual(await callTheMeshAsTheMember(engine.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS }), { refusal: `${PROCEDURE}: the answer came back unsealed, so it is not used` }, JSON.stringify(seal))
  }
})

test("#1016: a provider's own error is a refusal, never a result, sealed or not", async () => {
  const engine = anEngine(replying({ result: { error: { code: 'no_box' } }, seal: { sealed: 1 } }))
  assert.deepEqual(await callTheMeshAsTheMember(engine.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS }), { refusal: `${PROCEDURE}: {"code":"no_box"}` })
})

test("#1016: the host's error, a rejected call and an answer that is no reply are refusals in words", async () => {
  const failed = anEngine(() => Promise.resolve({ content: [{ type: 'text', text: 'replaced_by_newer_handshake' }], isError: true }))
  assert.deepEqual(await callTheMeshAsTheMember(failed.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS }), { refusal: `${PROCEDURE}: replaced_by_newer_handshake` })
  const silent = anEngine(() => Promise.resolve({ isError: true }))
  assert.deepEqual(await callTheMeshAsTheMember(silent.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS }), { refusal: `${PROCEDURE}: the mesh call failed` })
  const rejected = anEngine(() => Promise.reject(new Error('no connected MCP tool')))
  assert.deepEqual(await callTheMeshAsTheMember(rejected.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS }), { refusal: `${PROCEDURE}: Error: no connected MCP tool` })
  for (const text of ['not json', 'null', '7']) {
    const odd = anEngine(() => Promise.resolve({ content: [{ type: 'text', text }], isError: false }))
    const answer = await callTheMeshAsTheMember(odd.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS })
    assert.ok('refusal' in answer && answer.refusal.startsWith(`${PROCEDURE}: the mesh server's answer is not a reply`), text)
  }
})

test('#1016: no answer within the time the caller allows is a refusal, and the call is not waited on', async () => {
  const engine = anEngine(() => new Promise<Answer>(() => {}))
  assert.deepEqual(await callTheMeshAsTheMember(engine.$, { procedure: PROCEDURE, args: ARGS, timeout_ms: TIMEOUT_MS }), { refusal: `${PROCEDURE}: no answer within ${TIMEOUT_MS} ms` })
})

test('#1016: the reply reader alone: a sealed reply with no result is an empty result', () => {
  assert.deepEqual(meshReplyOf(PROCEDURE, JSON.stringify({ seal: { sealed: 1 } })), { result: {} })
})
