// The environment a launched member is given (martha#683).
//
// A member inherits the environment of whatever started it — the owner's shell, or a test's own process — and that
// environment may name a crew's state: the state home a root sits in, a path inside the root, or a session id the crew
// has recorded. A test process holding a real member's state must not pass it on to what it launches, so the member is
// handed none of it: the rule is the slice's (../refuse_launch_of_unapproved_config/the_crews_state_a_member_is_kept_out_of),
// and what this composes for it is what only a host adapter can read — where the root the launching process names is,
// how a home's state root is found, and which sessions the crew has recorded: one append-only stream per session under
// its rows place, named and decoded by the row store's own names (../row_streams_directory).
//
// It is handed no variable kitty sets for the programs it starts either (#572 T6, #547 S6): a member run in a kitty tab
// must not find that kitty's remote-control line or window. And, being handed the owner's sign-in, it is handed no
// API key (martha#916, ../give_a_member_its_own_config): taken out last, so no inherited value, switch or later layer
// puts it back.
//
// The environment is built in this order: what it inherits without the crew's state or kitty's, the gate's switches, the member's
// own config folder, and the launcher's own state home last, so neither an inherited value nor a switch can point a
// member at another state root.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { stateRootOf } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { withoutKittysVariables } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { makeTheMembersConfig, NOT_GIVEN_WITH_THE_SIGN_IN, theMembersConfigEnvironment } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { CREWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { streamOfDirectoryName } from '../row_streams_directory/row_streams_directory.ts'
import { SESSION_RECORD_STREAM } from '../session_records_in_rows/session_records_in_rows.ts'
import {
  STATE_HOME_VARIABLE,
  theCrewsStateAMemberIsGiven,
  withoutTheCrewsState,
  type TheCrewsState,
} from '../refuse_launch_of_unapproved_config/the_crews_state_a_member_is_kept_out_of.ts'

import { launchEnvironment, type Host, type HostSwitches } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** The session id a stream directory under the crew's rows holds, or undefined for any other stream. */
function theSessionIn(entry: string): string | undefined {
  const stream = streamOfDirectoryName(entry)
  return stream !== undefined && stream.startsWith(SESSION_RECORD_STREAM) ? stream.slice(SESSION_RECORD_STREAM.length) : undefined
}

/** The session ids a crew has recorded: one append-only stream per session under its rows place. */
function sessionIdsRecordedIn(rows: string): ReadonlySet<string> {
  try {
    return new Set(readdirSync(rows).flatMap((entry) => {
      const session = theSessionIn(entry)
      return session === undefined ? [] : [session]
    }))
  } catch {
    // No rows place yet, or one this user cannot read: then the crew has recorded no session a member could be handed.
    return new Set()
  }
}

/**
 * Every place a crew's state is known to sit in for a member being launched: the launch's own root and rows, and the
 * root the launching process names with that root's crews place, where another crew's rows sit.
 */
function theCrewsStateKnownTo(state_root: string, rows: string, named_root: string): readonly string[] {
  return [state_root, rows, named_root, join(named_root, CREWS_PLACE)]
}

/** Everything the environment of a member is built from: what it inherits, the gate's switches, the crew's state, its config folder. */
export interface AMembersEnvironment {
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly switches: HostSwitches
  readonly crew: TheCrewsState
  readonly member_config: string
  readonly host: Host
}

/** The environment a member is handed (martha#683), composed as the header says. */
export function theEnvironmentAMemberIsGiven(asking: AMembersEnvironment): Record<string, string> {
  const named = stateRootOf(asking.inherited.HOME ?? '', asking.inherited[STATE_HOME_VARIABLE])
  const kept = withoutTheCrewsState(asking.inherited, {
    places: theCrewsStateKnownTo(asking.crew.state_root, asking.crew.rows, named),
    session_ids: sessionIdsRecordedIn(asking.crew.rows),
  })
  const composed = {
    ...launchEnvironment(withoutKittysVariables(kept), asking.switches, asking.host),
    ...theMembersConfigEnvironment(asking.member_config),
    ...theCrewsStateAMemberIsGiven(asking.crew.state_root),
  }
  return Object.fromEntries(Object.entries(composed).filter(([name]) => !NOT_GIVEN_WITH_THE_SIGN_IN.includes(name)))
}

/** What a member starts with beside its environment: the approved checkout it works in, and the skills that checkout carries. */
export interface AMembersStart extends AMembersEnvironment {
  readonly checkout: string
  readonly skills: Readonly<Record<string, Uint8Array>>
}

/** The environment a member is handed, with its own config folder made for it; or why that folder could not be made. */
export function giveAMemberItsStart(asking: AMembersStart): Record<string, string> | string {
  const env = theEnvironmentAMemberIsGiven(asking)
  const made = makeTheMembersConfig(asking.member_config, asking.checkout, asking.skills)
  return made.made ? env : made.refusal
}
