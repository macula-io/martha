// An owner's own act, refused when it is typed from inside a member (martha#619).
//
// `martha approve`, `release`, `bells <member> muted|heard`, `pin-key`, `keep-shapes` and `start` are the owner's
// alone, and each already asks for a terminal. A member's shell can make one (`script -qc`), so this asks two more
// things before the act is made: whether the process carries a member's own environment, and whether a member's host,
// as its launch record names it, is among the processes above this one. Either is a refusal naming the member.
//
// What this is, said plainly (Raf, 2026-11-18, "Speed bumps, said plainly"): a member runs as the owner's own OS user.
// Martha refuses an owner-only act typed from inside a member, and records where every owner-only act was typed, but
// these are speed bumps, not a wall: a member that sets out to could still fake the owner's yes, by making a terminal of
// its own outside its process tree or by writing Martha's state files directly. What it catches is the plain path a
// model's own mistake takes: the act typed in its own shell, wrapped in a terminal or not.
//
// The walk starts at the process's parent and never the process itself, so a launcher reading its own record is never
// "inside a member"; and it runs once, at the verb's entry, so a restart through the crew's tool, which happens inside
// the running `martha start`, is never asked (design r=2, R1). The records read are those of the state root the act
// writes into: an act on another home's state is that home's to judge, and the owner's own state is what this keeps.

import { basename } from 'node:path'

import type { MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'

/** One process above the act's own: its pid, and its identity as the launch records read one, or null. */
export interface AProcessAbove {
  readonly pid: number
  readonly identity: string | null
}

/** What the refusal is decided over. */
export interface WhereAnOwnersActRuns {
  /** The act's word, as the owner types it after `martha`. */
  readonly act: string
  readonly env: Readonly<Record<string, string | undefined>>
  /** The processes above this one, the parent first, never this process itself. */
  readonly ancestors: readonly AProcessAbove[]
  /** Every member launch the act's own state root records. */
  readonly launches: readonly MemberLaunch[]
  /** The variable a member's relay socket is named in, and its config folder's, and that folder's own name. */
  readonly member_marks: { readonly relay_socket_variable: string; readonly config_dir_variable: string; readonly member_config_folder: string }
}

/** What every refusal ends with: the line as Raf drew it. */
export const NOT_A_WALL =
  "This is a speed bump, not a wall: a member running as your own OS user could still make this act from outside its own process tree, or write Martha's state files directly."

const theOwnersOwn = (act: string): string => `martha ${act} is the owner's own act`

/** Why `act` is not made here, inside a member; or undefined when nothing this can see says it is. */
export function whyAnOwnersActIsRefusedInsideAMember(where: WhereAnOwnersActRuns): string | undefined {
  const { act, env, member_marks: marks } = where
  const socket = env[marks.relay_socket_variable]
  if (socket !== undefined && socket !== '') {
    return `${theOwnersOwn(act)}, and this runs with a member's relay socket in its environment (${marks.relay_socket_variable}): type it in your own terminal, not a member's. ${NOT_A_WALL}`
  }
  const config = env[marks.config_dir_variable]
  if (config !== undefined && basename(config) === marks.member_config_folder) {
    return `${theOwnersOwn(act)}, and this runs on a member's own config folder (${marks.config_dir_variable}=${config}): type it in your own terminal, not a member's. ${NOT_A_WALL}`
  }
  for (const above of where.ancestors) {
    const launch = above.identity === null ? undefined : where.launches.find((one) => one.pid === above.pid && one.process_started_at === above.identity)
    if (launch !== undefined) {
      return `${theOwnersOwn(act)}, and this runs inside ${launch.member_name}'s session (its host is process ${launch.pid}, above this one): type it in your own terminal, not a member's. ${NOT_A_WALL}`
    }
  }
  return undefined
}
