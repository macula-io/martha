// The node id a ring's own result attests, so a member that rings a crew mate
// keeps its shell (martha#247).
//
// A5 (`mesh_ring`: a ring answered) and A4 (`mesh_answer_ring`: what answering a
// ring returns) both declare `attestation: 'station'` in the registry, and until
// this slice nothing supplied one, so every ring a member made cost it the shell
// for the rest of the session, its own crew mate's answer included. The id is
// there: on A5 `to` is the node whose own `~<node_id>/ring` answered (the SDK's
// own-namespace rule), on A4 `peer` is the ring's `from`, which the endpoint
// checked against the call's verified caller. Both are the server's word about
// who is on the other end, never the callee's.
//
// Four rules are load-bearing here.
//
//   1. THE ID IS CARRIED ONLY ON THE ANSWERED BRANCH, BY A MARKER'S PRESENCE.
//      An unreachable ring's result carries `to` too, and its `reason` is the
//      failed call's error text, which can be the far end's own words. A4 with
//      `caller_notified: 0` carries `peer` beside the text the caller sent back.
//      So A5 carries an id only when `answer` is exactly 1, 2 or 3, and A4 only
//      when `caller_notified` is exactly 1: a renamed marker yields no valid
//      one and the row records nothing, where a rule written as "not
//      unreachable" would turn the same rename into an attribution.
//
//   2. THE ID IS READ FROM ONE SHAPE ONLY: the host's answer for the call is a
//      bare one-block array of text, whose whole text is one JSON object, whose
//      own key is a 64-hex string. Never a substring, never an object found
//      inside the text: the server's error text quotes the callee's payload
//      (`JSON.stringify(delivery.payload)`), so a parser that hunted for JSON
//      would read an id the callee wrote. A string (an error result), an
//      object, an array of another length, a block that is not text, all record
//      nothing.
//
//   3. ON A5 THE RESULT MUST NAME THE NODE THIS CALL DIALLED, when the call's
//      own `to` was a node id. A call resolves a petname before it dials, so a
//      result naming some other node is not this call's answer.
//
//   4. THE REASON IS SAID. A row that records nothing records why, in words the
//      gate's refusal carries, so an unattributed ring says which branch it
//      was: unanswered, not notified, or a result that is not the recorded shape
//      (the caller's payload quoted back in an error, most of it).
//
// What this does not close: a ring to an offline peer still costs the shell,
// because that answer is unattributed by rule 1. The way out is a typed marker
// from the server saying no peer text is present, which is macula-io/macula-mcp#85.

import { isNodeId } from '../admit_a_room_message/admit_a_room_message.ts'
import hostAnswers from './recorded_host_ring_answers.json' with { type: 'json' }
import keys from './recorded_ring_result_keys.json' with { type: 'json' }
import { ANSWERS_A_RING, RINGS_AND_RETURNS_THE_ANSWER } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'

/**
 * The keys each ring result is read by, from the design: the id key and the
 * marker whose presence proves the branch carried an answer. The recorded key
 * sets (./recorded_ring_result_keys.json) are what prove the pinned server
 * still emits them; ../check_every_path_is_gated fails CI by name when a
 * recorded version stops carrying one.
 */
export const RING_RESULT_KEYS: Readonly<Record<string, { readonly id: string; readonly marker: string }>> = {
  [RINGS_AND_RETURNS_THE_ANSWER]: { id: 'to', marker: 'answer' },
  [ANSWERS_A_RING]: { id: 'peer', marker: 'caller_notified' },
}

/** The answer codes a ring's result may carry on the branch that really answered. */
export const ANSWERS_THAT_ANSWERED: readonly number[] = [1, 2, 3]

/** One recorded version's ring result keys, read from the server itself (./record_ring_results.ts). */
export interface RecordedRingResultKeys {
  readonly server_version: string
  /** The tarball's integrity: the bytes these keys were read from. */
  readonly integrity: string
  /** The keys each ring tool's answered result carried, sorted. */
  readonly results: Readonly<Record<string, readonly string[]>>
  /** The server's own sentence in front of a caller's quoted payload, as its code writes it. */
  readonly not_an_acknowledgement: string
}

/** The recording file: the package once, then each recorded version. */
export interface RingResultKeyRecording {
  readonly _why: string
  readonly server: string
  readonly versions: readonly RecordedRingResultKeys[]
}

const RECORDING = keys as RingResultKeyRecording

/** Every recorded version, oldest first. */
export const RECORDED_RING_RESULT_KEYS: readonly RecordedRingResultKeys[] = RECORDING.versions

/**
 * The server's own words for a caller whose answer it could not read, in its
 * newest recorded version: the branch that says a caller's payload came back
 * quoted rather than a failed call. Read from the recording, never typed here.
 */
