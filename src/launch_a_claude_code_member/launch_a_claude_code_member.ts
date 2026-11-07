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
//      installs, which must be a recorded one (martha#49), then the settings
//      the host reads, which may set no switch that turns the relay off, nor
//      safe mode in the environment, a settings file's env or the owner's
//      arguments (martha#122, ../claude_code_host/settings_that_turn_hooks_off),
//      then the env of the
//      settings files the host loads, the owner's user settings and the
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
//   3. The relay's server on that socket, answering with memberRelay.
//   4. `claude` in a process group of its own, so one SIGKILL reaches the host
//      and its tool servers. On the owner's own terminal (inherited stdio, with
//      stdin and stderr terminals) it is that terminal's foreground job, which
//      gets the terminal back to the launcher as it was once the member ends
//      (member_on_the_owners_terminal.ts);
//      otherwise it is also in a session of its own (`detached`). In both, the
//      owner's arguments go first, then the launch gate's
//      switches and the relay's copy. `--mcp-config` takes every argument after
//      it until the next flag, so the owner's prompt goes before it. The
//      environment is `launchEnvironment(inherited, switches)`, then the
//      settings that keep a checkout from running its hooks, install scripts
//      and .envrc through the member's own commands (martha#24), plus the
//      socket's path. Before it starts, each mesh server entry of the approved
//      copy is rewritten to start its recorded tree by path, installed or
//      compared file by file, with every variable of that environment and of
//      the settings files' env emptied but the few the server needs (martha#65, ../install_the_recorded_mesh_server);
//      a refusal starts nothing.
//   5. `recordMemberLaunch` with the writable store only the launcher holds
//      (#42), while the kernel still answers for the member's pid: on the
//      owner's terminal the member is held until it is recorded and runs only
//      then (martha#94); detached, it is recorded on its spawn, before this
//      process can reap it. A launch that cannot be recorded is stopped, and on
//      the owner's terminal its member never runs.
//   6. The backstop (martha#104): a member whose relay does not report its
//      session's start in time is stopped, and its stop says why, since a host
//      that does not run the relay runs no gate at all. In time is
//      TRUST_ANSWER_DEADLINE_MS when an owner can answer the host and the
//      host's own record does not already trust the folder, so the host may
//      first ask whether to trust it; else SESSION_START_DEADLINE_MS
//      (host_runs_the_relay.ts).
//   7. The settings watch (martha#122 r=2): the launcher reads those settings
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

import { type ChildProcess, spawn, type StdioOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  bindNothing,
  type LaunchRecorded,
  recordMemberLaunch,
  recordMemberStopped,
} from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { meshServerInstallsIn } from '../claude_code_host/mesh_server_install.ts'
import { environmentFromSettings, userSettingsPath } from '../claude_code_host/settings_env_reaching_servers.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { dropInFiles, hookSettingsWatch, safeModeIn, type HookSettingsWatch, type ManagedSettingsPlace } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { memoryDenyRules, ownerMemoryPlaces, settingsWithMemoryDenied, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { placeRecordedMeshServers, SERVER_NEEDS } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { MESH_SERVER_PACKAGE, refusalOfInstalledMeshServers } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { KNOWN_MESH_SERVER_SETTINGS, type MeshTreeRecording } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { switchesThatRunNothingFromACheckout } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  CLAUDE_SERVERS,
  CLAUDE_SETTINGS,
  claudeSettingsSwitches,
  launchEnvironment,
  prepareLaunch,
  type PreparedLaunch,
  type SnapshotPlace,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'
import {
  hostTrustsTheFolder,
  hostVersionLine,
  ownerCanAnswerTheHost,
  refusalToLoadTheRelay,
  resolvedHostCommand,
  SESSION_START_DEADLINE_MS,
  TRUST_ANSWER_DEADLINE_MS,
} from './host_runs_the_relay.ts'
import { makeEmptyDirectory } from './empty_directory.ts'
import { type ForegroundJob, isOnTheOwnersTerminal, startForegroundJob } from './member_on_the_owners_terminal.ts'
import { copyTheRelay, RELAY_COPY_NAME } from './relay_copy.ts'
import { makeRelayDirectory, type RelayDirectory } from './relay_directory.ts'
import { type RelayServer, serveTheRelay } from './serve_the_relay.ts'
import { sessionRecordsIn } from './session_records_in_rows.ts'

