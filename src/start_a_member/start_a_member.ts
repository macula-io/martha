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
// What the shell gate does to a member is off unless the declaration names it (`gate_enforces`, `gate_audits`, and the
// old `strict_gate` for one upgrade; martha#321, #259): a member is a trusted helper by default, and the owner's safety
// is review plus a yes on every push. The declaration is read here once, by ../read_the_gate_mode, and the launcher
// asks it for this member's mode; no later slice reads a setting for it.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

import type { StdioOptions } from 'node:child_process'
import { crewToolsOver } from '../a_crews_tools/a_crews_tools.ts'
import { handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import type { HandoverStampStore, Refused } from '../host_contract/host_contract.ts'
import type { CrewStore, DocumentStore, RowStore } from '../host_contract/host_contract.ts'
import { LIFECYCLE_PLACE, watchForAStop, type StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { launchesIn } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { readingOnly } from '../host_contract/host_contract.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { GATE_AUDIT_PLACE } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import { DeclarationRefused, declareCrew, OWNER_BELL, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { crewTextFilesOf } from '../hand_a_member_its_crew_text/hand_a_member_its_crew_text.ts'
import { CLAUDE_CODE_BASH_RESULT_SHAPES } from '../claude_code_host/claude_code_bash_results.ts'
import { CLAUDE_CODE_MODELS, CLAUDE_CODE_SUBAGENT_SPAWN } from '../claude_code_host/claude_code_host.ts'
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
  HOOK_SETTINGS_CHECK_MS,
  launchClaudeCodeMember,
  NOT_STARTED,
  type LauncherPlaces,
  type MemberStarted,
} from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import type { MemberRelayPlace } from '../launch_a_claude_code_member/answer_the_relay.ts'
import { userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'
import { ownersSettingsIn } from '../owners_settings_directory/owners_settings_directory.ts'
import { finishTheOwnersDefaultAtLaunch, type OwnersDefaultPlace } from '../put_the_owners_model_back/put_the_owners_model_back.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
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
import { theApprovalInUse, type SnapshotPlace } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

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
  // The crew's own folders a launch keeps — the dashboard's row, and the gate's audit folder (martha#321) — then the
  // places this checkout keeps in Martha's state.
  const made = [crewSubdirectory(state.state_root, root, CREW_ROW_PLACE), crewSubdirectory(state.state_root, root, GATE_AUDIT_PLACE), ...STATE_PLACES.map((name) => stateSubdirectory(state, name))]
  const refused = made.find((place) => 'refusal' in place)
  if (refused !== undefined && 'refusal' in refused) return refused
  const [dashboard, gate_audit, launch_records, snapshot_root, mesh_servers, relay_journal] = made.map((place) => ('path' in place ? place.path : ''))
  const unsafe = closedRelayRoot(relay_root)
  if (unsafe !== undefined) return { refusal: unsafe }
  return { rows: rows.path, dashboard: dashboard!, gate_audit: gate_audit!, launch_records: launch_records!, snapshot_root: snapshot_root!, mesh_servers: mesh_servers!, relay_journal: relay_journal!, relay_root }
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
    return await declareCrew(request.documents, request.root, CLAUDE_CODE_MODELS)
  } catch (error) {
    if (!(error instanceof DeclarationRefused)) throw error
    const fix = error.field === null && error.message.endsWith('is missing') ? ' Run martha init to declare a crew here.' : ''
    return `${NOT_STARTED}: ${error.message}.${fix}`
  }
}


