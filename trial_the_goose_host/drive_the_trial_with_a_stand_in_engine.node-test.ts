// The whole driver, driven against a stand-in engine whose model answers on a clock (macula-io/martha#732,
// PR 733 R4).
//
// This exists because the cap had unit tests and nothing else: nothing showed that a launch reaches a verdict
// under the bound its own model set, or that a model paced too slowly for what is left of the launch is refused
// by name rather than reaped by the runner with no result at all. The engine here speaks enough ACP to answer
// the handshake and one prompt, and asks the stand-in model the way the engine's provider does (api/show first,
// then the chat), so the measurement is the real one and no Goose build is needed.

import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { THE_LAUNCH_BOUND_KEY } from './the_cap_a_line_gets/the_cap_a_line_gets.ts'
import { THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS } from './drive_the_trial.ts'
import { NOT_OBSERVED, THE_TRANSCRIPT } from './the_evidence_it_keeps/the_evidence_says_why.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

const theDriverRun = promisify(execFile)

const ROOT = dirname(dirname(new URL(import.meta.url).pathname))
const DRIVER = join(ROOT, 'trial_the_goose_host', 'drive_the_trial.ts')

const made: string[] = []

after(() => {
  for (const directory of made) removeTheTree(directory)
})

function aFreshDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'martha-732-driver-'))
  made.push(directory)
  return directory
}

/**
 * The engine, as far as the driver can tell: the handshake, and one prompt answered after asking the model, or,
 * going quiet after its chat, never answered at all. Which one is written into the script: a launch hands the engine
 * none of the test's environment.
 *
 * Its shebang names the node that runs these tests, not `/usr/bin/env node`: a launch gets a PATH of the system's
 * own, and on a runner node lives outside it, so an engine found through PATH is one the launch cannot start.
 */
const aStandInEngine = (goesQuietAfterItsChat: boolean): string => `#!${process.execPath}
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const root = process.env.GOOSE_PATH_ROOT ?? ''
let base = 'http://127.0.0.1:11434'
try {
  const config = readFileSync(join(root, 'config', 'config.yaml'), 'utf8')
  base = /OLLAMA_HOST:\\s*(\\S+)/.exec(config)?.[1] ?? base
} catch {}

const post = (path, body) => fetch(new URL(path, base), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value })

createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') return result(message.id, { protocolVersion: 1 })
  if (message.method === 'session/new') {
    return result(message.id, { sessionId: 'a-stand-in-session', modes: { currentModeId: 'approve' } })
  }
  if (message.method !== 'session/prompt') return
  Promise.resolve()
    .then(() => post('/api/show', { model: 'a-model' }))
    .then(() => post('/v1/chat/completions', { model: 'a-model', messages: [] }))
    .then(() => {
      if (${String(goesQuietAfterItsChat)}) return
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'a-stand-in-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the stand-in engine answered' } } } })
      result(message.id, { stopReason: 'end_turn' })
    })
})
`
const A_STAND_IN_ENGINE = aStandInEngine(false)

/** An engine that starts and then says nothing at all: the launch never shakes hands (PR 733 R2). */
const AN_ENGINE_THAT_NEVER_ANSWERS = `#!${process.execPath}
import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', () => undefined)
`

/** What an engine that never answers had written when the kill cut it off: a message without its newline. */
const A_MESSAGE_CUT_OFF = '{"jsonrpc":"2.0","method":"session/update","params":{"cut":"off"'

/** An engine that writes a message the kill cuts before its newline, then never answers the handshake. */
const AN_ENGINE_CUT_OFF_MID_MESSAGE = `#!${process.execPath}
import { createInterface } from 'node:readline'
process.stdout.write(${JSON.stringify(A_MESSAGE_CUT_OFF)})
createInterface({ input: process.stdin }).on('line', () => undefined)
`