/** The installed relay plugin's folder, which each launch copies; the host is given the copy (relay_copy.ts). */
export const RELAY_PLUGIN_DIR = fileURLToPath(new URL('../claude_code_relay', import.meta.url))

/** The empty directory inside a launch's relay directory (../refuse_code_a_checkout_runs_itself). */
export const EMPTY_DIRECTORY_NAME = 'nothing'

/** The host this launcher starts. */
export const CLAUDE_CODE = 'claude-code'

/** Where the launcher keeps a member's files: directories this user owns. */
export interface LauncherPlaces {
  /** The row streams, the session records among them. */
  readonly rows: string
  /** The launcher's records, which the binder reads (#14). */
  readonly launch_records: string
  /** The parent of each launch's relay socket directory: owned by this user, written by no one else. */
  readonly relay_root: string
  /** Where the recorded mesh server trees are installed, one directory per version (martha#65). */
  readonly mesh_servers: string
}

export interface ClaudeCodeMemberLaunch {
  readonly member_name: string
  readonly node_id: string
  /** Where the member starts and what the owner approved there, for `prepareLaunch`. */
  readonly place: SnapshotPlace
  readonly policy: Policy
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

/** The start of every refusal: the member was not started. */
export const NOT_STARTED = 'The member is not started'

/**
 * How often, in ms, the launcher reads the settings files the host reads again
 * while a member runs, apart from any hook: the host may drop its hooks as soon
 * as it reloads a file a shell wrote a switch into, and then no hook asks again
 * (martha#122 r=2). A member runs ungated for at most this long after the write.
 */
export const HOOK_SETTINGS_CHECK_MS = 1_000

/** The signals that end the launcher without its 'exit' event, and so clean up on their own. */
const LAUNCHER_END_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']

/** Sends SIGKILL to a whole process group; a group already gone is no error. */
function killGroup(group: number): void {
  try {
    process.kill(-group, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/**
 * How a spawned member's start ended: the pid the launcher kills the group of,
 * or why there is none. On the owner's terminal the job-control shell says it
 * (member_on_the_owners_terminal.ts); detached, the member is the spawned child.
 */
async function memberStartOf(
  command: string,
  spawned: Error | undefined,
  job: ForegroundJob<RecordedWhileHeld> | undefined,
  childPid: number | undefined,
  record: (pid: number) => LaunchRecorded,
): Promise<RecordedStart> {
  if (spawned !== undefined) return { refusal: `${command} could not be started (${spawned.message}).` }
  if (job !== undefined) {
    const held = await job.member
    return 'refusal' in held ? held : { pid: held.pid, recorded: held.admission.recorded }
  }
  // Read on the spawn, with no turn of the event loop since, so this process
  // has not reaped the child yet and the kernel still answers for its pid.
  return childPid === undefined ? { refusal: `${command} could not be started (no pid).` } : { pid: childPid, recorded: record(childPid) }
}

/** A member held on the owner's terminal, recorded before it may run: it runs only when the record holds. */
interface RecordedWhileHeld {
  readonly admitted: boolean
  readonly recorded: LaunchRecorded
}

/** How a member's start ends: its pid, which is also its group's id, and its launch record; or why it did not start. */
type RecordedStart = { readonly pid: number; readonly recorded: LaunchRecorded } | { readonly refusal: string }

/**
 * Why the mesh server the approved server config installs is not proved, or
 * undefined when it is a recorded version started as a bin it has, or none is
 * installed (martha#49).
 */
function meshServerUnproved(serverConfig: Uint8Array | undefined): string | undefined {
  if (serverConfig === undefined) return undefined
  const installed = meshServerInstallsIn(new TextDecoder().decode(serverConfig), MESH_SERVER_PACKAGE)
  return 'refusal' in installed ? installed.refusal : refusalOfInstalledMeshServers(installed.installs)
}

/**
 * Rewrites the approved server config in the snapshot so each mesh server
 * starts from its recorded tree by path, with an environment built from the
 * one the host is given; why it cannot, or undefined (martha#65).
 */
function meshServersPlaced(
  serverConfig: Uint8Array | undefined,
  launch: ClaudeCodeMemberLaunch,
  snapshotDir: string,
  hostEnvironment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (serverConfig === undefined) return undefined
  const placed = placeRecordedMeshServers({
    serverConfig: new TextDecoder().decode(serverConfig),
    root: launch.places.mesh_servers,
    hostEnvironment,
    ...(launch.mesh_trees === undefined ? {} : { recording: launch.mesh_trees }),
  })
  if ('refusal' in placed) return placed.refusal
  writeFileSync(join(snapshotDir, CLAUDE_SERVERS), placed.config)
  return undefined
}

/**
 * What the settings files the host loads add to every server's environment:
 * the owner's user settings, then the approved --settings copy; or why the
 * launch is refused (martha#65 r=3, ../claude_code_host/settings_env_reaching_servers).
 */
function settingsEnvironment(
  hostEnv: Readonly<Record<string, string | undefined>>,
  approvedSettings: Uint8Array | undefined,
  snapshotDir: string,
  knownSettings: readonly string[],
): { readonly env: Readonly<Record<string, string>> } | { readonly refusal: string } {
  const user = userSettingsPath(hostEnv)
  if ('refusal' in user) return user
  return environmentFromSettings(
    [
      { path: user.path, text: existsSync(user.path) ? readFileSync(user.path, 'utf8') : undefined },
      { path: join(snapshotDir, CLAUDE_SETTINGS), text: approvedSettings === undefined ? undefined : new TextDecoder().decode(approvedSettings) },
    ],
    [...SERVER_NEEDS, ...knownSettings],
  )
}

/**
 * The settings files the member's host reads, watched for a key that turns
 * Martha's relay off: the owner's user settings, the launch's --settings copy,
 * which a launch always has (settingsDenyingOwnerMemory), and the managed
 * settings (martha#122); or why the launch is refused: one of them sets such a
 * key, or the user settings file cannot be told.
 */
function hookSettingsOf(
  launch: ClaudeCodeMemberLaunch,
  hostEnv: Readonly<Record<string, string | undefined>>,
  startSettings: string,
): HookSettingsWatch | string {
  const user = userSettingsPath(hostEnv)
  if ('refusal' in user) return user.refusal
  const safeMode = safeModeIn(hostEnv, launch.args, CLAUDE_CODE_HOOK_SWITCHES.safe_mode)
  if (safeMode !== undefined) return safeMode
  const watch = hookSettingsWatch({
    user: user.path,
    home: hostHome(hostEnv),
    approved: startSettings,
    managed: launch.managed_settings ?? RECORDED_HOST.managed_settings,
    switches: CLAUDE_CODE_HOOK_SWITCHES,
  })
  return watch.check() ?? watch
}

/** The host's home, which a leading `~` resolves against: its HOME, as userSettingsPath reads it. */
const hostHome = (hostEnv: Readonly<Record<string, string | undefined>>): string => hostEnv.HOME ?? homedir()

/**
 * Where the owner's sessions load memory and instructions from: the launcher's
 * config dir and the member's, the folders the launcher's environment moves
 * memory to, and each memory folder the policy, user and carried settings name
 * (martha#136); or why the user settings file cannot be told.
 */
function ownerMemoryOf(
  launch: ClaudeCodeMemberLaunch,
  hostEnv: Readonly<Record<string, string | undefined>>,
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
): OwnerMemoryPlaces | string {
  const user = userSettingsPath(hostEnv)
  if ('refusal' in user) return user.refusal
  const managed = launch.managed_settings ?? RECORDED_HOST.managed_settings
  return ownerMemoryPlaces({
    launcher_env: launch.inherited,
    member_env: hostEnv,
    home: hostHome(hostEnv),
    settings_files: [
      join(managed.dir, managed.file),
      ...dropInFiles(join(managed.dir, managed.drop_in)),
      user.path,
      ...(prepared.carried_files[CLAUDE_SETTINGS] === undefined ? [] : [join(prepared.snapshot_dir, CLAUDE_SETTINGS)]),
    ],
  })
}

/**
 * Writes the settings the host starts with into the snapshot: the approved
 * --settings copy, or a file of its own when none is carried, with the rules
 * that refuse the host's own writes into the owner's memory added to its
 * permissions.deny (martha#136). Returns the file and the switches that name it
 * when none was carried; or why the approved copy cannot take the rules.
 */
function settingsDenyingOwnerMemory(
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
  ownerMemory: OwnerMemoryPlaces,
): { readonly path: string; readonly args: readonly string[] } | { readonly refusal: string } {
  const path = join(prepared.snapshot_dir, CLAUDE_SETTINGS)
  const approved = prepared.carried_files[CLAUDE_SETTINGS]
  const settings = settingsWithMemoryDenied(
    approved === undefined ? undefined : new TextDecoder().decode(approved),
    memoryDenyRules(ownerMemory),
    CLAUDE_SETTINGS,
  )
  if ('refusal' in settings) return settings
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, settings.text)
  return { path, args: approved === undefined ? claudeSettingsSwitches(path).args : [] }
}

/**
 * The settings the member's host starts with: where the owner's memory is, the
 * launch's --settings copy that keeps the host's own writes out of it
 * (martha#136), and the watch on every settings file for a key that turns
 * Martha's relay off (martha#122); or the refusal.
 */
function hostSettingsOf(
  launch: ClaudeCodeMemberLaunch,
  hostEnv: Readonly<Record<string, string | undefined>>,
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
):
  | { readonly ownerMemory: OwnerMemoryPlaces; readonly startSettings: { readonly path: string; readonly args: readonly string[] }; readonly hookSettings: HookSettingsWatch }
  | { readonly refusal: string } {
  const ownerMemory = ownerMemoryOf(launch, hostEnv, prepared)
  if (typeof ownerMemory === 'string') return { refusal: ownerMemory }
  const startSettings = settingsDenyingOwnerMemory(prepared, ownerMemory)
  if ('refusal' in startSettings) return startSettings
  const hookSettings = hookSettingsOf(launch, hostEnv, startSettings.path)
  return typeof hookSettings === 'string' ? { refusal: hookSettings } : { ownerMemory, startSettings, hookSettings }
}

/** A launch the gate allowed, with what the member's environment is built from. */
interface ReadyLaunch {
  readonly prepared: Extract<PreparedLaunch, { readonly allow: true }>
  /** Removes the approved copies. */
  removeSnapshot(): void
  readonly hostEnv: Readonly<Record<string, string | undefined>>
  /** What the settings files the host loads add to every server's environment. */
  readonly settingsEnv: Readonly<Record<string, string>>
  /** The settings files the host reads, watched for a key that turns Martha's relay off (martha#122). */
  readonly hookSettings: HookSettingsWatch
  /** Where the owner's sessions load memory and instructions from, which a member does not write (martha#136). */
  readonly ownerMemory: OwnerMemoryPlaces
  /** The switches that name the settings the launch wrote, when no approved copy was carried (martha#136). */
  readonly settingsArgs: readonly string[]
}

/** Everything a launch has made on disk and on its socket, up to the member's start. */
interface LaunchMade extends ReadyLaunch {
  /** The file the host's command resolved to: what the checks ran, and what the member runs (host_runs_the_relay.ts). */
  readonly binary: string
  readonly relayDirectory: Extract<RelayDirectory, { readonly made: true }>
  readonly emptyDirectory: string
  /** The launch's read-only copy of the relay, which --plugin-dir names (martha#117). */
  readonly pluginDir: string
  readonly server: RelayServer
}

/** Step 1: the launch gate, the mesh server version, and the settings files' env; or the refusal. */
function readyLaunch(launch: ClaudeCodeMemberLaunch): ReadyLaunch | string {
  if (launch.place.host !== CLAUDE_CODE) return `${NOT_STARTED}: this launcher starts ${CLAUDE_CODE}, not ${launch.place.host}.`

  const prepared = prepareLaunch(launch.place, thisMachine)
  if (!prepared.allow) return prepared.refusal
  const removeSnapshot = (): void => rmSync(prepared.snapshot_dir, { recursive: true, force: true })
  const unproved = meshServerUnproved(prepared.carried_files[CLAUDE_SERVERS])
  if (unproved !== undefined) {
    removeSnapshot()
    return `${NOT_STARTED}: ${unproved}`
  }
  const hostEnv = launchEnvironment(launch.inherited, prepared.switches)
  // Before the server environment rule: a switch is refused as a switch, whatever that rule allows.
  const settings = hostSettingsOf(launch, hostEnv, prepared)
  if ('refusal' in settings) {
    removeSnapshot()
    return `${NOT_STARTED}: ${settings.refusal}`
  }
  const { ownerMemory, startSettings, hookSettings } = settings
  const fromSettings = settingsEnvironment(
    hostEnv,
    prepared.carried_files[CLAUDE_SETTINGS],
    prepared.snapshot_dir,
    launch.mesh_trees?.known_settings ?? KNOWN_MESH_SERVER_SETTINGS,
  )
  if ('refusal' in fromSettings) {
    removeSnapshot()
    return `${NOT_STARTED}: ${fromSettings.refusal}`
  }
  for (const path of prepared.not_carried) launch.tellOwner(`Not loaded for ${launch.member_name}: ${path}`)
  return { prepared, removeSnapshot, hostEnv, settingsEnv: fromSettings.env, hookSettings, ownerMemory, settingsArgs: startSettings.args }
}

/**
 * Step 2b: the file the host's command resolves to, which must load the launch's copy of the relay;
 * or the refusal. A host of another version than the recording is told to the
 * owner and refuses nothing (host_runs_the_relay.ts).
 */
async function hostThatRunsTheRelay(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
  pluginDir: string,
): Promise<{ readonly binary: string } | string> {
  const cwd = launch.place.launch_dir
  const resolved = resolvedHostCommand(launch.command, ready.hostEnv.PATH, cwd)
  if ('refusal' in resolved) return `${NOT_STARTED}: ${resolved.refusal}`
  const env = ready.hostEnv
  // The folder the member's host will load: the launch's copy, never the installed relay (martha#117).
  const refused = await refusalToLoadTheRelay(resolved.binary, pluginDir, env, cwd, RELAY_PLUGIN_DIR)
  if (refused !== undefined) return `${NOT_STARTED}: ${refused}`
  const drift = await hostVersionLine(resolved.binary, env, cwd)
  if (drift !== undefined) launch.tellOwner(drift)
  return resolved
}

/** Step 2: the relay socket's directory, the empty directory and the relay's copy inside it; or the refusal, with all gone. */
function launchDirectories(
  launch: ClaudeCodeMemberLaunch,
  ready: ReadyLaunch,
): Pick<LaunchMade, 'relayDirectory' | 'emptyDirectory' | 'pluginDir'> | string {
  const relayDirectory = makeRelayDirectory(join(launch.places.relay_root, randomUUID()))
  if (!relayDirectory.made) {
    ready.removeSnapshot()
    return relayDirectory.refusal
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
  return { relayDirectory, emptyDirectory, pluginDir: copy.plugin_dir }
}

/** Step 3: the relay's server on the launch's socket, answering with memberRelay; or why it could not be served. */
async function servedRelay(
  launch: ClaudeCodeMemberLaunch,
  hookSettings: HookSettingsWatch,
  ownerMemory: OwnerMemoryPlaces,
  socket_path: string,
  stop: (why: string) => void,
  sessionReported: () => void,
): Promise<RelayServer | string> {
  const answering = memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(launch.places.rows)),
    launch: {
      host: launch.place.host,
      launch_dir: launch.place.launch_dir,
      stop_dir: launch.place.stop_dir,
      approved_fingerprints: launch.place.approved_fingerprints,
    },
    policy: launch.policy,
    names: { ownNameOf: ownNameOfCalledTool },
    binder: bindNothing,
    hookSettings,
    ownerMemory,
    stopMember: stop,
  })
  // Any report of a session's start, taken or refused, shows the host runs the relay (the backstop, #104).
  const relay: MemberRelay = {
    answer: (event, body) => {
      if (event === 'session_started') sessionReported()
      return answering.answer(event, body)
    },
  }

  try {
    return await serveTheRelay(relay, socket_path)
  } catch (error) {
    return `${NOT_STARTED}: its relay socket could not be served (${(error as NodeJS.ErrnoException).code ?? String(error)}).`
  }
}

/** Closes the relay's server and removes the socket directory and the snapshot, in that order. */
async function removeWhatTheLaunchMade(made: LaunchMade): Promise<void> {
  await made.server.close()
  made.relayDirectory.remove()
  made.removeSnapshot()
}

/** A member that started: its process, its pid, and whether the launcher recorded it while it was held. */
interface StartedMember {
  readonly child: ChildProcess
  readonly pid: number
  readonly recorded: LaunchRecorded
  readonly launchRecords: ReturnType<typeof launchRecordsDirectory>
}

/** Step 4: `claude` in a process group of its own; or why it did not start, with everything the launch made gone. */
async function startedMember(
  launch: ClaudeCodeMemberLaunch,
  made: LaunchMade,
): Promise<StartedMember | string> {
  const { prepared, hostEnv, relayDirectory } = made
  const env = {
    ...launchEnvironment(hostEnv, switchesThatRunNothingFromACheckout(hostEnv, made.emptyDirectory)),
    [RELAY_SOCKET_VARIABLE]: relayDirectory.socket_path,
  }
  // The host hands a server its own environment and then the settings files' env,
  // so the server's is built from both.
  const placed = meshServersPlaced(prepared.carried_files[CLAUDE_SERVERS], launch, prepared.snapshot_dir, { ...env, ...made.settingsEnv })
  if (placed !== undefined) {
    await removeWhatTheLaunchMade(made)
    return `${NOT_STARTED}: ${placed}`
  }
  const memberArgs = [...launch.args, ...prepared.switches.args, ...made.settingsArgs, '--plugin-dir', made.pluginDir]
  const launchRecords = launchRecordsDirectory(launch.places.launch_records)
  const record = (pid: number): LaunchRecorded =>
    recordMemberLaunch(launchRecords, linuxProcessIdentities, { member_name: launch.member_name, node_id: launch.node_id, pid })
  const job = isOnTheOwnersTerminal(launch.stdio)
    ? startForegroundJob(made.binary, memberArgs, { cwd: launch.place.launch_dir, env }, (pid): RecordedWhileHeld => {
        const recorded = record(pid)
        return { admitted: recorded.recorded, recorded }
      })
    : undefined
  // On the owner's terminal `child` is the job-control shell: it exits once the
  // member has and the terminal is given back, so its exit is the member's.
  const child = job?.shell ?? spawn(made.binary, memberArgs, { cwd: launch.place.launch_dir, env, detached: true, stdio: launch.stdio })

  const spawned = await new Promise<Error | undefined>((resolve) => {
    child.once('spawn', () => resolve(undefined))
    child.once('error', resolve)
  })
  const start = await memberStartOf(launch.command, spawned, job, child.pid, record)
  if ('refusal' in start) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await removeWhatTheLaunchMade(made)
    return `${NOT_STARTED}: ${start.refusal}`
  }
  return { child, pid: start.pid, recorded: start.recorded, launchRecords }
}