/** Everything a start needs before the launcher is asked, or why it may not start. */
async function readyToStart(request: MemberStartRequest): Promise<{ readonly node_id: string; readonly model: string | null; readonly approval: Approval | undefined; readonly settings: CrewSettings } | string> {
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
  // The crew's own text files are read as entries of the approval (martha#306), so the approval in use is asked about
  // the same files the launch will read.
  const inUse = theApprovalInUse({ host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home, crew_text_files: crewTextFilesOf(settings) }, kept.approvals, thisMachine)
  // What the owner reads when the checkout holds a config nobody approved: the entries, and the command that fixes it.
  if ('needs_approval' in inUse) {
    return `${NOT_STARTED}: this checkout holds config that starts code by itself (${inUse.needs_approval.join(', ')}), and you have not approved it as it is now. Run martha approve, read what it shows, and answer yes.`
  }
  return { node_id: ids.ids[member.name]!, model: member.model, approval: inUse.approval, settings }
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
 * The two stores a crew's own directory holds (martha#254 R1, #255): the places its tools keep files in — a member's
 * park marker, the handovers a wake reads — and the stamps a handover carries. A crew directory that is not this
 * user's own is answered as stores that refuse both ways, so a tool that needed one says why rather than writing a
 * file nothing stamped.
 */
function theCrewsStores(state: MarthaState, root: string): { readonly crew: CrewStore; readonly stamps: HandoverStampStore } {
  const crew = crewStateDirectory(state.state_root, root)
  if ('refusal' in crew) return { crew: { place: () => crew }, stamps: { read: () => crew, write: () => crew } }
  return { crew: crewFilesDirectory(crew.path), stamps: handoverStampsIn(crew.path) }
}

/**
 * Where the owner's own default for new sessions lives, and where the one lock that guards it is kept (martha#359): from
 * the host's own answer about which settings file it reads, made once in ../claude_code_host (martha#65, martha#75), so
 * a config directory the host refuses is refused here by that same line rather than by a second opinion.
 */
function ownersDefaultPlaceOf(request: MemberStartRequest): OwnersDefaultPlace | Refused {
  const settings = userSettingsPath(request.inherited)
  return 'refusal' in settings
    ? settings
    : { config_dir: dirname(settings.path), file: settings.path, store: ownersSettingsIn(settings.path, request.state.state_root) }
}

/**
 * Where a stop or a restart of this crew's members is asked (martha#312): the crew's lifecycle requests, the launcher's
 * records as the binder reads them, and the ledger. The owner's verbs and a member's restart tool ask through it alike.
 */
export function stoppingHostOn(places: { readonly launcher: MemberPlaces; readonly crew: string }): StoppingHost {
  return {
    stores: { lifecycle: crewFilesDirectory(places.crew).place(LIFECYCLE_PLACE), rows: rowStreamsDirectory(places.launcher.rows) },
    launches: () => launchesIn(readingOnly(launchRecordsDirectory(places.launcher.launch_records))),
    processes: thisMachine.processes,
    clock: { now: () => Date.now() },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

/** The place a member's restart tool asks through; none when the crew's directory is not this user's own. */
function theRestartPlaceOf(request: MemberStartRequest): { readonly lifecycle?: StoppingHost } {
  const crew = crewStateDirectory(request.state.state_root, request.root)
  return 'refusal' in crew ? {} : { lifecycle: stoppingHostOn({ launcher: request.places, crew: crew.path }) }
}

/**
 * Where the owner's default lives, after finishing any switch a killed launch left unfinished (martha#359, step 7): the
 * owner's file must be right before any new session reads it, and the line that needs the owner goes to the terminal.
 */
async function finishAnySwitchBeforeTheHostStarts(request: MemberStartRequest, crewStores: ReturnType<typeof theCrewsStores>): Promise<OwnersDefaultPlace | Refused> {
  const owners = ownersDefaultPlaceOf(request)
  for (const told of await finishTheOwnersDefaultAtLaunch({ member: request.member, host: { stores: { crew: crewStores.crew } }, owners, beats: dashboardRowsIn(request.places.dashboard) })) request.tellOwner(told)
  return owners
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
  const crewStores = theCrewsStores(request.state, request.root)
  const owners = await finishAnySwitchBeforeTheHostStarts(request, crewStores)
  // One raising for this launch, and one channel carrier over it: the carrier hears every turn the host takes in, so
  // a message counts as taken in only when the host raised it back (martha#253).
  const turns = turnsRaised()
  const channel = { clock: { now: () => Date.now() }, stores: { rows: rowStreamsDirectory(request.places.rows) } }
  const started = await launchClaudeCodeMember({
    member_name: request.member,
    node_id: ready.node_id,
    place: { host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home, snapshot_root, crew_text_files: crewTextFilesOf(ready.settings), ...approvedPlace(request, ready.approval) },
    policy: { may_send_executable_text: [] },
    crew_settings: ready.settings,
    owner_bell: ready.settings.house_rules[OWNER_BELL],
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
        stores: { crew: crewStores.crew },
        carrier: carryingTo({ member: request.member, host: channel, turns }),
        sessions,
        // The stamps the host keeps its handovers with (martha#255), under the same crew directory: a handover one
        // session writes is the one its successor inherits.
        stamps: crewStores.stamps,
        // The five tools that act run git and gh through the launcher's own processes, over the declaration's
        // workspace places: nothing that acts runs inside the member's session (martha#256).
        processes: thisMachine.processes,
        settings: ready.settings,
        models: CLAUDE_CODE_MODELS,
        launched_on: ready.model ?? '',
        spawn: CLAUDE_CODE_SUBAGENT_SPAWN,
        owners_settings: owners, // the owner's own settings file, and the lock that guards it (martha#359)
        ...theRestartPlaceOf(request),
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
  if (started.started) watchForAStopOf(request, started, channel)
  return started
}

/**
 * The launcher's watch for a stop asked of this member (martha#312), on the launcher's own tick, for as long as it runs.
 * A member already gone by the time its identity is read has nothing to watch.
 */
function watchForAStopOf(request: MemberStartRequest, started: Extract<MemberStarted, { started: true }>, channel: { readonly clock: { now(): number }; readonly stores: { readonly rows: RowStore } }): void {
  const process_started_at = thisMachine.processes.identityOf(started.pid)
  if (process_started_at === null) return
  watchForAStop(
    { stores: { lifecycle: theCrewsStores(request.state, request.root).crew.place(LIFECYCLE_PLACE), rows: channel.stores.rows }, processes: thisMachine.processes, clock: channel.clock },
    { member: request.member, launch: { pid: started.pid, process_started_at }, stop: started.stop, stopped: started.stopped, tellOwner: (line) => request.tellOwner(line) },
    HOOK_SETTINGS_CHECK_MS,
  )
}
