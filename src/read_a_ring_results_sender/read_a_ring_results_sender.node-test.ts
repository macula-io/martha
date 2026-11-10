// What a ring's own result attests, and what it records when it attests
// nothing (martha#247).
//
// The two answered branches are driven from a recorded host answer
// (./recorded_host_ring_answers.json): a real PostToolUse body from a real
// Claude Code host, so a parse that reads a shape the host does not produce
// fails here rather than in a member's shell. The branches that record nothing
// are the recorded answer with the one field each branch turns on changed, so
// every one of them is a real shape too.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { ANSWERS_A_RING, RINGS_AND_RETURNS_THE_ANSWER } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { RECORDED_RING_RESULT_KEYS, RING_RESULT_KEYS, senderOfARingResult, WHY_NO_RING_SENDER } from './read_a_ring_results_sender.ts'

// Synthetic node ids, never a real one: this repository is public.
const MEMBER = 'a'.repeat(64)
const PEER = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)

interface RecordedAnswer {
  readonly tool_name: string
  readonly tool_input: Readonly<Record<string, unknown>>
  /** The host's own `tool_response`, exactly as its PostToolUse body carried it. */
  readonly tool_response: unknown
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

/** The recorded answer with its JSON object changed, as one branch of the server's result. */
function answerWith(tool: string, change: (result: Record<string, unknown>) => void): { tool_input: unknown; tool_response: unknown } {
  const { tool_input, tool_response } = recorded(tool)
  const blocks = tool_response as { type: string; text: string }[]
  const result = JSON.parse(blocks[0]?.text ?? '') as Record<string, unknown>
  change(result)
  return { tool_input, tool_response: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

test('the host keeps a macula MCP result as one bare text block, which is the shape the recorded answers have (martha#247)', () => {
  for (const tool of [RINGS_AND_RETURNS_THE_ANSWER, ANSWERS_A_RING]) {
    const { tool_response } = recorded(tool)
    assert.ok(Array.isArray(tool_response), `${tool}: the host answer is an array of content blocks`)
    assert.equal(tool_response.length, 1)
    assert.equal(typeof (tool_response[0] as { type?: unknown }).type, 'string')
    assert.equal((tool_response[0] as { type?: unknown }).type, 'text')
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
  const { tool_input, tool_response } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, tool_input, tool_response), { from_identity: MEMBER })
})

test('answering a ring records the peer the server checked against its caller, from the host answer the recording holds (A4, martha#247)', () => {
  const { tool_input, tool_response } = recorded(ANSWERS_A_RING)
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, tool_input, tool_response), { from_identity: MEMBER })
})

test('the recording names two different nodes on the two rows, so a case cannot pass by way of the other row', () => {
  const ring = recorded(RINGS_AND_RETURNS_THE_ANSWER).tool_response as { text: string }[]
  const answer = recorded(ANSWERS_A_RING).tool_response as { text: string }[]
  const dialled = JSON.parse(ring[0]?.text ?? '') as { to: string }
  const peer = JSON.parse(answer[0]?.text ?? '') as { peer: string }
  assert.equal(dialled.to, MEMBER)
  assert.equal(peer.peer, MEMBER)
  assert.equal(dialled.to, peer.peer, 'both rows are of the same member, which is what the capture was of')
})

// --- the branches that record nothing ---------------------------------------

test('A5: a ring nobody answered records nothing, and the refusal says it was not answered', () => {
  const unreachable = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    delete result['answer']
    delete result['answer_label']
    result['unreachable'] = 1
    result['reason'] = 'unreachable: the call timed out'
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, unreachable.tool_input, unreachable.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_answered,
  })
})

test('A5: an answer code the server never sends records nothing rather than trusting the presence of the field', () => {
  const odd = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    result['answer'] = 4
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, odd.tool_input, odd.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_answered,
  })
})

test('A5: a renamed marker records nothing, so a release that renames `answer` fails closed', () => {
  const renamed = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    result['reply'] = result['answer']
    delete result['answer']
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, renamed.tool_input, renamed.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_answered,
  })
})

