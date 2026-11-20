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
// must not find that kitty's remote-control line or window. And it is handed one credential, the one its billing picks
// (martha#916, ../give_a_member_its_own_config): the other is taken out last, so no inherited value, switch or later
// layer puts it back.
//
// When the crew declares no billing, the launch asks the host whether the owner is signed in, before anything of the
// member is made: the host binary the command resolves to on the launcher's PATH, asked `auth status --json` in the
// launcher's environment without the key and with the sign-in store variable set and empty (what a member billed by
// the subscription is handed), and a config folder of the question's own, made new and removed after. A host that
// cannot be found, an exit that is not 0, an answer that does not come within the host's answer timeout, or one that
// does not parse, is an untold sign-in, and the member is billed by the subscription. The owner is told the billing
// and why whenever it is not the usual one, a signed-in owner's subscription.
//
// The environment is built in this order: what it inherits without the crew's state or kitty's, the gate's switches, the member's
// own config folder, and the launcher's own state home last, so neither an inherited value nor a switch can point a
// member at another state root.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { API_KEY_VARIABLE, resolvedHostCommand, theSignInTheHostSays, type TheSignIn } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { BILLED_BY_API_KEY, BILLED_BY_SUBSCRIPTION, type Billing } from '../declare_crew/declare_crew.ts'

import { stateRootOf } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { withoutKittysVariables } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { makeTheMembersConfig, notGivenUnder, theBillingAMemberGets, theMembersConfigEnvironment } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
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
  /** The credential the member is billed by (martha#916). */
  readonly billing: Billing
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
    ...theMembersConfigEnvironment(asking.member_config, asking.billing),
    ...theCrewsStateAMemberIsGiven(asking.crew.state_root),
  }
  const notGiven = notGivenUnder(asking.billing)
  return Object.fromEntries(Object.entries(composed).filter(([name]) => !notGiven.includes(name)))
}

/** What a member starts with beside its environment: the approved checkout it works in, and the skills that checkout carries. */
export interface AMembersStart extends AMembersEnvironment {
  readonly checkout: string
  readonly skills: Readonly<Record<string, Uint8Array>>
}

/**
 * The environment a member is handed, with its own config folder made for it; or why not: a member billed by the key
 * whose launcher carries none, or a folder that could not be made.
 */
export function giveAMemberItsStart(asking: AMembersStart): Record<string, string> | string {
  const env = theEnvironmentAMemberIsGiven(asking)
  const billedKey = asking.billing === BILLED_BY_API_KEY ? env[API_KEY_VARIABLE] : undefined
  if (asking.billing === BILLED_BY_API_KEY && (billedKey === undefined || billedKey === '')) {
    return `the crew bills its members by ${BILLED_BY_API_KEY}, and the launcher's environment carries no ${API_KEY_VARIABLE}`
  }
  const made = makeTheMembersConfig(asking.member_config, asking.checkout, billedKey, asking.skills)
  return made.made ? env : made.refusal
}

/** What the billing of a launch is read from: the crew's declared billing, the launcher's environment and command. */
export interface ALaunchesBilling {
  readonly declared: Billing | null
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly command: string
  readonly cwd: string
}

/** The billing a launch gives its member, and the line the owner is told when the crew declares none. */
export interface TheBillingOfALaunch {
  readonly billing: Billing
  readonly told: string | undefined
}

/** Asks the host the command resolves to whether the owner is signed in, as the header says; never rejects. */
async function theOwnersSignIn(asking: ALaunchesBilling): Promise<TheSignIn> {
  const resolved = resolvedHostCommand(asking.command, asking.inherited.PATH, asking.cwd)
  if ('refusal' in resolved) return { untold: resolved.refusal }
  const folder = mkdtempSync(join(tmpdir(), 'martha-sign-in-question-'))
  try {
    const kept = Object.entries(asking.inherited).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== API_KEY_VARIABLE)
    const env = { ...Object.fromEntries(kept), ...theMembersConfigEnvironment(folder, BILLED_BY_SUBSCRIPTION) }
    return await theSignInTheHostSays(resolved.binary, env, asking.cwd)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/** The billing of a launch (martha#916): the declared one, else the one the owner's sign-in and the launcher's key give. */
export async function theBillingOfALaunch(asking: ALaunchesBilling): Promise<TheBillingOfALaunch> {
  if (asking.declared !== null) return { billing: asking.declared, told: undefined }
  const signIn = await theOwnersSignIn(asking)
  const key = asking.inherited[API_KEY_VARIABLE]
  const billing = theBillingAMemberGets(null, signIn, key !== undefined && key !== '')
  // The usual start -- a signed-in owner, billed by the subscription -- is told nothing; a member billed by the key,
  // or a sign-in the host could not tell, is.
  if ('signed_in' in signIn && signIn.signed_in) return { billing, told: undefined }
  const why = 'untold' in signIn ? `the host could not say whether the owner is signed in (${signIn.untold})` : 'the owner is not signed in'
  return { billing, told: `The crew declares no billing; ${why}, so the member is billed by ${billing}.` }
}
