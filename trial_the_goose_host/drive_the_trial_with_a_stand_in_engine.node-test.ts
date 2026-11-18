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

/** The engine, as far as the driver can tell: the handshake, and one prompt answered after asking the model. */
const A_STAND_IN_ENGINE = `#!/usr/bin/env node
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
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'a-stand-in-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the stand-in engine answered' } } } })
      result(message.id, { stopReason: 'end_turn' })
    })
})
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

/** Runs the driver for one line, and hands back what the launch left behind. */
async function theDriverFor(line: number, minutes: string, modelUrl: string): Promise<{ evidence: string; refused: string }> {
  const work = aFreshDirectory()
  const engine = join(work, 'a-stand-in-engine.mjs')
  writeFileSync(engine, A_STAND_IN_ENGINE)
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

test('the driver refuses, by name and with the arithmetic, a line whose model paced too slowly for what is left (martha#732)', async () => {
  const model = await aStandInModel(3_000)
  try {
    const { evidence } = await theDriverFor(1, '0.45', model.url)
    const result = JSON.parse(readFileSync(join(evidence, 'line-1', 'result.json'), 'utf8')) as { verdict: string; say: string }
    assert.equal(result.verdict, 'fail', 'a bound that cannot fit is a fail that is never launched again')
    assert.match(result.say, /the launch cannot give this turn the bound its model asks for/)
    assert.match(result.say, /(a \d+ ms round-trip plus its \d+ ms margin is \d+ ms, beyond the \d+ ms left of the launch|the launch has -?\d+ ms left, less than the room its own end needs)/,
      'the refusal carries the arithmetic, not only the word no')
  } finally {
    await model.stop()
  }
})
