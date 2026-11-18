// The crew's state a member is kept out of (martha#683).
//
// A launched member inherits the environment of whatever started it — the owner's shell, or a test's own process — and
// that environment may name a crew's state: the state home a root sits in, a path inside the root, or a session id the
// crew has recorded. None of it is the member's business, and a test process holding a real member's state must not
// pass it on to what it launches.
//
// So a member is handed the launcher's own state home, resolved from the state root the launch keeps its state in, and
// every inherited variable that names a crew's state is dropped: by name for the variable that points at a state home,
// and by value for a path inside any root the launching process names, its crews place, the launch's own root and rows,
// and any session id the crew has recorded.

import { readdirSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

import { stateRootOf } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { theMembersConfigEnvironment } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

import { launchEnvironment, type Host, type HostSwitches } from './refuse_launch_of_unapproved_config.ts'

/** The variable a home's own environment names its state home in, which a member is handed the launcher's own of. */
export const STATE_HOME_VARIABLE = 'XDG_STATE_HOME'

/** Where a crew keeps its state: the root itself, and the directory its rows, one stream per session, sit in. */
export interface TheCrewsState {
  readonly state_root: string
  readonly rows: string
}

/** A file's name without the suffix that says what it holds. */
const nameWithoutItsSuffix = (name: string): string => name.slice(0, name.lastIndexOf('.') === -1 ? name.length : name.lastIndexOf('.'))

/** The session ids a crew has recorded: one file per session directly in its rows place. */
function sessionIdsRecordedIn(rows: string): ReadonlySet<string> {
  try {
    return new Set(readdirSync(rows).map(nameWithoutItsSuffix))
  } catch {
    // No rows place yet, or one this user cannot read: then the crew has recorded no session a member could be handed.
    return new Set()
  }
}

/**
 * The inherited variables a member is given: all of them but the ones that name a crew's state (martha#683). The
 * variable that names a state home is dropped here, because the member is handed the launcher's own
 * (theCrewsStateAMemberIsGiven); so is any value inside the root the launching process names, inside that root's crews
 * place, inside the launch's own state root or its rows, and any value that is a session id the crew has recorded.
 */
export function withoutTheCrewsState(
  inherited: Readonly<Record<string, string | undefined>>,
  crew: TheCrewsState,
): Record<string, string | undefined> {
  const named = stateRootOf(inherited.HOME ?? '', inherited[STATE_HOME_VARIABLE])
  const places = [crew.state_root, crew.rows, named, join(named, CREWS_PLACE)]
  const insideTheCrewsState = (value: string): boolean => places.some((place) => value === place || value.startsWith(`${place}${sep}`))
  const sessions = sessionIdsRecordedIn(crew.rows)
  return Object.fromEntries(
    Object.entries(inherited).filter(
      ([name, value]) => name !== STATE_HOME_VARIABLE && (value === undefined || (!insideTheCrewsState(value) && !sessions.has(value))),
    ),
  )
}

/** The crew's state a member is handed: the launcher's own state home, resolved from the root the launch keeps its state in. */
export const theCrewsStateAMemberIsGiven = (state_root: string): Readonly<Record<string, string>> => ({ [STATE_HOME_VARIABLE]: dirname(state_root) })

/** Everything the environment of a member is built from: what it inherits, the gate's switches, the crew's state, its config folder. */
export interface AMembersEnvironment {
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly switches: HostSwitches
  readonly crew: TheCrewsState
  readonly member_config: string
  readonly host: Host
}

/**
 * The environment a member is handed (martha#683): what it inherits without the crew's state, the member's own config
 * folder over it, and the launcher's own state home last, so neither an inherited value nor a switch can point a member
 * at another state root.
 */
export function theEnvironmentAMemberIsGiven(asking: AMembersEnvironment): Record<string, string> {
  const kept = launchEnvironment(withoutTheCrewsState(asking.inherited, asking.crew), asking.switches, asking.host)
  return { ...kept, ...theMembersConfigEnvironment(asking.member_config), ...theCrewsStateAMemberIsGiven(asking.crew.state_root) }
}
