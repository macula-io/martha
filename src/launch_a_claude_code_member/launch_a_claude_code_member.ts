// The launcher of one Claude Code member (#41, on #16's launch gate).
//
// This exists so a member runs only on the config the owner approved, with its
// every prompt and tool call answered by the core, and so the launcher can stop
// it whole when the checkout stops matching what was approved.
//
// A hooks module cannot run the core (it has no Node), so the core runs here,
// and the member's relay (../claude_code_relay) asks it over a Unix socket made
// for this launch alone. In order:
//
//   1. `prepareLaunch`, then the mesh server version the approved server config
//      installs, which must be a recorded one (martha#49), then a config folder
//      of the member's own inside the snapshot, whose user settings are Martha's
//      and whose sign-in is the owner's default store, uncopied (martha#602,
//      ../give_a_member_its_own_config), then the settings
//      the host reads, which may set no switch that turns the relay off, nor
//      safe mode in the environment, a settings file's env or the owner's
//      arguments (martha#122, ../claude_code_host/settings_that_turn_hooks_off),
//      and, but for the approved copy, may declare no hook and enable no plugin,
//      nor may the launcher's environment name a plugin folder (martha#121,
//      ../claude_code_host/hooks_and_plugins_the_owner_declares), then the env of the
//      settings files the host loads, the member's own user settings and the
//      approved --settings copy, which may name only what the mesh server may
//      be given (martha#65 r=3, ../claude_code_host/settings_env_reaching_servers):
//      on a refusal of any nothing starts, and the refusal goes to the owner.
//   2. A fresh 0700 directory for the relay socket (relay_directory.ts); a
//      pre-existing path, a link or a parent others may write refuses the launch.
//      Inside it, an empty 0500 directory: where the member's git looks for
//      hooks and direnv for its config (../refuse_code_a_checkout_runs_itself).
//      Beside it, the launch's own read-only copy of the relay's declared files
//      (relay_copy.ts, martha#117): the folder --plugin-dir names, so the host's
//      generated files never land in the installed relay folder. A declared file
//      that is missing or a link refuses the launch.
//      Then the host's command, resolved once to the file it runs, must load
//      that copy, the folder the member's host will load, by the host's own
//      loader, or nothing starts; a host of another version than the recording
//      is told to the owner in one line (host_runs_the_relay.ts, martha#104).
//   3. The host's own answer about the rules that keep a member out of the
//      owner's memory: asked in print mode with no prompt, with hooks off and
//      exactly those rules, it says which of them its file permission checks
//      can never match, and one of them refuses the launch, naming the host's
//      own line (martha#226). Every rule is written under the tool that
//      statement says the checks use (recorded_claude_code_host.ts).
//   4. The relay's server on that socket, answering with memberRelay.
//   5. `claude` in a process group of its own, so one SIGKILL reaches the host
//      and its tool servers. On the owner's own terminal (inherited stdio, with
//      stdin and stderr terminals) it is that terminal's foreground job, which
//      gets the terminal back to the launcher as it was once the member ends
//      (member_on_the_owners_terminal.ts);
//      otherwise it is also in a session of its own (`detached`). In both, the
//      owner's arguments go first, then the launch gate's
//      switches and the relay's copy. `--mcp-config` takes every argument after
//      it until the next flag, so the owner's prompt goes before it. The
//      environment is `theEnvironmentAMemberIsGiven(inherited, switches, crew, config, host)`
//      (./the_environment_a_member_is_given.ts): what it inherits without the crew's
//      state, the switches, the member's own config folder and the launcher's own
//      state home, then the settings that keep a checkout from running its hooks,
//      install scripts and .envrc through the member's own commands (martha#24),
//      plus the socket's path. Its PATH starts with the launch's own `git` guard, and
//      git is pointed at the guard's hooks (../guard_the_git_a_member_runs,
//      martha#562), so the member's every git meets the workspace rules. Before it starts, each mesh server entry of the approved
//      copy is rewritten to start its recorded tree by path, installed or
//      compared file by file, with every variable of that environment and of
//      the settings files' env emptied but the few the server needs (martha#65, ../install_the_recorded_mesh_server);
//      a refusal starts nothing.
//   6. `recordMemberLaunch` with the writable store only the launcher holds
//      (#42), while the kernel still answers for the member's pid: on the
//      owner's terminal the member is held until it is recorded and runs only
//      then (martha#94); detached, it is recorded on its spawn, before this
//      process can reap it. A launch that cannot be recorded is stopped, and on
//      the owner's terminal its member never runs.
//   7. The backstop (martha#104): a member whose relay does not report its
//      session's start in time is stopped, and its stop says why, since a host
//      that does not run the relay runs no gate at all. In time is
//      TRUST_ANSWER_DEADLINE_MS when an owner can answer the host and the
//      host's own record does not already trust the folder, so the host may
//      first ask whether to trust it; else SESSION_START_DEADLINE_MS
//      (host_runs_the_relay.ts).
//   8. The settings watch (martha#122 r=2): the launcher reads those settings
//      files again every HOOK_SETTINGS_CHECK_MS for the member's whole life,
//      apart from any hook, and stops the member when one now sets a switch.
//
// When the member exits, by itself or killed: its group is sent SIGKILL so no
// tool server outlives it, its launch record is dropped, the server closes, and
// the socket directory, with the relay's copy, and the snapshot are removed. If the launcher itself
// exits first, or is ended by SIGTERM or SIGINT, it kills the group and removes
// both directories on the way out.
//
// What the launcher does not do yet: hand a turn to the model or register a
// tool for it (the contract's `delivery.handToModel` and `tools.register`). No
// slice calls either today; the relay would carry them as calls on the engine's
// `$`. Nor does it read the approvals or the policy itself: the caller passes
// them, until the crew's declaration (port map step 2) holds them.

