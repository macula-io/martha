// Martha's ACP client against an agent that speaks as the recorded Goose engine does (macula-io/martha#541, packages
// 7-8, part B). Each case starts the stand-in as a child over real pipes, as the launcher starts the engine, and reads
// what was answered from the agent's side of the wire.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { ACP, AcpClient, METHOD_NOT_FOUND, type ATurn, type Decide } from './the_acp_client.ts'
import { STAND_IN_SESSION, THE_ENGINES_OPTIONS, whatTheEngineMakesOf, type AnAgentScript } from '../stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'
import { ALLOW_ONCE, REJECT_ONCE } from './answer_a_permission_once.ts'

const STAND_IN = join(import.meta.dirname, '..', 'stand_in_for_an_acp_agent', 'main.ts')
const A_CALL = { id: 'call-1', title: 'shell: echo hi', input: { command: 'echo hi' } }
const allow: Decide = () => 'allow'
const reject: Decide = () => 'reject'
/** A mode id of the stand-in's own: no engine names it, so a client that read or typed a mode of its own instead of passing the agent's through cannot pass. */
const THE_STAND_INS_MODE = 'the-stand-ins-own-mode'

/** What the agent made of the answer to the turn's one call, from the call's own update. */
const heardFor = (turn: ATurn): unknown => turn.toolCalls[0]?.rawOutput
/** The options that save a rule, as the engine reads them. */
const SAVING = THE_ENGINES_OPTIONS.filter((option) => whatTheEngineMakesOf(option.optionId).saves === 1)

