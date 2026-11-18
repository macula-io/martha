// The whole driver, driven against a stand-in engine whose model answers on a clock (macula-io/martha#732,
// PR 733 R4).
//
// This exists because the cap had unit tests and nothing else: nothing showed that a launch reaches a verdict
// under the bound its own model set, or that a model paced too slowly for what is left of the launch is refused
// by name rather than reaped by the runner with no result at all. The engine here speaks enough ACP to answer
// the handshake and one prompt, and asks the stand-in model the way the engine's provider does (api/show first,
// then the chat), so the measurement is the real one and no Goose build is needed.

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'

import { THE_LAUNCH_BOUND_KEY } from './the_cap_a_line_gets.ts'
import { THE_ROOM_THE_END_OF_A_LAUNCH_NEEDS_MS } from './drive_the_trial.ts'
import { THE_TRANSCRIPT } from './the_evidence_says_why.ts'
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
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      const answer = (): void => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"done":true}')
      }
      if ((request.url ?? '').includes('api/show')) answer()
      else setTimeout(answer, chatMs)
    })
  })
  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', () => settle()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { url: `http://127.0.0.1:${String(port)}`, stop: () => new Promise<void>((settle) => server.close(() => settle())) }
}

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
): Promise<{ evidence: string; refused: string }> {
  const work = aFreshDirectory()
  const engine = join(work, 'a-stand-in-engine.mjs')
  writeFileSync(engine, engineSource)
  chmodSync(engine, 0o755)
  const evidence = join(work, 'evidence')
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

test('a launch whose handshake fails keeps the message the kill cut off, as every other kill path does (PR 733, martha#694)', async () => {
  const { evidence } = await theDriverFor(1, aLaunchLeaving(HANDSHAKE_LEFT_MS), 'http://127.0.0.1:9', AN_ENGINE_CUT_OFF_MID_MESSAGE)
  const kept = readFileSync(join(evidence, 'line-1', THE_TRANSCRIPT), 'utf8').split('\n').filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { direction: string; message: unknown })
  const received = kept.filter(({ direction }) => direction === 'received').map(({ message }) => message)
  assert.deepEqual(received, [{ text: A_MESSAGE_CUT_OFF }], 'the message without its newline is in the transcript, once')
})
