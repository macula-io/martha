// The trial keeps every message that crosses its pipe with the engine (martha#694).
//
// This exists because a line that ended "not-observed" kept only its verdict: line 4's turn got no answer in
// time, and the evidence could not say whether the engine was slow or a message never reached the client.
// The keeper is called as each message crosses, so a launch killed at its bound still has every message up to
// the kill — these cases pin the direction, the order and the shape a killed launch leaves behind.

import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { GooseOverAcp, type Exchange } from './speak_acp_to_goose.ts'
import { ALLOW_ONCE, REJECT_ONCE } from '../../src/speak_acp_to_an_agent/answer_a_permission_once.ts'

/** A child-shaped pair of pipes: what the trial writes lands on `written`, what the test pushes is read. */
function aPipe(): { child: { stdin: PassThrough; stdout: PassThrough }; written: () => string[] } {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const lines: string[] = []
  let buffered = ''
  stdin.setEncoding('utf8')
  stdin.on('data', (chunk: string) => {
    buffered += chunk
    const parts = buffered.split('\n')
    buffered = parts.pop() ?? ''
    for (const line of parts) if (line.trim() !== '') lines.push(line)
  })
  return { child: { stdin, stdout }, written: () => lines }
}

test('a message Martha sends is kept before it goes, so a kill cannot lose it (martha#694)', async () => {
  const { child, written } = aPipe()
  const kept: Exchange[] = []
  const acp = new GooseOverAcp(child as never, (exchange) => kept.push(exchange))

  const answered = acp.ask('session/new', { cwd: '/somewhere', mcpServers: [] })
  // The keeper ran before the promise could settle: nothing had to happen on the pipe for it to be kept.
  assert.equal(kept.length, 1, 'the sent message was kept when it was sent')
  assert.equal(kept[0]?.direction, 'sent')
  assert.equal((kept[0]?.message as { method?: string }).method, 'session/new')
  assert.equal(typeof kept[0]?.at, 'number')

  const sent = JSON.parse(written()[0] ?? '{}') as { id?: number; method?: string }
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { sessionId: 's-1' } })}\n`)
  assert.deepEqual(await answered, { sessionId: 's-1' })
  assert.deepEqual((kept[1]?.message as { result?: unknown }).result, { sessionId: 's-1' }, 'the answer was kept as it arrived')
})

/** Lets the pipes deliver what was just written, so the order the keeper saw is the order that crossed. */
const delivered = (): Promise<void> => new Promise((settle) => setImmediate(settle))

test('what the engine sends is kept with its direction, in the order it crossed, with a timestamp each (martha#694)', async () => {
  const { child } = aPipe()
  const kept: Exchange[] = []
  const acp = new GooseOverAcp(child as never, (exchange) => kept.push(exchange))

  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk' } } })}\n`)
  await delivered()
  const asked = acp.ask('session/prompt', { sessionId: 's-1', prompt: [{ type: 'text', text: 'hello' }] })
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } })}\n`)
  await asked

  assert.deepEqual(kept.map((one) => one.direction), ['received', 'sent', 'received'])
  assert.ok(kept.every((one) => Number.isFinite(one.at)), 'every message carries a timestamp')
  const times = kept.map((one) => one.at)
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'the timestamps never go backwards')
})

test('a line that is not JSON is kept too, because a frame the trial cannot read is the reason a turn hung (martha#694)', async () => {
  const { child } = aPipe()
  const kept: Exchange[] = []
  new GooseOverAcp(child as never, (exchange) => kept.push(exchange))

  child.stdout.write('this is not json\n')
  await delivered()
  assert.equal(kept.length, 1)
  assert.equal(kept[0]?.direction, 'received')
  assert.equal((kept[0]?.message as { text?: string }).text, 'this is not json')
})

test('the answer to a permission request is kept as it is sent, with the once-answer it gave (martha#694)', async () => {
  const { child, written } = aPipe()
  const kept: Exchange[] = []
  const acp = new GooseOverAcp(child as never, (exchange) => kept.push(exchange))
  acp.answers.next = REJECT_ONCE

  child.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    method: 'session/request_permission',
    params: { toolCall: { toolCallId: 'call-1', title: 'shell' }, options: [{ optionId: ALLOW_ONCE, kind: ALLOW_ONCE }, { optionId: REJECT_ONCE, kind: REJECT_ONCE }, { optionId: 'allow_always', kind: 'allow_always' }] },
  })}\n`)
  await delivered()

  const reply = kept.find((one) => one.direction === 'sent')
  assert.deepEqual((reply?.message as { result?: unknown }).result, { outcome: { outcome: 'selected', optionId: 'reject_once' } })
  assert.equal(JSON.parse(written()[0] ?? '{}').result.outcome.optionId, 'reject_once', 'the pipe carried the same answer that was kept')
})

test('a trial that hands the client no keeper still runs: keeping the exchange is offered, never required (martha#694)', async () => {
  const { child } = aPipe()
  const acp = new GooseOverAcp(child as never)
  const asked = acp.ask('initialize', { protocolVersion: 1 })
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } })}\n`)
  assert.deepEqual(await asked, { protocolVersion: 1 })
})

test('a message cut off by the kill is kept: the pipe end flushes what arrived without a newline (martha#694)', async () => {
  const { child } = aPipe()
  const kept: Exchange[] = []
  new GooseOverAcp(child as never, (exchange) => kept.push(exchange))

  // The engine wrote a message the kill cut before its newline: it sits in the client's buffer.
  child.stdout.write('{"jsonrpc":"2.0","method":"session/update","params":{"update":{"agent_message_chunk"')
  await delivered()
  child.stdout.end()
  await delivered()

  assert.equal(kept.length, 1, 'the partial message was kept when the pipe ended')
  assert.equal(kept[0]?.direction, 'received')
  assert.match(JSON.stringify(kept[0]?.message), /agent_message_chunk/, 'it is kept as the text that crossed, not dropped')
})

test('the flush keeps the partial message once, however many times it is asked (martha#694)', async () => {
  const { child } = aPipe()
  const kept: Exchange[] = []
  const acp = new GooseOverAcp(child as never, (exchange) => kept.push(exchange))

  child.stdout.write('{"jsonrpc":"2.0","method":"session/update"')
  await delivered()
  acp.closeTheExchange()
  acp.closeTheExchange()
  child.stdout.end()
  await delivered()

  assert.equal(kept.length, 1, 'the end event after an explicit flush keeps nothing twice')
})