/**
 * Kills the member's group and removes both directories if the launcher exits
 * first, or is ended by SIGTERM or SIGINT; returns what takes those handlers off.
 */
function cleanUpIfTheLauncherEnds(pid: number, made: LaunchMade): () => void {
  const onLauncherExit = (): void => {
    killGroup(pid)
    made.relayDirectory.remove()
    made.removeSnapshot()
  }
  process.once('exit', onLauncherExit)
  // SIGTERM and SIGINT end the process without 'exit', so each cleans up too.
  // The signal is raised again once this launcher's handlers are off, unless
  // some other part of the process still listens for it, so it still ends the
  // launcher the way it would have.
  const onLauncherSignal = (signal: NodeJS.Signals): void => {
    offLauncherEnd()
    onLauncherExit()
    // A `once` listener registered before this one has already been removed
    // when this runs, so it counts as 0 here: the signal is raised again before
    // that listener's own asynchronous shutdown can finish. A part of the
    // process that needs one must keep listening with `on`.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
  }
  const offLauncherEnd = (): void => {
    process.off('exit', onLauncherExit)
    for (const signal of LAUNCHER_END_SIGNALS) process.off(signal, onLauncherSignal)
  }
  for (const signal of LAUNCHER_END_SIGNALS) process.once(signal, onLauncherSignal)
  return offLauncherEnd
}