/** A model that answers a chat after `chatMs` and the model-info request at once, as the provider sends them. */
async function aStandInModel(chatMs: number): Promise<{ url: string; stop: () => Promise<void> }> {
  const stillToAnswer = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const answer = (): void => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"done":true}')
      }
      if ((request.url ?? '').includes('api/show')) return answer()
      const later: ReturnType<typeof setTimeout> = setTimeout(() => { stillToAnswer.delete(later); answer() }, chatMs)
      stillToAnswer.add(later)
    })
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', () => settle()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${String(port)}`,
    // An answer still waiting is the case's own doing, not the next case's: it is dropped with the model that owed
    // it (a launch cut at its bound leaves the model still answering, martha#732).
    stop: () => {
      for (const one of stillToAnswer) clearTimeout(one)
      stillToAnswer.clear()
      return new Promise<void>((settle) => server.close(() => settle()))
    },
  }
}

/**
 * A model that answers its requests at two different speeds, chosen by what the request says: the engine's own
 * bookkeeping request (Goose asks the model for a title while the turn it belongs to is still running) is the
 * shortest chat it makes, and the turn's own request is the longest. Both are chat requests to the proxy.
 */
async function aStandInModelWithTwoSpeeds(fastMs: number, slowMs: number): Promise<{ url: string; stop: () => Promise<void> }> {
  const stillToAnswer = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const answer = (): void => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"done":true}')
      }
      if ((request.url ?? '').includes('api/show')) return answer()
      const asked = Buffer.concat(chunks).toString('utf8')
      const later: ReturnType<typeof setTimeout> = setTimeout(() => {
        stillToAnswer.delete(later)
        answer()
      }, asked.includes(THE_BOOKKEEPINGS_MARK) ? fastMs : slowMs)
      stillToAnswer.add(later)
    })
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', () => settle()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${String(port)}`,
    stop: () => {
      for (const one of stillToAnswer) clearTimeout(one)
      stillToAnswer.clear()
      return new Promise<void>((settle) => server.close(() => settle()))
    },
  }
}

/** What the model's two requests say, so the stand-in answers each at its own speed. */
const THE_BOOKKEEPINGS_MARK = 'name this session'
const THE_TURNS_MARK = 'the turn in hand'

/**
 * An engine that asks the model two things on one prompt, as Goose does: a short bookkeeping request of its own
 * (a title) and the turn's own request, both chats to the same model, the bookkeeping one answered first. The
 * engine sends a session update when the first lands, as Goose does, and answers the prompt only after the second.
 */
const AN_ENGINE_THAT_ASKS_FOR_A_TITLE_TOO = `#!${process.execPath}
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const root = process.env.GOOSE_PATH_ROOT ?? ''
let base = 'http://127.0.0.1:11434'
try {
  const config = readFileSync(join(root, 'config', 'config.yaml'), 'utf8')
  base = /OLLAMA_HOST:\\s*(\\S+)/.exec(config)?.[1] ?? base
} catch {}

const post = (body) => fetch(new URL('/v1/chat/completions', base), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value })

createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') return result(message.id, { protocolVersion: 1 })
  if (message.method === 'session/new') {
    return result(message.id, { sessionId: 'a-stand-in-session', modes: { currentModeId: 'approve' } })
  }
  if (message.method !== 'session/prompt') return
  Promise.resolve()
    .then(() => post({ model: 'a-model', messages: [{ role: 'user', content: ${JSON.stringify(THE_BOOKKEEPINGS_MARK)} }] }))
    .then(() => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'a-stand-in-session', update: { sessionUpdate: 'session_info_update' } } }))
    .then(() => post({ model: 'a-model', messages: [{ role: 'user', content: ${JSON.stringify(THE_TURNS_MARK)} }] }))
    .then(() => {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'a-stand-in-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the stand-in engine answered' } } } })
      result(message.id, { stopReason: 'end_turn' })
    })
})
`

/** The engine source the launch config is read from: Developer, which the launch keeps, and Skills as an extension. */
const AN_ENGINE_SOURCE: Readonly<Record<string, string>> = {
  'crates/goose/src/agents/platform_extensions/mod.rs': [
    "pub fn platform_extensions() -> HashMap<&'static str, PlatformExtensionDef> {",
    '    map.insert(',
    '        developer::EXTENSION_NAME,',
    '        PlatformExtensionDef {',
    '            default_enabled: true,',
    '            hidden: false,',
    '        },',
    '    );',
    '    map.insert(',
    '        crate::skills::EXTENSION_NAME,',
    '        PlatformExtensionDef {',
    '            default_enabled: true,',
    '            hidden: false,',
    '        },',
    '    );',
    '    map',
    '}',
    '',
  ].join('\n'),
  'crates/goose/src/agents/platform_extensions/developer.rs': 'pub const EXTENSION_NAME: &str = "developer";\n',
  'crates/goose/src/skills/client.rs': 'pub static EXTENSION_NAME: &str = "skills";\n',
}