async function withTheAgent(script: AnAgentScript, decide: Decide, run: (client: AcpClient, child: ChildProcess) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify(script)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const client = AcpClient.overAChild(child, decide)
  try {
    await client.initialize()
    await run(client, child)
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
}

async function oneTurn(script: AnAgentScript, decide: Decide, text = 'go'): Promise<{ turn: ATurn; notes: readonly string[] }> {
  let result: { turn: ATurn; notes: readonly string[] } | undefined
  await withTheAgent(script, decide, async (client) => {
    const { sessionId } = await client.newSession('/')
    result = { turn: await client.prompt(sessionId, text), notes: client.notes }
  })
  assert.ok(result !== undefined)
  return result
}

test('a session names its id and the mode the agent says it runs', async () => {
  await withTheAgent({ turns: [], currentModeId: THE_STAND_INS_MODE }, allow, async (client) => {
    assert.deepEqual(await client.newSession('/'), { sessionId: STAND_IN_SESSION, currentModeId: THE_STAND_INS_MODE })
  })
  await withTheAgent({ turns: [] }, allow, async (client) => {
    assert.equal((await client.newSession('/')).currentModeId, undefined)
  })
})

test('an agent that speaks another ACP version is refused at initialize, by name', async () => {
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify({ turns: [], protocolVersion: 2 })], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const client = AcpClient.overAChild(child, allow)
  try {
    await assert.rejects(client.initialize(), /the agent speaks ACP version 2, and this client speaks 1/)
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
})

test('an allowed call is answered allow_once, and the turn keeps the call, the text and why it stopped', async () => {
  const { turn } = await oneTurn({ turns: [[{ call: A_CALL }, { say: 'done' }]] }, allow)
  const made = { heard: ALLOW_ONCE, runs: 1, saves: 0 }
  assert.deepEqual(heardFor(turn), made)
  assert.equal(turn.stopReason, 'end_turn')
  assert.equal(turn.text, 'done')
  assert.deepEqual(turn.toolCalls, [{ toolCallId: A_CALL.id, title: A_CALL.title, kind: 'other', status: 'completed', rawInput: A_CALL.input, rawOutput: made }])
  assert.deepEqual(turn.asked.map((asked) => [asked.toolCallId, asked.title, asked.answered]), [[A_CALL.id, A_CALL.title, { outcome: 'selected', optionId: ALLOW_ONCE }]])
})

test('a turn ends with the stop reason the agent gives', async () => {
  assert.equal((await oneTurn({ turns: [[]], stopReason: 'max_tokens' }, allow)).turn.stopReason, 'max_tokens')
})

test('a refused call is answered reject_once, and the call does not run', async () => {
  const { turn } = await oneTurn({ turns: [[{ call: A_CALL }]] }, reject)
  assert.deepEqual(heardFor(turn), { heard: REJECT_ONCE, runs: 0, saves: 0 })
  assert.equal(turn.toolCalls[0]?.status, 'failed')
})

test('the gate is asked with the session, the call, its input and what the updates said of it first', async () => {
  const seen: unknown[] = []
  await oneTurn({ turns: [[{ call: A_CALL }]] }, (request) => { seen.push(request); return 'allow' })
  const heard = { toolCallId: A_CALL.id, title: A_CALL.title, kind: 'other', status: 'pending', rawInput: A_CALL.input }
  assert.deepEqual(seen, [{ sessionId: STAND_IN_SESSION, toolCallId: A_CALL.id, title: A_CALL.title, rawInput: A_CALL.input, heard }])
})

test('a decision that throws, or that rejects, refuses the call and says why', async () => {
  for (const decide of [(): never => { throw new Error('the gate broke') }, (): Promise<never> => Promise.reject(new Error('the gate broke'))]) {
    const { turn, notes } = await oneTurn({ turns: [[{ call: A_CALL }]] }, decide as Decide)
    assert.deepEqual(heardFor(turn), { heard: REJECT_ONCE, runs: 0, saves: 0 })
    assert.match(notes.join('\n'), /the decision for call-1 failed, so the call is refused: the gate broke/)
  }
})

test('offered only the "always" answers, the agent hears a cancel, whatever the decision', async () => {
  for (const decide of [allow, reject]) {
    assert.deepEqual(heardFor((await oneTurn({ turns: [[{ call: A_CALL, options: SAVING }]] }, decide)).turn), { heard: 'cancelled', runs: 0, saves: 0 })
  }
})

test('a request the client has no answer for is answered "method not found", and noted', async () => {
  const { turn, notes } = await oneTurn({ turns: [[{ ask: 'fs/read_text_file' }]] }, allow)
  assert.equal((JSON.parse(turn.text) as { error?: { code?: number } }).error?.code, METHOD_NOT_FOUND)
  assert.match(notes.join('\n'), /a request this client has no answer for: fs\/read_text_file/)
})

test('a line that is not JSON is noted, and the turn still ends', async () => {
  const { turn, notes } = await oneTurn({ turns: [[{ line: 'a log line' }, { say: 'still here' }]] }, allow)
  assert.equal(turn.text, 'still here')
  assert.deepEqual(notes, ['not JSON: a log line'])
})

test('a turn whose first non-blank character would start an engine command is never sent', async () => {
  await withTheAgent({ turns: [[{ echo: 1 }]] }, allow, async (client) => {
    const { sessionId } = await client.newSession('/')
    for (const text of ['!touch marker', '  /compact', '\n!ls']) await assert.rejects(client.prompt(sessionId, text), /a turn may not start with ! or \//)
    assert.equal((await client.prompt(sessionId, '[owner message] !touch marker')).text, '[owner message] !touch marker')
  })
})

test('an agent that ends during a turn fails the turn by name', async () => {
  await withTheAgent({ turns: [[{ exit: 1 }]] }, allow, async (client) => {
    const { sessionId } = await client.newSession('/')
    await assert.rejects(client.prompt(sessionId, 'go'), /session\/prompt \(request \d+\) never answered: the agent's output (ended|closed)/)
    await assert.rejects(client.newSession('/'), /session\/new not sent: the agent's output/)
  })
})

test('the client declares no file or terminal capability, so the agent asks for neither', async () => {
  const { turn } = await oneTurn({ turns: [[{ capabilities: 1 }]] }, allow)
  assert.deepEqual(JSON.parse(turn.text), { fs: { readTextFile: false, writeTextFile: false }, terminal: false })
})

test('a permission request that names no call is cancelled without asking the gate', async () => {
  const asked: unknown[] = []
  const { turn, notes } = await oneTurn({ turns: [[{ call: { ...A_CALL, id: '' } }]] }, (request) => { asked.push(request); return 'allow' })
  assert.deepEqual(JSON.parse(turn.text), { heard: 'cancelled', runs: 0, saves: 0 })
  assert.deepEqual(asked, [])
  assert.match(notes.join('\n'), /a permission request outside a turn, or naming no call, was cancelled/)
})

test('a decision that is neither allow nor reject is a refusal', async () => {
  const { turn } = await oneTurn({ turns: [[{ call: A_CALL }]] }, (() => 'yes') as unknown as Decide)
  assert.deepEqual(heardFor(turn), { heard: REJECT_ONCE, runs: 0, saves: 0 })
})

test('a second turn on a session whose turn is still running is refused, and the first ends', async () => {
  let release: (decision: 'allow') => void = () => undefined
  let asked: () => void = () => undefined
  const askedNow = new Promise<void>((settle) => { asked = settle })
  const held: Decide = () => new Promise((settle) => { release = settle; asked() })
  await withTheAgent({ turns: [[{ call: A_CALL }]] }, held, async (client) => {
    const { sessionId } = await client.newSession('/')
    const first = client.prompt(sessionId, 'go')
    await askedNow
    await assert.rejects(client.prompt(sessionId, 'again'), new RegExp(`session ${sessionId} already has a turn running`))
    release('allow')
    assert.deepEqual(heardFor(await first), { heard: ALLOW_ONCE, runs: 1, saves: 0 })
  })
})

/** A gate that holds the first call until released, and answers every later one at once; it counts what it was asked. */
function aHeldGate(later: 'allow' | 'reject' = 'allow'): { decide: Decide; askedNow: Promise<void>; release: (decision: 'allow') => void; asked: string[] } {
  const asked: string[] = []
  let release: (decision: 'allow') => void = () => undefined
  let firstAsked: () => void = () => undefined
  const askedNow = new Promise<void>((settle) => { firstAsked = settle })
  const decide: Decide = (request) => {
    asked.push(request.toolCallId)
    if (asked.length > 1) return later
    return new Promise((settle) => { release = settle; firstAsked() })
  }
  return { decide, askedNow, release: (decision) => release(decision), asked }
}

/** Lets every answer already decided reach the wire. */
const drained = (): Promise<void> => new Promise((settle) => setImmediate(settle))

test('a cancel answers the call still waiting on the gate cancelled, and the gate\'s late allow is never sent', async () => {
  const gate = aHeldGate()
  await withTheAgent({ turns: [[{ call: A_CALL }]] }, gate.decide, async (client) => {
    const { sessionId } = await client.newSession('/')
    const turn = client.prompt(sessionId, 'go')
    await gate.askedNow
    client.cancel(sessionId)
    gate.release('allow')
    const ended = await turn
    assert.deepEqual(heardFor(ended), { heard: 'cancelled', runs: 0, saves: 0 })
    assert.deepEqual(ended.asked.map((asked) => asked.answered), [{ outcome: 'cancelled' }])
    await drained()
    assert.match(client.notes.join('\n'), /the decision for call-1 came after its turn was cancelled, and was dropped/)
  })
})

test('a call asked about after the cancel, while the turn still runs, is cancelled without asking the gate', async () => {
  const gate = aHeldGate()
  const SECOND = { ...A_CALL, id: 'call-2' }
  await withTheAgent({ turns: [[{ call: A_CALL }, { call: SECOND }]] }, gate.decide, async (client) => {
    const { sessionId } = await client.newSession('/')
    const turn = client.prompt(sessionId, 'go')
    await gate.askedNow
    client.cancel(sessionId)
    gate.release('allow')
    const ended = await turn
    assert.deepEqual(ended.toolCalls.map((call) => call.rawOutput), [{ heard: 'cancelled', runs: 0, saves: 0 }, { heard: 'cancelled', runs: 0, saves: 0 }])
    assert.deepEqual(gate.asked, [A_CALL.id])
  })
})

test('a request cancelled while the gate decides gets one answer, never a second', async () => {
  const gate = aHeldGate()
  await withTheAgent({ turns: [[{ call: A_CALL }]] }, gate.decide, async (client, child) => {
    const answers: unknown[] = []
    const stdin = child.stdin
    assert.ok(stdin !== null)
    const write = stdin.write.bind(stdin) as (line: string) => boolean
    stdin.write = ((line: string) => {
      const message = JSON.parse(line) as { method?: unknown; id?: unknown }
      if (message.method === undefined) answers.push(message.id)
      return write(line)
    }) as typeof stdin.write
    const { sessionId } = await client.newSession('/')
    const turn = client.prompt(sessionId, 'go')
    await gate.askedNow
    client.cancel(sessionId)
    gate.release('allow')
    await turn
    await drained()
    assert.equal(answers.length, 1)
  })
})

/** A gate that never decides, keeping each request's withdrawn signal, with a wait for the first request. */
function aGateThatNeverDecides(): { decide: Decide; signals: AbortSignal[]; askedNow: Promise<void> } {
  const signals: AbortSignal[] = []
  let asked!: () => void
  const askedNow = new Promise<void>((settle) => (asked = settle))
  const decide: Decide = (_request, withdrawn) => {
    signals.push(withdrawn)
    asked()
    return new Promise<never>(() => undefined)
  }
  return { decide, signals, askedNow }
}

test('a decision still running is told it is withdrawn when its turn is cancelled', async () => {
  const gate = aGateThatNeverDecides()
  await withTheAgent({ turns: [[{ call: A_CALL }]] }, gate.decide, async (client) => {
    const { sessionId } = await client.newSession('/')
    const turn = client.prompt(sessionId, 'go')
    await gate.askedNow
    assert.equal(gate.signals[0]?.aborted, false, 'not withdrawn while it waits')
    client.cancel(sessionId)
    assert.equal(gate.signals[0]?.aborted, true)
    assert.deepEqual(heardFor(await turn), { heard: 'cancelled', runs: 0, saves: 0 })
  })
})

test('a decision still running is told it is withdrawn when the agent\'s output ends, and the turn says the request was cancelled', async () => {
  const gate = aGateThatNeverDecides()
  await withTheAgent({ turns: [[{ call: A_CALL }]] }, gate.decide, async (client) => {
    const { sessionId } = await client.newSession('/')
    const turn = client.prompt(sessionId, 'go')
    await gate.askedNow
    client.end()
    await assert.rejects(turn, /never answered/)
    assert.equal(gate.signals[0]?.aborted, true)
  })
})

test('a turn the agent ends with a request still undecided answers it cancelled and withdraws its decision', async () => {
  // An agent written here, over in-memory pipes: it asks about one call and ends the turn in the same breath, without
  // waiting for the answer, which the stand-in never does.
  const toClient = new PassThrough()
  const fromClient = new PassThrough()
  const sent: { id?: unknown; method?: unknown; result?: unknown }[] = []
  const gate = aGateThatNeverDecides()
  const client = new AcpClient(toClient, fromClient, gate.decide)
  const say = (message: object): void => void toClient.write(`${JSON.stringify(message)}\n`)
  fromClient.setEncoding('utf8')
  fromClient.on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter((one) => one !== '')) {
      const message = JSON.parse(line) as { id?: unknown; method?: unknown; params?: unknown; result?: unknown }
      sent.push(message)
      if (message.method === 'initialize') say({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })
      if (message.method === 'session/new') say({ jsonrpc: '2.0', id: message.id, result: { sessionId: 's-1' } })
      if (message.method === 'session/prompt') {
        say({ jsonrpc: '2.0', id: 'ask-1', method: 'session/request_permission', params: { sessionId: 's-1', toolCall: { toolCallId: A_CALL.id, title: A_CALL.title, rawInput: A_CALL.input }, options: THE_ENGINES_OPTIONS } })
        void gate.askedNow.then(() => say({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } }))
      }
    }
  })
  await client.initialize()
  const { sessionId } = await client.newSession('/')
  const turn = await client.prompt(sessionId, 'go')
  assert.equal(gate.signals[0]?.aborted, true)
  assert.deepEqual(turn.asked.map((asked) => asked.answered), [{ outcome: 'cancelled' }])
  await drained()
  assert.deepEqual(sent.filter((message) => message.id === 'ask-1').map((message) => message.result), [{ outcome: { outcome: 'cancelled' } }])
  client.end()
  toClient.end()
})

