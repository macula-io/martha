// The trial's ACP client against the stand-in agent (macula-io/martha#541): a request it has no answer for goes back
// as a JSON-RPC error, never as a success whose outcome holds one.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { METHOD_NOT_FOUND } from '../src/speak_acp_to_an_agent/the_acp_client.ts'
import type { AnAgentScript } from '../src/stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'
import { GooseOverAcp } from './speak_acp_to_goose.ts'

const STAND_IN = join(import.meta.dirname, '..', 'src', 'stand_in_for_an_acp_agent', 'main.ts')
const ASKED = 'fs/read_text_file'

test('a request the trial has no answer for is answered with a JSON-RPC error, and noted', async () => {
  const script: AnAgentScript = { turns: [[{ ask: ASKED }]] }
  const child = spawn(process.execPath, [STAND_IN, JSON.stringify(script)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const goose = new GooseOverAcp(child)
  try {
    await goose.ask('initialize', {})
    const { sessionId } = (await goose.ask('session/new', { cwd: '/', mcpServers: [] })) as { sessionId: string }
    await goose.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'go' }] })
    const said = goose.updates.map((update) => (update['params'] as { update: { content: { text: string } } }).update.content.text).join('')
    const answer = JSON.parse(said) as Record<string, unknown>
    assert.equal('result' in answer, false)
    assert.equal((answer['error'] as { code?: unknown } | undefined)?.code, METHOD_NOT_FOUND)
    assert.match(goose.notes.join('\n'), new RegExp(`unexpected request from goose: ${ASKED}`))
  } finally {
    goose.stop()
    if (child.exitCode === null) child.kill()
    await exited
  }
})