/** A fork checkout with the launch's bound in it, as the runner would source it, and the engine it builds. */
function aForkSaying(minutes: string): string {
  const fork = aFreshDirectory()
  const pins = join(fork, 'martha', 'sync', 'pins.env')
  mkdirSync(dirname(pins), { recursive: true })
  writeFileSync(pins, `${THE_LAUNCH_BOUND_KEY}=${minutes}\n`)
  for (const [path, text] of Object.entries(AN_ENGINE_SOURCE)) {
    const at = join(fork, path)
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
  }
  return fork
}

const MS_IN_A_MINUTE = 60_000

/** A launch's bound, in the minutes pins.env gives, that leaves `leftMs` once the room its own end needs is taken. */
const aLaunchLeaving = (leftMs: number): string => String((THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS + leftMs) / MS_IN_A_MINUTE)

/**
 * A model too slow for what is left of its launch, whose answer still lands inside it (PR 733 A1): its chat takes
 * SLOW_CHAT_MS, so its idle bound is half again that, and the launch leaves SLOW_LAUNCH_LEFT_MS at its start. When
 * the answer lands, what is left is that less the chat and node's own start, well under the idle bound and well
 * above nothing, on a fast machine or a slow one.
 */
const SLOW_CHAT_MS = 8_000
const SLOW_LAUNCH_LEFT_MS = 15_000

/** What a launch leaves the handshake of an engine that never answers. */
const HANDSHAKE_LEFT_MS = 5_000

/** Runs the driver for one line, and hands back what the launch left behind. */
async function theDriverFor(
  line: number, minutes: string, modelUrl: string, engineSource = A_STAND_IN_ENGINE,
  aRunBefore: (evidence: string) => void = () => undefined,
): Promise<{ evidence: string; refused: string }> {
  const work = aFreshDirectory()
  const engine = join(work, 'a-stand-in-engine.mjs')
  writeFileSync(engine, engineSource)
  chmodSync(engine, 0o755)
  const evidence = join(work, 'evidence')
  aRunBefore(evidence)
  // A home of its own for the driver and the stand-in engine: one that does not exist is a home nothing runs in.
  const home = join(work, 'home')
  mkdirSync(home, { recursive: true })
  let refused = ''
  try {
    await theDriverRun('node', [DRIVER,
      '--goose', engine, '--goose-source', aForkSaying(minutes), '--model', 'a-model',
      '--evidence', evidence, '--launch', join(work, 'launches'), '--line', String(line), '--ollama', modelUrl,
    ], { cwd: ROOT, timeout: 120_000, env: { ...process.env, HOME: home } })
  } catch (error) {
    refused = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
  }
  return { evidence, refused }
}

test('the driver carries a line to its own verdict under the bound its model set, and records it (martha#732)', async () => {
  const model = await aStandInModel(100)
  try {
    const { evidence } = await theDriverFor(1, '1', model.url)
    const resultPath = join(evidence, 'line-1', 'result.json')
    assert.ok(existsSync(resultPath), 'the line left its result behind')
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      verdict: string; cap: { roundTripMs: number; marginMs: number; ms: number; fits: boolean }
    }
    // The verdict is the line own: the trace may still name opens outside the launch (the node that runs the
    // stand-in engine lives under the machine own home here), which is not what this case observes.
    assert.notEqual(result.verdict, 'not-observed', `the line reached a verdict of its own: ${JSON.stringify(result.verdict)}`)
    assert.doesNotMatch((result as { say?: string }).say ?? '', /cannot give this turn the bound/)
    assert.ok(result.cap.roundTripMs >= 80, `the model own chat answer is what was measured: ${JSON.stringify(result.cap)}`)
    assert.equal(result.cap.fits, true)
    assert.ok(result.cap.ms > result.cap.roundTripMs, 'the bound runs on the idle bound, not on the round-trip alone')
  } finally {
    await model.stop()
  }
})

