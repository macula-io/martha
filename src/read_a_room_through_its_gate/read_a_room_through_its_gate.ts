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
//   1. A RAW READ IS RECOGNISED BY ITS OWN NAME, UNDER ANY NAMESPACE. The same
//      server can be installed under more than one prefix, so the name is the
//      part after the last `__` of an MCP tool. A third copy under a new prefix
//      is refused too. `mesh_say` is a raw read when it waits for a reply,
//      because the reply comes back as its result.
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
import { PATH_OF_SOURCE, takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** The mesh tools whose result carries other agents' text, by their own name. */
export const RAW_MESH_READS: readonly string[] = [
  'mesh_read_inbox',
  'mesh_wait_room',
  'mesh_lobby_transcript',
  'mesh_read_node_events',
  'mesh_watch',
  'mesh_wait_ring',
  'mesh_rooms',
  'mesh_join_room',
]

/** The tool that sends and returns the reply when told to wait for one. */
const SENDS_AND_MAY_WAIT = 'mesh_say'
const WAIT_FOR_A_REPLY = 'wait_reply_seconds'

/** An MCP tool's own name: what follows the last `__`. Any other tool is its own name. */
export function ownToolName(tool: string): string {
  if (!tool.startsWith('mcp__')) return tool
  return tool.slice(tool.lastIndexOf('__') + '__'.length)
}

/** True when the call would hand the model other agents' text that no gate has seen. */
export function isRawMeshRead(tool: string, input?: Readonly<Record<string, unknown>>): boolean {
  const own = ownToolName(tool)
  if (RAW_MESH_READS.includes(own)) return true
  if (own !== SENDS_AND_MAY_WAIT) return false
  const wait = input?.[WAIT_FOR_A_REPLY]
  return wait !== undefined && wait !== null && wait !== 0 && wait !== '0'
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
