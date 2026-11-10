// What a ring's own result attests, and what it records when it attests
// nothing (martha#247).
//
// The two answered branches are driven from a recorded host answer
// (./recorded_host_ring_answers.json): the value a real Claude Code host 2.1.322
// returned to a `tool.call` hook's `next(e)`, which is the value Martha's relay
// puts in body.answer and this parse reads. Its shape is the host's — a
// `{ result, text }` wrapper around the tool's one-block array of text — so a
// parse written against the bare array (what a PostToolUse body carries) records
// nothing here, which is the second case below. The branches that record nothing
// are the recorded answer with the one field each branch turns on changed, so
// every one of them is a real shape too.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ANSWERS_A_RING, RINGS_AND_RETURNS_THE_ANSWER } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { RECORDED_RING_RESULT_KEYS, RING_RESULT_KEYS, senderOfARingResult, WHY_NO_RING_SENDER } from './read_a_ring_results_sender.ts'

// Synthetic node ids, never a real one: this repository is public.
const STRANGER = 'c'.repeat(64)

/** The answer a real host gave a `tool.call` hook: the tool's output, wrapped. */
interface RecordedAnswer {
  readonly tool_name: string
  readonly tool_input: Readonly<Record<string, unknown>>
  readonly tool_call_answer: { readonly ref: number; readonly result: readonly { readonly type: string; readonly text: string }[]; readonly text: string }
}

const RECORDED = JSON.parse(readFileSync(new URL('./recorded_host_ring_answers.json', import.meta.url), 'utf8')) as {
  readonly answers: Readonly<Record<string, RecordedAnswer>>
}

/** The recorded answer for one ring tool, whose single text block is the server's JSON. */
function recorded(tool: string): RecordedAnswer {
  const answer = RECORDED.answers[tool]
  assert.ok(answer !== undefined, `${tool} is not in the recording`)
  return answer
}

/** The server's result inside a recorded answer: the JSON its one text block holds. */
function bodyOf(answer: RecordedAnswer): Readonly<Record<string, unknown>> {
  const [block] = answer.tool_call_answer.result
  assert.ok(block !== undefined, 'the recorded answer holds no text block')
  return JSON.parse(block.text) as Readonly<Record<string, unknown>>
}

/** The node the recorded ring was placed at, as the server wrote it. */
const DIALED = String(bodyOf(recorded(RINGS_AND_RETURNS_THE_ANSWER))['to'])
/** The node whose ring the member answered, as the server wrote it. */
const ANSWERED = String(bodyOf(recorded(ANSWERS_A_RING))['peer'])

/** The recorded answer with its JSON object changed, as one branch of the server's result. */
function answerWith(tool: string, change: (result: Record<string, unknown>) => void): { tool_input: unknown; tool_call_answer: unknown } {
  const { tool_input, tool_call_answer } = recorded(tool)
  const result = JSON.parse(tool_call_answer.result[0]?.text ?? '') as Record<string, unknown>
  change(result)
  const text = JSON.stringify(result, null, 2)
  return { tool_input, tool_call_answer: { ...tool_call_answer, result: [{ type: 'text', text }], text } }
}

test('the host answers a tool.call hook with the tool output wrapped, and its result is one bare text block (martha#247)', () => {
  for (const tool of [RINGS_AND_RETURNS_THE_ANSWER, ANSWERS_A_RING]) {
    const answer = recorded(tool)
    assert.ok(Number.isInteger(answer.tool_call_answer.ref), `${tool}: the host numbers its answer`)
    assert.equal(answer.tool_call_answer.text, answer.tool_call_answer.result[0]?.text, `${tool}: the text is the whole of its one block`)
    assert.equal(answer.tool_call_answer.result.length, 1, `${tool}: one block`)
    assert.equal(answer.tool_call_answer.result[0]?.type, 'text', `${tool}: a text block`)
  }
})

test('the recorded server versions carry the keys the parse reads, and the sentence it names a branch by (martha#247)', () => {
  assert.ok(RECORDED_RING_RESULT_KEYS.length > 0, 'no mesh server version is recorded')
  for (const version of RECORDED_RING_RESULT_KEYS) {
    for (const [tool, keys] of Object.entries(RING_RESULT_KEYS)) {
      const carried = version.results[tool]
      assert.ok(carried !== undefined, `${version.server_version} records no ${tool} result`)
      assert.ok(carried.includes(keys.id), `${version.server_version} carries no ${keys.id} on ${tool}`)
      assert.ok(carried.includes(keys.marker), `${version.server_version} carries no ${keys.marker} on ${tool}`)
    }
    assert.ok(version.not_an_acknowledgement.length > 0, `${version.server_version} records no sentence for a caller's quoted payload`)
  }
})

test('a ring answered records the node it dialled, from the host answer the recording holds (A5, martha#247)', () => {
  const { tool_input, tool_call_answer } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, tool_input, tool_call_answer), { from_identity: DIALED })
})

test('answering a ring records the peer the server checked against its caller, from the host answer the recording holds (A4, martha#247)', () => {
  const { tool_input, tool_call_answer } = recorded(ANSWERS_A_RING)
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, tool_input, tool_call_answer), { from_identity: ANSWERED })
})

