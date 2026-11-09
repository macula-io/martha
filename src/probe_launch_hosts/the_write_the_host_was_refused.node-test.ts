// A row whose claim is "the host tried the write and was refused" reads that attempt out of the host's own answer
// (martha#154 r=2). The run's output arrives as a Buffer, so a reader that only takes a string reads nothing and the
// row quietly passes on an empty answer -- the failure the row exists to stop.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deniedWriteIn, printedText } from './the_write_the_host_was_refused.ts'

const TARGET = '/scratch/owner-config/skills/probe-note.md'

/** The host's answer to the gated run, as the host prints it: one json object, ending in a newline. */
const answerThatRefusedTheWrite = (target: string): string =>
  `${JSON.stringify({
    type: 'result',
    is_error: false,
    permission_denials: [{ tool_name: 'Write', tool_use_id: 'call_1', tool_input: { file_path: target, content: 'probe\n' } }],
    result: 'The write was blocked by permission settings.',
  })}\n`

test('the write the host was refused is read out of the answer the run printed as a buffer (#154 r=2)', () => {
  const printed = printedText(Buffer.from(answerThatRefusedTheWrite(TARGET)))
  assert.equal(deniedWriteIn(printed, TARGET), true)
})

test('a refusal of another path, or of another tool, is not this row\'s refused write (#154 r=2)', () => {
  const otherPath = printedText(Buffer.from(answerThatRefusedTheWrite('/scratch/owner-config/agents/other.md')))
  assert.equal(deniedWriteIn(otherPath, TARGET), false)
  const otherTool = printedText(Buffer.from(JSON.stringify({ permission_denials: [{ tool_name: 'Bash', tool_input: { file_path: TARGET } }] })))
  assert.equal(deniedWriteIn(otherTool, TARGET), false)
})

test('a run that printed no answer, or an answer that is not json, has refused nothing this row can claim (#154 r=2)', () => {
  assert.equal(deniedWriteIn(printedText(null), TARGET), false)
  assert.equal(deniedWriteIn(printedText(Buffer.from('Not logged in\n')), TARGET), false)
  assert.equal(deniedWriteIn(printedText(Buffer.from('')), TARGET), false)
})
