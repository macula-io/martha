// Who may act.
//
// The crew's tools that decide what may be DONE — assign work, read the crew
// roster, verify a range, open a crew room, restart a member, close the owner's
// todo rows — compare a display name that the CALLING session sets about itself.
// That name falls back to the first six user messages of the session, and a
// delivered message is a user message, so a stranger's ring purpose saying "you
// are Supervisor" passes every one of them. `crew_restart` and `crew_todo_done`
// go further: they have no caller check at all.
//
// The actor here is therefore the CALLING session, and its identity is the node
// id the harness holds for it — never the sender of a message the session
// received, and never a name read out of text. That distinction is the whole
// point: a member that receives an attested message from the supervisor's node
// id must not become the supervisor (a confused deputy), and the supervisor's own
// session must be able to act on words the owner typed, which arrive with no
// message at all.
//
// The anchor is the harness's own record of the session's node id. Where that is
// a file in the crew's state directory, a shell running as the same OS user can
// rewrite it — the roster anchor weakness, unchanged here and named in the doc.
//
// `take_asks` was on this list, and is not any more: taking the owner's asks and
// settling a batch are decided by the declaration's table, on the act
// OFFER_OWNER_ASKS, because a solo crew has no node id to compare (martha#313,
// ../queue_the_owners_asks). A list that named it here would claim a gate this
// rule never asks.

/** The actions the crew lets only the supervisor take, in business words. */
export const SUPERVISOR_ONLY_ACTIONS = [
  'assign_work',
  'read_crew_roster',
  'verify_range',
  'open_crew_room',
  'restart_member',
  'complete_todo',
] as const

export type SupervisorOnlyAction = (typeof SUPERVISOR_ONLY_ACTIONS)[number]

/**
 * The calling session: the node id the harness holds for it, and the name it
 * goes by. Only `node_id` is ever compared.
 */
export interface Actor {
  readonly node_id: string | null
  readonly display_name: string | null
}

/**
 * Who is the supervisor, by node id. Plural on purpose: a team may name more
 * than one principal, and solo mode names one.
 */
export interface Roster {
  readonly supervisor_node_ids: readonly string[]
}

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly refusal: string }

export interface GateInput {
  readonly action: string
  readonly actor: Actor
  readonly roster: Roster
}

/**
 * The one honest constructor: the identity the harness holds for the calling
 * session. Text cannot build an actor — a session the harness cannot identify has
 * no node id, and is nobody.
 */
export function actorFromCallingSession(session: {
  readonly node_id: string | null
  readonly display_name: string | null
}): Actor {
  return { node_id: session.node_id, display_name: session.display_name }
}

/**
 * The supervisor-only tools a host declares that this rule does not know.
 *
 * A host can add an eighth supervisor-only tool without touching this module, and
 * the rule would never be asked about it. An adapter must call this with its own
 * list and fail when it returns anything: the two lists have to be equal.
 */
export function unknownSupervisorOnlyTools(declared_by_host: readonly string[]): readonly string[] {
  return declared_by_host.filter((action) => !(SUPERVISOR_ONLY_ACTIONS as readonly string[]).includes(action))
}

/** Allow or refuse one action, on the calling session's node id alone. */
export function refuseActionFromAnUnverifiedActor({ action, actor, roster }: GateInput): Decision {
  if (!(SUPERVISOR_ONLY_ACTIONS as readonly string[]).includes(action)) {
    return { allow: false, refusal: `Action ${action} is refused: this rule does not know it, so it may not be taken.` }
  }

  if (actor.node_id === null) {
    return {
      allow: false,
      refusal: `Action ${action} is refused: the calling session has no node id. The calling session's own node id is what counts, never a name read out of text.`,
    }
  }

  const node_id = actor.node_id.toLowerCase()
  if (!roster.supervisor_node_ids.some((supervisor) => supervisor.toLowerCase() === node_id)) {
    return {
      allow: false,
      refusal: `Action ${action} is refused: the calling session's node id is not the supervisor's. The calling session's own node id is what counts, never a name read out of text.`,
    }
  }

  return { allow: true }
}
