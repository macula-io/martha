// How a member reads a room: through the room's own gate, never raw.
//
// This exists so a stranger who can publish to a topic a member reads cannot get
// text in front of that member through the mesh read tools (row B1).
//
// Why refuse the raw tools instead of tainting on them. Until now every raw
// mesh read tainted, which failed closed and made the crew room useless for
// shell work: the crew room's delivery tells the model to read the rest of a
// long message, and a member that followed the pointer lost its shell. A crew
// in that position turns the gate off or stops following the pointer. So the
// raw reads are refused outright, tainted or not, and there is one read that
// returns only what the room's own gate admits. Text the model never receives
// needs no record.
//
// Three rules are load-bearing here.
//
//   1. A MESH TOOL RUNS ONLY WHEN IT IS NAMED TO RUN, UNDER ANY NAMESPACE.
//      MESH_TOOLS_THAT_RUN is an allow-list: a mesh tool not on it, one added
//      by a new release of the server included, is refused, because a list of
//      what is refused quietly lets through every name it was never taught.
//      The match is on the tool's own name, which only the host can take out
//      of the name it calls (host_contract's `ownNameOf`): the same server can
//      be installed under more than one prefix, and each host composes the
//      name its own way. `mesh_say` is a raw read when it waits for a reply,
//      because the reply comes back as its result, and when the host gives no
//      input at all, because then nothing says it will not wait.
//
//   2. ONE GATE, NOT TWO. The gated read calls the delivery gate the registry
//      binds to the room's inbound path, with that path's roster. It is not a
//      second copy that can drift, and a caller cannot choose the roster.
//
//   3. WHAT THE GATE REFUSES IS NOT SHOWN AT ALL. The result says how many
//      envelopes were withheld, never their text, sender or kind. A result that
//      showed refused text "for information" would be B1 again. Each admitted
//      envelope is an ingestion carrying its sender's node id, so the shell is
//      kept only when the policy names every sender.
//
// What this does not do: it trusts `attested` as the room's delivery does (the
// anchor, item 7). B2 (`mesh_get`, `mesh_recall`, board cards) stays on the
// shell gate, because those results have no sender to admit.

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { DeliveryGate, RoomMessage, RoomRosters } from '../admit_a_room_message/admit_a_room_message.ts'
import { DELIVERY_GATES, INBOUND_PATHS } from '../inbound_paths/inbound_paths.ts'
import type { ToolNames, TurnSource } from '../host_contract/host_contract.ts'
import { MESH_TOOLS_THAT_WIDEN_REACH } from '../refuse_widening_a_member_reach/refuse_widening_a_member_reach.ts'
import { PATH_OF_SOURCE, takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** Every tool of the mesh server starts its own name with this. */
export const MESH_TOOL_PREFIX = 'mesh_'

/** The tool that sends and returns the reply when told to wait for one. */
const SENDS_AND_MAY_WAIT = `${MESH_TOOL_PREFIX}say`
const WAIT_FOR_A_REPLY = 'wait_reply_seconds'

/** The tool that rings an agent and returns its answer: a decline carries the callee's own reason (A5). */
export const RINGS_AND_RETURNS_THE_ANSWER = `${MESH_TOOL_PREFIX}ring`

/**
 * The tool that answers a ring this member was given: its result can carry
 * the caller's own text, an acknowledgement it could not read among it (A4).
 */
export const ANSWERS_A_RING = `${MESH_TOOL_PREFIX}answer_ring`

/**
 * The tool that starts a member's presence. Its answer is the one
 * ../prove_a_mesh_answer_is_wordless exists for; the name is defined here,
 * beside its siblings, because this is where every tool's name is built.
 */
export const MESH_HELLO = `${MESH_TOOL_PREFIX}hello`

/** The tool that ends a member's presence: the same shape of answer, and the same reasoning. */
export const MESH_GOODBYE = `${MESH_TOOL_PREFIX}goodbye`

/**
 * The mesh tools that may be called, by their own name. None of them returns
 * a room's messages: each sends, manages the member's own presence and rooms,
 * or looks a record up. A result that carries text with no sender to admit
 * (`mesh_get`, `mesh_recall`, `mesh_call`, a ring's answer) stays on the shell
 * gate (B2), as before. Every name added here is a decision that the tool hands
 * the model no room's text: a tool that does (`mesh_read_inbox`, `mesh_join_room`
 * and the rest) is refused because it is not here.
 */
export const MESH_TOOLS_THAT_RUN: readonly string[] = [
  'mesh_agents',
  ANSWERS_A_RING,
  'mesh_call',
  'mesh_find_record',
  'mesh_find_records',
  'mesh_find_records_by_type',
  'mesh_get',
  MESH_GOODBYE,
  MESH_HELLO,
  'mesh_join_realm',
  'mesh_leave_room',
  'mesh_list_realms',
  'mesh_list_stations',
  'mesh_observe_lobby',
  'mesh_open_room',
  'mesh_publish',
  'mesh_put',
  'mesh_recall',
  'mesh_remember',
  'mesh_remember_directory',
  RINGS_AND_RETURNS_THE_ANSWER,
  SENDS_AND_MAY_WAIT,
  'mesh_unobserve_lobby',
  'mesh_unserve',
]

/**
 * The mesh tools that are refused, by their own name. The first three change
 * who or what can reach the member (../refuse_widening_a_member_reach,
 * martha#48); every other one hands the model a room's or another agent's text
 * that no gate has seen (B1). At run time
 * they are refused because MESH_TOOLS_THAT_RUN does not name them; this list is
 * the other half of the decision, and the coverage check proves the two halves
 * cover every tool the recorded server registers (./mesh_server_tools.ts).
 */
export const MESH_TOOLS_REFUSED: readonly string[] = [
  ...MESH_TOOLS_THAT_WIDEN_REACH,
  'mesh_join_room',
  'mesh_lobby_transcript',
  'mesh_read_inbox',
  'mesh_read_node_events',
  'mesh_rooms',
  'mesh_wait_ring',
  'mesh_wait_room',
  'mesh_watch',
]

/** True when the call would hand the model other agents' text that no gate has seen. */
export function isRawMeshRead(
  tool: string,
  input: Readonly<Record<string, unknown>> | undefined,
  names: ToolNames,
): boolean {
  const own = names.ownNameOf(tool)
  if (!own.startsWith(MESH_TOOL_PREFIX)) return false
  if (!MESH_TOOLS_THAT_RUN.includes(own)) return true
  if (own !== SENDS_AND_MAY_WAIT) return false
  if (input === undefined) return true
  const wait = input[WAIT_FOR_A_REPLY]
  return wait !== undefined && wait !== null && wait !== 0 && wait !== '0'
}

/** The ring tools whose result is a ring's own row, by their own name. */
const SOURCE_OF_A_RING_TOOL: Readonly<Record<string, TurnSource>> = {
  [RINGS_AND_RETURNS_THE_ANSWER]: 'ring_answer',
  [ANSWERS_A_RING]: 'ring',
}

/**
 * The turn source an MCP tool's result is recorded on, by the tool's own name.
 * A ring's answer is A5: its decline reason is the callee's text. Answering a
 * ring is A4: what comes back can carry the caller's text. Every other result
 * that runs is an MCP result (B2): what it returns has no sender to admit. A
 * tool that hands the model a room's text, or a ring's purpose, never runs
 * (isRawMeshRead), so no result of one is ever recorded (B1).
 */
export function sourceOfAMeshToolResult(own_name: string): TurnSource {
  return Object.hasOwn(SOURCE_OF_A_RING_TOOL, own_name) ? (SOURCE_OF_A_RING_TOOL[own_name] ?? 'mcp_result') : 'mcp_result'
}

/** The rooms a member can read, by the turn source their delivery is recorded on. */
export type ReadableRoom = 'crew_room' | 'shared_room'

/** One envelope as the mesh returns it: the gate's fields, plus what the model would read. */
export interface RoomEnvelope extends RoomMessage {
  readonly message_id: string
  readonly text: string
}

export interface RoomRead {
  readonly session: HostSession
  readonly admitted: readonly RoomEnvelope[]
  /** How many envelopes the gate refused. Nothing else about them leaves this function. */
  readonly withheld: number
}

/** The delivery gate the registry binds to a room's inbound path. */
export function gateOfRoom(room: ReadableRoom): DeliveryGate {
  const path = INBOUND_PATHS.find((row) => row.id === PATH_OF_SOURCE[room])
  if (path?.control.kind !== 'delivery-gate') {
    throw new Error(`inbound path ${PATH_OF_SOURCE[room]} for ${room} names no delivery gate`)
  }
  return DELIVERY_GATES[path.control.gate]
}

/** Read a room: only what its gate admits, each admitted envelope recorded with its sender. */
export function readRoomThroughItsGate(input: {
  readonly session: HostSession
  readonly room: ReadableRoom
  readonly envelopes: readonly RoomEnvelope[]
  readonly rosters: RoomRosters
  readonly self_node_id: string
}): RoomRead {
  const gate = gateOfRoom(input.room)
  const admitted = input.envelopes.filter((message) =>
    gate({ message, rosters: input.rosters, self_node_id: input.self_node_id }),
  )
  const session = admitted.reduce(
    (taken, envelope) => takeInTurn(taken, { source: input.room, from_identity: envelope.from_node_id }, bindNothing),
    input.session,
  )
  return { session, admitted, withheld: input.envelopes.length - admitted.length }
}