test('the driver writes a fail by name when the engine never shakes hands, rather than leaving no result (martha#732)', async () => {
  // A launch of a little over the room its own end needs: what is left for the handshake is that much and no more.
  const { evidence } = await theDriverFor(1, aLaunchLeaving(HANDSHAKE_LEFT_MS), 'http://127.0.0.1:9', AN_ENGINE_THAT_NEVER_ANSWERS)
  const result = JSON.parse(readFileSync(join(evidence, 'line-1', 'result.json'), 'utf8')) as { verdict: string; say: string }
  assert.equal(result.verdict, 'fail', 'a launch that never shook hands is a fail that is never launched again')
  assert.match(result.say, /the engine answered no handshake within the \d+ ms left of the launch/,
    'the refusal says what was left, not only that nothing came')
})

test('a model too slow for what is left of the launch is not refused: its turn ends inside it and the line reaches its own verdict (PR 733 A1)', async () => {
  const model = await aStandInModel(SLOW_CHAT_MS)
  try {
    const { evidence } = await theDriverFor(1, aLaunchLeaving(SLOW_LAUNCH_LEFT_MS), model.url)
    const result = JSON.parse(readFileSync(join(evidence, 'line-1', 'result.json'), 'utf8')) as {
      verdict: string; say: string; cap: { roundTripMs: number }
    }
    assert.doesNotMatch(result.say, /cannot give this turn the bound|no answer within/, `the turn was not cut: ${result.say}`)
    assert.notEqual(result.verdict, 'not-observed', 'the line reached a verdict of its own')
    assert.ok(result.cap.roundTripMs >= SLOW_CHAT_MS, `the slow chat answer was measured: ${JSON.stringify(result.cap)}`)
  } finally {
    await model.stop()
  }
})

test('a turn the launch\'s end cuts reads not-observed, with the arithmetic, so it is launched again (PR 733 A1)', async () => {
  const model = await aStandInModel(SLOW_CHAT_MS)
  try {
    const { evidence } = await theDriverFor(1, aLaunchLeaving(SLOW_LAUNCH_LEFT_MS), model.url, aStandInEngine(true))
    const result = JSON.parse(readFileSync(join(evidence, 'line-1', 'result.json'), 'utf8')) as { verdict: string; say: string }
    // The observation is the not-observed one, which is what the fork launches again. The verdict may still be a
    // fail for the trace's own reasons (the node running the stand-in engine may live under this machine's home),
    // which is not what this case observes; the say begins with the observation either way.
    assert.match(result.say, /^the line observed nothing: no answer within \d+ ms, the launch's end: a \d+ ms round-trip plus its \d+ ms margin is \d+ ms, beyond the \d+ ms left of the launch/,
      'the cut carries the arithmetic, not only the word no')
  } finally {
    await model.stop()
  }
})

/**
 * A bookkeeping answer at the model's fastest may not cut the turn's own request, which is the model at its slowest
 * (martha#732, found on the fork's run 44417856422): Goose asks the model for a title while the turn is in flight, and
 * that answer is the shortest chat the engine makes. It landed first, set the pace, and the bound it made cut the
 * turn's own request a third of a second later, so every line read not-observed at about thirty seconds.
 */
const A_BOOKKEEPING_CHAT_MS = 300
const THE_TURNS_CHAT_MS = 6_000

test('a bookkeeping answer at the model\'s fastest cannot cut the turn\'s own request at its slowest (martha#732)', async () => {
  const model = await aStandInModelWithTwoSpeeds(A_BOOKKEEPING_CHAT_MS, THE_TURNS_CHAT_MS)
  try {
    const { evidence } = await theDriverFor(1, '2', model.url, AN_ENGINE_THAT_ASKS_FOR_A_TITLE_TOO)
    const result = JSON.parse(readFileSync(join(evidence, 'line-1', 'result.json'), 'utf8')) as {
      verdict: string; say: string; cap: { roundTripMs: number }
    }
    assert.doesNotMatch(result.say, /no answer within/, `the turn was not cut by the bookkeeping answer: ${result.say}`)
    assert.notEqual(result.verdict, 'not-observed', 'the line reached a verdict of its own')
    assert.ok(result.cap.roundTripMs >= THE_TURNS_CHAT_MS,
      `the turn's own answer is what the pace learned: ${JSON.stringify(result.cap)}`)
  } finally {
    await model.stop()
  }
})

