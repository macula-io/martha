// One mesh server of the pinned version, started as one agent and spoken to over the
// MCP stdio protocol (martha#251).
//
// This exists so a recording can be taken from the server a member really installs,
// not from a fixture: ../record_mesh_answers starts two of these with different
// settings, asks each the same tool, and writes down what came back. It is the same
// shape ../record_ring_results uses to take the ring result keys, and it is a
// recording tool, never a member's path: nothing under src/launch_a_claude_code_member
// imports it.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { stderr } from 'node:process'

/** How long one call may take before the recording gives up, in milliseconds. */
export const ANSWER_MILLISECONDS = 90_000

/** One server of the pinned tree, running as one agent. */
export class MeshServer {
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
    await this.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'martha-record-mesh-answers', version: '1' } }, 'initialize')
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
        reject(new Error(`${what} did not answer within ${ANSWER_MILLISECONDS / 1000}s`))
      }, ANSWER_MILLISECONDS)
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
  const block = Array.isArray(answered.content) ? answered.content[0] : undefined
  const text = isRecord(block) ? block['text'] : undefined
  if (typeof text !== 'string') throw new Error(`${name} answered no text block`)
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error(`${name} did not answer a JSON object: ${text}`)
  return parsed
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