test('A5: a result naming a node the call did not dial records nothing', () => {
  const elsewhere = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    result['to'] = STRANGER
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, elsewhere.tool_input, elsewhere.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.another_node,
  })
})

test('A5: a petname the call dialled is resolved by the server, so the result’s node id is carried', () => {
  const { tool_response } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, { to: 'a_petname', purpose: 'x' }, tool_response), { from_identity: MEMBER })
})

test('A4: an answer the caller could not be told records nothing, and the refusal says so', () => {
  const notNotified = answerWith(ANSWERS_A_RING, (result) => {
    result['caller_notified'] = 0
    result['notify_error'] = 'WebSocket closed with code 1006'
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, notNotified.tool_input, notNotified.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_notified,
  })
})

test('A4: a caller whose answer was not an acknowledgement records nothing, and the refusal says the payload came back quoted', () => {
  const quoted = answerWith(ANSWERS_A_RING, (result) => {
    result['caller_notified'] = 0
    result['notify_error'] = `${RECORDED_RING_RESULT_KEYS.at(-1)?.not_an_acknowledgement ?? ''}: {"peer":"${PEER}"}`
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, quoted.tool_input, quoted.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_an_acknowledgement,
  })
})

test('A4: caller_notified is read as a number, so a string "1" records nothing', () => {
  const stringly = answerWith(ANSWERS_A_RING, (result) => {
    result['caller_notified'] = '1'
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, stringly.tool_input, stringly.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_notified,
  })
})

// --- shapes that are not the recorded one ----------------------------------

test('a string, an object, two blocks, a block that is not text, and text that is not one JSON object all record nothing', () => {
  const { tool_input, tool_response } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  const block = (tool_response as { type: string; text: string }[])[0] as { type: string; text: string }
  const shapes: readonly { what: string; answer: unknown }[] = [
    { what: 'the host’s error text, a plain string', answer: "mesh_ring failed: the call timed out" },
    { what: 'an object rather than the array of blocks', answer: { content: [{ type: 'text', text: block.text }] } },
    { what: 'two blocks', answer: [block, block] },
    { what: 'a block that is not text', answer: [{ type: 'image', text: block.text }] },
    { what: 'text that is not JSON', answer: [{ type: 'text', text: 'mesh_ring failed: not json at all' }] },
    { what: 'text that is a JSON array', answer: [{ type: 'text', text: '[{"to":"' + MEMBER + '"}]' }] },
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
  const { tool_input, tool_response } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  const block = (tool_response as { type: string; text: string }[])[0] as { type: string; text: string }
  const quoted = answerWith(RINGS_AND_RETURNS_THE_ANSWER, (result) => {
    delete result['to']
    result['reason'] = `declined: ${JSON.stringify({ to: STRANGER })}`
  })
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, quoted.tool_input, quoted.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.no_node_id('to'),
  })
  const prefixed = `not a result: ${block.text}`
  assert.deepEqual(senderOfARingResult(RINGS_AND_RETURNS_THE_ANSWER, tool_input, [{ type: 'text', text: prefixed }]), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.not_the_recorded_shape,
  })
})

test('a key that is not a 64-hex node id records nothing', () => {
  const short = answerWith(ANSWERS_A_RING, (result) => {
    result['peer'] = 'not-a-node-id'
  })
  assert.deepEqual(senderOfARingResult(ANSWERS_A_RING, short.tool_input, short.tool_response), {
    from_identity: null,
    why: WHY_NO_RING_SENDER.no_node_id('peer'),
  })
})

test('every other mesh tool result is not this slice’s to read', () => {
  const { tool_input, tool_response } = recorded(RINGS_AND_RETURNS_THE_ANSWER)
  assert.equal(senderOfARingResult('mesh_get', tool_input, tool_response), undefined)
  assert.equal(senderOfARingResult('mesh_agents', tool_input, tool_response), undefined)
})