/**
 * A launch whose verdict is written leaves nothing answering the model (martha#732): nine lines have to fit the job's
 * own limit, and a cut that keeps the model's request open holds the driver until the runner reaps it at the launch's
 * whole bound. On the fork's run that was about nine minutes a line, and the job hit its 120 minutes at line 7.
 */
const A_CHAT_STILL_ANSWERED_AFTER_THE_CUT_MS = 60_000

test('the driver leaves no request answering the model once the line has its verdict (martha#732)', async () => {
  const model = await aStandInModel(A_CHAT_STILL_ANSWERED_AFTER_THE_CUT_MS)
  try {
    const began = Date.now()
    const { evidence } = await theDriverFor(1, aLaunchLeaving(SLOW_LAUNCH_LEFT_MS), model.url, aStandInEngine(true))
    const took = Date.now() - began
    assert.ok(existsSync(join(evidence, 'line-1', 'result.json')), 'the line wrote its verdict under the bound')
    assert.ok(took < A_CHAT_STILL_ANSWERED_AFTER_THE_CUT_MS / 3,
      `the driver ended with its verdict, not with the model's answer: ${String(took)} ms`)
  } finally {
    await model.stop()
  }
})

// What this pins is the outcome on the handshake-failure path, not the explicit close in startARun's catch: the pipe's
// `end` normally flushes the cut-off message first, and the close is the fallback for when it has not, as in endARun.
// No case against the real spawned engine can stop `end` from running first, so the call site is not pinned from here.
test('a launch whose handshake fails keeps what crossed before the kill (PR 733, martha#694)', async () => {
  const { evidence } = await theDriverFor(1, aLaunchLeaving(HANDSHAKE_LEFT_MS), 'http://127.0.0.1:9', AN_ENGINE_CUT_OFF_MID_MESSAGE)
  const kept = readFileSync(join(evidence, 'line-1', THE_TRANSCRIPT), 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { direction: string; message: unknown })
  const received = kept.filter(({ direction }) => direction === 'received').map(({ message }) => message)
  assert.deepEqual(received, [{ text: A_MESSAGE_CUT_OFF }], 'the message without its newline is in the transcript, once')
})

test('a run ends red, naming the line, when its evidence holds a not-observed line that cannot say why (martha#694)', async () => {
  // An earlier launch left line 2 not-observed with no transcript beside it; this run drives line 1 only. The run is
  // judged whole at its end, so the line it did not drive is still named, and the run does not exit green.
  const model = await aStandInModel(100)
  try {
    const { evidence, refused } = await theDriverFor(1, '1', model.url, A_STAND_IN_ENGINE, (into) => {
      mkdirSync(join(into, 'line-2'), { recursive: true })
      writeFileSync(join(into, 'line-2', 'result.json'), JSON.stringify({ verdict: NOT_OBSERVED }))
    })
    assert.ok(existsSync(join(evidence, 'line-1', 'result.json')), 'the line this run drove left its result')
    assert.match(refused, /line 2: not-observed, and no ACP transcript was kept, so the run cannot say why \(line-2\)/)
  } finally {
    await model.stop()
  }
})

/**
 * A launch must not outlive its verdict (martha#725). On the fork every launch that reached `not-observed` lived on for
 * six more minutes and ended only because the runner's `timeout` sent SIGTERM at the ten-minute bound, which it reports
 * as status 124. Two things in the driver held the process open, and both are checked here by running the real driver
 * and watching the process itself, not by reading the code.
 *
 * What node says it still holds is its own diagnostic report, asked for with `--report-on-signal`: its `libuv` list
 * names every active, referenced handle. That is how a failing case says WHICH handle held the launch, not only that
 * it was held.
 */
const ENDS_WITHIN_MS = 5_000

/** What a watched driver did: whether it ended, how long after its result, and what node said still held it. */
interface Watched {
  readonly evidence: string
  readonly pid: number
  readonly endedByItself: boolean
  readonly outlivedMs: number
  readonly whatHeldIt: readonly string[]
}

