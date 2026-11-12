// `martha start <member>`: start one member of the declared crew on the config its owner approved (martha#98).
//
// This exists so an owner starts a member by its name, and never by building a launch by hand: the declaration
// (../declare_crew) is read once and names the member, Martha's state outside the checkout
// (../keep_martha_state_outside_the_checkout) holds its node id and the owner's approvals, and the launcher
// (../launch_a_claude_code_member) starts it on the owner's terminal.
//
// Before the launcher is asked, three things refuse a start by name, each with the command that fixes it: no
// declaration (martha init), a member the crew does not have (the crew's names), and a config the owner has not
// approved (martha approve). A config that is approved is named to the owner with when they approved it, so an
// approval they never gave is on their own screen before the member starts.
//
// It starts only on a terminal, as martha approve asks only on one: a member's shell tool runs with no terminal on
// its input, so a model that calls `martha start` to bring up a sibling is refused before anything is read. A speed
// bump, not a boundary (martha#1 decision 2).
//
// The owner's own arguments for the host pass only when every one is on SWITCHES_THAT_LOAD_NO_CONFIG
// (../pass_only_switches_that_load_no_config, which says why); any other word is refused by name before anything
// starts.
//
// The member's policy lets no node id hand it executable text: for the first release the owner relays every
// hand-off between members (martha#51 ruling), and a turn the owner types is host-attested as theirs.
//
// The strict shell gate is off unless the declaration names it (`house_rules.strict_gate`, martha#259): a member is a
// trusted helper by default, and the owner's safety is review plus a yes on every push. The switch is read here once,
// from the declaration, and handed to the launcher; no later slice reads a setting for it.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import process from 'node:process'

