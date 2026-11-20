// An engine member's start (martha#541 package A, design r=1 steps 1-10 as r=2..r=7 amend them): the engine's entry in
// the start table. The member's model is built from its declaration and the crew's endpoint; the launch writes its root
// and starts the engine; the model is read back from the written root; the entry is the same core entry a Claude Code
// launch answers through, over the engine's own places; the crew's tools are served on the launch's socket; the ACP
// client drives the session, checks its mode, and hands every final result to the entry; the session's start and every
// turn are recorded before the engine sees anything; and the end stops the engine, reads its permission store, closes
// what was served and removes the launch's directory.

import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, type Stats } from 'node:fs'

import { THE_HOMES_PREFIX, writtenOut } from '../bring_up_the_declared_crew/declare_the_engines_endpoint.ts'
import type { ManagedSettingsPlace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { crewToolsOver, type CrewToolPlaces } from '../a_crews_tools/a_crews_tools.ts'
import { agentRunsKept, answersOver, type TheAnswersOfOneLaunch } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'
import { releasesIn } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { THE_EXTENSION_A_MEMBER_KEEPS, THE_MODE_THAT_ASKS_THE_CLIENT } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import { NOT_STARTED } from '../end_a_launch/end_a_launch.ts'
import { crewTextToHand, noCrewTextFor } from '../hand_a_member_its_crew_text/hand_a_member_its_crew_text.ts'
import { theOwnersAsks, type TheOwnersAsks } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'
import type { TurnSource } from '../host_contract/host_contract.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import type { HoldingTheWatch, TheServedToolsWatch } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import { appendStateLine, crewSubdirectory, readStateFile } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { relayJournalKeptIn } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import type { MemberStarted, MemberStopped } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { driveTheEngine, theSessionsGateKept } from '../launch_a_goose_member/drive_the_engine.ts'
import { launchTheGooseEngine, type AGooseLaunch } from '../launch_a_goose_member/launch_a_goose_member.ts'
import { theEnginesPlaces, type TheSharedPlaces } from '../launch_a_goose_member/the_engines_places.ts'
import { anEngineRelay } from '../launch_a_goose_member/the_engines_relay.ts'
import { theSessionStoreOf } from '../launch_a_goose_member/the_session_store_read_back.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { userSettingsPath } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { gateModeFor } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { ownerMemoryPlaces, userScopeUnder } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import type { SnapshotPlace } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { dropInFiles } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { NOTHING_IS_MUTED, theMuteOf, theMutedStartLine, type TheMute } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { theOwnersScreenOfALaunch, type TheScreenOfALaunch } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import { theEngineMembersTurns, type ATurnToSend, type TheEngineMembersTurns, type WhatATurnDid } from '../send_an_engine_member_its_turns/the_engine_members_turns.ts'
import { theCrewsMessagesAsTurns, type TheCrewsMessagesAsTurns } from '../send_an_engine_member_its_turns/the_crews_messages_as_turns.ts'
import { carryingTo } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { THE_CREWS_TOOL_SERVER } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_words.ts'
import { anOwnerActStandsBehind, forgetTheRoute, keepTheRoute, serveTheOwnersAnswers, THE_ANSWER_ROUTES_PLACE, THE_OWNERS_ANSWERS_FILE, type TheRouteServed } from '../serve_the_owners_answers/the_owners_answer_route.ts'
import { reviewSpawnsRemembered } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { mintALaunchToken } from '../serve_the_relay_to_a_launch/the_launchs_token.ts'
import { serveTheRelay, type RelayServer } from '../serve_the_relay_to_a_launch/serve_the_relay.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { isOnTheOwnersTerminal } from '../start_the_member_on_the_owners_terminal/member_on_the_owners_terminal.ts'
import type { AStartOnItsHost, TheCrewToolsOfAHost } from '../start_the_member_on_its_host/start_the_member_on_its_host.ts'
import { theMembersTelling } from '../tell_the_member_a_line/tell_the_member_a_line.ts'
import { theModelOfAnEngineMember, whyAKeyFileIsNotTheOwners, whyTheConfigRunsAnotherModel } from './the_engines_model.ts'
import { ENGINE_ENDPOINT } from '../declare_crew/declare_crew.ts'

/** What every host's start builds alike from the start, handed in by the start table so this slice imports none of it. */
export interface TheSharedOfAStart {
  /** The place the owner approved, as every host's start builds it. */
  readonly place: SnapshotPlace
  /** The crew tools' places every host's start shares, with this host's own handed in. */
  readonly crewTools: (sessions: NonNullable<CrewToolPlaces['sessions']>, served_tools: TheServedToolsWatch, host: TheCrewToolsOfAHost) => HoldingTheWatch<CrewToolPlaces>
}

/** A test's hands on a start; a real start gives none. */
export interface TheEnginesStartSeams {
  /** Runs after the engine started and before its session is opened. */
  readonly before_the_session?: (launch: AGooseLaunch) => void
  /** Hears what each turn came to, and the text the engine answered it with. */
  readonly heard_a_turn?: (turn: ATurnToSend, did: WhatATurnDid) => void
}

/** What an owner installs when the engine is not on their path: the recorded engine, at the version and commit recorded. */
export const THE_ENGINES_INSTALL = `${RECORDED_GOOSE_ENGINE.engine_name} ${RECORDED_GOOSE_ENGINE.engine_version}, built from commit ${RECORDED_GOOSE_ENGINE.engine_commit}`

/** The socket the owner's answers reach this launch on, in the launch's own directory. */
export const THE_ANSWER_SOCKET = 'owner-answers.sock'

/** The source the start's own prompt is recorded under: the line the owner's start command hands the member. */
export const THE_START_PROMPTS_SOURCE: TurnSource = 'owner_typed'

/**
 * The served-tools watch of an engine launch. Claude Code reports which crew tools it served in its own journal; the
 * engine reports nothing of the kind, so every session's fact is unknown, which the window reads as "not known to be
 * held", never as held (martha#541 package A: said plainly in the handoff).
 */
const NOTHING_REPORTED: TheServedToolsWatch = {
  factOf: () => ({ state: 'unknown' }),
  predecessorOf: () => null,
  takeTheCalls: () => [],
}

/**
 * What the launch is given before anything is made: the member's model at the crew's endpoint, and the owner's Claude Code
 * user settings file. The owner's Claude Code settings watch is not run here (martha#601 row 174): those are Claude Code's
 * own files, which an engine member never reads, so a setting that turns hooks off neither refuses an engine start nor
 * stops it while it works. A CLAUDE_CONFIG_DIR that cannot be resolved is still refused: the owner's user settings file is
 * not one file, it places the owner's whole Claude config folder (`ownerMemoryPlaces` builds that folder's settings,
 * CLAUDE.md, rules and output styles from it), and an unresolvable value would leave all of it unguarded for a member's
 * writes — a leak, which is one of the three a refusal stays for. Or why the launch cannot start at all.
 */
function whatTheLaunchIsGiven(start: AStartOnItsHost) {
  const model = theModelOfAnEngineMember({ facts: RECORDED_GOOSE_ENGINE, member: start.member, model: start.model, endpoint: start.settings.engine_endpoint, environment: start.inherited, readTheKeyFile: (key_file) => theKeyInTheOwnersFile(key_file, start.home) })
  if ('refusal' in model) return model
  const user = userSettingsPath(start.inherited)
  if ('refusal' in user) return user
  return { model, managed: RECORDED_HOST.managed_settings, owners_settings_file: user.path }
}

/** The owner's settings files a member's writes are held away from: the host's managed ones, and the user's own file. */
function theOwnersSettingsFiles(managed: ManagedSettingsPlace, owners_settings_file: string): readonly string[] {
  return [join(managed.dir, managed.file), ...dropInFiles(join(managed.dir, managed.drop_in)), owners_settings_file]
}

/**
 * The key in the file the crew's endpoint names, as the declaration writes it (martha#931): a provider's `~/` path written
 * out against the owner's home first, then read as theKeyInAFile reads one.
 */
export const theKeyInTheOwnersFile = (key_file: string, home: string): ReturnType<typeof theKeyInAFile> => theKeyInAFile(writtenOut(key_file, home))

/**
 * The key in the file the crew's endpoint names by its absolute path (martha#511 part B): only this user's own plain file, closed to the group and to others, and never a link, since a link's own mode says nothing of
 * its target. The key is trimmed of the line end a file ends with and never named in a refusal.
 */
export function theKeyInAFile(at: string): { readonly key: string } | { readonly refusal: string } {
  // A provider's key file is kept as the owner wrote it (martha#931); written out, it must be absolute, or it would be read against wherever the start runs.
  if (!isAbsolute(at)) return { refusal: `the key file ${at} is not an absolute path or one under ${THE_HOMES_PREFIX}` }
  let found: Stats
  try {
    found = lstatSync(at)
  } catch (error) {
    return { refusal: `${ENGINE_ENDPOINT}.key_file ${at} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
  const why = whyAKeyFileIsNotTheOwners(at, { plain_file: found.isFile(), owner_is_this_user: found.uid === process.getuid?.(), mode: found.mode })
  if (why !== undefined) return { refusal: why }
  const key = readFileSync(at, 'utf8').trim()
  return key === '' ? { refusal: `${ENGINE_ENDPOINT}.key_file ${at} is empty` } : { key }
}

/** The launch's config read back to the declared model, then the crew text composed from what the launch carried; or why not. */
function theCrewTextOfALaunchHeldToItsModel(start: AStartOnItsHost, launch: AGooseLaunch, model: string): { readonly text: string } | { readonly refusal: string } {
  const another = whyTheConfigRunsAnotherModel(readFileSync(launch.config_at, 'utf8'), launch.config_at, model)
  if (another !== undefined) return { refusal: another }
  const crew = crewTextToHand(start.settings, start.member, launch.carried_files, thisMachine.stores.files)
  return 'refusal' in crew ? { refusal: noCrewTextFor(start.member, crew.refusal) } : crew
}

/** The engine's entry in the start table: one engine member started, or why not. */
export async function startOnTheEngine(start: AStartOnItsHost, shared: TheSharedOfAStart, seams: TheEnginesStartSeams = {}): Promise<MemberStarted> {
  const facts = RECORDED_GOOSE_ENGINE
  const notStarted = (why: string): MemberStarted => ({ started: false, refusal: `${NOT_STARTED}: ${why}` })
  const before = whatTheLaunchIsGiven(start)
  if ('refusal' in before) return notStarted(before.refusal)
  const { model, managed, owners_settings_file } = before

  const token = mintALaunchToken()
  const launch = await launchTheGooseEngine({ facts, binary: start.command, place: shared.place, relay_root: start.places.relay_root, model, tool_server: { token } })
  if ('refusal' in launch) return { started: false, refusal: launch.refusal }
  const ending = async (why: string): Promise<MemberStarted> => {
    await launch.end()
    return notStarted(why)
  }
  const crew = theCrewTextOfALaunchHeldToItsModel(start, launch, model.model)
  if ('refusal' in crew) return ending(crew.refusal)

  const sessions = new Map<string, HostSession>()
  const session_gate = theSessionsGateKept()
  const places = theEnginesPlaces(theSharedPlacesOf(start, shared, launch, sessions, crew.text), {
    facts,
    root: launch.places.root,
    home: start.home,
    owners_settings_file,
    owner_memory: ownerMemoryPlaces({
      launcher_env: start.inherited,
      member_env: start.inherited,
      home: start.home,
      launch_dir: start.root,
      martha_state_root: start.state.state_root,
      settings_files: theOwnersSettingsFiles(managed, owners_settings_file),
      user_scope: userScopeUnder(start.home),
    }),
    launcher_env: start.inherited,
    settings_still_hold: launch.settings_still_hold,
    the_sessions_gate: () => session_gate.get(),
  })
  if ('refusal' in places) return ending(places.refusal)
  const answers = answersOver(places, sessions)

  let relay: RelayServer
  try {
    relay = await serveTheRelay(anEngineRelay(answers), launch.socket_path, token)
  } catch (error) {
    return ending(`its relay socket could not be served (${(error as NodeJS.ErrnoException).code ?? String(error)})`)
  }
  const asked = await theAsksServed(start, launch)
  if ('refusal' in asked) {
    await relay.close()
    return ending(asked.refusal)
  }
  return theStartRuns(start, seams, { launch, answers, relay, asked, session_gate, launched: { mode: THE_MODE_THAT_ASKS_THE_CLIENT, provider: model.provider, model: model.model, extensions: [THE_EXTENSION_A_MEMBER_KEEPS, THE_CREWS_TOOL_SERVER] } })
}

/**
 * What every host's entry is given alike (design G1): the same values a Claude Code launch hands its entry, built from
 * the start. Nothing is carried into the engine's own root, so the sources a start hands the model are the checkout's
 * files the engine attaches with no tool call (`text_a_start_loads`, A25 and A26).
 */
function theSharedPlacesOf(start: AStartOnItsHost, shared: TheSharedOfAStart, launch: AGooseLaunch, sessions: Map<string, HostSession>, crew_text: string): TheSharedPlaces {
  const rows = rowStreamsDirectory(start.places.rows)
  const journal = relayJournalKeptIn(start.places.relay_journal, shared.place.since_approval?.launch_id ?? randomUUID())
  const place = shared.place
  return {
    records: sessionRecordsIn(rows, releasesIn(rows)),
    launch: {
      host: place.host,
      launch_dir: place.launch_dir,
      stop_dir: place.stop_dir,
      approved_fingerprints: place.approved_fingerprints,
      ...(place.since_approval === undefined ? {} : { since_approval: place.since_approval }),
    },
    machine: thisMachine,
    binder: bindNothing,
    handed_at_start: [...new Set(launch.text_a_start_loads.map((text) => text.source))],
    // The engine runs any model its delegate is handed and spawns no subagent Martha names, and it has no settings file
    // of its own the model command switches: the crew tools are given its models and neither of the other two.
    crew: crewToolsOver(shared.crewTools({ of: (session_id) => sessions.get(session_id) }, NOTHING_REPORTED, { models: RECORDED_GOOSE_ENGINE.subagent_models })),
    crew_text,
    // The same kept table a Claude Code launch keeps: empty, because the engine spawns no review Martha names.
    reviews: reviewSpawnsRemembered(),
    agents: agentRunsKept(),
    told: theMembersTelling({ member: start.member, dashboard: start.places.dashboard, rows: start.places.rows, journal }),
    policy: { may_send_executable_text: [] },
    gate: gateModeFor(start.settings.gate, start.member),
    audit: start.places.gate_audit === undefined ? undefined : { directory: start.places.gate_audit, member: start.member, lines: { append: appendStateLine, read: readStateFile } },
    journal,
  }
}

/** What an engine member's owner's screen is made from: its row, its bells, its terminal, and the notices its crew shows. */
export const theScreenAnEngineStartSees = (start: Pick<AStartOnItsHost, 'member' | 'places' | 'settings' | 'stdio'>, muted: () => boolean): TheScreenOfALaunch => ({
  member: start.member,
  beats: dashboardRowsIn(start.places.dashboard),
  declared_bells: start.settings.house_rules.owner_bell,
  muted,
  on_the_owners_terminal: isOnTheOwnersTerminal(start.stdio),
  environment: process.env,
  write: (bytes) => void process.stdout.write(bytes),
  shown_notices: start.settings.owner_notices.show,
})

/** The owner's asks of this launch, served on a route `martha answer` finds by the member's name; or why not. */
async function theAsksServed(start: AStartOnItsHost, launch: AGooseLaunch): Promise<{ readonly asks: TheOwnersAsks; readonly route: TheRouteServed; readonly routes: string } | { readonly refusal: string }> {
  const routes = crewSubdirectory(start.state.state_root, start.root, THE_ANSWER_ROUTES_PLACE)
  if ('refusal' in routes) return routes
  const answers_typed = join(start.state.directory, THE_OWNERS_ANSWERS_FILE)
  const mute = (): TheMute => (start.places.bells === undefined ? NOTHING_IS_MUTED : theMuteOf({ directory: start.places.bells, lines: { append: appendStateLine, read: readStateFile } }, start.member))
  if (mute().muted) start.tellOwner(theMutedStartLine(start.member))
  const asks = theOwnersAsks({
    screen: theOwnersScreenOfALaunch(theScreenAnEngineStartSees(start, () => mute().muted)),
    now: Date.now,
    anOwnerActStandsBehind: (heard) => {
      const read = readStateFile(answers_typed)
      return typeof read === 'string' && anOwnerActStandsBehind(read, start.member, heard)
    },
  })
  const route = await serveTheOwnersAnswers(join(launch.directory, THE_ANSWER_SOCKET), asks)
  if ('refusal' in route) return route
  keepTheRoute(routes.path, { member: start.member, socket_path: route.socket_path, pid: process.pid })
  return { asks, route, routes: routes.path }
}

/** What the running start holds. */
interface ARunningStart {
  readonly launch: AGooseLaunch
  readonly answers: TheAnswersOfOneLaunch
  readonly relay: RelayServer
  readonly asked: { readonly asks: TheOwnersAsks; readonly route: TheRouteServed; readonly routes: string }
  readonly session_gate: ReturnType<typeof theSessionsGateKept>
  readonly launched: { readonly mode: string; readonly provider: string; readonly model: string; readonly extensions: readonly string[] }
}

/** The session opened and driven, its start recorded, the start's prompt queued; the member's end, whenever it comes. */
async function theStartRuns(start: AStartOnItsHost, seams: TheEnginesStartSeams, running: ARunningStart): Promise<MemberStarted> {
  const { launch, answers, relay, asked } = running
  let stopped_because: string | null = null
  const stopMember = (why: string): void => {
    if (stopped_because !== null) return
    stopped_because = why
    start.tellOwner(`${start.member} is stopped: ${why}`)
    launch.engine.stop()
  }
  const theEnd = async (): Promise<MemberStopped> => {
    await launch.engine.exited
    await relay.close()
    await asked.route.close()
    forgetTheRoute(asked.routes, start.member)
    const ended = await launch.end()
    if (!ended.permissions.empty) start.tellOwner(ended.permissions.refusal)
    return { exit_code: launch.engine.child.exitCode, signal: launch.engine.child.signalCode, stopped_because }
  }
  const notStarted = async (why: string): Promise<MemberStarted> => {
    stopMember(why)
    await theEnd()
    return { started: false, refusal: `${NOT_STARTED}: ${why}` }
  }

  seams.before_the_session?.(launch)
  const driven = await driveTheEngine({
    facts: RECORDED_GOOSE_ENGINE,
    child: launch.engine.child,
    launch_dir: launch.places.checkout,
    store: theSessionStoreOf(RECORDED_GOOSE_ENGINE, launch.places.root),
    launched: running.launched,
    answers,
    session_gate: running.session_gate,
    decideOver: (gate) => asked.asks.decide(gate, []),
    stopMember,
  })
  if ('refusal' in driven) return notStarted(driven.refusal)
  const begun = await answers.inOrder(async () => answers.aSessionStarted({ session_id: driven.session_id, outcome: 'fresh' }))
  if ('refused' in begun) return notStarted(begun.refused)

  // What the entry hands the session as it starts (the crew text among it) goes ahead of the first turn's text: the
  // engine has no hook that adds context, so the first prompt carries it, recorded by the start above.
  let handed = begun.taken
  const turns = theEngineMembersTurns(start.member, {
    session_id: driven.session_id,
    aTurnArrived: async (session_id, turn) => answers.inOrder(async () => answers.aTurnArrived(session_id, turn)),
    send: async (session_id, text) => {
      const ahead = handed
      handed = ''
      return driven.client.prompt(session_id, ahead === '' ? text : `${ahead}\n\n${text}`)
    },
    tell: (line) => start.tellOwner(line),
  })
  if (start.prompt !== undefined) {
    const turn: ATurnToSend = { text: start.prompt, arrival: { source: THE_START_PROMPTS_SOURCE } }
    void turns.take(turn).then((did) => seams.heard_a_turn?.(turn, did))
  }
  const crew = theCrewsTurnsOf(start, turns, seams)
  const stopped = launch.engine.exited.then(() => crew.stop()).then(theEnd)
  return { started: true, pid: launch.engine.pid, stopped, stop: stopMember }
}

/** Milliseconds in a second: the crew's read interval is declared in seconds. */
const THE_MS_IN_A_SECOND = 1000

/**
 * The crew's messages for this member, become its turns (martha#511 part B): read by the launch at the crew's own read
 * interval, through the same carrier a Claude Code member's mod asks, until the start stops the reader.
 */
function theCrewsTurnsOf(start: AStartOnItsHost, turns: TheEngineMembersTurns, seams: TheEnginesStartSeams): TheCrewsMessagesAsTurns {
  return theCrewsMessagesAsTurns({
    carrierOf: () => carryingTo({ member: start.member, host: start.channel }),
    turns,
    every_ms: start.settings.channel_read_seconds * THE_MS_IN_A_SECOND,
    ...(seams.heard_a_turn === undefined ? {} : { heard: seams.heard_a_turn }),
  })
}