/** How long a test waits for updates the stand-in sends after a turn's answer: far longer than its own pause. */
const THE_LATE_UPDATES_ARRIVE_WITHIN_MS = 5_000

test('every update reaches the listener, one after its turn was answered included: a late chunk and a late result (#541 package A, design R4; mutant: the listener after the turn lookup)', async () => {
  const late = [
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'after the answer' } },
    { sessionUpdate: 'tool_call_update', toolCallId: A_CALL.id, status: 'completed', rawOutput: 'late' },
  ]
  const heard: unknown[] = []
  let allHeard: () => void = () => undefined
  const both = new Promise<void>((settle) => (allHeard = settle))
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify({ turns: [[{ say: 'in the turn' }, { after_the_answer: late.map((update) => ({ update })) }]] })], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const client = AcpClient.overAChild(child, allow, (sessionId, update) => {
    heard.push({ sessionId, update })
    if (heard.length === 1 + late.length) allHeard()
  })
  try {
    await client.initialize()
    const { sessionId } = await client.newSession('/')
    await client.prompt(sessionId, 'go')
    await Promise.race([both, new Promise<void>((settle) => setTimeout(settle, THE_LATE_UPDATES_ARRIVE_WITHIN_MS).unref())])
    assert.deepEqual(heard.slice(1), late.map((update) => ({ sessionId, update })))
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
})