/**
 * An engine whose survivor holds its output (martha#725): it answers the handshake and the prompt, and on the prompt
 * starts a process in a session of its own that inherits this engine's stdout and stderr, as a builtin extension's
 * subagent does. The launch kills the engine's own group, which is not that process's, so the engine's output stays
 * open after the group is dead — and a pipe node still holds is a handle that keeps the driver alive.
 */
const AN_ENGINE_WHOSE_SURVIVOR_HOLDS_ITS_OUTPUT = `#!${process.execPath}
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const root = process.env.GOOSE_PATH_ROOT ?? ''
let base = 'http://127.0.0.1:11434'
try {
  const config = readFileSync(join(root, 'config', 'config.yaml'), 'utf8')
  base = /OLLAMA_HOST:\\s*(\\S+)/.exec(config)?.[1] ?? base
} catch {}

const post = (path, body) => fetch(new URL(path, base), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const result = (id, value) => send({ jsonrpc: '2.0', id, result: value })

createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'initialize') return result(message.id, { protocolVersion: 1 })
  if (message.method === 'session/new') {
    return result(message.id, { sessionId: 'a-stand-in-session', modes: { currentModeId: 'approve' } })
  }
  if (message.method !== 'session/prompt') return
  const survivor = spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 30000)'], {
    detached: true, stdio: ['ignore', 'inherit', 'inherit'],
  })
  survivor.unref()
  try { writeFileSync(join(root, 'survivor.pid'), String(survivor.pid)) } catch {}
  Promise.resolve()
    .then(() => post('/api/show', { model: 'a-model' }))
    .then(() => post('/v1/chat/completions', { model: 'a-model', messages: [] }))
    .then(() => {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'a-stand-in-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the stand-in engine answered' } } } })
      result(message.id, { stopReason: 'end_turn' })
    })
})
`

/** A fork that declares no skills switch, so the launch's config cannot be written and the launch never starts. */
function aForkSayingNothingOfSkills(minutes: string): string {
  const fork = aForkSaying(minutes)
  removeTheTree(join(fork, 'crates', 'goose', 'src', 'skills'))
  writeFileSync(
    join(fork, 'crates', 'goose', 'src', 'agents', 'platform_extensions', 'mod.rs'),
    ["pub fn platform_extensions() -> HashMap<&'static str, PlatformExtensionDef> {", '    map.insert(', '        developer::EXTENSION_NAME,', '        PlatformExtensionDef {', '            default_enabled: true,', '            hidden: false,', '        },', '    );', '    map', '}', ''].join('\n'),
  )
  return fork
}

/** The handles node says it still holds, from its own report: only the active and referenced ones keep a process up. */
function heldHandlesIn(reportPath: string): string[] {
  if (!existsSync(reportPath)) return ['node wrote no report']
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    libuv?: readonly { readonly type: string; readonly is_active?: boolean; readonly is_referenced?: boolean; readonly fd?: number; readonly stdio?: string }[]
  }
  return (report.libuv ?? [])
    .filter((handle) => handle.is_active === true && handle.is_referenced === true)
    .map((handle) => (handle.fd === undefined ? handle.type : `${handle.type} fd ${String(handle.fd)}${handle.stdio === undefined ? '' : ` (${handle.stdio})`}`))
}

/** The longest a case waits for the line's result before it treats the launch as one that never wrote it. */
const THE_RESULT_WAIT_MS = 90_000
/** How long node gets to write the diagnostic report the signal asks for. */
const THE_REPORT_WAIT_MS = 3_000
/** How often a wait looks again. */
const THE_POLL_MS = 50
/** Where in the driver's own working directory node writes the report, named in the arguments that start it. */
const THE_REPORT = 'the-report.json'

/** True once `done` answers yes, or false when `ms` runs out first. */
async function waitedFor(done: () => boolean, ms: number): Promise<boolean> {
  const began = Date.now()
  while (!done() && Date.now() - began < ms) await new Promise((settle) => setTimeout(settle, THE_POLL_MS))
  return done()
}

