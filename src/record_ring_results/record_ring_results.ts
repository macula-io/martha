// Records the keys of the two ring results, one record per version of the mesh
// server (martha#247).
//
// The gate reads exactly one key per ring row: `to` on A5, `peer` on A4, and the
// marker whose presence proves the branch really answered (`answer`,
// `caller_notified`). Those names are the server's, not ours, so they are read
// from the server itself: this starts two of its servers as two agents on the
// station, has one ring the other, has the other answer, and writes down the keys
// each result carried. The coverage check (../check_every_path_is_gated) then
// fails CI by name when a recorded version stops carrying one of them, so a
// release that renames a field is recorded again in a reviewed commit instead of
// quietly costing a member its shell.
//
// It runs once by hand for a version, never in CI: a recording is a reviewed act,
// as every other recording in this repo is, and CI has no station to ring over.
//
//   npm pack @macula-io/mcp@<version>
//   npm run record:ring-results -- <the .tgz npm pack wrote> <its server bin>
//
// What it does not become: it pins the keys the pinned server emitted when it was
// recorded, not that a running registry still emits them, and it pins the keys
// only, never their values or their provenance.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { argv, exit, stderr } from 'node:process'

import { recordMeshTree } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import { MESH_TREE_RECORDING } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { MESH_SERVER_PACKAGE, RECORDED_MESH_SERVERS } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { ANSWERS_A_RING, MESH_HELLO, RINGS_AND_RETURNS_THE_ANSWER } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'

const RECORDING = new URL('../read_a_ring_results_sender/recorded_ring_result_keys.json', import.meta.url)
const ANSWER_SECONDS = 90_000

interface RingResultKeyRecord {
  readonly server_version: string
  /** The tarball's integrity, as the registry lock gives it: the bytes these keys were read from. */
  readonly integrity: string
  /** The keys each ring tool's answered result carried. */
  readonly results: Readonly<Record<string, readonly string[]>>
  /** The server's own sentence for a caller whose answer it could not read, as its code writes it. */
  readonly not_an_acknowledgement: string
}

interface RingResultKeyRecording {
  readonly _why: string
  readonly server: string
  readonly versions: readonly RingResultKeyRecord[]
}

const KEY_RECORDING = JSON.parse(readFileSync(RECORDING, 'utf8')) as RingResultKeyRecording

/** One server of the pinned version, started as one agent, spoken to over the MCP stdio protocol. */
class MeshServer {
  private next = 1
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (why: Error) => void }>()
  private buffered = ''
  private readonly child: ChildProcessWithoutNullStreams

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.read(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => stderr.write(chunk))
  }

  static start(server_file: string, env: Readonly<Record<string, string>>): MeshServer {
    const child = spawn(process.execPath, [server_file], {
      env: { PATH: process.env['PATH'] ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return new MeshServer(child)
  }

  async initialize(): Promise<void> {
    await this.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'martha-record-ring-results', version: '1' } }, 'initialize')
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  }

  /** One tool call's parsed JSON result, or a failure that names the tool. */
  async tool(name: string, args: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
    const answered = (await this.call('tools/call', { name, arguments: args }, name)) as { content?: unknown }
    return jsonOfToolResult(name, answered)
  }

  stop(): void {
    this.child.kill('SIGKILL')
  }

  private call(method: string, params: unknown, what: string): Promise<unknown> {
    const id = this.next++
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`${what} did not answer within ${ANSWER_SECONDS / 1000}s`))
      }, ANSWER_SECONDS)
      this.waiting.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (why) => {
          clearTimeout(timer)
          reject(why)
        },
      })
    })
  }

  private read(chunk: string): void {
    this.buffered += chunk
    const lines = this.buffered.split('\n')
    this.buffered = lines.pop() ?? ''
    for (const line of lines) this.take(line)
  }

  private take(line: string): void {
    if (line.trim() === '') return
    const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
    const waiting = message.id === undefined ? undefined : this.waiting.get(message.id)
    if (waiting === undefined) return
    this.waiting.delete(message.id as number)
    if (message.error === undefined) waiting.resolve(message.result)
    else waiting.reject(new Error(message.error.message ?? 'the server refused the call'))
  }
}

