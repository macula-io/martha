// On the recorded host, the relay's mesh call reaches the member's own mesh server through the host's `$.mcp`, and comes
// back sealed (martha#1016, Jupiter's design read r=1: "The first slice's red test is a stand-in mesh server answering a
// `mesh_call` that the relay sends through `$.mcp`, on the recorded host").
//
// This exists because the call path rests on one fact only the host can say: that a hooks module may call a connected
// MCP server's tool with the session's own connection. Were it not so, there would be no call path without a second
// server on the member's key, and that is the owner's scope question, not code (the Supervisor's GO on #1016).
//
// The real Claude Code at the recorded version loads a hooks module that carries the relay's own file
// (../claude_code_relay/hooks/call_the_mesh_as_the_member.ts, copied beside it as the host loads only a module's own
// files) and calls one procedure once the server is connected. The mesh server is a stand-in named as the member's is,
// which answers the call with what it was asked, sealed, and writes down each process it ran as. No model is reached:
// the module calls on its own timer, so the session needs no turn. The case skips on RECORDED_HOST_SKIP: ci.yml's relay
// job runs it with the recorded host, as prove_the_relay_loads/recorded_host_runs.json lists. Everything it makes is
// removed after it.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CLAUDE_FOLDER, MCP_CONFIG_SWITCH } from '../know_claude_codes_own_facts/claude_code_facts.ts'

/** The server, tool and seal the module asks for, spelled as the mesh server reads them: an import would agree with a typo. */
const MESH_SERVER = 'macula'
const MESH_CALL_TOOL = 'mesh_call'
const SEALED_ONLY = 'required'

const THE_RELAYS_FILE = fileURLToPath(new URL('../claude_code_relay/hooks/call_the_mesh_as_the_member.ts', import.meta.url))
const PROCEDURE = 'a_provider/read_the_box'
const ARGS = { box: 'a-box' }
/** How long the module's call may take, and how long the case waits for the whole run. */
const CALL_TIMEOUT_MS = 12_000
const RUN_WAIT_MS = 100_000
/** How often the module asks again while the server is not yet connected, and how many times. */
const ASK_AGAIN_MS = 1_000
const ASKS = 30

/** A stand-in MCP server over stdio: one tool, the mesh call, answered with what it was asked, sealed. */
const STAND_IN = `import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
appendFileSync(process.argv[2], process.pid + '\\n')
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id === undefined) return
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'a-stand-in', version: '0.0.0' } } })
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: ${JSON.stringify(MESH_CALL_TOOL)}, description: 'a stand-in', inputSchema: { type: 'object' } }] } })
  if (m.method === 'tools/call') return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ result: { asked: m.params.arguments }, seal: { sealed: 1 } }) }] } })
  send({ jsonrpc: '2.0', id: m.id, result: {} })
})
`

/** The hooks module the host loads: the relay's own call, asked again until the server is connected, its answer written down. */
const MODULE = `import { callTheMeshAsTheMember } from './call_the_mesh_as_the_member.ts'

export const register = (on: any): void => {
  on('session.start', async ($: any) => {
    const where = await $.env.get('MARTHA_MESH_CALL_ANSWER')
    let asks = 0
    const ask = async (): Promise<void> => {
      asks++
      const answer = await callTheMeshAsTheMember($, { procedure: ${JSON.stringify(PROCEDURE)}, args: ${JSON.stringify(ARGS)}, timeout_ms: ${CALL_TIMEOUT_MS} })
      if ('refusal' in answer && answer.refusal.includes('no connected') && asks < ${ASKS}) return void $.clock.after(${ASK_AGAIN_MS}, () => void ask())
      await $.fs.write(where, JSON.stringify(answer))
    }
    $.clock.after(${ASK_AGAIN_MS}, () => void ask())
  })
}
`

/** Waits until `path` exists or the time runs out; true when it exists. */
async function cameToBe(path: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (!existsSync(path) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 200))
  return existsSync(path)
}

test("#1016: the relay's mesh call reaches the member's own mesh server through the host's $.mcp, sealed, on one server", { skip: RECORDED_HOST_SKIP }, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'martha-1016-mesh-call-'))
  t.after(() => removeTheTree(scratch))
  const plugin = join(scratch, 'plugin')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(plugin, 'hooks'))
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'martha-mesh-call-probe', version: '0.0.0' }))
  writeFileSync(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ modules: ['./probe.ts'] }))
  writeFileSync(join(plugin, 'hooks', 'probe.ts'), MODULE)
  copyFileSync(THE_RELAYS_FILE, join(plugin, 'hooks', 'call_the_mesh_as_the_member.ts'))
  const server = join(scratch, 'stand_in.mjs')
  const pids = join(scratch, 'server-pids')
  writeFileSync(server, STAND_IN)
  const config = join(scratch, 'servers.json')
  writeFileSync(config, JSON.stringify({ mcpServers: { [MESH_SERVER]: { command: process.execPath, args: [server, pids] } } }))
  const home = join(scratch, 'home')
  const work = join(scratch, 'work')
  mkdirSync(join(home, CLAUDE_FOLDER), { recursive: true })
  mkdirSync(work)
  const answer = join(scratch, 'answer.json')

  // No account and no model: the key is a stand-in's and the model's address answers nothing, so the session runs no
  // turn; the module calls on its own timer.
  const host = spawn(recordedHost(), ['-p', 'nothing is asked of the model', '--plugin-dir', plugin, '--strict-mcp-config', MCP_CONFIG_SWITCH, config], {
    cwd: work,
    detached: true,
    stdio: 'ignore',
    env: { HOME: home, PATH: process.env['PATH'] ?? '', CLAUDE_CONFIG_DIR: join(home, CLAUDE_FOLDER), ANTHROPIC_API_KEY: 'a-stand-in-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', MARTHA_MESH_CALL_ANSWER: answer },
  })
  const exited = new Promise<void>((resolve) => host.once('exit', () => resolve()))
  try {
    assert.ok(await cameToBe(answer, RUN_WAIT_MS), 'the module wrote no answer: the host did not load it, or never called the server')
  } finally {
    if (host.pid !== undefined && host.exitCode === null) process.kill(-host.pid, 'SIGKILL')
    await exited
  }
  assert.deepEqual(JSON.parse(readFileSync(answer, 'utf8')), { result: { asked: { procedure: PROCEDURE, args: ARGS, confidential: SEALED_ONLY, timeout_ms: CALL_TIMEOUT_MS } } })
  assert.equal(readFileSync(pids, 'utf8').trim().split('\n').length, 1, 'the session ran one mesh server, and the call went through it')
})
