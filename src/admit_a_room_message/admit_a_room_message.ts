// Whether a message from a crew room or a shared room is admitted to a session.
//
// This is the rule behind the two delivery gates the registry names. Until now
// those names were accepted on their own; here they are a function the coverage
// check drives, so a name cannot pass without an implementation and an
// implementation cannot pass by admitting everyone.
//
// Five questions, all of which must answer yes:
//
//   1. did something attest the sender?          (the station said who it was)
//   2. is the sender on this room's roster?
//   3. is the sender someone other than this session?
//   4. is the message addressed to this session, by node id?
//   5. is it a kind of message people talk with?
//
// A shared cross-crew room runs the same five against the board's roster. What
// it does NOT give anyone is authority: nothing said in that room may authorise
// anything, which is why the roster question comes before anything the body says.
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

/** A delivery gate: may this message in? */
export type DeliveryGate = (input: {
  readonly message: RoomMessage
  readonly roster: RoomRoster
  readonly self_node_id: string
}) => boolean

/** The crew room's acceptance rule, and the shared room's: the same five questions. */
export const admitsRoomMessage: DeliveryGate = ({ message, roster, self_node_id }) => {
  if (!message.attested) return false
  if (message.from_node_id === null) return false

  const sender = message.from_node_id.toLowerCase()
  const self = self_node_id.toLowerCase()

  if (sender === self) return false
  if (!roster.member_node_ids.some((member) => member.toLowerCase() === sender)) return false
  if (!message.to_node_ids.some((to) => to.toLowerCase() === self)) return false

  return TALK_KINDS.includes(message.kind)
}
