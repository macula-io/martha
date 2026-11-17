// The OpenAI-compatible stand-in answers as the chat completions API does, on the path the recorded engine posts to,
// and keeps what it heard (macula-io/martha#541, package 10). These cases post to it over HTTP the way the engine's
// OpenAI provider does, on the real server, with no engine behind it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { A_SIDE_ANSWER, THE_PATH_THE_ENGINE_POSTS_TO, openAiStandInCallId, theOpenAiStandIn, type ModelRequest, type ModelScript } from './the_openai_stand_in.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

/** A tool the member's engine offers, by a name the test makes up: the stand-in answers whatever it is offered. */
const A_TOOL = { type: 'function', function: { name: 'a_tool', parameters: { type: 'object' } } }
const OFFERS_TOOLS = { model: 'the-stand-in', stream: true, tools: [A_TOOL], messages: [{ role: 'user', content: 'go' }] }

async function post(url: string, body: Readonly<Record<string, unknown>>, path = THE_PATH_THE_ENGINE_POSTS_TO): Promise<Response> {
  return fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

/** The chunks of a streamed reply, as the engine's provider reads them: each `data:` line up to `[DONE]`. */
function chunksOf(stream: string): Record<string, unknown>[] {
  const lines = stream.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice('data: '.length))
  assert.equal(lines.at(-1), '[DONE]', 'the stream does not end the way the API ends one, so the engine waits for more')
  return lines.slice(0, -1).map((line) => JSON.parse(line) as Record<string, unknown>)
}

type Choice = { delta?: Record<string, unknown>; message?: Record<string, unknown>; finish_reason?: string }
const choiceOf = (chunk: Record<string, unknown>): Choice => ((chunk['choices'] as Choice[] | undefined) ?? [])[0] ?? {}

async function withTheStandIn(script: ModelScript, run: (url: string, heard: ModelRequest[]) => Promise<void>): Promise<void> {
  const heard: ModelRequest[] = []
  const failures: string[] = []
  const stand = await theOpenAiStandIn(script, heard, (why) => void failures.push(why))
  try {
    await run(stand.url, heard)
    assert.deepEqual(failures, [])
  } finally {
    await stand.close()
  }
}

test('it listens on the path the recorded engine posts to under a host, and on no other', async () => {
  assert.equal(THE_PATH_THE_ENGINE_POSTS_TO, `/${RECORDED_GOOSE_ENGINE.openai_provider.default_base_path}`)
  await withTheStandIn(() => ({ text: 'Done.' }), async (url, heard) => {
    assert.equal((await post(url, OFFERS_TOOLS, `${THE_PATH_THE_ENGINE_POSTS_TO}x`)).status, 404)
    assert.equal((await fetch(`${url}${THE_PATH_THE_ENGINE_POSTS_TO}`)).status, 404)
    assert.deepEqual(heard, [], 'a request on another path was heard as the model\'s')
  })
})

test('a text turn streams as one delta, a stop, and the end', async () => {
  await withTheStandIn(() => ({ text: 'Done.' }), async (url) => {
    const answered = await post(url, OFFERS_TOOLS)
    assert.match(answered.headers.get('content-type') ?? '', /^text\/event-stream/)
    const chunks = chunksOf(await answered.text())
    assert.deepEqual(chunks.map((chunk) => choiceOf(chunk).delta?.['content'] ?? null), ['Done.', null])
    assert.equal(choiceOf(chunks.at(-1) ?? {}).finish_reason, 'stop')
  })
})

test('a tool turn streams one call with its arguments as JSON text, its id from the request number, and a tool_calls finish', async () => {
  const input = { command: 'echo stand-in' }
  await withTheStandIn(() => ({ tool: 'a_tool', input }), async (url) => {
    const chunks = chunksOf(await (await post(url, OFFERS_TOOLS)).text())
    const calls = choiceOf(chunks[0] ?? {}).delta?.['tool_calls'] as { id: string; function: { name: string; arguments: string } }[]
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.id, openAiStandInCallId(1))
    assert.equal(calls[0]?.function.name, 'a_tool')
    assert.deepEqual(JSON.parse(calls[0]?.function.arguments ?? ''), input)
    assert.equal(choiceOf(chunks.at(-1) ?? {}).finish_reason, 'tool_calls')
  })
})

test('a request that does not ask for a stream is answered whole', async () => {
  await withTheStandIn(() => ({ text: 'Done.' }), async (url) => {
    const answered = await post(url, { ...OFFERS_TOOLS, stream: false })
    const choice = choiceOf((await answered.json()) as Record<string, unknown>)
    assert.equal(choice.message?.['content'], 'Done.')
    assert.equal(choice.finish_reason, 'stop')
  })
})

test('each request that offers tools is numbered, kept whole, and stamped when read and when answered', async () => {
  await withTheStandIn((request) => ({ text: `turn ${request.number}` }), async (url, heard) => {
    await (await post(url, OFFERS_TOOLS)).text()
    const second = chunksOf(await (await post(url, OFFERS_TOOLS)).text())
    assert.equal(choiceOf(second[0] ?? {}).delta?.['content'], 'turn 2')
    assert.deepEqual(heard.map((request) => request.number), [1, 2])
    assert.deepEqual(heard[0]?.body, OFFERS_TOOLS)
    for (const request of heard) assert.ok(request.answered_at !== undefined && request.answered_at >= request.received_at)
  })
})

test('a request that offers no tools is answered with the side answer and never counted', async () => {
  const side = A_SIDE_ANSWER
  assert.ok('text' in side)
  await withTheStandIn(() => assert.fail('the script was asked about a request that offers no tools'), async (url, heard) => {
    const chunks = chunksOf(await (await post(url, { model: 'the-stand-in', stream: true, messages: [] })).text())
    assert.equal(choiceOf(chunks[0] ?? {}).delta?.['content'], side.text)
    assert.deepEqual(heard, [])
  })
})

test('a refused turn answers with its status, the API\'s error body and its retry-after', async () => {
  const refused = { status: 429, type: 'rate_limit_exceeded', message: 'slow down', retry_after: 3 }
  await withTheStandIn(() => ({ refused }), async (url, heard) => {
    const answered = await post(url, OFFERS_TOOLS)
    assert.equal(answered.status, refused.status)
    assert.equal(answered.headers.get('retry-after'), String(refused.retry_after))
    assert.deepEqual(await answered.json(), { error: { message: refused.message, type: refused.type, code: null } })
    assert.ok(heard[0]?.answered_at !== undefined)
  })
})
