// The crew's tool server answers a Goose member's calls with the launcher's own answers, and decides nothing itself
// (martha#541, packages 7-8 part C, C1). Each test starts the real server from the entry a launch writes, over a real
// relay socket with this launch's token, and speaks to it as the engine does.

import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'

import { CREW_TOOL_NAMES, CREW_TOOLS } from '../a_crews_tools/a_crews_tools.ts'
import { TOOL_ANSWER_PATH, toolCallBody } from '../claude_code_relay/hooks/relay_protocol.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { NOT_THIS_LAUNCHS_SERVER } from '../serve_the_relay_to_a_launch/serve_the_relay.ts'
import { aScriptedRelay, aStandInEngine, type AskedOfTheLauncher } from './a_stand_in_engine.ts'
import { METHODS } from './serve_the_crews_tools.ts'
import { THE_TOKEN_HEADER, isThisLaunchsToken, mintALaunchToken } from '../serve_the_relay_to_a_launch/the_launchs_token.ts'
import { THE_CREWS_TOOL_SERVER } from './the_tool_servers_words.ts'

const SESSION_KEY = RECORDED_GOOSE_ENGINE.tool_call_session_key

/** A session the engine names, and arguments a call carries: a test's own, so no answer can be the tree's by chance. */
const A_SESSION = 'a-session-a-test-names'
const SOME_ARGUMENTS = { a_field_a_test_names: 'a-value-a-test-names' }

/** What the scripted launcher answers each call with: words naming the tool and the session it was asked in. */
const theLaunchersWordsFor = (body: AskedOfTheLauncher): string => `the launcher's own answer to ${String(body['tool'])} in ${String(body['session_id'])}`

/** A `tools/call` as the engine sends it: the tool, its arguments, and the session in the call's meta. */
const aCall = (name: string, meta: Readonly<Record<string, unknown>> = { [SESSION_KEY]: A_SESSION }) => ({ name, arguments: SOME_ARGUMENTS, _meta: meta })

/** The text and the error flag of a call's result. */
function theResultOf(reply: Readonly<Record<string, unknown>>): { readonly text: string; readonly isError: boolean } {
  const result = reply['result'] as { readonly content: ReadonlyArray<{ readonly text: string }>; readonly isError?: boolean }
  return { text: result.content.map((part) => part.text).join(''), isError: result.isError === true }
}

test("initialize names the server, and tools/list is exactly the crew's tools: their names, descriptions and schemas", async (t) => {
  const relay = await aScriptedRelay(t, (body) => ({ answer: theLaunchersWordsFor(body) }))
  const engine = aStandInEngine(t, relay)
  const started = await engine.ask(METHODS.initialize, { protocolVersion: 'a-version-a-test-names', capabilities: {}, clientInfo: { name: 'a-stand-in-engine' } })
  const result = started['result'] as Readonly<Record<string, unknown>>
  assert.equal(result['protocolVersion'], 'a-version-a-test-names', "the server did not answer in the engine's own protocol version")
  assert.deepEqual(result['serverInfo'], { name: THE_CREWS_TOOL_SERVER, version: (result['serverInfo'] as Record<string, unknown>)['version'] })

  const listed = (await engine.ask(METHODS.list))['result'] as { readonly tools: ReadonlyArray<Readonly<Record<string, unknown>>> }
  assert.deepEqual(listed.tools.map((tool) => tool['name']), CREW_TOOL_NAMES)
  assert.deepEqual(listed.tools, CREW_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))
  assert.deepEqual(relay.asked, [], 'listing the tools asked the launcher something')
})

test('every crew tool, called in turn, is answered with the launcher\'s own answer, in the session the engine named', async (t) => {
  const relay = await aScriptedRelay(t, (body) => ({ answer: theLaunchersWordsFor(body) }))
  const engine = aStandInEngine(t, relay)
  for (const name of CREW_TOOL_NAMES) {
    const heard = theResultOf(await engine.ask(METHODS.call, aCall(name)))
    assert.deepEqual(heard, { text: theLaunchersWordsFor({ tool: name, session_id: A_SESSION }), isError: false }, `the engine heard something else for ${name}`)
  }
  assert.deepEqual(relay.asked, CREW_TOOL_NAMES.map((name) => toolCallBody(A_SESSION, name, SOME_ARGUMENTS)))
})

test('a tool Martha never named is refused by name, and the launcher is never asked (mutant: the name check removed)', async (t) => {
  const relay = await aScriptedRelay(t, (body) => ({ answer: theLaunchersWordsFor(body) }))
  const engine = aStandInEngine(t, relay)
  const named = 'a_tool_martha_never_named'
  const heard = theResultOf(await engine.ask(METHODS.call, aCall(named)))
  assert.equal(heard.isError, true)
  assert.match(heard.text, new RegExp(named))
  assert.deepEqual(relay.asked, [])
})

