// One start call, one launcher per host (martha#541 package 5, #547 S6).
//
// This exists so a member is started on the host its declaration names for it, and on no other: `martha start` and
// `martha wake` reach this one table, which keys each host to the launcher this release has for it and to the command
// that launcher starts. The start call keeps its host-neutral preflight (a terminal, the owner's arguments, the
// declaration, the member, its node ids, the owner's approval); what differs per host is here.
//
// A host the declaration names and this release has no launcher for is refused by name, never started on another host
// and never fallen back to (martha#547 line 39: "If the file names a host that is not installed on this machine,
// martha refuses and names the missing install. It never falls back to another host."). A host whose command is not on
// the owner's path is refused the same way, before anything starts, naming the install to make.
//
// The command each entry starts is the host's own fact, not a word at the call site: Claude Code's `claude` is held in
// ../know_claude_codes_own_facts beside the switches the host itself reads, and the engine's name comes from its
// recording when its launcher arrives (packages 7-8). A restart does not come here: it is a request to the launcher
// already holding the member, so only a start picks a host.

import { randomUUID } from 'node:crypto'
import fs, { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, normalize } from 'node:path'
import process from 'node:process'

import type { StdioOptions } from 'node:child_process'
import { crewToolsOver, type CrewToolPlaces } from '../a_crews_tools/a_crews_tools.ts'
import { CLAUDE_CODE_BASH_RESULT_SHAPES } from '../claude_code_host/claude_code_bash_results.ts'
import { CLAUDE_CODE_MODELS, CLAUDE_CODE_SUBAGENT_SPAWN } from '../claude_code_host/claude_code_host.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { BILLED_BY_SUBSCRIPTION, isATeamMode, OWNER_BELL, SOLO_MODE, THE_ENGINES_HOST, type CrewSettings, type Member, type TheVocabulariesOfHost } from '../declare_crew/declare_crew.ts'
import { theMeshKeyOf, type AKeyFileSeen, type AMembersKey } from '../read_a_members_mesh_key/read_a_members_mesh_key.ts'
import { writtenOut } from '../bring_up_the_declared_crew/declare_the_engines_endpoint.ts'
import { NOT_STARTED } from '../end_a_launch/end_a_launch.ts'
import type { HoldingTheWatch, TheServedToolsWatch } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import { theMembersConfigEnvironment } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { carryingTo } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { crewTextFilesOf } from '../hand_a_member_its_crew_text/hand_a_member_its_crew_text.ts'
import type { CrewStore, DocumentStore, HandoverStampStore, Refused, RowStore } from '../host_contract/host_contract.ts'
import {
  ownWritesKeptForLaunch,
  type Approval,
  readStateFile,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { openKeptCommandShapes } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { CLAUDE, CLAUDE_CODE, CLAUDE_INSTALL } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { THE_MODELS_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { startOnTheEngine, THE_ENGINES_INSTALL, type TheSharedOfAStart } from '../start_an_engine_member/start_an_engine_member.ts'
import { aReviewerMembersModelRefusal, theOwnersModelSwitchRefusal } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import { launchClaudeCodeMember, type ClaudeCodeMemberLaunch, type LauncherPlaces, type MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { userSettingsPath } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { ownersSettingsIn } from '../owners_settings_directory/owners_settings_directory.ts'
import { finishTheOwnersDefaultAtLaunch, type OwnersDefaultPlace } from '../put_the_owners_model_back/put_the_owners_model_back.ts'
import { turnsRaised } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import type { SnapshotPlace } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { theWorkspaceTheCrewDeclared } from '../guard_workspace/guard_workspace.ts'
import { theGitGuardPlacesOf, type TheGitGuardPlaces } from '../guard_the_git_a_member_runs/the_git_guard_places_of_a_crew.ts'

import { receiptsInMemory } from '../run_an_owner_signed_command/receipts.ts'
import { runAKeptShape } from '../run_an_owner_signed_command/run_a_signed_shape.ts'
import { signedRunsOf } from '../run_an_owner_signed_command/signed_runs.ts'
import type { StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { machineRootsFrom } from '../tell_a_citer_of_a_volatile_path/volatile_paths.ts'
import type { MemberRelayPlace } from '../answer_the_relay/answer_the_relay.ts'
import { ROSTER_FILE, theKeptRoster } from '../write_the_crews_roster/write_the_crews_roster.ts'

/** The crew's channel as its carrier counts a message taken in (martha#253): the crew's row stream and a clock. */
export interface TheCrewChannel {
  readonly clock: { now(): number }
  readonly stores: { readonly rows: RowStore }
}

/** What the preflight gathered for a start, as the entry for its host uses it. */
export interface AStartOnItsHost {  readonly member: string
  readonly node_id: string
  readonly model: string | null
  readonly approval: Approval | undefined
  readonly settings: CrewSettings
  /** The project's absolute path: where the member starts. */
  readonly root: string
  /** The owner's home: the launch gate reads no config at it or above it. */
  readonly home: string
  readonly args: readonly string[]
  /** The one prompt Martha adds after the owner's, or none. */
  readonly prompt: string | undefined
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  readonly documents: DocumentStore
  readonly state: MarthaState
  /** The places a launch keeps in Martha's state, without the approval's snapshot. */
  readonly places: LauncherPlaces
  readonly snapshot_root: string
  readonly crew_stores: { readonly crew: CrewStore; readonly stamps: HandoverStampStore }
  /** Where a stop or a restart is asked, or nothing when the crew's directory is not this user's own. */
  readonly restart: { readonly lifecycle?: StoppingHost }
  /** The crew's channel as its carrier counts a message taken in, and as the watch for a stop reads the same rows. */
  readonly channel: TheCrewChannel
  /** The command the host's own fact names, found on the owner's path by the preflight. */
  readonly command: string
  /** A test's ear on what the member's relay is handed; a real start gives none. */
  readonly hear_relay_place?: (place: MemberRelayPlace) => void
  /** The owner's lines at the member's tab (martha#927 part 2): a test's own; a real start gives none, and the tab's
   * terminal is read when it is the owner's. */
  readonly owners_lines?: NodeJS.ReadableStream
  /** Called each time the member's relay reports its session started (martha#919): where a first prompt is typed in. */
  readonly hear_session_start?: () => void
  tellOwner(line: string): void
}

/** What starting a member on one host is: the command that launcher starts, what to install for it, and the start. */
export interface AHostsLauncher {
  /** The command a launch of this host starts, as the host's own facts name it. */
  readonly command: string
  /** What an owner installs when that command is not on their path. */
  readonly install: string
  start(start: AStartOnItsHost): Promise<MemberStarted>
}

/** Every host this release can start a member on, keyed by the name a declaration writes. */
export type TheLaunchersOfHost = Readonly<Record<string, AHostsLauncher>>

/**
 * The models each host runs, by the name a declaration writes (martha#541 package 6b): Claude Code's recorded list, and
 * the engine's, recorded from its delegate tool's own schema. A host with no entry here is a host this release records
 * no models for, and a declaration that names it is refused by name rather than read as running everything.
 */
export const THE_VOCABULARIES_OF_HOST: TheVocabulariesOfHost = new Map([
  [CLAUDE_CODE, CLAUDE_CODE_MODELS],
  [THE_ENGINES_HOST, RECORDED_GOOSE_ENGINE.subagent_models],
])

/**
 * The launchers this release has, by host. `claude-code` is today's launch, moved behind the table so that the start
 * call itself names no host; the engine's entry is martha#541 package A's start.
 */
export const THE_LAUNCHERS_OF_HOST: TheLaunchersOfHost = {
  [CLAUDE_CODE]: { command: CLAUDE, install: CLAUDE_INSTALL, start: startOnClaudeCode },
  [THE_ENGINES_HOST]: { command: RECORDED_GOOSE_ENGINE.engine_name, install: THE_ENGINES_INSTALL, start: async (start) => startOnTheEngine(start, theSharedOfAStart(start)) },
}

/** What a start on a host runs on, or why it cannot run. */
export interface TheStartOfAHost {
  readonly launcher: AHostsLauncher
  readonly command: string
}

/**
 * The launcher a host's start runs on, and the command it starts, or the refusal naming what this release or this
 * machine lacks. The launcher is asked for by the name the declaration wrote, never read as another host's.
 */
export function theStartOfAHost(
  host: string,
  inherited: Readonly<Record<string, string | undefined>>,
  table: TheLaunchersOfHost = THE_LAUNCHERS_OF_HOST,
): TheStartOfAHost | string {
  const launcher = table[host]
  if (launcher === undefined) return noLauncherFor(host, table)
  const command = theCommandOnThePath(launcher.command, inherited)
  if (command !== undefined) return { launcher, command }
  return `${NOT_STARTED}: ${launcher.command} is not on your PATH, so ${host} cannot be started: install ${launcher.install}.`
}

/** Why a host the declaration names cannot start here: this release has no launcher for it. */
export const noLauncherFor = (host: string, table: TheLaunchersOfHost = THE_LAUNCHERS_OF_HOST): string =>
  `${NOT_STARTED}: ${host} is a host this release has no launcher for (it starts ${Object.keys(table).join(', ')}). A crew whose members name two hosts cannot start until the other host's launch and its approve step are released.`

/**
 * The start this member makes on `host`, or why it may not start (martha#541 package 6b): the host's launcher and the
 * command it starts, and then the crew's reviewer rules over this member, whose own session is a review when its role
 * holds `hold_reviews` — its declared model, and the owner's own model switch in `args`. The one reading a start asks,
 * so a host this release cannot start and a reviewer member that would run off the crew's reviewer model are refused in
 * the same place, before anything about the checkout is read.
 */
export function theStartOfAMember(
  host: string,
  inherited: Readonly<Record<string, string | undefined>>,
  member: Member,
  settings: CrewSettings,
  args: readonly string[] = [],
): TheStartOfAHost | string {
  const start = theStartOfAHost(host, inherited)
  if (typeof start === 'string') return start
  const heldToTheReviewModel = aReviewerMembersModelRefusal(member, settings) ?? theOwnersModelSwitchRefusal(member, settings, args)
  return heldToTheReviewModel === undefined ? start : `${NOT_STARTED}: ${heldToTheReviewModel}`
}

/** The file named on the owner's path, which the launch then starts by its own path, or undefined when there is none. */
function theCommandOnThePath(command: string, inherited: Readonly<Record<string, string | undefined>>): string | undefined {
  for (const directory of (inherited['PATH'] ?? '').split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, command)
    if (isAFileThisUserCanRun(candidate)) return candidate
  }
  return undefined
}

/** Whether a path is a file this user may execute. Not a boundary: it turns a missing install into a refusal by name. */
function isAFileThisUserCanRun(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false
    accessSync(candidate, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Finishes any switch a killed launch left unfinished (martha#359, step 7): the owner's file must be right before any
 * new session reads it, and the line that needs the owner goes to the terminal.
 */
async function finishAnySwitchBeforeTheHostStarts(start: AStartOnItsHost): Promise<void> {
  const owners = settingsPlaceOf(start.inherited, start)
  for (const told of await finishTheOwnersDefaultAtLaunch({ member: start.member, host: { stores: { crew: start.crew_stores.crew } }, owners, beats: dashboardRowsIn(start.places.dashboard), stillThere: fs.existsSync })) start.tellOwner(told)
}

/**
 * Where the owner's own default for new sessions lives, and where the one lock that guards it is kept (martha#359): from
 * the host's own answer about which settings file it reads, made once in ../claude_code_host (martha#65, martha#75), so
 * a config directory the host refuses is refused here by that same line rather than by a second opinion.
 */
function settingsPlaceOf(env: Readonly<Record<string, string | undefined>>, start: AStartOnItsHost): OwnersDefaultPlace | Refused {
  const settings = userSettingsPath(env)
  return 'refusal' in settings
    ? settings
    : { config_dir: dirname(settings.path), file: settings.path, store: ownersSettingsIn(settings.path, start.state.state_root) }
}

/**
 * The file a member's switch is guarded in while it runs (martha#602): the settings file in the member's own config
 * folder, which is where the host's model command saves it, and the lock named by that folder. The owner's own file is
 * never written by a member's host any more, so the owner's default stays where the owner left it by construction;
 * the owner's file is read only at launch, to finish a switch a launch from before martha#602 left open.
 */
const theMembersSwitchPlace = (start: AStartOnItsHost, config_dir: string): OwnersDefaultPlace | Refused =>
  // The config folder is the same under either billing (martha#916); only where the folder is is read here.
  settingsPlaceOf(theMembersConfigEnvironment(config_dir, BILLED_BY_SUBSCRIPTION), start)

/**
 * What the member is started on: the approval's fingerprint, and what its own writes are checked against while it
 * runs (martha#132), each launch named afresh so no other launch's writes pass, and kept in a file of its own
 * (martha#162). None when the checkout needs none.
 */
export function approvedPlace(member: string, approval: Approval | undefined, state: MarthaState): Pick<SnapshotPlace, 'approved_fingerprints' | 'approved_tree' | 'since_approval'> {
  if (approval === undefined) return { approved_fingerprints: [] }
  const launch_id = randomUUID()
  return {
    approved_fingerprints: [approval.fingerprint],
    ...(approval.tree === null ? {} : { approved_tree: approval.tree }),
    since_approval: {
      approved: { entries: approval.entries, tree: approval.tree },
      member,
      own_writes: ownWritesKeptForLaunch(state, launch_id),
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
 * The workspace guard's places, for the crew's own tools and for the two seams that reach git without a tool call
 * (martha#562): a crew that declared a layout has every shell line a tool call carries read into its git calls, every
 * call the `git` on a member's PATH is handed judged, and every ref a transaction deletes read for whose branch it is.
 * No layout declared, nothing is judged, and the crew's tools are handed no guard at all.
 */
function theGitGuardPlaceOf(settings: CrewSettings, member: string, leftovers: CrewStore): TheGitGuardPlaces {
  return theGitGuardPlacesOf(theWorkspaceTheCrewDeclared(settings), member, thisMachine, leftovers) ?? {}
}

/**
 * What this launch hands its end: the crew's own store, and the workspace its declaration lays out (martha#693,
 * martha#562). One place builds them, so a test can plant a declaration and read what a real start would hand on: the
 * launch tests hand a workspace in themselves, and a start that handed none would leave every one of them green.
 */
export const leftoversOfALaunch = (settings: CrewSettings, crew: CrewStore) => ({ crew, workspace: theWorkspaceTheCrewDeclared(settings) })

/** The crew tools' places a host's start does not choose itself: the models it names, how it spawns a subagent, and the settings file its model command saves a switch into. */
export type TheCrewToolsOfAHost = Pick<CrewToolPlaces, 'models' | 'spawn' | 'owners_settings' | 'usage_host'>

/**
 * The crew tools' places every host's start shares (martha#541 package A): built here once, with the host's own
 * places handed in, so a second host's start serves the same tools over the same stores as a Claude Code start.
 */
export function theCrewToolsOfAStart(start: AStartOnItsHost, sessions: NonNullable<CrewToolPlaces['sessions']>, served_tools: TheServedToolsWatch, host: TheCrewToolsOfAHost): HoldingTheWatch<CrewToolPlaces> {
  // One raising for this launch, and one channel carrier: the carrier counts a handed message taken in when the mod
  // reports the member's next main turn started (martha#253).
  const channel = start.channel
  return {
    ...theGitGuardPlaceOf(start.settings, start.member, start.crew_stores.crew),
    member: start.member,
    ledger: channel,
    beats: dashboardRowsIn(start.places.dashboard),
    root: start.root,
    documents: start.documents,
    stores: { crew: start.crew_stores.crew },
    carrier: carryingTo({ member: start.member, host: channel }),
    sessions,
    // What the launch watches of the crew tools it served (martha#658): 697 handed the member's
    // served window here, where the tools are built now that the launch body moved (#703).
    served_tools,
    // The stamps the host keeps its handovers with (martha#255), under the same crew directory: a handover one
    // session writes is the one its successor inherits.
    stamps: start.crew_stores.stamps,
    // The five tools that act run git and gh through the launcher's own processes, over the declaration's
    // workspace places: nothing that acts runs inside the member's session (martha#256).
    processes: thisMachine.processes,
    note: (line) => void process.stderr.write(`${line}\n`),
    settings: start.settings,
    // What a reboot deletes on this machine, read here and ruled on by ../tell_a_citer_of_a_volatile_path (martha#314).
    volatile_roots: machineRootsFrom(tmpdir(), process.env['XDG_RUNTIME_DIR']),
    launched_on: start.model ?? '',
    ...host,
    ...start.restart,
  }
}

/**
 * What every host's start builds alike from the start (martha#541 package A): the place the owner approved and the crew
 * tools' shared places, handed to the engine's start so its slice imports none of this file's values.
 */
export function theSharedOfAStart(start: AStartOnItsHost): TheSharedOfAStart {
  return {
    place: { host: THE_ENGINES_HOST, launch_dir: start.root, stop_dir: start.home, snapshot_root: start.snapshot_root, crew_text_files: crewTextFilesOf(start.settings), ...approvedPlace(start.member, start.approval, start.state) },
    crewTools: (sessions, served_tools, host) => theCrewToolsOfAStart(start, sessions, served_tools, host),
  }
}

/**
 * The request a Claude Code start hands its launcher (martha#784): one value, built here from the start and handed on
 * whole, as `leftoversOfALaunch` builds one field of it. The launch tests build their own request and the start tests
 * swap the whole host launcher, so nothing else reads what a real start hands on: without this, any field below could
 * be replaced by a literal at the call site with every test green.
 */
export function theLaunchOfAClaudeCodeStart(start: AStartOnItsHost, key: AMembersKey = { none: SOLO_MODE }): ClaudeCodeMemberLaunch {
  return {
    member_name: start.member,
    node_id: start.node_id,
    // A team member's own key, pinned into its mesh server (martha#1016); a solo crew's member has none.
    ...('path' in key ? { mesh_identity: key.path } : {}),
    place: { host: CLAUDE_CODE, launch_dir: start.root, stop_dir: start.home, snapshot_root: start.snapshot_root, crew_text_files: crewTextFilesOf(start.settings), ...approvedPlace(start.member, start.approval, start.state) },
    policy: { may_send_executable_text: [] },
    crew_settings: start.settings,
    owner_bell: start.settings.house_rules[OWNER_BELL],
    places: start.places,
    // The crew's own store and the layout it declared, so this launch's end keeps what a killed command left (#693):
    // the record the member's next start is told from, and the two refusals judge (a launch given none keeps nothing).
    leftovers: leftoversOfALaunch(start.settings, start.crew_stores.crew),
    command: start.command,
    args: [...(start.model === null ? [] : [THE_MODELS_SWITCH, start.model]), ...start.args, ...(start.prompt === undefined ? [] : [start.prompt])],
    inherited: start.inherited,
    stdio: start.stdio,
    tellOwner: (line) => start.tellOwner(line),
    ...(start.hear_relay_place === undefined ? {} : { hearRelayPlace: start.hear_relay_place }),
    ...(start.hear_session_start === undefined ? {} : { hearSessionStart: start.hear_session_start }),
    turns: turnsRaised(),
    crew_tools: (sessions, member) =>
      crewToolsOver(theCrewToolsOfAStart(start, sessions, member.served_tools, {
        models: CLAUDE_CODE_MODELS,
        spawn: CLAUDE_CODE_SUBAGENT_SPAWN,
        // The settings file the host's model command saves a switch into, and the lock that guards it (martha#359): the
        // member's own since martha#602. The owner's file was finished above, before the host started.
        owners_settings: theMembersSwitchPlace(start, member.config_dir),
      })),
    signed_runs: signedRunsOf(
      receiptsInMemory(),
      (name) => runAKeptShape(start.state, start.root, start.inherited, name, new Date()),
      // The names the owner has signed now, read when an answer is judged: a list replaced mid-session takes effect
      // on the next run, and one that no longer opens leaves nothing to keep the shell for (martha#129).
      () => signedShapeNames(start.state),
      CLAUDE_CODE_BASH_RESULT_SHAPES,
    ),
  }
}

/** The roster `martha up` kept in Martha's state (martha#1016): none when the file cannot be read. Crew mail and memory read it. */
export function readTheCrewsRoster(state: MarthaState): Readonly<Record<string, string>> {
  const read = readStateFile(join(state.directory, ROSTER_FILE))
  return theKeptRoster('text' in read ? read.text : '')
}

/** The Claude Code entry: today's launch, unchanged in behaviour, behind the table. */
async function startOnClaudeCode(start: AStartOnItsHost): Promise<MemberStarted> {
  // A team member whose key cannot be read is not started at all (martha#1016 T1): never on an identity its server makes up.
  const key = theMeshKeyOfAStart(start)
  if ('refusal' in key) {
    const refusal = `${NOT_STARTED}: ${key.refusal}`
    start.tellOwner(refusal)
    return { started: false, refusal }
  }
  await finishAnySwitchBeforeTheHostStarts(start)
  return launchClaudeCodeMember(theLaunchOfAClaudeCodeStart(start, key))
}

/** What a key's path is on this disk, as ../read_a_members_mesh_key asks it: lstat, never following a link; null when absent. */
export function seeAKeyFileOnDisk(path: string): AKeyFileSeen | null {
  try {
    const seen = fs.lstatSync(path)
    const kind = seen.isSymbolicLink() ? 'link' : seen.isFile() ? 'file' : 'other'
    return { kind, uid: seen.uid, mode: seen.mode, real: kind === 'file' ? fs.realpathSync(path) : path }
  } catch {
    // Nothing there, or a folder this user cannot look into: either way there is no key to read.
    return null
  }
}

/** Where a key path written in the declaration sits: under the owner's home for `~/`, itself when absolute, else under the project root. */
export const placeOfAWrittenKey = (home: string, root: string) => (written: string): string => {
  const out = writtenOut(written, home)
  return normalize(isAbsolute(out) ? out : join(root, out))
}

/** The key of the member a start is for, read on this disk under the owner's home and the project root (martha#1016). */
export function theMeshKeyOfAStart(start: Pick<AStartOnItsHost, 'member' | 'settings' | 'home'>, see: (path: string) => AKeyFileSeen | null = seeAKeyFileOnDisk): AMembersKey {
  return theMeshKeyOf(start.member, {
    team: isATeamMode(start.settings.mode.name),
    keys: start.settings.mesh_keys,
    members: start.settings.members.map((member) => member.name),
    placeOf: placeOfAWrittenKey(start.home, start.settings.paths.root),
    uid: process.getuid?.() ?? -1,
    see,
  })
}