test('the recording is of one member ringing one peer and answering that peer back', () => {
  assert.equal(DIALED, ANSWERED, 'the two rows carry the same node, which is what the capture was of')
  assert.match(DIALED, /^[0-9a-f]{64}$/)
  assert.equal(recorded(RINGS_AND_RETURNS_THE_ANSWER).tool_input['to'], DIALED, 'the call dialled exactly the node the result names')
})

// --- the branches that record nothing ---------------------------------------

test('A5: a ring nobody answered records nothing, and the refusal says it was not answered', () => {
  const unreachable = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    delete result['answer']
    delete result['answer_label']
    result['unreachable'] = 1
    result['reason'] = 'unreachable: the call timed out'
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, unreachable.tool_input, unreachable.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_answered,
  })
})

test('A5: an answer code the server never sends records nothing rather than trusting the presence of the field', () => {
  const odd = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    result['answer'] = 4
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, odd.tool_input, odd.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_answered,
  })
})

test('A5: a renamed marker records nothing, so a release that renames `answer` fails closed', () => {
  const renamed = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    result['reply'] = result['answer']
    delete result['answer']
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, renamed.tool_input, renamed.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_answered,
  })
})

test('A5: a result naming a node the call did not dial records nothing', () => {
  const elsewhere = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    result['to'] = STRANGER
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, elsewhere.tool_input, elsewhere.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.another_node,
  })
})

test('A5: a petname the call dialled is resolved by the server, so the result’s node id is carried', () => {
  const { tool_call_answer } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, { to: 'a_petname', purpose: 'x' }, tool_call_answer), { from_identity: DIALED })
})

test('A4: an answer the caller could not be told records nothing, and the refusal says so', () => {
  const notNotified = answerWith(ANSWERS_A_RING, (result) => {
    result['caller_notified'] = 0
    result['notify_error'] = 'WebSocket closed with code 1006'
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, notNotified.tool_input, notNotified.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_notified,
  })
})

test('A4: a caller whose answer was not an acknowledgement records nothing, and the refusal says the payload came back quoted', () => {
  const quoted = answerWith(ANSWERS_A_RING, (result) => {
    result['caller_notified'] = 0
    result['notify_error'] = `${RECORDED_RING_RESULT_KEYS.at(-1)?.not_an_acknowledgement ?? ''}: {"peer":"${STRANGER}"}`
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, quoted.tool_input, quoted.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_an_acknowledgement,
  })
})

test('A4: caller_notified is read as a number, so a string "1" records nothing', () => {
  const stringly = answerWith(ANSWERS_A_RING, (result) => {
    result['caller_notified'] = '1'
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, stringly.tool_input, stringly.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_notified,
  })
})

// --- shapes that are not the recorded one -----------------------------------

test('a string, the bare block array, an object without the wrapper, two blocks, a block that is not text, and text that is not one JSON object all record nothing', () => {
  const { tool_input, tool_call_answer } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  const block = tool_call_answer.result[0] as { type: string; text: string }
  const shapes: readonly { what: string; answer: unknown }[] = [
    { what: 'the host’s error text, a plain string', answer: 'mesh_ring failed: the call timed out' },
    {
      what: 'the bare one-block array, which is what a PostToolUse body carries and this seam never receives',
      answer: [block],
    },
    { what: 'an object with no result of its own', answer: { content: [block] } },
    { what: 'two blocks', answer: { ...tool_call_answer, result: [block, block] } },
    { what: 'a block that is not text', answer: { ...tool_call_answer, result: [{ type: 'image', text: block.text }] } },
    { what: 'text that is not JSON', answer: { ...tool_call_answer, result: [{ type: 'text', text: 'mesh_ring failed: not json at all' }] } },
    { what: 'text that is a JSON array', answer: { ...tool_call_answer, result: [{ type: 'text', text: '[{"to":"' + DIALED + '"}]' }] } },
  ]
  for (const shape of shapes) {
    assert.deepEqual(
      senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, tool_input, shape.answer),
      { from_identity: null, why: WHY_NO_RING_SENDER.not_the_recorded_shape },
      shape.what,
    )
  }
})

test('an id the callee wrote inside its own text is never read: only the top-level key of the whole block counts', () => {
  const { tool_input, tool_call_answer } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  const block = tool_call_answer.result[0] as { type: string; text: string }
  const quoted = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    delete result['to']
    result['reason'] = `declined: ${JSON.stringify({ to: STRANGER })}`
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, quoted.tool_input, quoted.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.no_node_id('to'),
  })
  const prefixed = `not a result: ${block.text}`
  assert.deepEqual(
    senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, tool_input, { ...tool_call_answer, result: [{ type: 'text', text: prefixed }] }),
    { from_identity: null, why: WHY_NO_RING_SENDER.not_the_recorded_shape },
  )
})

test('a key that is not a 64-hex node id records nothing', () => {
  const short = answerWith(ANSWERS_A_RING, (result) => {
    result['peer'] = 'not-a-node-id'
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, short.tool_input, short.tool_call_answer), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.no_node_id('peer'),
  })
})

test('every other mesh tool result is not this slice’s to read', () => {
  const { tool_input, tool_call_answer } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  assert.equal(senderOfARingResult('mesh_get', tool_input, tool_call_answer), undefined)
  assert.equal(senderOfARingResult('mesh_agents', tool_input, tool_call_answer), undefined)
})
