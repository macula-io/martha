// Whether a message from a crew room or a shared room is admitted to a session.
//
// This is the rule behind the two delivery gates the registry names. Until item 4
// those names were accepted on their own; here they are functions the coverage
// check drives, so a name cannot pass without an implementation, and an
// implementation cannot pass by answering only one of the questions.
//
// Six questions, all of which must answer yes:
//
//   1. is the sender a node id at all?            (an empty or malformed one is nobody)
//   2. did something attest the sender?           (the station said who it was)
//   3. is the sender on this room's roster?
//   4. is the sender someone other than this session?
//   5. is the message addressed to this session, by node id?
//   6. is it a kind of message people talk with?
//
// The two names are two ROSTERS, not two rules: `crew-room-acceptance` checks the
// crew's roster, `shared-room-acceptance` the board's. What the shared room gives
// nobody is authority — nothing said there authorises anything — which is why the
// roster question comes before anything the body says.
//
// What this rule does not do: it does not cap or fence the body (that is the
// room's), and it trusts the roster's contents — a file every member's shell can
// write is the anchor weakness the publish gate names separately.

/** A message offered to a session, as the room hands it over. */
export interface RoomMessage {
  /** The station's attestation: it says who sent this, and nothing here verifies it. */
  readonly attested: boolean
  readonly from_node_id: string | null
  readonly to_node_ids: readonly string[]
  readonly kind: string
}

/** The members allowed in this room, by node id. */
export interface RoomRoster {
  readonly member_node_ids: readonly string[]
}

/** Both rosters a crew keeps: its own and the shared cross-crew room's. */
export interface RoomRosters {
  readonly crew: RoomRoster
  readonly shared: RoomRoster
}

/** The kinds of message people talk with. Anything else is not talk. */
export const TALK_KINDS: readonly string[] = [
  'message',
  'question_asked',
  'answer_given',
  'help_requested',
  'help_offered',
  'remark_made',
  'task_handed_over',
  'result_reported',
]

/** A node id as the mesh writes it: 64 hex characters. */
const NODE_ID = /^[0-9a-f]{64}$/i

/** A delivery gate: may this message in? */
export type DeliveryGate = (input: {
  readonly message: RoomMessage
  readonly rosters: RoomRosters
  readonly self_node_id: string
}) => boolean

/** The acceptance rule itself, against one roster. */
export const admitsRoomMessage = ({
  message,
  roster,
  self_node_id,
}: {
  readonly message: RoomMessage
  readonly roster: RoomRoster
  readonly self_node_id: string
}): boolean => {
  if (!NODE_ID.test(self_node_id)) return false
  if (message.from_node_id === null) return false
  if (!NODE_ID.test(message.from_node_id)) return false
  if (!message.attested) return false

  const sender = message.from_node_id.toLowerCase()
  const self = self_node_id.toLowerCase()

  if (sender === self) return false
  if (!roster.member_node_ids.some((member) => member.toLowerCase() === sender)) return false
  if (!message.to_node_ids.some((to) => to.toLowerCase() === self)) return false

  return TALK_KINDS.includes(message.kind)
}

/** The crew room's gate: the rule, against the crew's own roster. */
export const admitsInCrewRoom: DeliveryGate = ({ message, rosters, self_node_id }) =>
  admitsRoomMessage({ message, roster: rosters.crew, self_node_id })

/** The shared cross-crew room's gate: the rule, against the board's roster. */
export const admitsInSharedRoom: DeliveryGate = ({ message, rosters, self_node_id }) =>
  admitsRoomMessage({ message, roster: rosters.shared, self_node_id })