import type { StdioOptions } from 'node:child_process'
import { crewToolsOver } from '../a_crews_tools/a_crews_tools.ts'
import { handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import type { HandoverStampStore } from '../host_contract/host_contract.ts'
import type { CrewStore, DocumentStore } from '../host_contract/host_contract.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { DeclarationRefused, declareCrew, STRICT_GATE, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { CLAUDE_CODE_BASH_RESULT_SHAPES } from '../claude_code_host/claude_code_bash_results.ts'
import {
  CREW_ROW_PLACE,
  crewRowsDirectory,
  crewStateDirectory,
  crewSubdirectory,
  nodeIdsFor,
  PERMISSION_BITS,
  readApprovals,
  stateSubdirectory,
  STATE_DIRECTORY_MODE,
  ownWritesKeptForLaunch,
  pruneOwnWritesOfOldLaunches,
  type Approval,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import {
  CLAUDE_CODE,
  launchClaudeCodeMember,
  NOT_STARTED,
  type LauncherPlaces,
  type MemberStarted,
} from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import type { MemberRelayPlace } from '../launch_a_claude_code_member/answer_the_relay.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { carryingTo } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { turnsRaised } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { openKeptCommandShapes } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { RELAY_JOURNAL_PLACE } from '../launch_a_claude_code_member/keep_the_relays_journal.ts'
import { receiptsInMemory } from '../run_an_owner_signed_command/receipts.ts'
import { runAKeptShape } from '../run_an_owner_signed_command/run_a_signed_shape.ts'
import { signedRunsOf } from '../run_an_owner_signed_command/signed_runs.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { unpassedOwnerArgument } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { decideLaunch, fingerprintOf, readLaunchState, type SnapshotPlace } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** Why start starts nothing: its input is no terminal, as a member's shell tool's never is. */
export const NOT_A_TERMINAL =
  'martha start runs a member on your own terminal, and its input is not one. Run it yourself, in a terminal.'

/** The launcher's places, and where its approved snapshots go. */
export type MemberPlaces = LauncherPlaces & { readonly snapshot_root: string; readonly relay_journal: string }

/** The directories inside Martha's state that the launcher keeps a member's files in, in the order MemberPlaces names them. */
/** The directory inside Martha's state that holds the launcher's launch records. */
const LAUNCH_RECORDS_PLACE = 'launches'

/** Everything the launcher keeps per checkout: the rows are the crew's, not a checkout's (martha#254 R1). */
const STATE_PLACES = [LAUNCH_RECORDS_PLACE, 'snapshots', 'mesh-servers', RELAY_JOURNAL_PLACE] as const

/** Why the relay root may not hold a launch's socket, or undefined; made mode 0700 when missing. */
function closedRelayRoot(relay_root: string): string | undefined {
  if (fs.lstatSync(relay_root, { throwIfNoEntry: false }) === undefined) fs.mkdirSync(relay_root, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const found = fs.lstatSync(relay_root)
  const closed = found.isDirectory() && found.uid === process.getuid?.() && (found.mode & PERMISSION_BITS) === STATE_DIRECTORY_MODE
  return closed ? undefined : `${NOT_STARTED}: ${relay_root} is not a directory of this user's that only this user may enter.`
}

/** The launcher's places in Martha's state, and the relay root for its sockets; or why one cannot be used. */
export function launcherPlacesOf(state: MarthaState, relay_root: string, root: string): MemberPlaces | { readonly refusal: string } {
  const rows = crewRowsDirectory(state.state_root, root)
  if ('refusal' in rows) return rows
  const dashboard = crewSubdirectory(state.state_root, root, CREW_ROW_PLACE)
  if ('refusal' in dashboard) return dashboard
  const made = STATE_PLACES.map((name) => stateSubdirectory(state, name))
  const refused = made.find((place) => 'refusal' in place)
  if (refused !== undefined && 'refusal' in refused) return refused
  const [launch_records, snapshot_root, mesh_servers, relay_journal] = made.map((place) => ('path' in place ? place.path : ''))
  const unsafe = closedRelayRoot(relay_root)
  if (unsafe !== undefined) return { refusal: unsafe }
  return { rows: rows.path, dashboard: dashboard.path, launch_records: launch_records!, snapshot_root: snapshot_root!, mesh_servers: mesh_servers!, relay_journal: relay_journal!, relay_root }
}

export interface MemberStartRequest {
  /** The project's absolute path: where the member starts. */
  readonly root: string
  /** The owner's home: the launch gate reads no config at it or above it. */
  readonly home: string
  /** The member's name in the declaration. */
  readonly member: string
  /** The owner's own arguments for the host: only ../pass_only_switches_that_load_no_config's switches pass. */
  readonly args: readonly string[]
  /**
   * The one prompt Martha adds to the host's own arguments, after the owner's: what a woken member starts on
   * (../wake_a_member). Martha's, never the owner's, so it is not read by the switch rule above.
   */
  readonly initial_prompt?: string
  /** Whether the input start was run with is a terminal: a member's shell tool's never is. */
  readonly is_terminal: boolean
  readonly state: MarthaState
  readonly places: MemberPlaces
  /** The host's command: `claude`, or a path to it. */
  readonly command: string
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  readonly documents: DocumentStore
  /**
   * A test's ear on what the member's relay is handed (martha#259), so that the declaration's switch reaching the gate is
   * measured through the launcher rather than inferred from the line that passes it. A real start gives none.
   */
  readonly hear_relay_place?: (place: MemberRelayPlace) => void
  tellOwner(line: string): void
}

/** The declaration, or why there is none to start from. */
async function settingsOf(request: MemberStartRequest): Promise<CrewSettings | string> {
  try {
    return await declareCrew(request.documents, request.root)
  } catch (error) {
    if (!(error instanceof DeclarationRefused)) throw error
    const fix = error.field === null && error.message.endsWith('is missing') ? ' Run martha init to declare a crew here.' : ''
    return `${NOT_STARTED}: ${error.message}.${fix}`
  }
}

/** The approval the start is on, undefined when the checkout needs none, or why it may not start. */
function approvalInUse(request: MemberStartRequest, approvals: readonly Approval[]): Approval | undefined | string {
  const place = { host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home }
  // Each approval is read under the tree it approved, which is the only source of the attributes a checkout is read
  // with (martha#167): a checkout whose attributes changed since an approval reads back as another tree.
  for (const approval of approvals) {
    const under = readLaunchState(place, thisMachine, approval.tree ?? undefined)
    if (decideLaunch({ host: CLAUDE_CODE, ...under, approved_fingerprints: [approval.fingerprint] }).allow) return approval
  }
  const launch = readLaunchState(place, thisMachine)
  const fingerprint = fingerprintOf(launch)
  if (decideLaunch({ host: CLAUDE_CODE, ...launch, approved_fingerprints: [] }).allow) return undefined
  const unapproved = decideLaunch({ host: CLAUDE_CODE, ...launch, approved_fingerprints: [fingerprint] }).allow
  if (!unapproved) return undefined
  const present = launch.entries.filter((entry) => entry.kind !== 'absent').map((entry) => entry.path)
  return `${NOT_STARTED}: this checkout holds config that starts code by itself (${present.join(', ')}), and you have not approved it as it is now. Run martha approve, read what it shows, and answer yes.`
}

/** Everything a start needs before the launcher is asked, or why it may not start. */
async function readyToStart(request: MemberStartRequest): Promise<{ readonly node_id: string; readonly model: string | null; readonly approval: Approval | undefined; readonly strict_gate: boolean } | string> {
  if (!request.is_terminal) return NOT_A_TERMINAL
  const unpassed = unpassedOwnerArgument(request.args)
  if (unpassed !== undefined) return `${NOT_STARTED}: ${unpassed}`
  const settings = await settingsOf(request)
  if (typeof settings === 'string') return settings
  const member = settings.members.find((candidate) => candidate.name === request.member)
  const names = settings.members.map((candidate) => candidate.name)
  if (member === undefined) return `${NOT_STARTED}: ${request.member} is not on this crew (its members are ${names.join(', ')}).`
  const ids = nodeIdsFor(request.state, names)
  if ('refusal' in ids) return `${NOT_STARTED}: ${ids.refusal}`
  const kept = readApprovals(request.state)
  if ('refusal' in kept) return `${NOT_STARTED}: ${kept.refusal}`
  const approval = approvalInUse(request, kept.approvals)
  if (typeof approval === 'string') return approval
  return { node_id: ids.ids[member.name]!, model: member.model, approval, strict_gate: settings.house_rules[STRICT_GATE] }
}

/**
 * What the member is started on: the approval's fingerprint, and what its own writes are checked against while it
 * runs (martha#132), each launch named afresh so no other launch's writes pass, and kept in a file of its own
 * (martha#162). None when the checkout needs none.
 */
export function approvedPlace(request: MemberStartRequest, approval: Approval | undefined): Pick<SnapshotPlace, 'approved_fingerprints' | 'approved_tree' | 'since_approval'> {
  if (approval === undefined) return { approved_fingerprints: [] }
  const launch_id = randomUUID()
  return {
    approved_fingerprints: [approval.fingerprint],
    ...(approval.tree === null ? {} : { approved_tree: approval.tree }),
    since_approval: {
      approved: { entries: approval.entries, tree: approval.tree },
      member: request.member,
      own_writes: ownWritesKeptForLaunch(request.state, launch_id),
      launch_id,
    },
  }
}

/**
 * The shape names the owner has signed for this project, as the kept list opens now; none when it does not open
 * trusted, so a list that cannot be vouched for keeps no shell (martha#129).
 */
function signedShapeNames(state: MarthaState): readonly string[] {
  const opened = openKeptCommandShapes(state, new Date())
  return opened.trusted ? opened.shapes.map((shape) => shape.name) : []
}

/**
 * The crew's own store for this launch (martha#254 R1, #255): a member's park marker and the handovers a wake reads.
 * A crew directory that is not this user's own is answered as a store that refuses every place, so a tool that needed
 * it says why rather than writing somewhere else.
 */
function theCrewStore(state: MarthaState, root: string): CrewStore {
  const crew = crewStateDirectory(state.state_root, root)
  return 'refusal' in crew ? { place: () => crew } : crewFilesDirectory(crew.path)
}

/**
 * The stamps this crew's handovers carry (martha#255): the host's record of which it wrote, when, and for which member.
 * A crew directory that is not this user's own is answered as a store that refuses both ways, so the handover tool
 * says why instead of writing a file nothing stamped.
 */
function theHandoverStamps(state: MarthaState, root: string): HandoverStampStore {
  const crew = crewStateDirectory(state.state_root, root)
  return 'refusal' in crew ? { read: () => crew, write: () => crew } : handoverStampsIn(crew.path)
}

/** Starts the named member of the crew declared at `root`, on the config its owner approved. */
export async function startMember(request: MemberStartRequest): Promise<MemberStarted> {
  const ready = await readyToStart(request)
  if (typeof ready === 'string') {
    request.tellOwner(ready)
    return { started: false, refusal: ready }
  }
  if (ready.approval !== undefined) {
    request.tellOwner(`Starting ${request.member} on the config you approved at ${ready.approval.approved_at} (fingerprint ${ready.approval.fingerprint}).`)
    for (const unremoved of pruneOwnWritesOfOldLaunches(request.state)) request.tellOwner(unremoved)
  }
  const { snapshot_root, ...places } = request.places
  // One raising for this launch, and one channel carrier over it: the carrier hears every turn the host takes in, so
  // a message counts as taken in only when the host raised it back (martha#253).
  const turns = turnsRaised()
  const channel = { clock: { now: () => Date.now() }, stores: { rows: rowStreamsDirectory(request.places.rows) } }
  return launchClaudeCodeMember({
    member_name: request.member,
    node_id: ready.node_id,
    place: { host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home, snapshot_root, ...approvedPlace(request, ready.approval) },
    policy: { may_send_executable_text: [] },
    strict_gate: ready.strict_gate,
    places,
    command: request.command,
    args: [...(ready.model === null ? [] : ['--model', ready.model]), ...request.args, ...(request.initial_prompt === undefined ? [] : [request.initial_prompt])],
    inherited: request.inherited,
    stdio: request.stdio,
    tellOwner: (line) => request.tellOwner(line),
    ...(request.hear_relay_place === undefined ? {} : { hearRelayPlace: request.hear_relay_place }),
    turns,
    crew_tools: (sessions) =>
      crewToolsOver({
        member: request.member,
        ledger: channel,
        beats: dashboardRowsIn(request.places.dashboard),
        root: request.root,
        documents: request.documents,
        stores: { crew: theCrewStore(request.state, request.root) },
        carrier: carryingTo({ member: request.member, host: channel, turns }),
        sessions,
        // The stamps the host keeps its handovers with (martha#255), under the same crew directory: a handover one
        // session writes is the one its successor inherits.
        stamps: theHandoverStamps(request.state, request.root),
      }),
    signed_runs: signedRunsOf(
      receiptsInMemory(),
      (name) => runAKeptShape(request.state, request.root, request.inherited, name, new Date()),
      // The names the owner has signed now, read when an answer is judged: a list replaced mid-session takes effect
      // on the next run, and one that no longer opens leaves nothing to keep the shell for (martha#129).
      () => signedShapeNames(request.state),
      CLAUDE_CODE_BASH_RESULT_SHAPES,
    ),
  })
}