test('a listener that throws is noted, and the turn goes on (#541 package A, design R4)', async () => {
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify({ turns: [[{ say: 'still heard' }]] })], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const client = AcpClient.overAChild(child, allow, () => {
    throw new Error('a listener that fails')
  })
  try {
    await client.initialize()
    const { sessionId } = await client.newSession('/')
    assert.equal((await client.prompt(sessionId, 'go')).text, 'still heard')
    assert.ok(client.notes.some((note) => note.includes('a listener that fails')), JSON.stringify(client.notes))
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
})

/** A usage the engine reports, as the standard ACP `usage_update` carries it (martha-engine acp/server.rs build_usage_updates). */
const aUsage = (used: number, size: number, cost?: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({ sessionUpdate: 'usage_update', used, size, ...(cost === undefined ? {} : { cost }) })

test('#999 package 5: the client keeps each session\'s latest usage, mid-turn and at the turn\'s end, and a session that reported none has none (mutant: the usage not kept)', async () => {
  const first = aUsage(1_200, 200_000)
  const last = aUsage(152_000, 200_000, { amount: 0.75, currency: 'USD' })
  await withTheAgent({ turns: [[{ update: first }, { say: 'mid' }, { update: last }]] }, allow, async (client) => {
    const { sessionId } = await client.newSession('/')
    assert.equal(client.usageOf(sessionId), undefined)
    await client.prompt(sessionId, 'go')
    assert.deepEqual(client.usageOf(sessionId), { used: 152_000, size: 200_000, cost: { amount: 0.75, currency: 'USD' } })
    assert.equal(client.usageOf('another-session'), undefined)
  })
})

test('#999 package 5: a usage update the client cannot read is noted, and drops what was kept, so a stale share is never read as now (mutant: the malformed update kept, or the old one left)', async () => {
  const unreadable = [aUsage(10, 0), { sessionUpdate: 'usage_update', used: 'many', size: 100 }, aUsage(10, 100, { amount: 'cheap', currency: 'USD' })]
  for (const bad of unreadable) {
    await withTheAgent({ turns: [[{ update: aUsage(50, 100) }, { update: bad }]] }, allow, async (client) => {
      const { sessionId } = await client.newSession('/')
      await client.prompt(sessionId, 'go')
      assert.equal(client.usageOf(sessionId), undefined, JSON.stringify(bad))
      assert.ok(client.notes.some((note) => note.startsWith('a usage update this client cannot read')), JSON.stringify(client.notes))
    })
  }
})

test('a close waits for the session\'s running prompt to be answered, then is sent once (martha#1002 design point 1; mutant: the close sent at once)', async () => {
  const toClient = new PassThrough()
  const fromClient = new PassThrough()
  const sent: { id?: unknown; method?: unknown; params?: unknown }[] = []
  const prompts: unknown[] = []
  const client = new AcpClient(toClient, fromClient, allow)
  const say = (message: object): void => void toClient.write(`${JSON.stringify(message)}\n`)
  fromClient.setEncoding('utf8')
  fromClient.on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter((one) => one !== '')) {
      const message = JSON.parse(line) as { id?: unknown; method?: unknown; params?: unknown }
      sent.push(message)
      if (message.method === 'session/prompt') prompts.push(message.id)
      if (message.method === 'session/close') say({ jsonrpc: '2.0', id: message.id, result: {} })
    }
  })
  const turn = client.prompt('s-1', 'go')
  await drained()
  let closed = false
  const closing = client.closeSession('s-1').then(() => void (closed = true))
  await drained()
  assert.deepEqual(sent.filter((message) => message.method === 'session/close'), [], 'the close went out while the prompt still ran')
  assert.equal(closed, false)
  say({ jsonrpc: '2.0', id: prompts[0], result: { stopReason: 'end_turn' } })
  await turn
  await closing
  const methods = sent.map((message) => message.method)
  assert.deepEqual(methods, ['session/prompt', 'session/close'])
  assert.deepEqual(sent[1]?.params, { sessionId: 's-1' })
  client.end()
})

test('the client sends no session/load: no method of its own names it, so a closed session is never made current again (martha#1002 T4, the load row)', () => {
  const ACP_LOAD = ['session', 'load'].join('/')
  assert.ok(!Object.values(ACP).includes(ACP_LOAD as never), 'the ACP methods the client sends name session/load')
  const methods = Object.getOwnPropertyNames(AcpClient.prototype)
  assert.deepEqual(methods.filter((name) => /load/i.test(name)), [])
})
