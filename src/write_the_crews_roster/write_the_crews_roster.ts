// The crew's roster: each team member's node id, from its own key (martha#1016, (d) of the groundwork; Jupiter's design
// read r=1: node ids offline).
//
// This exists so a crew tool can address a member by the node id its key gives, as crew-code's roster does
// (`bin/crew` write_roster: "name -> node id for every member, the crew room's only trust anchor"). A member's node id
// is read from the release's own `macula-mcp-node-id` bin, which prints the id a key gives and never touches the mesh:
// asking the station instead (`mesh_hello`) would open a second link on a live member's key, and the station drops one
// of two links on one node id (T6 of the design).
//
// A member is on the roster only when its key is read as a launch reads it (../read_a_members_mesh_key) and the bin
// gave a node id for it: the key is read first, so the bin, which makes a key that is missing, is never started on a
// path with none (T4). Every member left out is named, with why. A solo crew has no roster.
//
// It takes no host and starts nothing: the bin's answer is handed in (`nodeIdOf`), by `martha up`, which runs it. The
// roster `martha up` kept is read back by theKeptRoster, from the text a launch read, for the crew tools that trust a node id only when a
// member's key gave it (crew memory's provenance filter, crew mail's sender).

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { theMeshKeyOf, type TheKeysAsked } from '../read_a_members_mesh_key/read_a_members_mesh_key.ts'

/** The roster's file in Martha's state for the crew: `{ <member>: <node id> }`, written whole, the owner's alone. */
export const ROSTER_FILE = 'roster.json'

/** What the roster is read from: the keys, as a launch reads them, and the node id a key's file gives. */
export interface TheRosterAsked extends TheKeysAsked {
  /** The node id the key at a path gives, or why there is none. */
  nodeIdOf(path: string): { readonly id: string } | { readonly refusal: string }
}

/** The roster of a team crew: each member's node id, and one line for each member left out; none for a solo crew. */
export type TheRoster = { readonly ids: Readonly<Record<string, string>>; readonly left_out: readonly string[] } | { readonly none: typeof SOLO_MODE }

/** The node id the key gives, when it is one: 64 hex digits, written lowercase, as the mesh keys them. */
export function aNodeIdOf(said: { readonly id: string } | { readonly refusal: string }): string | { readonly refusal: string } {
  if ('refusal' in said) return said
  const id = said.id.trim()
  return NODE_ID.test(id) ? id.toLowerCase() : { refusal: `the key gave no node id (${JSON.stringify(id.slice(0, 80))})` }
}

/** The crew's roster, as the header says. */
export function theCrewsRoster(asked: TheRosterAsked): TheRoster {
  if (!asked.team) return { none: SOLO_MODE }
  const ids: Record<string, string> = {}
  const left_out: string[] = []
  for (const member of asked.members) {
    const key = theMeshKeyOf(member, asked)
    if ('none' in key) continue
    if ('refusal' in key) {
      left_out.push(`${member} is left out of the roster: ${key.refusal}`)
      continue
    }
    const id = aNodeIdOf(asked.nodeIdOf(key.path))
    if (typeof id === 'string') ids[member] = id
    else left_out.push(`${member} is left out of the roster: ${id.refusal}`)
  }
  return { ids, left_out }
}

/** The roster file's text: the ids by member, in the declaration's order. */
export const rosterText = (ids: Readonly<Record<string, string>>): string => `${JSON.stringify(ids, null, 2)}\n`

const parsedOrNothing = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The roster `martha up` kept for the crew, from its file's text: each member's node id, by member. Text that is not
 * an object (a file missing, unreadable or broken reads as '') is no roster at all, and an entry that is not a node id of 64 lowercase hex digits is left out, so a
 * caller that trusts a node id only when it is on the roster trusts none it was not given.
 */
export function theKeptRoster(text: string): Readonly<Record<string, string>> {
  const kept = parsedOrNothing(text)
  if (kept === null || typeof kept !== 'object' || Array.isArray(kept)) return {}
  return Object.fromEntries(Object.entries(kept).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && NODE_ID.test(entry[1]) && !/[A-F]/.test(entry[1])))
}