import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { StdioOptions } from 'node:child_process'
import process from 'node:process'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { type HookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import type { ManagedSettingsPlace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { CLAUDE_CODE, CLAUDE_SKILLS } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { sourcesALaunchHandsTheModel } from '../install_the_mesh_server_for_claude_code/what_a_launch_hands_the_model.ts'
import { meshServerEnvironments } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import { whatTheLaunchSupplied } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { knownSettingsOf, type MeshTreeRecording } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  CLAUDE_SERVERS,
  CLAUDE_SETTINGS,
  prepareLaunch,
  startedWithOf,
  type PreparedLaunch,
  type SnapshotPlace,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import type { HoldingTheWatch, TheServedToolsWatch } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import { watchTheCrewToolsServedBy } from '../watch_the_crew_tools_a_launch_served/watch_the_crew_tools_a_launch_served.ts'
import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { TRANSCRIPTS_WHEN_UNNAMED, type CrewTranscripts } from '../declare_crew/the_crews_transcripts.ts'
import { crewTextToHand } from '../hand_a_member_its_crew_text/hand_a_member_its_crew_text.ts'
import type { TheLeftoversALaunchKeeps } from '../tell_a_member_what_its_relaunch_killed/the_telling_on_every_start.ts'
import type { TurnRaising } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { memberRelay, type MemberRelay, type MemberRelayPlace } from '../answer_the_relay/answer_the_relay.ts'
import { theMembersTelling } from '../tell_the_member_a_line/tell_the_member_a_line.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import {
  API_KEY_VARIABLE,
  hostTrustsTheFolder,
  ownerCanAnswerTheHost,
  SESSION_START_DEADLINE_MS,
  TRUST_ANSWER_DEADLINE_MS,
} from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { hostThatRunsTheRelay, RELAY_PLUGIN_DIR, rulesTheHostMatches } from '../ask_the_host_what_it_loads/what_the_host_loads.ts'
import {
  NOT_STARTED,
  startedMember,
  whatTheHostStartsWith,
  whenTheMemberStops,
  type Starting,
} from '../end_a_launch/end_a_launch.ts'
import { cleanUpIfTheLauncherEnds } from '../a_launch_end_on_this_machine/what_a_launch_end_reads.ts'
import { killGroup, type TheRunsLifeline } from '../end_a_launch_when_its_run_ends/the_run_lifeline.ts'
import { theLaunchItsRunAsks, told, watchItsRun, whatTheRunWatches, type WhatTheRunWatches } from '../end_a_launch_when_its_run_ends/watch_the_run_of_a_launch.ts'
import {
  hostSettingsOf,
  meshServerUnproved,
  ownerMemoryOf,
  settingsDenyingOwnerMemory,
  settingsEnvironment,
} from '../place_the_hosts_settings/the_hosts_settings.ts'
import { makeEmptyDirectory } from '../empty_directory_of_a_launch/empty_directory.ts'
import { isOnTheOwnersTerminal } from '../start_the_member_on_the_owners_terminal/member_on_the_owners_terminal.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { keptBeatingWhileItRuns } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theOwnersScreenOfALaunch } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import { NOTHING_IS_MUTED, theMuteOf, theMutedStartLine, type TheMute } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { recordTheLauncher, sweepLeftoverLaunchDirectories } from '../sweep_leftover_launch_directories/leftover_relay_directories.ts'
import { copyTheRelay, RELAY_COPY_NAME } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { relayJournalKeptIn, type RelayJournal } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { makeRelayDirectory, type RelayDirectory } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { aFolderOfTheMisses, theGuardOfTheLaunch, type TheGitGuard } from '../guard_the_git_a_member_runs/the_guard_of_a_launch.ts'
import { MEMBER_CONFIG_FOLDER, makeTheMembersConfig } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { isBelowACarriedFolder } from '../refuse_launch_of_unapproved_config/carry_the_approved_skills.ts'
import { aFolderOfTheScan, aTickOfTheRowsWork, type TheScanOfTheWorkspace } from '../tell_the_owner_the_workspace_drift/tell_the_owner_the_workspace_drift.ts'
import { theDriftInTheWorkspace } from '../check_the_workspace_matches_its_layout/check_the_workspace_matches_its_layout.ts'
import { relayBackstop } from '../keep_the_backstop_of_a_launch/keep_the_backstop_of_a_launch.ts'
import { theEnvironmentAMemberIsGiven } from './the_environment_a_member_is_given.ts'
import { userSettingsPath } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { type RelayServer, serveTheRelay } from '../serve_the_relay_to_a_launch/serve_the_relay.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { releasesIn } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { gateModeFor } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { appendStateLine, readStateFile } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepTheTranscriptsOf, type WhatIsKept } from '../keep_the_transcripts_of_a_launch/keep_the_transcripts_of_a_launch.ts'

/** The empty directory inside a launch's relay directory (../refuse_code_a_checkout_runs_itself). */
export const EMPTY_DIRECTORY_NAME = 'nothing'

/** Where the launcher keeps a member's files: directories this user owns. */
export interface LauncherPlaces {
  /**
   * Martha's own state root (martha#619): every record the owner's acts and the launcher keep. A member's file tools may
   * not write under it, so it is denied in the member's settings and refused by the gate, as the owner's memory is. A
   * member's shell can still write here, as the owner's own OS user: a speed bump, not a wall.
   */
  readonly state_root: string
  /** The crew's row streams, the session records among them, which every member of the crew shares (martha#254). */
  readonly rows: string
  /** The crew's dashboard rows, one file per member (martha#254). */
  readonly dashboard: string
  /** The launcher's records, which the binder reads (#14). */
  readonly launch_records: string
  /** The parent of each launch's relay socket directory: owned by this user, written by no one else. */
  readonly relay_root: string
  /** Where the recorded mesh server trees are installed, one directory per version (martha#65). */
  readonly mesh_servers: string
  /** Where each launch keeps its journal, one file per launch (martha#240). */
  readonly relay_journal: string
  /**
   * The crew's own folder where an audited member's would-be refusals are written (martha#321), made with the crew's
   * place. Absent, an audited member's call is refused: the audit never runs without a place to write its evidence.
   */
  readonly gate_audit?: string
  /**
   * The crew's own place where the owner's mutes of a member's bells are kept (martha#371), made with the crew's place:
   * the launcher asks it every time a bell is about to ring, and `martha bells` keeps a flip in it. Absent, or a file
   * that cannot be read, this launch reads no mute and rings as the declaration leaves it: a mute the owner typed is not
   * honoured, which is the loud direction.
   */
  readonly bells?: string
}

/**
 * How a launch builds its crew's tools: over its sessions, its member's own config folder and the crew tools it watches
 * (martha#658). The tools it returns hold that watch (martha#710), so a builder that leaves it out cannot compile.
 */
export type CrewToolsOfALaunch = (sessions: { readonly of: (session_id: string) => HostSession | undefined }, member: { readonly config_dir: string; readonly served_tools: TheServedToolsWatch }) => HoldingTheWatch<CrewTools>

/**
 * The transcript bounds a launch keeps its member's session to (martha#931 B): its crew's declared `transcripts`, or the
 * defaults for a launch that carries no crew (a test's launch).
 */
export const theTranscriptBoundsOf = (launch: { readonly crew_settings?: CrewSettings }): CrewTranscripts => launch.crew_settings?.transcripts ?? TRANSCRIPTS_WHEN_UNNAMED

/**
 * What a launch's end keeps of its member's session: where, under which launch's name, the key redacted, and to the
 * crew's declared bounds. The launch is named by its approval when the gate recorded one, and otherwise by its snapshot,
 * which is made afresh for each launch.
 */
export const whatALaunchKeeps = (
  launch: Pick<ClaudeCodeMemberLaunch, 'places' | 'place'> & { readonly crew_settings?: CrewSettings },
  config_folder: string,
  snapshot_dir: string,
  theLaunchKey: string,
): WhatIsKept => ({
  state_root: launch.places.state_root,
  project_root: launch.place.launch_dir,
  config_folder,
  theLaunch: launch.place.since_approval?.launch_id ?? basename(snapshot_dir),
  theLaunchKey,
  transcripts: theTranscriptBoundsOf(launch),
})

export interface ClaudeCodeMemberLaunch {
  readonly member_name: string
  readonly node_id: string
  /** Where the member starts and what the owner approved there, for `prepareLaunch`. */
  readonly place: SnapshotPlace
  readonly policy: Policy
  /**
   * The crew's declaration, from which the text every session is handed is composed (martha#306): the practice when
   * the crew switched it on, this member's role text, the mode's text, the lines it sends and the crew's conventions.
   * Absent, no crew text is handed and the launch is as it was before this existed.
   */
  readonly crew_settings?: CrewSettings
  /**
   * Whether this member's bells ring when its host asks the owner something (`house_rules.owner_bell`, read once by
   * `martha start`), with the owner's own mute of this member read on top of it every time a bell is about to ring
   * (martha#313, martha#371). Absent means none ring, as every switch in the declaration is off unasked.
   */
  readonly owner_bell?: boolean
  readonly places: LauncherPlaces
  /** The recorded mesh server trees; the reviewed recording unless a test gives its own. */
  readonly mesh_trees?: MeshTreeRecording
  /** Where the host reads managed settings; the recorded host's place unless a test gives its own (martha#122). */
  readonly managed_settings?: ManagedSettingsPlace
  /** How often the launcher reads those settings files again while the member runs; HOOK_SETTINGS_CHECK_MS unless a test gives its own. */
  readonly hook_settings_check_ms?: number
  /** The host's command: `claude`, or a path to it. */
  readonly command: string
  /** The owner's own arguments, the prompt among them; they go before Martha's. */
  readonly args: readonly string[]
  /** The environment the member inherits, before the launch gate drops what would bring config back. */
  readonly inherited: Readonly<Record<string, string | undefined>>
  /** `'inherit'` from a terminal makes the member that terminal's foreground job. */
  readonly stdio: StdioOptions
  /** Shows the owner a line: a refusal, what was not carried, why a member was stopped. */
  tellOwner(line: string): void
  /** How long the relay of a member no owner can answer for has to report the session's start; SESSION_START_DEADLINE_MS unless a test gives its own. */
  readonly session_start_deadline_ms?: number
  /** The same when an owner can answer the host, which may first ask whether to trust the folder; TRUST_ANSWER_DEADLINE_MS unless a test gives its own. */
  readonly trust_answer_deadline_ms?: number
  /** The member's signed runs (martha#129): `martha start` gives them; without them the member runs no shape. */
  readonly signed_runs?: SignedRuns
  /**
   * The crew's tools, over this member's crew place (martha#254); a launch with none answers no tool. They are handed
   * the member's own config folder (martha#602), where the host's model command saves a switch, before the host starts.
   */
  readonly crew_tools?: CrewToolsOfALaunch
  /**
   * What this launch raises every turn the host took in to (martha#253): the crew channel's carrier builds one and
   * reads it, so a message counts as taken in only once the host raised it back. A launch given none raises nothing.
   */
  readonly turns?: TurnRaising
  /**
   * A test's ear on what the relay is handed, so that what the relay calls `started_with` is measured against what
   * the host was really spawned with rather than inferred from the code that builds both (martha#135). A real
   * launch gives none.
   */
  readonly hearRelayPlace?: (place: MemberRelayPlace) => void
  /**
   * The crew's own store and the layout it declared, so this launch's end keeps what a killed command left in the
   * member's trees (#693): the record the member's next start is told from, and the two refusals judge. A launch given
   * none keeps no record, and the refusals judge nothing (a test's launch, and a crew that declared no layout).
   */
  readonly leftovers?: TheLeftoversALaunchKeeps
}

/** How a member's process ended. */
export interface MemberStopped {
  readonly exit_code: number | null
  readonly signal: string | null
  /** Why the launcher stopped the member, or null when it ended by itself. */
  readonly stopped_because: string | null
}

export type MemberStarted =
  | {
      readonly started: true
      readonly pid: number
      /** Settles once the member exited and everything the launch made is gone. */
      readonly stopped: Promise<MemberStopped>
      /** Sends SIGKILL to the member's process group. */
      stop(why: string): void
    }
  | { readonly started: false; readonly refusal: string }

/**
 * How often, in ms, the launcher reads the settings files the host reads again
 * while a member runs, apart from any hook: the host may drop its hooks as soon
 * as it reloads a file a shell wrote a switch into, and then no hook asks again
 * (martha#122 r=2). A member runs ungated for at most this long after the write.
 */
export const HOOK_SETTINGS_CHECK_MS = 1_000

/** A launch the gate allowed, with what the member's environment is built from. */
export interface ReadyLaunch {
  readonly prepared: Extract<PreparedLaunch, { readonly allow: true }>
  /** Removes the approved copies. */
  removeSnapshot(): void
  /**
   * Keeps what the member's host wrote of its session, before the snapshot that holds it goes (martha#646). A failure
   * is said in one line and never stops the removals.
   */
  keepTranscripts(): void
  readonly hostEnv: Readonly<Record<string, string | undefined>>
  /** What the settings files the host loads add to every server's environment. */
  readonly settingsEnv: Readonly<Record<string, string>>
  /** The settings files the host reads, watched for a key that turns Martha's relay off (martha#122). */
  readonly hookSettings: HookSettingsWatch
  /** The crew text every session this launch starts is handed (martha#306), or empty when the crew declares none. */
  readonly crew_text: string
}

/** Everything a launch has made on disk and on its socket, up to the member's start. */
export interface LaunchMade extends ReadyLaunch, WhatTheRunWatches {
  /** The file the host's command resolved to: what the checks ran, and what the member runs (host_runs_the_relay.ts). */
  readonly binary: string
  readonly relayDirectory: Extract<RelayDirectory, { readonly made: true }>
  readonly emptyDirectory: string
  /** The launch's read-only copy of the relay, which --plugin-dir names (martha#117). */
  readonly pluginDir: string
  readonly server: RelayServer
  /** Where the owner's own text is, which a member does not write (martha#136, martha#154). */
  readonly ownerMemory: OwnerMemoryPlaces
  /** The switches that name the settings the launch wrote, when no approved copy was carried (martha#136). */
  readonly settingsArgs: readonly string[]
  /** The `git` first on the member's PATH, its hook, and the misses file it leaves (../guard_the_git_a_member_runs). */
  readonly guard: TheGitGuard
}

/**
 * The host's environment, on a config folder of the member's own (martha#602): what the gate reads as the member's
 * user settings is the file Martha wrote there, and the owner's own folder is never loaded into the member. The
 * owner's folder must still be told, since the places a member may not write are read from it (ownerMemoryOf). Or why
 * not.
 */
function membersHostEnvironment(launch: ClaudeCodeMemberLaunch, prepared: Extract<PreparedLaunch, { readonly allow: true }>): Record<string, string> | string {
  const owners = userSettingsPath(launch.inherited)
  if ('refusal' in owners) return owners.refusal
  const memberConfig = membersConfigFolderOf(prepared)
  const env = theEnvironmentAMemberIsGiven({
    inherited: launch.inherited,
    switches: prepared.switches,
    crew: { state_root: launch.places.state_root, rows: launch.places.rows },
    member_config: memberConfig,
    host: CLAUDE_CODE,
  })
  // The key answered yes is the one the member is handed, read from the environment it starts with.
  const made = makeTheMembersConfig(memberConfig, launch.place.launch_dir, env[API_KEY_VARIABLE], theCarriedSkills(prepared.carried_files))
  if (!made.made) return made.refusal
  return env
}

/** The member's own config folder for a launch: decided once, from the launch's snapshot directory, and read by both its users. */
const membersConfigFolderOf = (prepared: Extract<PreparedLaunch, { readonly allow: true }>): string => join(prepared.snapshot_dir, MEMBER_CONFIG_FOLDER)

/** Step 1: the launch gate, the mesh server version, and the settings files' env; or the refusal. */
function readyLaunch(launch: ClaudeCodeMemberLaunch): ReadyLaunch | string {
  if (launch.place.host !== CLAUDE_CODE) return `${NOT_STARTED}: this launcher starts ${CLAUDE_CODE}, not ${launch.place.host}.`

  const prepared = prepareLaunch(launch.place, thisMachine)
  if (!prepared.allow) return prepared.refusal
  const removeSnapshot = (): void => rmSync(prepared.snapshot_dir, { recursive: true, force: true })
  // The crew text, composed once here from the bytes `prepareLaunch` has just carried and hashed against the owner's
  // approval (martha#306): the crew's own texts are answered from those bytes alone and never read live, so a write by
  // any member reaches no member's prompt.
  const crew = crewTextToHand(launch.crew_settings, launch.member_name, prepared.carried_files, thisMachine.stores.files)
  if ('refusal' in crew) {
    removeSnapshot()
    return `${NOT_STARTED}: ${crew.refusal}, so ${launch.member_name} is handed no crew text`
  }
  const crew_text = crew.text
  const unproved = meshServerUnproved(prepared.carried_files[CLAUDE_SERVERS])
  if (unproved !== undefined) {
    removeSnapshot()
    return `${NOT_STARTED}: ${unproved}`
  }
  const hostEnv = membersHostEnvironment(launch, prepared)
  if (typeof hostEnv === 'string') {
    removeSnapshot()
    return `${NOT_STARTED}: ${hostEnv}`
  }
  // Before the server environment rule: a switch is refused as a switch, whatever that rule allows.
  const hookSettings = hostSettingsOf(launch, hostEnv, prepared)
  if (typeof hookSettings === 'string') {
    removeSnapshot()
    return `${NOT_STARTED}: ${hookSettings}`
  }
  const fromSettings = settingsEnvironment(
    hostEnv,
    prepared.carried_files[CLAUDE_SETTINGS],
    prepared.snapshot_dir,
    knownSettingsOf(launch.mesh_trees),
  )
  if ('refusal' in fromSettings) {
    removeSnapshot()
    return `${NOT_STARTED}: ${fromSettings.refusal}`
  }
  for (const path of prepared.not_carried) launch.tellOwner(`Not loaded for ${launch.member_name}: ${path}`)
  // The host writes the member's session under the folder this snapshot holds, so the keep is taken here, beside the
  // snapshot's removal, and each of the three ends calls it (martha#646). A launch on an approval keeps the id its own
  // writes are kept under; any other launch is named by its snapshot, which is made afresh for each launch.
  const keepTranscripts = (): void => {
    try {
      const kept = whatALaunchKeeps(launch, membersConfigFolderOf(prepared), prepared.snapshot_dir, hostEnv[API_KEY_VARIABLE] ?? '')
      for (const line of keepTheTranscriptsOf(kept)) launch.tellOwner(`Not kept for ${launch.member_name}: ${line}`)
    } catch (error) {
      try {
        launch.tellOwner(`Not kept for ${launch.member_name}: ${(error as Error).message}`)
      } catch {
        // The launch is ending: what cannot be said now does not stop it.
      }
    }
  }
  return { prepared, removeSnapshot, keepTranscripts, hostEnv, settingsEnv: fromSettings.env, hookSettings, crew_text }
}

/**
 * Step 2c: where the owner's own text is, which a member does not write: the places the launcher's and the member's
 * config dirs hold, and the folder for output styles the member's own session init reported (martha#136, martha#154).
 * The settings the host starts with are written here, carrying the rules that refuse the host's own writes into the
 * same places, and the host is asked whether its own checks match those rules before anything runs on them
 * (martha#226). Or the refusal.
 */
async function placesAwayFromTheOwner(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
  host: { readonly binary: string; readonly reported_output_styles_dir: string },
): Promise<{ readonly ownerMemory: OwnerMemoryPlaces; readonly settingsArgs: readonly string[] } | { readonly refusal: string }> {
  const ownerMemory = ownerMemoryOf(launch, ready.hostEnv, ready.prepared, host.reported_output_styles_dir)
  if (typeof ownerMemory === 'string') return { refusal: ownerMemory }
  const startSettings = settingsDenyingOwnerMemory(ready.prepared, ownerMemory)
  if ('refusal' in startSettings) return startSettings
  const unmatched = await rulesTheHostMatches(launch, ready, host.binary, ownerMemory)
  return unmatched === undefined ? { ownerMemory, settingsArgs: startSettings.args } : { refusal: unmatched }
}

/** Step 2: the relay socket's directory, the empty directory and the relay's copy inside it; or the refusal, with all gone. */
function launchDirectories(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
): Pick<LaunchMade, 'relayDirectory' | 'emptyDirectory' | 'pluginDir' | 'guard'> | string {
  // A launcher killed hard runs none of its own cleanup, so what another launch
  // left in the relay root is swept here, before this launch makes its own
  // directory; a launch still running is left alone (leftover_relay_directories.ts).
  sweepLeftoverLaunchDirectories(launch.places.relay_root)
  const relayDirectory = makeRelayDirectory(join(launch.places.relay_root, randomUUID()))
  if (!relayDirectory.made) {
    ready.removeSnapshot()
    return relayDirectory.refusal
  }
  // The record that tells a later sweep this directory's launch is over.
  const recorded = recordTheLauncher(relayDirectory.directory)
  if (recorded !== undefined) {
    relayDirectory.remove()
    ready.removeSnapshot()
    return `${NOT_STARTED}: ${recorded}`
  }
  const emptyDirectory = join(relayDirectory.directory, EMPTY_DIRECTORY_NAME)
  const empty = makeEmptyDirectory(emptyDirectory)
  if (!empty.made) {
    relayDirectory.remove()
    ready.removeSnapshot()
    return empty.refusal
  }
  const copy = copyTheRelay(RELAY_PLUGIN_DIR, join(relayDirectory.directory, RELAY_COPY_NAME))
  if (!copy.made) {
    relayDirectory.remove()
    ready.removeSnapshot()
    return copy.refusal
  }
  // The guard's shim goes first on the member's PATH and its hook is where git looks for one (../guard_the_git_a_member_runs),
  // so it is placed here, inside the directory the launch takes away whole.
  const guard = theGuardOfTheLaunch(relayDirectory.directory, process.execPath, launch.inherited)
  if ('refusal' in guard) { relayDirectory.remove(); ready.removeSnapshot(); return guard.refusal }
  return { relayDirectory, emptyDirectory, pluginDir: copy.plugin_dir, guard }
}

/**
 * What this launch supplied a mesh answer, so the relay can read a session answer as the member's own and keep its
 * shell (martha#251); or nothing at all, and then every mesh answer records on B2 as before. Nothing is offered when
 * the launch carries no server config, or when exactly one mesh server entry cannot be identified: a reading against
 * a guess is worse than the taint it would lift.
 */
function wordlessAnswersOf(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
  starting: Starting,
): { readonly wordless_answers: NonNullable<MemberRelayPlace['wordless_answers']> } | Record<string, never> {
  const carried = ready.prepared.carried_files[CLAUDE_SERVERS]
  if (carried === undefined) return {}
  const environments = Object.values(
    meshServerEnvironments({ serverConfig: new TextDecoder().decode(carried), hostEnvironment: { ...starting.env, ...ready.settingsEnv } }),
  )
  return whatTheLaunchSupplied(environments, { node_id: launch.node_id, home: ready.hookSettings.home, host_version: RECORDED_HOST.host_version })
}

/**
 * The crew's tools for this launch, or nothing at all: a launch given no crew place answers no tool (martha#254). The
 * sessions are this launch's own, handed over so a handover is stamped with the session it came from and a refreshed
 * session inherits the one it was cleared from (martha#255).
 */
function crewOf(launch: ClaudeCodeMemberLaunch, sessions: Map<string, HostSession>, ready: ReadyLaunch, served_tools: TheServedToolsWatch): { readonly crew?: CrewTools } {
  return launch.crew_tools === undefined
    ? {}
    : { crew: launch.crew_tools({ of: (session_id) => sessions.get(session_id) }, { config_dir: membersConfigFolderOf(ready.prepared), served_tools }) }
}

/** What this launch raises turns to, or nothing: a launch given none raises nothing (martha#253). */
function turnsOf(launch: ClaudeCodeMemberLaunch): { readonly turns?: TurnRaising } {
  return launch.turns === undefined ? {} : { turns: launch.turns }
}

/**
 * The two places this launch keeps of its own: its relay's journal, one file named by the approval it runs on (a launch
 * started on no approval names itself, martha#240), and the owner's screen (martha#313) — the member's own row, moved
 * by what the host asks, and the bell that change is worth, rung on the terminal this launcher was started on.
 *
 * The owner's own mute of this member's bells (martha#371) is read here, once for the line the owner is told, and then
 * asked again every time the screen is about to ring: a mute typed at the owner's terminal reaches a member that is
 * running, so a member is never restarted to silence a bell.
 */
function thePlacesOfItsOwn(launch: ClaudeCodeMemberLaunch, hearing: (journal: RelayJournal) => RelayJournal): Pick<MemberRelayPlace, 'journal' | 'screen' | 'telling'> {
  const journal = hearing(relayJournalKeptIn(launch.places.relay_journal, launch.place.since_approval?.launch_id ?? randomUUID()))
  const mute = (): TheMute => (launch.places.bells === undefined ? NOTHING_IS_MUTED : theMuteOf({ directory: launch.places.bells, lines: { append: appendStateLine, read: readStateFile } }, launch.member_name))
  if (mute().muted) launch.tellOwner(theMutedStartLine(launch.member_name))
  return {
    journal,
    telling: theMembersTelling({ member: launch.member_name, dashboard: launch.places.dashboard, rows: launch.places.rows, journal }),
    screen: theOwnersScreenOfALaunch({ member: launch.member_name, beats: dashboardRowsIn(launch.places.dashboard), declared_bells: launch.owner_bell, muted: () => mute().muted, on_the_owners_terminal: isOnTheOwnersTerminal(launch.stdio), environment: process.env, write: (bytes) => void process.stdout.write(bytes) }),
  }
}

/** Step 3: the relay's server on the launch's socket, answering with memberRelay; or why it could not be served. */
async function servedRelay(
  launch: ClaudeCodeMemberLaunch,
  socket_path: string,
  stop: (why: string) => void,
  sessionReported: () => void,
  ready: ReadyLaunch,
  starting: Starting,
  ownerMemory: OwnerMemoryPlaces,
): Promise<RelayServer | string> {
  // One map of this launch's sessions, shared by the relay that keeps them and the crew's tools that read them
  // (martha#255): a handover is stamped with the session it came from, and a refresh's successor inherits it.
  const sessions = new Map<string, HostSession>()
  // The crew tools this launch served, watched through the journal it keeps (martha#658); the crew answers a refresh's predecessor.
  const watched = watchTheCrewToolsServedBy(membersConfigFolderOf(ready.prepared), async (id) => (await place.crew?.thePredecessorOf(id)) ?? null)
  const rows = rowStreamsDirectory(launch.places.rows)
  const place: MemberRelayPlace = {
    // The owner's releases are read again at load and before every check, so a member released while it runs is free
    // on its next call (martha#321).
    records: sessionRecordsIn(rows, releasesIn(rows)),
    launch: {
      host: launch.place.host,
      launch_dir: launch.place.launch_dir,
      stop_dir: launch.place.stop_dir,
      approved_fingerprints: launch.place.approved_fingerprints,
      ...(launch.place.since_approval === undefined ? {} : { since_approval: launch.place.since_approval }),
    },
    policy: launch.policy,
    // What the gate does to this member, read from the declaration once (martha#321): absent means enforced, never off.
    gate: launch.crew_settings === undefined ? 'enforced' : gateModeFor(launch.crew_settings.gate, launch.member_name),
    audit: launch.places.gate_audit === undefined ? undefined : { directory: launch.places.gate_audit, member: launch.member_name, lines: { append: appendStateLine, read: readStateFile } },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, starting.args, starting.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel(ready.prepared.carried_files),
    hookSettings: ready.hookSettings,
    ownerMemory,
    ...(launch.signed_runs === undefined ? {} : { signed_runs: launch.signed_runs }),
    ...crewOf(launch, sessions, ready, watched.watch),
    // The crew text this launch hands every session it starts (martha#306), composed once from the approved bytes.
    crew_text: ready.crew_text,
    ...wordlessAnswersOf(launch, ready, starting),
    ...turnsOf(launch),
    ...thePlacesOfItsOwn(launch, watched.journalOver),
    stopMember: stop,
  }
  launch.hearRelayPlace?.(place)
  const answering = memberRelay(place, sessions)
  // Any report of a session's start, taken or refused, shows the host runs the relay (the backstop, #104).
  const relay: MemberRelay = {
    ...answering,
    answer: (event, body) => {
      if (event === 'session_started') sessionReported()
      return answering.answer(event, body)
    },
  }

  try {
    return keptBeatingWhileItRuns(place.crew, await serveTheRelay(relay, socket_path))
  } catch (error) {
    return `${NOT_STARTED}: its relay socket could not be served (${(error as NodeJS.ErrnoException).code ?? String(error)}).`
  }
}

/** Why a member is stopped whose relay did not report its session's start: the backstop's deadline and reason (#104). */
function sessionStartDeadline(launch: ClaudeCodeMemberLaunch, hostEnv: Readonly<Record<string, string | undefined>>): { readonly ms: number; readonly why: string } {
  if (ownerCanAnswerTheHost(launch.stdio) && !hostTrustsTheFolder(hostEnv, launch.place.launch_dir, launch.args)) {
    const ms = launch.trust_answer_deadline_ms ?? TRUST_ANSWER_DEADLINE_MS
    return {
      ms,
      why: `its relay did not report the session's start within ${ms / 1000} s. If the host was still asking whether to trust ${launch.place.launch_dir}, start the member again and answer it; if it was not, the host is not running Martha's gates`,
    }
  }
  const ms = launch.session_start_deadline_ms ?? SESSION_START_DEADLINE_MS
  return { ms, why: `its relay did not report the session's start within ${ms / 1000} s, so the host is not running Martha's gates` }
}

/**
 * Reads the settings files the host reads again every `ms`, apart from any
 * hook, and stops the member the first time one sets a switch (martha#122 r=2);
 * returns what ends the watch. `also` is work the same tick does, which is how a
 * launch folds the misses its git guard left into the member's row (martha#562).
 */
function watchHookSettings(watch: HookSettingsWatch, ms: number, stop: (why: string) => void, also?: () => void): () => void {
  const timer = setInterval(() => {
    also?.()
    const why = watch.check()
    if (why === undefined) return
    clearInterval(timer)
    stop(why)
  }, ms)
  return () => clearInterval(timer)
}

/**
 * Starts one Claude Code member on its approved config, with its relay answered here. The run that asked for it keeps
 * one end of a pipe open for as long as the member may run (#472): no variable is an owner's own start, and its member
 * keeps outliving their shell, while a variable naming no pipe this launcher can read refuses the launch by name,
 * before anything is made.
 */
export async function launchClaudeCodeMember(asking: ClaudeCodeMemberLaunch): Promise<MemberStarted> {
  const { launch, lifeline } = theLaunchItsRunAsks(asking, NOT_STARTED)
  return lifeline.kind === 'refused' ? { started: false, refusal: told(launch, lifeline.refusal) } : launching(launch, lifeline)
}

/**
 * The tick the launcher keeps (martha#562 package 2): the misses a member's git guard left, and the scan of the workspace
 * this launch was given, which starts here and is never awaited. It sits beside the launch rather than inside it so that
 * what it decides — including a launch given no layout — costs the launch's own reading nothing.
 */
function aTickOfWorkFor(launch: ClaudeCodeMemberLaunch, misses: string): () => void {
  const beats = dashboardRowsIn(launch.places.dashboard)
  const scan: TheScanOfTheWorkspace = (workspace) => theDriftInTheWorkspace({ files: thisMachine.stores.files, processes: thisMachine.processes, workspace })
  return aTickOfTheRowsWork(aFolderOfTheMisses(misses, launch.member_name, beats), aFolderOfTheScan(launch.leftovers?.workspace, launch.member_name, beats, scan))
}

/** The launch itself, on a run that has said whether it is still there. */
async function launching(launch: ClaudeCodeMemberLaunch, lifeline: TheRunsLifeline): Promise<MemberStarted> {
  const refuse = (refusal: string): MemberStarted => {
    launch.tellOwner(refusal)
    return { started: false, refusal }
  }
  const ready = readyLaunch(launch)
  if (typeof ready === 'string') return refuse(ready)
  const directories = launchDirectories(launch, ready)
  if (typeof directories === 'string') return refuse(directories)
  const host = await hostThatRunsTheRelay(launch, ready, directories.pluginDir)
  if (typeof host === 'string') {
    directories.relayDirectory.remove()
    ready.removeSnapshot()
    return refuse(host)
  }
  // The owner's own text, the settings that keep the host's own writes out of those places (martha#136, #154), and the
  // host's own answer about those rules, before a member runs on any of them (martha#226).
  const places = await placesAwayFromTheOwner(launch, ready, host)
  if ('refusal' in places) {
    directories.relayDirectory.remove()
    ready.removeSnapshot()
    return refuse(`${NOT_STARTED}: ${places.refusal}`)
  }

  let group: number | undefined
  let stoppedBecause: string | null = null
  const stop = (why: string): void => {
    stoppedBecause ??= why
    launch.tellOwner(`${launch.member_name} is stopped: ${why}`)
    if (group !== undefined) killGroup(group)
  }
  const backstop = relayBackstop(sessionStartDeadline(launch, ready.hostEnv), stop)

  // Built once, here, so what the relay records as what this launch started the host with is the very arguments and
  // environment `spawn` gets below, never a second guess at them (martha#135). The settings the owner's places are
  // kept out of are written by then, so the switches naming them are in what is recorded.
  const starting = whatTheHostStartsWith(launch, { ...ready, ...directories, ...places })

  const server = await servedRelay(launch, directories.relayDirectory.socket_path, stop, backstop.reported, ready, starting, places.ownerMemory)
  if (typeof server === 'string') {
    directories.relayDirectory.remove()
    ready.removeSnapshot()
    return refuse(server)
  }
  const made: LaunchMade = { ...ready, ...directories, ...places, server, binary: host.binary, ...whatTheRunWatches(lifeline) }
  const itsRunWent = watchItsRun(lifeline, launch, made, () => group, stop)

  const started = await startedMember(launch, made, starting)
  if (typeof started === 'string') return refuse(started)
  group = started.pid
  itsRunWent.theGroupIsKnown()
  const pid = started.pid

  const { launchRecords, recorded } = started
  const offLauncherEnd = cleanUpIfTheLauncherEnds(pid, made)
  // The row's one line is written here, and here only: the misses a guard left, and the scan of the workspace this
  // launch was given, which starts now that its host is up and is never awaited (martha#562 package 2).
  const unwatch = watchHookSettings(ready.hookSettings, launch.hook_settings_check_ms ?? HOOK_SETTINGS_CHECK_MS, stop, aTickOfWorkFor(launch, made.guard.misses))
  const ended = (): string | null => (backstop.disarm(), unwatch(), itsRunWent.forgetTheRun(), stoppedBecause)
  const stopped = whenTheMemberStops(started.child, pid, launch, launchRecords, made, offLauncherEnd, ended)
  backstop.arm()

  if (!recorded.recorded) {
    stop(recorded.refusal)
    await stopped
    return { started: false, refusal: recorded.refusal }
  }

  return { started: true, pid, stopped, stop }
}

/**
 * The carried skill files, keyed by their path below the skills folder: what the member's config folder writes under
 * `skills/` (martha#747). The gate decided which are carried; this only names them as the folder takes them.
 */
export function theCarriedSkills(carried_files: Readonly<Record<string, Uint8Array>>): Readonly<Record<string, Uint8Array>> {
  return Object.fromEntries(
    Object.entries(carried_files)
      .filter(([path]) => isBelowACarriedFolder(path, [CLAUDE_SKILLS]))
      .map(([path, bytes]) => [path.slice(CLAUDE_SKILLS.length + 1), bytes]),
  )
}