/** The one JSON object a tool's answer holds, or a failure naming what came back instead. */
function jsonOfToolResult(name: string, answered: { content?: unknown }): Readonly<Record<string, unknown>> {
  const content = answered.content
  const first = Array.isArray(content) ? content[0] : undefined
  const text = typeof first === 'object' && first !== null ? (first as { text?: unknown }).text : undefined
  if (typeof text !== 'string') throw new Error(`${name} answered no text block`)
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${name} did not answer a JSON object: ${text}`)
  return parsed as Readonly<Record<string, unknown>>
}

/** Every 64-hex string anywhere in a value: what a server's own hello hands back is its node id. */
function nodeIdsIn(value: unknown): readonly string[] {
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (/^[0-9a-f]{64}$/.test(node)) found.push(node)
      return
    }
    if (typeof node !== 'object' || node === null) return
    for (const inner of Object.values(node)) walk(inner)
  }
  walk(value)
  return found
}

/** The sentence the installed server writes when the caller's answer is not an acknowledgement, read from its code. */
function acknowledgementSentenceIn(dir: string): string {
  const code = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.js'))
  for (const path of code) {
    const found = readFileSync(join(dir, path), 'utf8').match(/[A-Za-z][^`"'\n]{0,160}is not an acknowledgement/)
    if (found !== null) return found[0].trim()
  }
  throw new Error('the installed server has no sentence about an answer that is not an acknowledgement: this is not the ring code the recording is of')
}

/** The whole recording of one version: two agents, one ring, one answer. */
async function record(server_file: string, server_version: string, integrity: string, code: string, scratch: string): Promise<RingResultKeyRecord> {
  const serverOf = (agent: string): MeshServer =>
    MeshServer.start(server_file, {
      HOME: scratch,
      MACULA_MCP_AGENT: agent,
      CLAUDE_CODE_SESSION_ID: `martha-record-${agent}`,
    })

  const ringer = serverOf(`record-ringer-${server_version.replace(/\./g, '-')}`)
  const answerer = serverOf(`record-answerer-${server_version.replace(/\./g, '-')}`)
  try {
    await ringer.initialize()
    await answerer.initialize()
    const answererId = nodeIdsIn(await answerer.tool(MESH_HELLO, {}))[0]
    if (answererId === undefined) throw new Error('the answering server named no node id of its own')
    await ringer.tool(MESH_HELLO, {})

    const ring = await ringer.tool(RINGS_AND_RETURNS_THE_ANSWER, {
      to: answererId,
      purpose: 'martha records the keys of a ring result',
      wait_join_seconds: 0,
    })
    const ringId = ring['ring_id']
    if (typeof ringId !== 'string') throw new Error(`mesh_ring answered no ring_id: ${JSON.stringify(ring)}`)

    const answered = await answerer.tool(ANSWERS_A_RING, { ring_id: ringId, answer: 2, reason: 'recording the result key set' })
    return {
      server_version,
      integrity,
      results: { [RINGS_AND_RETURNS_THE_ANSWER]: Object.keys(ring).sort(), [ANSWERS_A_RING]: Object.keys(answered).sort() },
      not_an_acknowledgement: acknowledgementSentenceIn(code),
    }
  } finally {
    ringer.stop()
    answerer.stop()
  }
}

/** The recording with one version in it: added in version order, or replacing that version's record. */
function withVersion(current: RingResultKeyRecording, record: RingResultKeyRecord): RingResultKeyRecording {
  const others = current.versions.filter((recorded) => recorded.server_version !== record.server_version)
  const versions = [...others, record].sort((a, b) => {
    const [left, right] = [a.server_version.split('.').map(Number), b.server_version.split('.').map(Number)]
    for (let at = 0; at < Math.max(left.length, right.length); at++) {
      const order = (left[at] ?? 0) - (right[at] ?? 0)
      if (order !== 0) return order
    }
    return 0
  })
  return { ...current, versions }
}

const [tarballPath, serverBin] = argv.slice(2)
if (tarballPath === undefined || serverBin === undefined) {
  stderr.write('usage: record_ring_results.ts <the .tgz npm pack wrote> <its server bin>\n')
  exit(2)
}

const scratch = mkdtempSync(join(tmpdir(), 'martha-record-rings-'))
try {
  const tree = recordMeshTree({ tarball: readFileSync(tarballPath), recording: MESH_TREE_RECORDING, scratch })
  const record_of_server = RECORDED_MESH_SERVERS.find((recorded) => recorded.server_version === tree.server_version)
  const bin = record_of_server?.bins[serverBin]
  if (record_of_server === undefined || bin === undefined) {
    stderr.write(`${MESH_SERVER_PACKAGE} ${tree.server_version} has no recorded bin ${serverBin}: record the version's tools first (npm run record:mesh-tools)\n`)
    exit(1)
  }
  const server_file = join(scratch, 'installed-tree', 'node_modules', MESH_SERVER_PACKAGE, bin)
  const code = join(scratch, 'extracted', 'package')
  const recorded = await record(server_file, tree.server_version, tree.integrity, code, scratch)
  const next = withVersion(KEY_RECORDING, recorded)
  writeFileSync(RECORDING, `${JSON.stringify(next, null, 2)}\n`)
  process.stdout.write(`recorded ${MESH_SERVER_PACKAGE} ${tree.server_version}: ${JSON.stringify(recorded.results)}\n`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