export const THE_SENTENCE_ABOUT_AN_ACKNOWLEDGEMENT: string = RECORDED_RING_RESULT_KEYS.at(-1)?.not_an_acknowledgement ?? ''

/**
 * What a ring's own result says about the node on the other end: the id, or
 * `null` with the reason the branch carried none.
 */
export interface RingSender {
  readonly from_identity: string | null
  /** Why no id is carried, in words the gate's refusal repeats. Absent when one is. */
  readonly why?: string
}

/** The reason a result records nothing, one sentence per branch the design names. */
export const WHY_NO_RING_SENDER = {
  not_the_recorded_shape: 'the result was not the recorded shape (one text block holding one JSON object), so what came back may be the other side’s own words',
  not_answered: 'the ring was not answered: its result carries no answer of 1, 2 or 3',
  not_notified: 'the answer was recorded but the caller could not be told',
  not_an_acknowledgement: 'the caller answered with something that is not an acknowledgement, so its payload came back quoted in ours',
  no_node_id: (expected: string) => `its result named no node id where the recorded key set has one (${expected})`,
  another_node: 'the result named a node id other than the one this call placed its ring at',
} as const

/**
 * The sender a ring tool's result attests, or `undefined` when the tool is not
 * one of the two ring tools (its result stays on B2, unchanged).
 */
export function senderOfARingResult(own_name: string, input: unknown, answer: unknown): RingSender | undefined {
  const keys = RING_RESULT_KEYS[own_name]
  if (keys === undefined) return undefined

  const result = jsonObjectIn(answer)
  if (result === undefined) return { from_identity: null, why: WHY_NO_RING_SENDER.not_the_recorded_shape }

  const branch = branchOf(own_name, result)
  if (branch !== undefined) return { from_identity: null, why: branch }

  return senderNamed(own_name, keys.id, result, input)
}

/** The id the answered branch names, or the reason it names none this call may use. */
function senderNamed(own_name: string, id_key: string, result: Readonly<Record<string, unknown>>, input: unknown): RingSender {
  const named = result[id_key]
  if (typeof named !== 'string' || !isNodeId(named)) return { from_identity: null, why: WHY_NO_RING_SENDER.no_node_id(id_key) }
  const id = named.toLowerCase()
  if (own_name === RINGS_AND_RETURNS_THE_ANSWER && !dialledHere(input, id)) return { from_identity: null, why: WHY_NO_RING_SENDER.another_node }
  return { from_identity: id }
}

/** Whether the call asked for this node, or named none as a node id: a petname is resolved by the server, not here. */
function dialledHere(input: unknown, id: string): boolean {
  const asked = isRecord(input) ? input['to'] : undefined
  return typeof asked !== 'string' || !isNodeId(asked) || asked.toLowerCase() === id
}

/** Why this result is not the answered branch, or undefined when it is one. */
function branchOf(own_name: string, result: Readonly<Record<string, unknown>>): string | undefined {
  if (own_name === RINGS_AND_RETURNS_THE_ANSWER) {
    const answer = result['answer']
    if (typeof answer === 'number' && ANSWERS_THAT_ANSWERED.includes(answer)) return undefined
    return WHY_NO_RING_SENDER.not_answered
  }

  if (result['caller_notified'] === 1) return undefined
  const notify_error = result['notify_error']
  return typeof notify_error === 'string' && notify_error.startsWith(THE_SENTENCE_ABOUT_AN_ACKNOWLEDGEMENT)
    ? WHY_NO_RING_SENDER.not_an_acknowledgement
    : WHY_NO_RING_SENDER.not_notified
}

/**
 * The one JSON object the host's answer holds, or undefined.
 *
 * Claude Code keeps a macula MCP tool's successful result as a bare one-block
 * array (`[{type: 'text', text}]`), and its error as a plain string: nothing
 * else is a result this reads. The whole block goes through `JSON.parse`, never
 * a substring of it.
 */
function jsonObjectIn(answer: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!Array.isArray(answer) || answer.length !== 1) return undefined
  const block: unknown = answer[0]
  if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(block['text'])
  } catch {
    return undefined
  }
  return isRecord(parsed) ? parsed : undefined
}

/** A JSON object: what is neither null, an array, nor a primitive. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The host's own answers for the two ring tools, taken live and recorded
 * (./recorded_host_ring_answers.json), by the tool's own name. A test that has to
 * drive a ring result reads this rather than building one: the shape is the
 * host's, and a hand-built one would hide a parse that reads a shape the host
 * never produces.
 */
export const RECORDED_RING_ANSWERS: Readonly<Record<string, { readonly tool_input: Readonly<Record<string, unknown>>; readonly tool_response: unknown }>> =
  (hostAnswers as { readonly answers: Readonly<Record<string, { readonly tool_input: Readonly<Record<string, unknown>>; readonly tool_response: unknown }>> })
    .answers
