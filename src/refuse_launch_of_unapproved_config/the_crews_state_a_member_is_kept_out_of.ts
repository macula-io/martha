// The crew's state a member is kept out of (martha#683).
//
// A launched member inherits the environment of whatever started it — the owner's shell, or a test's own process — and
// that environment may name a crew's state: the state home a root sits in, a path inside the root, or a session id the
// crew has recorded. None of it is the member's business, and a test process holding a real member's state must not
// pass it on to what it launches.
//
// This is the decision alone, so it is pure: a slice reads no machine. Whoever builds a member's environment resolves
// the places a crew's state sits in and the session ids the crew has recorded, and hands them here
// (../give_a_member_its_environment/the_environment_a_member_is_given.ts does both).

import { dirname, sep } from 'node:path'

/** The variable a home's own environment names its state home in, which a member is handed the launcher's own of. */
export const STATE_HOME_VARIABLE = 'XDG_STATE_HOME'

/** Where a crew keeps its state: the root itself, and the directory its rows, one stream per session, sit in. */
export interface TheCrewsState {
  readonly state_root: string
  readonly rows: string
}

/** What a crew's state is known to be from outside it: every place a value naming it may reach into, and its sessions. */
export interface TheCrewsStateKnown {
  /** The places a value is inside of if it is one of them or below one: the roots and rows a crew keeps. */
  readonly places: readonly string[]
  /** The session ids the crew has recorded, each of which is a value of its own a member may not be handed. */
  readonly session_ids: ReadonlySet<string>
}

/** Whether `value` names something at `place` or below it, the way a path names a place. */
const isAtOrBelow = (value: string, place: string): boolean => value === place || value.startsWith(`${place}${sep}`)

/**
 * The inherited variables a member is given: all of them but the ones that name a crew's state (martha#683). The
 * variable that names a state home is dropped here, because the member is handed the launcher's own
 * (theCrewsStateAMemberIsGiven); so is any value inside a place the crew's state is known to sit in, and any value that
 * is a session id the crew has recorded.
 */
export function withoutTheCrewsState(
  inherited: Readonly<Record<string, string | undefined>>,
  known: TheCrewsStateKnown,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(inherited).filter(
      ([name, value]) =>
        name !== STATE_HOME_VARIABLE &&
        (value === undefined || (!known.places.some((place) => isAtOrBelow(value, place)) && !known.session_ids.has(value))),
    ),
  )
}

/**
 * The crew's state a member is handed: the launcher's own state home, resolved from the root the launch keeps its state in.
 *
 * The root's own folder is the state home only because every root a launch keeps is built by `stateRootOf`, whose last
 * segment is STATE_ROOT_NAME: the one place that makes a root is run_the_martha_command, and it hands the launch that
 * root. A root built to another shape would leave this the folder the root merely sits in.
 */
export const theCrewsStateAMemberIsGiven = (state_root: string): Readonly<Record<string, string>> => ({ [STATE_HOME_VARIABLE]: dirname(state_root) })
