// `martha start <member>`: start one member of the declared crew on the config its owner approved (martha#98).
//
// This exists so an owner starts a member by its name, and never by building a launch by hand: the declaration
// (../declare_crew) is read once and names the member, Martha's state outside the checkout
// (../keep_martha_state_outside_the_checkout) holds its node id and the owner's approvals, and the host the
// declaration names for the member (../start_the_member_on_its_host) starts it on the owner's terminal.
//
// Before a launcher is asked, things refuse a start by name, each with the command that fixes it: no declaration
// (martha init), a member the crew does not have (the crew's names), a host this release cannot start or a host whose
// command is not installed (martha#541, #547), and a config the owner has not approved (martha approve). A config that
// is approved is named to the owner with when they approved it, so an approval they never gave is on their own screen
// before the member starts.
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

import fs from 'node:fs'
import process from 'node:process'

import type { StdioOptions } from 'node:child_process'
import { handoverStampsIn, keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { readingOnly, type CrewStore, type DocumentStore, type HandoverStampStore, type RowStore } from '../host_contract/host_contract.ts'
import { LIFECYCLE_PLACE, watchForAStop, type StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { launchesIn } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { GATE_AUDIT_PLACE } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import { THE_BELLS_PLACE } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { DeclarationRefused, declareCrewOnHosts, theHostOfMember, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { crewTextFilesOf } from '../hand_a_member_its_crew_text/hand_a_member_its_crew_text.ts'
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
  pruneOwnWritesOfOldLaunches,
  type Approval,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { HOOK_SETTINGS_CHECK_MS, type LauncherPlaces, type MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { NOT_STARTED } from '../end_a_launch/end_a_launch.ts'
import type { MemberRelayPlace } from '../answer_the_relay/answer_the_relay.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { RELAY_JOURNAL_PLACE } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { unpassedOwnerArgument } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { theApprovalInUse } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { THE_VOCABULARIES_OF_HOST, theStartOfAMember, type AHostsLauncher } from '../start_the_member_on_its_host/start_the_member_on_its_host.ts'

/**
 * Why start starts nothing: its input is no terminal. A member's shell tool has none, but a member that sets out to can
 * make one of its own, so this is a speed bump, not a wall (martha#619): the refusal from inside a member stands beside it.
 */
export const NOT_A_TERMINAL =
  'martha start runs a member on your own terminal, and its input is not one. Run it yourself, in a terminal.'

/** The launcher's places, and where its approved snapshots go. */
export type MemberPlaces = LauncherPlaces & { readonly snapshot_root: string; readonly relay_journal: string }

/** The directories inside Martha's state that the launcher keeps a member's files in, in the order MemberPlaces names
 * them: the rows are the crew's, not a checkout's (martha#254 R1). */
const STATE_PLACES = [THE_PLACES_A_STATE_ROOT_KEEPS.records_place, 'snapshots', 'mesh-servers', RELAY_JOURNAL_PLACE] as const

/** Why the relay root may not hold a launch's socket, or undefined; made mode 0700 when missing. */
function closedRelayRoot(relay_root: string): string | undefined {
  if (fs.lstatSync(relay_root, { throwIfNoEntry: false }) === undefined) fs.mkdirSync(relay_root, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const found = fs.lstatSync(relay_root)
  return found.isDirectory() && found.uid === process.getuid?.() && (found.mode & PERMISSION_BITS) === STATE_DIRECTORY_MODE ? undefined : `${NOT_STARTED}: ${relay_root} is not a directory of this user's that only this user may enter.`
}

/** The launcher's places in Martha's state, and the relay root for its sockets; or why one cannot be used. */
export function launcherPlacesOf(state: MarthaState, relay_root: string, root: string): MemberPlaces | { readonly refusal: string } {
  const rows = crewRowsDirectory(state.state_root, root)
  if ('refusal' in rows) return rows
  // The crew's own folders a launch keeps — the dashboard's row, the gate's audit folder (martha#321) and the owner's
  // mutes of a member's bells (martha#371) — then the places this checkout keeps in Martha's state.
  const made = [crewSubdirectory(state.state_root, root, CREW_ROW_PLACE), crewSubdirectory(state.state_root, root, GATE_AUDIT_PLACE), crewSubdirectory(state.state_root, root, THE_BELLS_PLACE), ...STATE_PLACES.map((name) => stateSubdirectory(state, name))]
  const refused = made.find((place) => 'refusal' in place)
  if (refused !== undefined && 'refusal' in refused) return refused
  const [dashboard, gate_audit, bells, launch_records, snapshot_root, mesh_servers, relay_journal] = made.map((place) => ('path' in place ? place.path : ''))
  const unsafe = closedRelayRoot(relay_root)
  if (unsafe !== undefined) return { refusal: unsafe }
  return { rows: rows.path, dashboard: dashboard!, gate_audit: gate_audit!, bells: bells!, launch_records: launch_records!, snapshot_root: snapshot_root!, mesh_servers: mesh_servers!, relay_journal: relay_journal!, relay_root, state_root: state.state_root }
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
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  readonly documents: DocumentStore
  /**
   * A test's ear on what the member's relay is handed (martha#259), so that the declaration's switch reaching the gate is
   * measured through the launcher rather than inferred from the line that passes it. A real start gives none.
   */
  readonly hear_relay_place?: (place: MemberRelayPlace) => void
  /** The owner's lines at an engine member's tab (martha#927 part 2): a test's own; a real start gives none. */
  readonly owners_lines?: NodeJS.ReadableStream
  /** Called each time the member's relay reports its session started (martha#919): where a first prompt is typed in. */
  readonly hear_session_start?: () => void
  tellOwner(line: string): void
}

/** The declaration, or why there is none to start from. */
async function settingsOf(request: MemberStartRequest): Promise<CrewSettings | string> {
  try {
    return await declareCrewOnHosts(request.documents, request.root, THE_VOCABULARIES_OF_HOST)
  } catch (error) {
    if (!(error instanceof DeclarationRefused)) throw error
    const fix = error.field === null && error.message.endsWith('is missing') ? ' Run martha init to declare a crew here.' : ''
    return `${NOT_STARTED}: ${error.message}.${fix}`
  }
}


/** Everything a start needs before the launcher is asked, or why it may not start. */
async function readyToStart(request: MemberStartRequest): Promise<{ readonly node_id: string; readonly model: string | null; readonly approval: Approval | undefined; readonly settings: CrewSettings; readonly launcher: AHostsLauncher; readonly command: string } | string> {
  if (!request.is_terminal) return NOT_A_TERMINAL
  const unpassed = unpassedOwnerArgument(request.args)
  if (unpassed !== undefined) return `${NOT_STARTED}: ${unpassed}`
  const settings = await settingsOf(request)
  if (typeof settings === 'string') return settings
  const member = settings.members.find((candidate) => candidate.name === request.member)
  const names = settings.members.map((candidate) => candidate.name)
  if (member === undefined) return `${NOT_STARTED}: ${request.member} is not on this crew (its members are ${names.join(', ')}).`
  // The host the declaration names for this member (martha#541): its launcher, or the refusal naming what this release
  // has, comes before anything else is read, so a crew naming a host this release cannot start learns that first.
  const host = theHostOfMember(settings, member)
  const start = theStartOfAMember(host, request.inherited, member, settings, request.args)
  if (typeof start === 'string') return start
  const ids = nodeIdsFor(request.state, names)
  if ('refusal' in ids) return `${NOT_STARTED}: ${ids.refusal}`
  const kept = readApprovals(request.state)
  if ('refusal' in kept) return `${NOT_STARTED}: ${kept.refusal}`
  // The crew's own text files are read as entries of the approval (martha#306), so the approval in use is asked about
  // the same files the launch will read, under the member's own host (martha#541).
  const inUse = theApprovalInUse({ host, launch_dir: request.root, stop_dir: request.home, crew_text_files: crewTextFilesOf(settings) }, kept.approvals, thisMachine)
  // What the owner reads when the checkout holds a config nobody approved: the entries, and the command that fixes it.
  if ('needs_approval' in inUse) {
    return `${NOT_STARTED}: this checkout holds config that starts code by itself (${inUse.needs_approval.join(', ')}), and you have not approved it as it is now. Run martha approve, read what it shows, and answer yes.`
  }
  return { node_id: ids.ids[member.name]!, model: member.model, approval: inUse.approval, settings, launcher: start.launcher, command: start.command }
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
  return { crew: keepTheCrewsFilesAsDirectories(crew.path), stamps: handoverStampsIn(crew.path) }
}

/**
 * Where a stop or a restart of this crew's members is asked (martha#312): the crew's lifecycle requests, the launcher's
 * records as the binder reads them, and the ledger. The owner's verbs and a member's restart tool ask through it alike.
 */
export function stoppingHostOn(places: { readonly launcher: MemberPlaces; readonly crew: string }): StoppingHost {
  return {
    stores: { lifecycle: keepTheCrewsFilesAsDirectories(places.crew).place(LIFECYCLE_PLACE), rows: rowStreamsDirectory(places.launcher.rows) },
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
 * Starts the named member of the crew declared at `root`, on the config its owner approved, on the host the
 * declaration names for it (martha#541): the entry for that host is asked, with what the preflight gathered.
 */
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
  // One channel for this launch: its carrier counts a handed message taken in when the mod reports the member's next
  // main turn started (martha#253), and the watch for a stop of this member reads the same rows.
  const channel = { clock: { now: () => Date.now() }, stores: { rows: rowStreamsDirectory(request.places.rows) } }
  const started = await ready.launcher.start({
    member: request.member,
    node_id: ready.node_id,
    model: ready.model,
    approval: ready.approval,
    settings: ready.settings,
    root: request.root,
    home: request.home,
    args: request.args,
    prompt: request.initial_prompt,
    inherited: request.inherited,
    stdio: request.stdio,
    documents: request.documents,
    state: request.state,
    places,
    snapshot_root,
    crew_stores: theCrewsStores(request.state, request.root),
    restart: theRestartPlaceOf(request),
    command: ready.command,
    channel,
    ...(request.hear_relay_place === undefined ? {} : { hear_relay_place: request.hear_relay_place }),
    ...(request.owners_lines === undefined ? {} : { owners_lines: request.owners_lines }),
    ...(request.hear_session_start === undefined ? {} : { hear_session_start: request.hear_session_start }),
    tellOwner: (line) => request.tellOwner(line),
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