/** The driver started against the stand-ins, its own working directory made, with node asked for a report. */
function theDriverStarted(line: number, about: {
  readonly fork: string
  readonly modelUrl: string
  readonly engineSource: string
}): { readonly work: string; readonly evidence: string; readonly child: ChildProcess } {
  const work = aFreshDirectory()
  const engine = join(work, 'a-stand-in-engine.mjs')
  writeFileSync(engine, about.engineSource)
  chmodSync(engine, 0o755)
  const evidence = join(work, 'evidence')
  const home = join(work, 'home')
  mkdirSync(home, { recursive: true })
  const child: ChildProcess = spawn('node', [
    '--report-on-signal', '--report-signal=SIGUSR2', `--report-directory=${work}`, `--report-filename=${THE_REPORT}`,
    DRIVER, '--goose', engine, '--goose-source', about.fork, '--model', 'a-model',
    '--evidence', evidence, '--launch', join(work, 'launches'), '--line', String(line), '--ollama', about.modelUrl,
  ], { cwd: ROOT, env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.resume()
  child.stderr?.resume()
  return { work, evidence, child }
}

/** A driver still running is asked for node's report and killed, so the case can name every handle it still held. */
async function theHandlesThatHeldIt(child: ChildProcess, work: string): Promise<string[]> {
  child.kill('SIGUSR2')
  const reportPath = join(work, THE_REPORT)
  await waitedFor(() => existsSync(reportPath), THE_REPORT_WAIT_MS)
  const held = heldHandlesIn(reportPath)
  child.kill('SIGKILL')
  return held
}

/** The survivor is the case's own doing: it keeps writing nothing, but it holds the engine's output until it is gone. */
function theSurvivorGone(work: string, line: number): void {
  const survivorPid = join(work, 'launches', `line-${String(line)}`, 'goose-root', 'survivor.pid')
  if (!existsSync(survivorPid)) return
  try { process.kill(Number(readFileSync(survivorPid, 'utf8').trim()), 'SIGKILL') } catch { /* it had already gone */ }
}

/**
 * The driver run and watched (martha#725): the test waits for the line's result and then for the process to end by
 * itself. A driver still running then is asked for a diagnostic report and killed, so the case can name what held it
 * — the process id, how many milliseconds past its result, and every handle node still held.
 */
async function theDriverWatched(line: number, fork: string, modelUrl: string, engineSource: string): Promise<Watched> {
  const { work, evidence, child } = theDriverStarted(line, { fork, modelUrl, engineSource })
  let ended = false
  child.once('exit', () => { ended = true })
  const resultPath = join(evidence, `line-${String(line)}`, 'result.json')
  await waitedFor(() => existsSync(resultPath) || ended, THE_RESULT_WAIT_MS)
  const wroteAt = Date.now()
  await waitedFor(() => ended, ENDS_WITHIN_MS)
  const outlivedMs = Date.now() - wroteAt
  const whatHeldIt = ended ? [] : await theHandlesThatHeldIt(child, work)
  theSurvivorGone(work, line)
  return { evidence, pid: child.pid ?? 0, endedByItself: ended, outlivedMs, whatHeldIt }
}

test('a launch whose verdict is written ends by itself, though a process the group kill never reached holds its engine\'s output (martha#725)', async () => {
  const model = await aStandInModel(100)
  try {
    const watched = await theDriverWatched(1, aForkSaying('1'), model.url, AN_ENGINE_WHOSE_SURVIVOR_HOLDS_ITS_OUTPUT)
    assert.ok(existsSync(join(watched.evidence, 'line-1', 'result.json')), 'the launch wrote its verdict')
    assert.equal(watched.endedByItself, true,
      `pid ${String(watched.pid)} was still running ${String(watched.outlivedMs)} ms after it wrote its result, held open by: ${watched.whatHeldIt.join(', ')}`)
  } finally {
    await model.stop()
  }
})

test('a launch that never got as far as its line ends by itself, rather than leaving its proxy listening (martha#725)', async () => {
  const model = await aStandInModel(100)
  try {
    const watched = await theDriverWatched(1, aForkSayingNothingOfSkills('1'), model.url, A_STAND_IN_ENGINE)
    const result = JSON.parse(readFileSync(join(watched.evidence, 'line-1', 'result.json'), 'utf8')) as { verdict: string; say: string }
    assert.equal(result.verdict, 'fail', 'a launch whose config could not be written says so')
    assert.equal(watched.endedByItself, true,
      `pid ${String(watched.pid)} was still running ${String(watched.outlivedMs)} ms after it wrote its result, held open by: ${watched.whatHeldIt.join(', ')}`)
  } finally {
    await model.stop()
  }
})
