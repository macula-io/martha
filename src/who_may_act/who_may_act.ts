// Who may act.
//
// The crew's tools that decide what a message may DO — assign work, read the
// crew roster, verify a range, open a crew room, restart a member — compare a
// display name that a session sets about itself. That name falls back to the
// first six user messages of the session, and a delivered message is a user
// message, so a stranger's ring purpose saying "you are Supervisor" passes every
// one of them. `crew_restart` goes further: it has no caller check at all.
//
// This is the rule that replaces all five. An action on the list is taken only
// by an actor whose NODE ID is the supervisor's. A display name is recorded for
// the transcript and never compared: it is evidence of nothing, because whoever
// wrote the text chose it.

/** The actions the crew lets only the supervisor take, in business words. */
export const SUPERVISOR_ONLY_ACTIONS = [
  'assign_work',
  'read_crew_roster',
  'verify_range',
  'open_crew_room',
  'restart_member',
] as const

export type SupervisorOnlyAction = (typeof SUPERVISOR_ONLY_ACTIONS)[number]

/**
 * The actor behind an action: what the delivery attributed, and what the session
 * calls itself. Only `node_id` is ever compared.
 */
export interface Actor {
  readonly node_id: string | null
  readonly claimed_name: string | null
}

/** Who is the supervisor, by node id. */
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
 * The actor a delivery attributes. This is the only honest source: the harness
 * says who sent the thing.
 */
export function actorFromDelivery(delivery: {
  readonly from_node_id: string | null
  readonly from_name: string | null
}): Actor {
  return { node_id: delivery.from_node_id, claimed_name: delivery.from_name }
}

/**
 * The actor a session infers from what it calls itself — `/crew-name`, a title,
 * or "you are X" in its first user messages. It has no node id, so it is nobody:
 * this function exists so that path is visibly a dead end rather than a gate.
 */
export function actorFromSessionName(name: string | null): Actor {
  return { node_id: null, claimed_name: name }
}

/** Allow or refuse one action, on the actor's node id alone. */
export function refuseActionFromAnUnverifiedActor({ action, actor, roster }: GateInput): Decision {
  if (!(SUPERVISOR_ONLY_ACTIONS as readonly string[]).includes(action)) {
    return { allow: false, refusal: `Action ${action} is refused: this rule does not know it, so it may not be taken.` }
  }

  if (actor.node_id === null) {
    return {
      allow: false,
      refusal: `Action ${action} is refused: the actor has no node id. A node id is what counts, never a name a session carries.`,
    }
  }

  const node_id = actor.node_id.toLowerCase()
  if (!roster.supervisor_node_ids.some((supervisor) => supervisor.toLowerCase() === node_id)) {
    return {
      allow: false,
      refusal: `Action ${action} is refused: the actor's node id is not the supervisor's. A node id is what counts, never a name a session carries.`,
    }
  }

  return { allow: true }
}