test('a launcher that refuses, or that is gone, is an error the engine hears, never an answer (mutant: a refusal read as an answer)', async (t) => {
  const why = 'a refusal a test names'
  const relay = await aScriptedRelay(t, () => ({ refused: why }))
  const engine = aStandInEngine(t, relay)
  const [name] = CREW_TOOL_NAMES
  assert.ok(name !== undefined)
  const refused = theResultOf(await engine.ask(METHODS.call, aCall(name)))
  assert.equal(refused.isError, true, 'a refusal reached the engine as an answer')
  assert.match(refused.text, new RegExp(why))

  await relay.server.close()
  const gone = theResultOf(await engine.ask(METHODS.call, aCall(name)))
  assert.equal(gone.isError, true, 'a call with no launcher to answer it reached the engine as an answer')
  assert.equal(relay.asked.length, 1, 'the launcher was asked after it was gone')
})

test('a call whose meta names no session is refused, and the launcher is not asked', async (t) => {
  const relay = await aScriptedRelay(t, (body) => ({ answer: theLaunchersWordsFor(body) }))
  const engine = aStandInEngine(t, relay)
  const [name] = CREW_TOOL_NAMES
  assert.ok(name !== undefined)
  for (const meta of [{}, { [SESSION_KEY]: '' }, { [`${SESSION_KEY}-elsewhere`]: A_SESSION }]) {
    const heard = theResultOf(await engine.ask(METHODS.call, aCall(name, meta)))
    assert.equal(heard.isError, true, `a call with the meta ${JSON.stringify(Object.keys(meta))} was run`)
  }
  assert.deepEqual(relay.asked, [])
})

/** Posts one tool call straight to the relay, as a process that is not the launch's server would, with `token` or none. */
function postAsAnotherProcess(socket_path: string, token: string | undefined): Promise<number> {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(toolCallBody(A_SESSION, CREW_TOOL_NAMES[0] ?? '', SOME_ARGUMENTS))
    const headers: Record<string, string | number> = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }
    if (token !== undefined) headers[THE_TOKEN_HEADER] = token
    const asked = request({ socketPath: socket_path, path: TOOL_ANSWER_PATH, method: 'POST', headers }, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode ?? 0))
    })
    asked.on('error', reject)
    asked.end(text)
  })
}

test("a caller without this launch's token is refused before the launcher hears it, and the launch's own server is answered (mutant: the token check removed)", async (t) => {
  const relay = await aScriptedRelay(t, (body) => ({ answer: theLaunchersWordsFor(body) }))
  // No token, and another launch's token: the same length, so the refusal is the comparison's.
  for (const token of [undefined, mintALaunchToken()]) {
    const status = await postAsAnotherProcess(relay.socket_path, token)
    assert.notEqual(status, 200, `a caller with ${token === undefined ? 'no token' : "another launch's token"} was answered`)
  }
  assert.deepEqual(relay.asked, [], "a caller that is not this launch's server reached the launcher")

  const engine = aStandInEngine(t, relay)
  const [name] = CREW_TOOL_NAMES
  assert.ok(name !== undefined)
  assert.equal(theResultOf(await engine.ask(METHODS.call, aCall(name))).isError, false, "the launch's own server was refused")
  assert.equal(relay.asked.length, 1)
})

test('a token is this launch\'s only when it is the same bytes: none, a shorter one, and another of the same length are not', () => {
  const token = mintALaunchToken()
  assert.equal(isThisLaunchsToken(token, token), true)
  assert.equal(isThisLaunchsToken(undefined, token), false)
  assert.equal(isThisLaunchsToken(token.slice(1), token), false)
  assert.equal(isThisLaunchsToken(`${token}0`, token), false)
  assert.equal(isThisLaunchsToken(mintALaunchToken(), token), false)
  assert.notEqual(mintALaunchToken(), mintALaunchToken(), 'two launches were given one token')
})

test("the relay's refusal of a caller says no token, and the server's own output never carries the token", async (t) => {
  assert.ok(!NOT_THIS_LAUNCHS_SERVER.includes(THE_TOKEN_HEADER), 'the refusal names the header a caller would have to forge')
  const relay = await aScriptedRelay(t, () => ({ refused: 'a refusal a test names' }))
  const engine = aStandInEngine(t, relay)
  const replies = [await engine.ask(METHODS.list), await engine.ask(METHODS.call, aCall('a_tool_martha_never_named')), await engine.ask(METHODS.call, aCall(CREW_TOOL_NAMES[0] ?? ''))]
  // assert.ok, not assert.equal: a red run must not print the token it found (assert.equal prints both sides).
  assert.ok(!JSON.stringify(replies).includes(relay.token), "the token reached the engine in the server's replies")
  assert.ok(!engine.errors().includes(relay.token), "the token reached the server's standard error")
})