/**
 * Settles once the member exited and everything the launch made is gone: its
 * group killed, its launch record dropped, the server closed, both directories
 * removed and the launcher's own end handlers off.
 */
function whenTheMemberStops(
  child: ChildProcess,
  pid: number,
  launch: ClaudeCodeMemberLaunch,
  launchRecords: ReturnType<typeof launchRecordsDirectory>,
  made: LaunchMade,
  offLauncherEnd: () => void,
  ended: () => string | null,
): Promise<MemberStopped> {
  return new Promise<MemberStopped>((resolve) => {
    child.once('exit', (exit_code, signal) => {
      void (async () => {
        const stopped_because = ended()
        killGroup(pid)
        recordMemberStopped(launchRecords, launch.member_name)
        await removeWhatTheLaunchMade(made)
        offLauncherEnd()
        resolve({ exit_code, signal, stopped_because })
      })()
    })
  })
}

/** Why a member is stopped whose relay did not report its session's start: the backstop's deadline and reason (#104). */
function sessionStartDeadline(launch: ClaudeCodeMemberLaunch, hostEnv: Readonly<Record<string, string | undefined>>): { readonly ms: number; readonly why: string } {
  if (ownerCanAnswerTheHost(launch.stdio) && !hostTrustsTheFolder(hostEnv, launch.place.launch_dir)) {
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
 * The backstop (#104): a host that runs the relay reports the session's start;
 * a member whose relay has not, the deadline's ms after it was armed, is stopped.
 */
function relayBackstop(deadline: { readonly ms: number; readonly why: string }, stop: (why: string) => void): { reported(): void; arm(): void; disarm(): void } {
  let reported = false
  let unheard: NodeJS.Timeout | undefined
  const disarm = (): void => clearTimeout(unheard)
  return {
    reported: () => ((reported = true), disarm()),
    arm: () => {
      if (reported) return
      unheard = setTimeout(() => stop(deadline.why), deadline.ms)
    },
    disarm,
  }
}

/**
 * Reads the settings files the host reads again every `ms`, apart from any
 * hook, and stops the member the first time one sets a switch (martha#122 r=2);
 * returns what ends the watch.
 */
function watchHookSettings(watch: HookSettingsWatch, ms: number, stop: (why: string) => void): () => void {
  const timer = setInterval(() => {
    const why = watch.check()
    if (why === undefined) return
    clearInterval(timer)
    stop(why)
  }, ms)
  return () => clearInterval(timer)
}

/** Starts one Claude Code member on its approved config, with its relay answered here. */
export async function launchClaudeCodeMember(launch: ClaudeCodeMemberLaunch): Promise<MemberStarted> {
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

  let group: number | undefined
  let stoppedBecause: string | null = null
  const stop = (why: string): void => {
    stoppedBecause ??= why
    launch.tellOwner(`${launch.member_name} is stopped: ${why}`)
    if (group !== undefined) killGroup(group)
  }
  const backstop = relayBackstop(sessionStartDeadline(launch, ready.hostEnv), stop)

  const server = await servedRelay(launch, ready.hookSettings, ready.ownerMemory, directories.relayDirectory.socket_path, stop, backstop.reported)
  if (typeof server === 'string') {
    directories.relayDirectory.remove()
    ready.removeSnapshot()
    return refuse(server)
  }
  const made: LaunchMade = { ...ready, ...directories, server, binary: host.binary }

  const started = await startedMember(launch, made)
  if (typeof started === 'string') return refuse(started)
  group = started.pid
  const pid = started.pid

  const { launchRecords, recorded } = started
  const offLauncherEnd = cleanUpIfTheLauncherEnds(pid, made)
  const unwatch = watchHookSettings(ready.hookSettings, launch.hook_settings_check_ms ?? HOOK_SETTINGS_CHECK_MS, stop)
  const ended = (): string | null => (backstop.disarm(), unwatch(), stoppedBecause)
  const stopped = whenTheMemberStops(started.child, pid, launch, launchRecords, made, offLauncherEnd, ended)
  backstop.arm()

  if (!recorded.recorded) {
    stop(recorded.refusal)
    await stopped
    return { started: false, refusal: recorded.refusal }
  }

  return { started: true, pid, stopped, stop }
}
