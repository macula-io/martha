// What a member may not do to who can reach it: serve a procedure, or change its own contact list.
//
// This exists so text a member takes in cannot leave behind a way in that outlives the session (martha#48).
//
// Two tools of the mesh server widen what reaches a member, and neither is a read, so the room gate
// (../read_a_room_through_its_gate) does not answer them:
//
//   - `mesh_serve` registers a procedure that runs on any caller's payload, with no model in the loop,
//     for as long as the server runs. It belongs to the server process, not to the session: a refresh does
//     not show it, and the owner cannot see it either.
//   - `mesh_trust_agent` and `mesh_untrust_agent` rewrite the contact list, which is the owner's and the
//     crew launcher's. Trusting widens it; untrusting removes an entry the owner put there and declines the
//     crew's own rings again, so both are refused.
//
// The shell gate already refuses all three while a session is tainted. They are refused here in a clean
// session too, because the harm does not need a stranger's text to be in the session: it needs only a
// model that calls the tool. A member's ring trust comes from the declaration and the crew launcher. A
// served procedure the owner signs is a proposal (martha#50), not built.

import type { ToolNames } from '../host_contract/host_contract.ts'

/** The mesh tools that change who or what reaches a member, by their own name. */
export const MESH_TOOLS_THAT_WIDEN_REACH: readonly string[] = ['mesh_serve', 'mesh_trust_agent', 'mesh_untrust_agent']

/** What the host says when it refuses one: who decides instead, and where. */
export const WHO_DECIDES_REACH =
  "who can reach a member is the owner's decision, made in the crew's declaration and its launcher, never by a member's call"

/** True when the call would change who or what can reach this member. */
export function widensMemberReach(tool: string, names: ToolNames): boolean {
  return MESH_TOOLS_THAT_WIDEN_REACH.includes(names.ownNameOf(tool))
}
