import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_BASH_RESULT_SHAPES } from '../claude_code_host/claude_code_bash_results.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { RESULT_DIFFERS, resultBuiltFrom, RUN_COMMAND_PREFIX, sha256Of } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import { receiptsInMemory } from './receipts.ts'
import { signedRunsOf } from './signed_runs.ts'

const OUTPUT = 'ok 1\n'
const input = { command: `${RUN_COMMAND_PREFIX}test`, tool_use_id: 'toolu_01' }
const names = () => ['test']
const runsOf = (ran: string[] = []) => signedRunsOf(receiptsInMemory(), async (name) => (ran.push(name), { output: Buffer.from(OUTPUT), status: 0 }), names, CLAUDE_CODE_BASH_RESULT_SHAPES)
/** The answer the pinned host shows for a status 0 run that printed OUTPUT. */
const shownAnswer = resultBuiltFrom(CLAUDE_CODE_BASH_RESULT_SHAPES, 0, OUTPUT)

test('a run binds to the shell call, and the answer its receipt builds keeps the shell, once', async () => {
  const runs = runsOf()
  runs.callAllowed(CLAUDE_CODE_SHELL_TOOL, input)
  assert.deepEqual(await runs.run({ name: 'test' }), { ran: 1, status: 0, output: Buffer.from(OUTPUT).toString('base64') })
  assert.deepEqual(runs.callAnswered(CLAUDE_CODE_SHELL_TOOL, input, shownAnswer), { why: undefined })
  // The receipt was taken with that answer, so a second answer for the same call has nothing to be built from.
  assert.match(String(runs.callAnswered(CLAUDE_CODE_SHELL_TOOL, input, shownAnswer)?.why), /no receipt was kept/)
})

test('an answer that is not the one the receipt builds records, and so does a call on another tool', async () => {
  const runs = runsOf()
  runs.callAllowed(CLAUDE_CODE_SHELL_TOOL, input)
  await runs.run({ name: 'test' })
  assert.equal(runs.callAnswered(CLAUDE_CODE_SHELL_TOOL, input, { result: 'anything' })?.why, RESULT_DIFFERS)
  const other = runsOf()
  other.callAllowed('Read', { command: `${RUN_COMMAND_PREFIX}test`, tool_use_id: 'toolu_02' })
  assert.equal(other.callAnswered('Read', { command: `${RUN_COMMAND_PREFIX}test`, tool_use_id: 'toolu_02' }, shownAnswer), undefined)
  assert.equal(other.callAnswered(CLAUDE_CODE_SHELL_TOOL, { command: 'ls', tool_use_id: 'toolu_03' }, shownAnswer), undefined)
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
  const runs = signedRunsOf(receiptsInMemory(), async () => 'nothing ran: planted.txt', names, CLAUDE_CODE_BASH_RESULT_SHAPES)
  runs.callAllowed(CLAUDE_CODE_SHELL_TOOL, input)
  assert.deepEqual(await runs.run({ name: 'test' }), { refused: 'nothing ran: planted.txt' })
  assert.match(String(runs.callAnswered(CLAUDE_CODE_SHELL_TOOL, input, undefined)?.why), /no receipt was kept/)
})
