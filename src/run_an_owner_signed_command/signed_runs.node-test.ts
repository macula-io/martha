import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { RUN_COMMAND_PREFIX, sha256Of } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import { receiptsInMemory } from './receipts.ts'
import { signedRunsOf } from './signed_runs.ts'

const OUTPUT = 'ok 1\n'
const input = { command: `${RUN_COMMAND_PREFIX}test`, tool_use_id: 'toolu_01' }
const runsOf = (ran: string[] = []) => signedRunsOf(receiptsInMemory(), async (name) => (ran.push(name), { output: Buffer.from(OUTPUT), status: 0 }))

test('a run binds to the shell call, and the receipt the answer takes holds what it gave', async () => {
  const runs = runsOf()
  runs.callAllowed(CLAUDE_CODE_SHELL_TOOL, input)
  assert.deepEqual(await runs.run({ name: 'test' }), { ran: 1, status: 0, output: Buffer.from(OUTPUT).toString('base64') })
  assert.deepEqual(runs.callAnswered(input), { tool_use_id: 'toolu_01', name: 'test', status: 0, output: OUTPUT, output_sha256: sha256Of(OUTPUT) })
})

test('the same command on any tool but the shell binds nothing', async () => {
  const ran: string[] = []
  const runs = runsOf(ran)
  for (const tool of ['Read', 'bash', 'mcp__x__Bash']) runs.callAllowed(tool, input)
  assert.deepEqual(await runs.run({ name: 'test' }), { refused: 'no martha run test call is pending' })
  assert.deepEqual(ran, [])
})

test('a call with no tool_use_id, or a request naming no shape, runs nothing', async () => {
  const ran: string[] = []
  const runs = runsOf(ran)
  runs.callAllowed(CLAUDE_CODE_SHELL_TOOL, { command: input.command })
  assert.deepEqual(await runs.run({ name: 'test' }), { refused: 'no martha run test call is pending' })
  for (const body of [{}, { name: '' }, { name: 1 }, null, 'test']) assert.deepEqual(await runs.run(body), { refused: 'the request names no shape' })
  assert.deepEqual(ran, [])
})

test('a run that did not run keeps no receipt, and says why', async () => {
  const runs = signedRunsOf(receiptsInMemory(), async () => 'nothing ran: planted.txt')
  runs.callAllowed(CLAUDE_CODE_SHELL_TOOL, input)
  assert.deepEqual(await runs.run({ name: 'test' }), { refused: 'nothing ran: planted.txt' })
  assert.equal(runs.callAnswered(input), undefined)
})
