// The `martha` command a stranger types (martha#98): `martha init`, `martha approve`, `martha start <member>`,
// `martha ls`, `martha stop [<member>]` and `martha restart <member> [--fresh]` (martha#312), `martha todo` (martha#316), `martha install`, and `martha --version`.
//
// This exists so a person who installed Martha gets a solo crew running without writing code or knowing its
// internals. It is the one place that reads the machine's environment, and only to find places: the project
// (the git top of the working directory), the owner's home, Martha's state root ($XDG_STATE_HOME/martha, else
// ~/.local/state/martha) and the root of the relay sockets ($XDG_RUNTIME_DIR, else /tmp, in a directory of
// this user's own). Every act is a slice of its own that takes those places as arguments.
//
// What it says: a refusal, and every line an act tells the owner, goes to stderr prefixed `martha:`, as
// martha-install does. Every line it shows has its terminal controls written out as escapes first (shownSafely),
// since a path, a member's name or a kept approval may hold bytes a terminal would act on. An error no act
// expected is shown the same way, as one refused line, never as Node's own trace. `--version` prints the release's version on stdout; `init` prints the members it
// declared; `start` prints one line naming the member and its pid once it is up, then holds the terminal until
// the member ends, and ends the way the member did; a restart asked of it starts it again on the same terminal. Exit 0 is done, 1 refused, 2 not a way the command is used.

import { spawnSync, type StdioOptions } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { constants } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { isatty } from 'node:tty'

import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { approveConfig, NOTHING_TO_APPROVE, type OwnersTerminal } from '../approve_a_checkouts_config/approve_a_checkouts_config.ts'
import { installThePinnedInstaller } from '../install_the_pinned_installer/install_the_pinned_installer.ts'
import { installWordsAreAWay } from '../read_the_words_of_martha_install/read_the_words_of_martha_install.ts'
import { floorRecordOf, launchBelowTheFloor, readTheRecord, releaseVersionOf } from '../hold_the_launch_to_the_version_floor/hold_the_launch_to_the_version_floor.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, declareCrew, OWNER_BELL, sameMemberName, THE_ENGINES_HOST, theHostOfMember, type CrewSettings, type Member } from '../declare_crew/declare_crew.ts'
import { noCrewDeclaredAt, upStarts } from '../bring_up_the_declared_crew/bring_up_the_declared_crew.ts'
import { declareTheEnginesEndpoint } from '../bring_up_the_declared_crew/declare_the_engines_endpoint.ts'
import { theKeyInAFile } from '../start_an_engine_member/start_an_engine_member.ts'
import { ADD, aChangedDeclaration, REMOVE, theChangeTold, theCrewChangeAsked, type CrewChange } from '../declare_crew/change_a_member.ts'
import { writeAChangedDeclaration } from '../declare_a_solo_crew/write_a_changed_declaration.ts'
import { THE_VOCABULARIES_OF_HOST } from '../start_the_member_on_its_host/start_the_member_on_its_host.ts'
import { CLAUDE_CODE_MODELS } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { appendStateLine, crewRowsDirectory, crewStateDirectory, nodeIdsFor, openState, readApprovals, readStateFile, stateSubdirectory, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { theLeftoversThisMachineShows } from '../read_a_kernel_and_a_home/read_a_kernel_and_a_home.ts'
import { stateRootOf } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { OWNER_TODO_STREAM, theListForTheTerminal, theOpenRows } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { keepTheCrewsFilesAsDirectories, handoverStampsIn } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import type { TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { wakeAMember } from '../wake_a_member/wake_a_member.ts'
import { launcherPlacesOf, NOT_A_TERMINAL as START_NEEDS_A_TERMINAL, startMember } from '../start_a_member/start_a_member.ts'
import type { MemberStarted } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { keepCommandShapes, pinOwnerKey, SIGNATURE_SUFFIX } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { askTheLauncherToRun } from '../run_an_owner_signed_command/ask_the_launcher_to_run.ts'
import { drawTheCrewStrip, holdOnThisTerminal, isRunning, restartTheMember, stopTheCrew, theCrewListed, type TheCrewsPlaces } from '../list_stop_and_restart_the_crew/list_stop_and_restart_the_crew.ts'
import { KITTY_PLACE, kittySaysOnThisMachine, openTheCrewInKitty, startKittyDetached, writeOwnerOnly } from '../open_the_crew_in_kitty/open_the_crew_in_kitty.ts'
import { THE_COMPOSER_SETTLES_MS, TMUX_PLACE, attachOnThisTerminal, attachToTheCrew, isMarthasOwnSocket, openTheCrewInTmux, tmuxOnThisMachine, tmuxSaysOnThisMachine, typeTheFirstPrompt } from '../open_the_crew_in_tmux/open_the_crew_in_tmux.ts'
import { opensInTmux, thePaneOnMarthasServer, theSocketOfThisTmux, whyNotAFirstPrompt } from '../open_the_crew_in_tmux/the_commands_tmux_runs.ts'
import { THE_FIRST_PROMPT_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { TAB_OF } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { kittenOnThisMachine, theStripsKitten } from '../open_the_crew_in_kitty/the_strips_kitten.ts'
import { EXIT_DONE, EXIT_REFUSED, EXIT_USAGE, refused, showingSafely, tellOwnerOn } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { releaseAHeldMember, toldOfARelease } from '../release_a_held_member/release_a_held_member.ts'
import { bellsOf, theBellsTold, theFlipNamed } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { gateModeFor } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { gateOf, sayWhatTheGateDoes } from '../say_what_the_gate_does/say_what_the_gate_does.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { RESTART, STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { whyAnOwnersActIsRefusedInsideAMember, type AProcessAbove } from '../refuse_an_owner_act_from_inside_a_member/refuse_an_owner_act_from_inside_a_member.ts'
import { ancestorsUnder, PROC_ROOT } from '../linux_process_identity/process_identity_from_proc.ts'
import { SYSTEM_TEMPORARY_DIRECTORY } from '../host_contract/host_contract.ts'
import { launchRecordsUnder } from '../read_a_kernel_and_a_home/launch_records_under_a_state_root.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { launchesIn } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { CONFIG_DIR_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { MEMBER_CONFIG_FOLDER } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { answerInAProject, answerOf } from '../serve_the_owners_answers/martha_answer.ts'
import { keepWhereItWasTyped, linesOf, seenFromThisProcess, theCutoverTakenOnce, theRecordFilesOf, whatTheOwnerReadsOf } from '../keep_where_owners_acts_were_typed/keep_where_owners_acts_were_typed.ts'

/** The line `martha start` prints once the member is up: its name and its pid. */
export const startedLine = (member: string, pid: number | string): string => `${member} started, pid ${pid}`

/** How the command is used. */
export const USAGE =
  'usage: martha init | martha up [--prompt <text>] | martha attach [<member>] | martha approve | martha todo | martha start [<member> [--prompt <text>] [-- <claude arguments>]] | martha wake <member> | martha release <member> | martha bells [<member> muted|heard] | martha gate [--member <name>] | martha answer [<member> <key> allow|reject] | martha ls | martha stop [<member>] | martha restart <member> [--fresh] | martha crew [add <member> <role> [--model <model>] [--host <host>] | remove <member> | set-model <member> <model>|--host-default | set-host <member> <host>|--crew-default] | martha run <shape> | martha install [<version>] [--downgrade] [--digest sha256:<hex>] [--withdrawal-in <version>] | martha pin-key <public key file> | martha keep-shapes <signed list> | martha version | martha help'

/** Why an owner's act is refused where no owner is at the keyboard. */
export const OWNERS_ACT_NEEDS_A_TERMINAL = 'only the owner, at a terminal, pins a key or keeps a signed list, and this is no terminal.'

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** Where the command reads and writes, and what it says. */
export interface CommandIo {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  readonly terminal: OwnersTerminal
  out(line: string): void
  err(line: string): void
  /** Writes bytes to stdout as they are: a signed run's output, which must reach the host unchanged (martha#129). */
  outBytes(bytes: Buffer): void
  /** The processes above this one, the parent first (martha#619); this process's own, from /proc, unless a test gives its own. */
  readonly ancestors?: () => readonly AProcessAbove[]
}

/** The places every act needs. */
interface Places {
  readonly root: string
  readonly home: string
  readonly state: MarthaState
}

const absolute = (path: string | undefined): string | undefined => (path !== undefined && isAbsolute(path) ? path : undefined)

/** git's answer in `cwd`, or undefined when git gave none. */
function gitSays(cwd: string, ...args: string[]): string | undefined {
  const run = spawnSync('git', marthasOwnGitArgs(args), { cwd, encoding: 'utf8' })
  const said = run.status === 0 ? run.stdout.trim() : ''
  return said === '' ? undefined : said
}

/** The project, the home and the state the acts work in; or why there are none. */
function placesOf(io: CommandIo): Places | string {
  const home = absolute(io.env['HOME'])
  if (home === undefined) return 'HOME is not set to an absolute path, so Martha cannot tell where your home is.'
  // A folder in no checkout is its own crew's root (martha#511): the owner's workspace, where `martha up` declares a
  // team, is not a checkout, and the crew's state is keyed by its real path (crewKeyOf).
  const root = gitSays(io.cwd, 'rev-parse', '--show-toplevel') ?? io.cwd
  const state_root = stateRootOf(home, io.env['XDG_STATE_HOME'])
  const state = openState(state_root, root)
  return 'refusal' in state ? state.refusal : { root, home, state }
}

/** The root of the release this command is part of: its package.json, and the pin that release carries. */
const releaseTree = (): string => join(import.meta.dirname, '..', '..')

/** Why this release may not launch below this machine's version floor, found from its own real path (martha#21). */
function belowTheFloor(): string | undefined {
  const record = floorRecordOf(realpathSync(releaseTree()))
  return record === undefined ? undefined : launchBelowTheFloor(record, readTheRecord(record, (path) => readFileSync(path, 'utf8')), version())
}

/** The version of the release this command is part of. */
const version = (): string => releaseVersionOf(releaseTree(), (path) => readFileSync(path, 'utf8'))

async function init(io: CommandIo, places: Places): Promise<number> {
  // The owner and the origin are both read here, where Martha's own git runs: the origin is what says whether the
  // checkout's path can prove a workspace layout (martha#611), and the declaration slice reads it as a value.
  const declared = await declareSoloCrew({ root: places.root, owner: gitSays(places.root, 'config', 'user.name') ?? null, origin: gitSays(places.root, 'remote', 'get-url', 'origin') ?? null, state: places.state, documents, models: CLAUDE_CODE_MODELS, host: CLAUDE_CODE })
  if (!declared.declared) return refused(io, declared.refusal)
  io.out(`Declared a solo crew in ${declared.declaration}: ${declared.settings.members.map((member) => member.name).join(', ')}.`)
  io.out(declared.workspace)
  return EXIT_DONE
}

async function approve(io: CommandIo, places: Places): Promise<number> {
  const tellOwner = tellOwnerOn(io)
  const outcome = await approveConfig({ ...places, terminal: io.terminal, documents, tellOwner, now: () => new Date() })
  if (outcome.kind === 'refused') return refused(io, outcome.refusal)
  io.out(outcome.kind === 'nothing' ? NOTHING_TO_APPROVE : `Approved: fingerprint ${outcome.fingerprint}.`)
  return EXIT_DONE
}

/**
 * `martha todo` (martha#316): the owner's to-do list, every command in full under what it does, for a crew that never
 * turned the pane on. It reads the crew's rows and writes nothing.
 */
async function todo(io: CommandIo, places: Places): Promise<number> {
  const rows = crewRowsDirectory(places.state.state_root, places.root)
  if ('refusal' in rows) return refused(io, rows.refusal)
  const open = theOpenRows(await rowStreamsDirectory(rows.path).read(OWNER_TODO_STREAM))
  for (const line of theListForTheTerminal(open, Date.now())) io.out(line)
  return EXIT_DONE
}

/** The exit status of a member that ended: its own, or 128 plus the signal that ended it, as a shell reports one. */
function exitOf(stopped: { readonly exit_code: number | null; readonly signal: string | null }): number {
  if (stopped.exit_code !== null) return stopped.exit_code
  const signal = constants.signals[stopped.signal as keyof typeof constants.signals]
  return signal === undefined ? EXIT_REFUSED : 128 + signal
}

async function start(io: CommandIo, places: Places, member: string, args: readonly string[], prompt?: string): Promise<number> {
  const typing = prompt === undefined ? undefined : await theFirstPromptTyped(io, places, member, prompt)
  if (typeof typing === 'string') return refused(io, typing)
  const started = await startingTheMember(io, places, member, args, undefined, typing)
  if (!started.started) return EXIT_REFUSED
  io.out(startedLine(member, started.pid))
  return held(io, places, member, args, started)
}

/** Why `--prompt` is refused outside a window of Martha's tmux (martha#919): where it works, and how the owner gets there. */
export const aFirstPromptNeedsMarthasTmux = (): string =>
  `${THE_FIRST_PROMPT_SWITCH} types your first turn into the member's own window of Martha's tmux, and this is no such window. Declare "terminal": "tmux" in .martha/martha.json and run: martha ${UP} ${THE_FIRST_PROMPT_SWITCH} <text>`

/**
 * What types the owner's first prompt into `member` once its session starts (martha#919), as the owner's own keys in the
 * member's pane of Martha's tmux, never as a word on the host's command line; or why it cannot. It types once: a later
 * start of the same session (a /clear, a resume) is not given the prompt again.
 */
async function theFirstPromptTyped(io: CommandIo, places: Places, member: string, prompt: string): Promise<(() => void) | string> {
  const why = whyNotAFirstPrompt(prompt)
  if (why !== undefined) return `martha start cannot type ${member}'s first prompt: ${why}.`
  const pane = thePaneOnMarthasServer(io.env)
  if (pane === undefined) return aFirstPromptNeedsMarthasTmux()
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return crew
  const declared = crew.settings.members.find((one) => sameMemberName(one.name, member))
  if (declared !== undefined && theHostOfMember(crew.settings, declared) !== CLAUDE_CODE) return `${member} runs on ${theHostOfMember(crew.settings, declared)}, and ${THE_FIRST_PROMPT_SWITCH} types into a Claude Code member's composer only.`
  const tmux = marthasTmuxFor(io, places, crew.settings)
  if ('refusal' in tmux) return tmux.refusal
  if (!isMarthasOwnSocket(tmux, theSocketOfThisTmux(io.env)!)) return aFirstPromptNeedsMarthasTmux()
  let typed = false
  return () => {
    if (typed) return
    typed = true
    setTimeout(() => {
      const failed = typeTheFirstPrompt(tmux, pane, prompt)
      if (failed !== undefined) tellOwnerOn(io)(`${member}'s first prompt was not typed in: ${failed}`)
    }, THE_COMPOSER_SETTLES_MS).unref()
  }
}

/**
 * The member held on this terminal until it ends (martha#312): each restart asked of it ends it and starts it again
 * here, through the same start, so the approval gate runs again; a restart whose start is refused ends the hold.
 */
async function held(io: CommandIo, places: Places, member: string, args: readonly string[], first: Extract<MemberStarted, { started: true }>): Promise<number> {
  const launcher = launcherOf(io, places)
  const crew = crewStateDirectory(places.state.state_root, places.root)
  if ('refusal' in launcher || 'refusal' in crew) return exitOf(await first.stopped)
  const again = async (prompt: string | undefined): Promise<MemberStarted> => {
    const started = await startingTheMember(io, places, member, args, prompt)
    if (started.started) io.out(startedLine(member, started.pid))
    return started
  }
  const end = await holdOnThisTerminal({ launcher, crew: crew.path }, member, first, again, tellOwnerOn(io))
  return end.kind === 'ended' ? exitOf(end.ended) : EXIT_REFUSED
}

/**
 * `martha wake <member>` (martha#255 part 2): the member unparked and started from its newest handover. Every refusal
 * is told to the owner before anything is started, and the member holds the terminal afterwards exactly as `martha
 * start` does, so the two verbs end the same way.
 */
async function wake(io: CommandIo, places: Places, member: string): Promise<number> {
  const crew = crewStateDirectory(places.state.state_root, places.root)
  if ('refusal' in crew) return refused(io, crew.refusal)
  const declaration = await theDeclarationsOf(places)
  if (typeof declaration === 'string') return refused(io, declaration)
  let running: MemberStarted | undefined
  const woken = await wakeAMember(
    { stores: { crew: keepTheCrewsFilesAsDirectories(crew.path) }, stamps: handoverStampsIn(crew.path) },
    { member, declaration, at: new Date() },
    async (asking) => {
      const started = await startingTheMember(io, places, asking.member, [], asking.prompt)
      running = started
      return started.started ? { started: true } : { started: false, refusal: started.refusal }
    },
  )
  if ('refusal' in woken) return woken.told_by_the_start === true ? EXIT_REFUSED : refused(io, woken.refusal)
  io.out(`${woken.member} woken from ${woken.handover.file}`)
  if (woken.park.kind === 'could_not_be_cleared') tellOwnerOn(io)(`${woken.member} is running, but its park could not be cleared: ${woken.park.refusal}`)
  return running !== undefined && running.started ? held(io, places, member, [], running) : EXIT_DONE
}

/** The declaration as parking and waking read it; or why it could not be read. */
async function theDeclarationsOf(places: Places): Promise<TheDeclaration | string> {
  try {
    const settings = await declareCrew(documents, places.root, CLAUDE_CODE_MODELS)
    return { members: settings.members.map((member) => ({ name: member.name, role: member.role })), mode: { may: settings.mode.may } }
  } catch (error) {
    return `the crew's declaration could not be read: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * The member started on this project, its refusal told to the owner in the words the launcher gives: `prompt` is
 * Martha's own, and is added after the owner's arguments rather than passing the switch rule they pass.
 */
async function startingTheMember(
  io: CommandIo,
  places: Places,
  member: string,
  args: readonly string[],
  prompt?: string,
  heardSessionStart?: () => void,
): Promise<MemberStarted> {
  const launcher = launcherOf(io, places)
  if ('refusal' in launcher) {
    tellOwnerOn(io)(launcher.refusal)
    return { started: false, refusal: launcher.refusal }
  }
  return startMember({
    ...places,
    member,
    args,
    is_terminal: io.terminal.is_terminal,
    places: launcher,
    inherited: io.env,
    stdio: io.stdio,
    documents,
    tellOwner: tellOwnerOn(io),
    ...(prompt === undefined ? {} : { initial_prompt: prompt }),
    ...(heardSessionStart === undefined ? {} : { hear_session_start: heardSessionStart }),
  })
}

/** The directory this user's launches keep their relay roots under: inside the runtime directory they were given when it is an absolute path, and under the system's own temporary directory when they were given none. */
export const theCommandsRuntimeDirectory = (runtime: string | undefined): string => join(absolute(runtime) ?? SYSTEM_TEMPORARY_DIRECTORY, `martha-${process.getuid?.()}`)

/** The launcher's places in Martha's state, with the relay sockets under this user's runtime directory. */
function launcherOf(io: CommandIo, places: Places): ReturnType<typeof launcherPlacesOf> {
  return launcherPlacesOf(places.state, theCommandsRuntimeDirectory(io.env['XDG_RUNTIME_DIR']), places.root)
}

/** What `martha ls` and `martha stop` read (martha#312); or why it cannot be read. */
async function crewsPlacesOf(io: CommandIo, places: Places): Promise<TheCrewsPlaces | string> {
  const launcher = launcherOf(io, places)
  if ('refusal' in launcher) return launcher.refusal
  const crew = crewStateDirectory(places.state.state_root, places.root)
  if ('refusal' in crew) return crew.refusal
  try {
    return { launcher, crew: crew.path, settings: await declareCrew(documents, places.root, CLAUDE_CODE_MODELS) }
  } catch (error) {
    return `the crew's declaration could not be read: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** `martha ls` (martha#312): one line per declared member, on stdout. */
async function ls(io: CommandIo, places: Places): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  for (const line of theCrewListed(crew, Date.now())) io.out(line)
  // A member a run started and left running is no member of this crew's: it is no line of the list, which is one line
  // per declared member, so it is a notice beside it (martha#472).
  for (const line of theLeftoversThisMachineShows()) io.err(line)
  return EXIT_DONE
}

/** What moves the cursor home and clears the terminal, so each frame of the strip is drawn in place of the last. */
export const CLEAR_THE_TERMINAL = '\u001b[H\u001b[2J'

/** `martha crew [--tab-of <member>]` (martha#572): the crew strip, redrawn in place until the owner ends it; as a kitty tab's strip, it also titles that tab and fits its window (#547 S6). */
async function crew(io: CommandIo, places: Places, tabOf?: string): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const kitten = tabOf === undefined ? undefined : theStripsKitten(tabOf, kittenOnThisMachine)
  await drawTheCrewStrip(crew, (frame) => {
    io.outBytes(Buffer.from(CLEAR_THE_TERMINAL))
    for (const line of frame) io.out(line)
    kitten?.fit(frame.length, process.stdout.rows)
  }, new AbortController().signal, kitten?.title)
  return EXIT_DONE
}

/** Bare `martha start` (#547 S6): every member that is not running opened in a kitty tab of its own; with `which`, only the members it picks. */
async function openTheCrew(io: CommandIo, places: Places, which: (settings: CrewSettings, member: Member) => boolean = () => true): Promise<number> {
  // Each tab starts its member on kitty's terminal, so the owner's own terminal is asked for first, as start <member> asks.
  if (!io.terminal.is_terminal) return refused(io, START_NEEDS_A_TERMINAL)
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const place = stateSubdirectory(places.state, KITTY_PLACE)
  if ('refusal' in place) return refused(io, place.refusal)
  return openTheCrewInKitty(io, { root: places.root, members: crew.settings.members.filter((member) => which(crew.settings, member)).map((member) => member.name), isRunning: (member) => isRunning(crew, member), martha: THIS_MARTHA(), env: io.env, place: place.path, kittySays: kittySaysOnThisMachine, write: writeOwnerOnly, startKitty: startKittyDetached })
}

/** The command that is this release of `martha`: the program and its arguments before the act. */
const THIS_MARTHA = (): readonly string[] => [process.execPath, ...process.execArgv, process.argv[1]!]

/** The act that shows the owner the crew's tmux session (martha#932). */
const ATTACH = 'attach'

/** Martha's own tmux, for the crew read at `places`: its config's place in Martha's state, and this machine's tmux. */
function marthasTmuxFor(io: CommandIo, places: Places, settings: CrewSettings) {
  const place = stateSubdirectory(places.state, TMUX_PLACE)
  return 'refusal' in place ? place : { id: settings.opens.id, env: io.env, place: place.path, tmuxSays: tmuxSaysOnThisMachine, write: writeOwnerOnly, tmux: tmuxOnThisMachine }
}

/** `martha up` for a crew declared `"terminal": "tmux"` (martha#932): every member `up` starts, a window each in Martha's own tmux. */
async function openTheCrewInTmuxHere(io: CommandIo, places: Places, crew: TheCrewsPlaces, prompt?: string): Promise<number> {
  const tmux = marthasTmuxFor(io, places, crew.settings)
  if ('refusal' in tmux) return refused(io, tmux.refusal)
  const starting = crew.settings.members.filter(upStarts)
  const typedInto = starting.filter((member) => theHostOfMember(crew.settings, member) === CLAUDE_CODE).map((member) => member.name)
  if (prompt !== undefined) starting.filter((member) => !typedInto.includes(member.name)).forEach((member) => tellOwnerOn(io)(`${member.name} runs on ${theHostOfMember(crew.settings, member)}, so it is not given your first prompt.`))
  const promptFor = (member: string): string | undefined => (typedInto.includes(member) ? prompt : undefined)
  return openTheCrewInTmux(io, { ...tmux, root: places.root, members: starting.map((member) => member.name), isRunning: (member) => isRunning(crew, member), martha: THIS_MARTHA(), promptFor })
}

/** `martha attach [<member>]` (martha#932): the owner's terminal on the crew's tmux session, at a member's window when one is named. */
async function attach(io: CommandIo, places: Places, member: string | undefined): Promise<number> {
  if (!io.terminal.is_terminal) return refused(io, START_NEEDS_A_TERMINAL)
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const tmux = marthasTmuxFor(io, places, crew.settings)
  if ('refusal' in tmux) return refused(io, tmux.refusal)
  return attachToTheCrew(io, { ...tmux, terminal: crew.settings.opens.terminal, members: crew.settings.members.map((one) => one.name), member, attach: attachOnThisTerminal })
}

/** The act that brings up every member the workspace declares (martha#511). */
export const UP = 'up'

/** The refusal of a key file's check, or undefined when it held a key: the key itself is dropped here. */
const whyNotAKey = (read: { readonly key: string } | { readonly refusal: string }): string | undefined => ('refusal' in read ? read.refusal : undefined)

/**
 * `martha up` (martha#511): every member the declaration at this folder names that is not parked and not running,
 * opened in a kitty tab of its own on its own host and model. The declaration is the config (DECIDED 2026-11-20, Raf:
 * "`martha up` against this file should contain all info required to bring up the crew"): `up` adds no member, and
 * with no declaration it starts nothing and says where the file goes. When an engine member is to start and the crew
 * names no endpoint, `up` first declares it (../bring_up_the_declared_crew/declare_the_engines_endpoint.ts).
 */
async function up(io: CommandIo, places: Places, prompt?: string): Promise<number> {
  if (!io.terminal.is_terminal) return refused(io, START_NEEDS_A_TERMINAL)
  const why = whyNotUpsFirstPrompt(prompt)
  if (why !== undefined) return refused(io, why)
  const declaration = join(places.root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  if (!existsSync(declaration)) return refused(io, noCrewDeclaredAt(declaration))
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const anEngineMemberStarts = crew.settings.members.some((member) => upStarts(member) && theHostOfMember(crew.settings, member) === THE_ENGINES_HOST)
  if (anEngineMemberStarts && crew.settings.engine_endpoint === null) {
    const endpoint = await declareTheEnginesEndpoint({ root: places.root, home: places.home, documents, env: io.env, ask: io.terminal.ask, whyNotTheOwnersKeyFile: (key_file) => whyNotAKey(theKeyInAFile(key_file)) })
    if ('refusal' in endpoint) return refused(io, endpoint.refusal)
    io.out(endpoint.told)
  }
  return opensInTmux(crew.settings.opens.terminal) ? openTheCrewInTmuxHere(io, places, crew, prompt) : openTheCrewInKittyHere(io, places, crew.settings, prompt)
}

/** Why `martha up`'s first prompt cannot be typed in (martha#919), or undefined when it can or none was given. */
function whyNotUpsFirstPrompt(prompt: string | undefined): string | undefined {
  const why = prompt === undefined ? undefined : whyNotAFirstPrompt(prompt)
  return why === undefined ? undefined : `martha ${UP} cannot type a first prompt: ${why}.`
}

/** `martha up` for a crew that opens in kitty: a first prompt is refused, since only Martha's tmux types one in (martha#919). */
function openTheCrewInKittyHere(io: CommandIo, places: Places, settings: CrewSettings, prompt: string | undefined): Promise<number> {
  if (prompt !== undefined) return Promise.resolve(refused(io, `martha ${UP} ${THE_FIRST_PROMPT_SWITCH} types the first turn in through Martha's tmux, and this crew opens in ${settings.opens.terminal}. Declare "terminal": "tmux" in .martha/martha.json to give one.`))
  return openTheCrew(io, places, (_settings, member) => upStarts(member))
}

/**
 * `martha crew add|remove|set-model|set-host` (martha#307): the change, read back through the reader and the start's
 * reviewer rule (../declare_crew/change_a_member.ts), then written over the declaration. A member is removed only
 * while it is not running, as `martha stop` reads it, and an added member gets its node id as `martha init` makes one.
 */
async function changeTheCrew(io: CommandIo, places: Places, change: CrewChange): Promise<number> {
  const running = change.kind === REMOVE ? await whyItStays(io, places, change.member) : undefined
  if (running !== undefined) return refused(io, running)
  const outcome = await aChangedDeclaration(documents, places.root, THE_VOCABULARIES_OF_HOST, change)
  if ('refusal' in outcome) return refused(io, outcome.refusal)
  const unwritten = writeAChangedDeclaration(places.root, outcome)
  if (unwritten !== undefined) return refused(io, unwritten)
  const ids = change.kind === ADD ? nodeIdsFor(places.state, [change.member]) : undefined
  theChangeTold(change, outcome, THE_VOCABULARIES_OF_HOST).forEach(tellOwnerOn(io))
  return ids !== undefined && 'refusal' in ids ? refused(io, ids.refusal) : EXIT_DONE
}

/** Why `member` stays on the crew: it is running, as `martha stop` reads it, or the crew cannot be read; or undefined. */
async function whyItStays(io: CommandIo, places: Places, member: string): Promise<string | undefined> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return crew
  const declared = crew.settings.members.find((one) => sameMemberName(one.name, member))
  return declared !== undefined && isRunning(crew, declared.name) ? `${declared.name} is running, so it stays on the crew. Stop it first: martha ${STOP} ${declared.name}` : undefined
}

/** `martha stop [<member>]` (martha#312): one member, or every running one; each outcome told to the owner. */
async function stop(io: CommandIo, places: Places, member: string | undefined): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const outcomes = await stopTheCrew(crew, member)
  for (const outcome of outcomes) tellOwnerOn(io)(outcome.told)
  return outcomes.some((outcome) => outcome.kind === 'refused') ? EXIT_REFUSED : EXIT_DONE
}

/** `martha restart <member> [--fresh]` (martha#312): the member's launcher asked to end it and start it again. */
async function restart(io: CommandIo, places: Places, member: string, fresh: boolean): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const outcome = await restartTheMember(crew, member, fresh)
  tellOwnerOn(io)(outcome.told)
  return outcome.kind === 'restarted' ? EXIT_DONE : EXIT_REFUSED
}

/**
 * `martha release <member>` (martha#321): the owner's release of a member the gate is holding, typed at the owner's
 * terminal. The act is ../release_a_held_member's; this hands it the places and tells the owner its answer.
 */
async function release(io: CommandIo, places: Places, member: string): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const released = await releaseAHeldMember({
    member,
    members: crew.settings.members.map((one) => one.name),
    row: dashboardRowsIn(crew.launcher.dashboard).read(member),
    rows: rowStreamsDirectory(crew.launcher.rows),
    onATerminal: io.terminal.is_terminal,
    gate: gateModeFor(crew.settings.gate, member),
  })
  if (!released.released) return refused(io, toldOfARelease(released))
  io.out(toldOfARelease(released))
  return EXIT_DONE
}

/**
 * `martha bells [<member> muted|heard]` (martha#371): every declared member's bells, or the owner's own silence for one
 * member's, typed at the owner's terminal. The act is ../ring_the_owner's; this hands it the crew's own place and tells
 * the owner its answer.
 */
async function bells(io: CommandIo, places: Places, asked: Asked): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const told = theBellsTold(io, { members: crew.settings.members.map((one) => one.name), declared: crew.settings.house_rules[OWNER_BELL], owner: crew.settings.owner }, { directory: crew.launcher.bells!, lines: { append: appendStateLine, read: readStateFile } }, theFlipNamed(asked.member, asked.args[0]))
  // Reading the bells shows where each flip was typed (martha#619); a flip says only what it did.
  if (asked.member === undefined) {
    const lines = whatTheOwnerReadsOf(places, 'bells', theFirstApprovalAt(places))
    if (lines.length > 0) ['Every flip, and where it was typed:', ...lines].forEach((line) => io.out(line))
  }
  return told
}

/**
 * `martha gate [--member <name>]` (martha#321): what the gate does to each declared member, or one member's lines.
 * The reading is ../say_what_the_gate_does's; this only hands it the crew's own place and prints what it answers.
 */
async function theGate(io: CommandIo, places: Places, member: string | undefined): Promise<number> {
  const crew = await crewsPlacesOf(io, places)
  if (typeof crew === 'string') return refused(io, crew)
  const shown = sayWhatTheGateDoes({
    members: crew.settings.members.map((one) => one.name),
    gate: crew.settings.gate,
    crew: { directory: crew.crew, lines: { append: appendStateLine, read: readStateFile } },
    ...(member === undefined ? {} : { member }),
  })
  if (!shown.shown) return refused(io, shown.refusal)
  shown.lines.forEach((line) => io.out(line))
  return EXIT_DONE
}

/**
 * `martha install`: the installer this release pins, run with the words typed here unchanged (martha#84). It runs
 * before any place is read, so an installed machine with no checkout can still upgrade.
 */
function install(io: CommandIo, args: readonly string[]): number {
  const outcome = installThePinnedInstaller({ args, tree: releaseTree(), env: io.env, stdio: io.stdio })
  return 'refusal' in outcome ? refused(io, outcome.refusal) : outcome.status
}

/** `martha run <shape>`: the launcher's run of a shape the owner signed, its output on stdout as is, its status. */
async function run(io: CommandIo, name: string): Promise<number> {
  const heard = await askTheLauncherToRun(io.env, name)
  if (!heard.ran) return refused(io, heard.why)
  io.outBytes(Buffer.from(heard.output, 'base64'))
  return heard.status
}

/** A file the owner names, read; or why it cannot be. */
async function readNamed(io: CommandIo, path: string): Promise<string | { readonly refusal: string }> {
  try {
    return await readFile(resolve(io.cwd, path), 'utf8')
  } catch (error) {
    return { refusal: `${path} could not be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).` }
  }
}

/** `martha pin-key <file>`: the owner's hardware key, pinned for this project. */
async function pinKey(io: CommandIo, places: Places, path: string): Promise<number> {
  if (!io.terminal.is_terminal) return refused(io, OWNERS_ACT_NEEDS_A_TERMINAL)
  const line = await readNamed(io, path)
  if (typeof line !== 'string') return refused(io, line.refusal)
  const pinned = pinOwnerKey(places.state, line)
  if (pinned !== undefined) return refused(io, pinned.refusal)
  io.out(`Pinned your key for ${places.root}.`)
  return EXIT_DONE
}

/** `martha keep-shapes <file>`: the list the owner signed (the file and the file's .sig), kept when it opens. */
async function keepShapes(io: CommandIo, places: Places, path: string): Promise<number> {
  if (!io.terminal.is_terminal) return refused(io, OWNERS_ACT_NEEDS_A_TERMINAL)
  const document = await readNamed(io, path)
  if (typeof document !== 'string') return refused(io, document.refusal)
  const signature = await readNamed(io, `${path}${SIGNATURE_SUFFIX}`)
  if (typeof signature !== 'string') return refused(io, signature.refusal)
  const kept = keepCommandShapes(places.state, Buffer.from(document, 'utf8'), signature, new Date())
  if (!kept.trusted) return refused(io, kept.why)
  io.out(`Kept epoch ${kept.epoch}: base ${kept.base.branch} of ${kept.base.remote_url}; shapes ${kept.shapes.map((shape) => shape.name).join(', ')}.`)
  return EXIT_DONE
}

/** The act asked for, with its arguments, or undefined when the words are no way the command is used. */
export const VERSION_WORDS: readonly string[] = ['--version', 'version']
export const ACTS_ALONE: readonly string[] = ['init', 'approve', 'todo', 'ls', ...VERSION_WORDS]

/** The words that ask for the help (martha#511): each alone prints HELP. */
export const HELP_WORDS: readonly string[] = ['help', '-h', '--help']

/** What a word that is no act is told, before the help (martha#511). */
export const UNKNOWN_COMMAND = 'unknown command:'

/** One plain line per act, saying what it does (martha#511, DECIDED 2026-11-20 "no `martha version` or `martha help`?"). */
export const HELP: readonly string[] = [
  'martha init                  declare a solo crew of a builder and a reviewer in this checkout',
  `martha ${UP} [--prompt <text>]  open every member .martha/martha.json declares and not parked, in kitty or tmux; in tmux, type <text> into each Claude Code member as your first turn`,
  `martha ${ATTACH} [<member>]    show the crew's tmux session, at a member's window when one is named`,
  'martha approve               read the config your members start from, and approve it',
  'martha start [<member>]      start one member here, or open every member in kitty; --prompt <text> types your first turn into it, in Martha\'s tmux',
  'martha wake <member>         start a parked member on its newest handover',
  'martha release <member>      release a member Martha holds',
  'martha bells [<member> ...]  list, mute or hear a member\'s bells',
  'martha gate [--member <m>]   say what the shell gate does for each member',
  'martha answer [...]          list or answer what members wait on you for',
  'martha todo                  your to-do list from the crew',
  'martha ls                    list the members and whether each runs',
  'martha stop [<member>]       stop one member, or every running one',
  'martha restart <member>      stop a member and start it again',
  'martha crew [<verb> ...]     show the crew strip, or add, remove or change a member',
  'martha run <shape>           run a command shape the owner signed, from inside a member',
  'martha install [<version>]   install or upgrade Martha',
  'martha pin-key <file>        pin your hardware key for this project',
  'martha keep-shapes <file>    keep the command shapes you signed',
  'martha version               print this release\'s version',
  'martha help                  print this list',
]

/** Whether `word` is a word the command knows as an act. */
const isAnAct = (word: string): boolean => ACTS_ALONE.includes(word) || ACTS_OF_ONE.includes(word) || Object.hasOwn(ACTS_OF_THEIR_OWN, word)
/** The acts that take exactly one argument (martha#129). */
export const ACTS_OF_ONE: readonly string[] = ['run', 'pin-key', 'keep-shapes', 'wake', 'release']

type Asked = { readonly act: string; readonly member?: string; readonly args: readonly string[]; readonly prompt?: string }

export function actOf(argv: readonly string[]): Asked | undefined {
  const [act] = argv
  if (act === undefined) return undefined
  if (ACTS_ALONE.includes(act)) return argv.length === 1 ? { act, args: [] } : undefined
  if (ACTS_OF_ONE.includes(act)) return actOfOne(act, argv)
  const parse = ACTS_OF_THEIR_OWN[act]
  return parse === undefined ? undefined : parse(act, argv)
}

/** `install [<version>] [<switches>]`: the words, passed on unchanged, when the installer is asked a way it knows. */
const installOf = (act: string, argv: readonly string[]): Asked | undefined => (installWordsAreAWay(argv.slice(1)) ? { act, args: argv.slice(1) } : undefined)

/** The acts that read their own arguments: each parser answers undefined when the words are no way it is used. */
export const ACTS_OF_THEIR_OWN: Readonly<Record<string, (act: string, argv: readonly string[]) => Asked | undefined>> = {
  install: installOf,
  gate: gateOf,
  bells: bellsOf,
  [STOP]: stopOf,
  [RESTART]: restartOf,
  [ATTACH]: stopOf,
  [UP]: upOf,
  start: startOf,
  answer: answerOf,
  crew: crewOf,
}

/** `crew`, which draws the strip, or `crew <verb> <member> …`, the owner's change to one member (martha#307). */
function crewOf(act: string, argv: readonly string[]): Asked | undefined {
  if (argv.length === 1) return { act, args: [] }
  if (argv.length === 3 && argv[1] === TAB_OF && argv[2] !== '') return { act, args: argv.slice(1) }
  const change = theCrewChangeAsked(argv.slice(1))
  return change === undefined ? undefined : { act, member: change.member, args: argv.slice(1) }
}

/** `--prompt <text>` at the head of `words`: the prompt and the words after it; nothing when the head is not it; undefined when it has no text. */
function aFirstPromptOf(words: readonly string[]): { readonly prompt?: string; readonly rest: readonly string[] } | undefined {
  if (words[0] !== THE_FIRST_PROMPT_SWITCH) return { rest: words }
  return words[1] === undefined ? undefined : { prompt: words[1], rest: words.slice(2) }
}

/** `start <member> [--prompt <text>] [-- <claude arguments>]`: the prompt is Martha's word, read before `--` (martha#919). */
function startOf(act: string, argv: readonly string[]): Asked | undefined {
  const [, member, ...after] = argv
  if (argv.length === 1) return { act, args: [] }
  if (member === undefined || member.startsWith('-')) return undefined
  const prompted = aFirstPromptOf(after)
  if (prompted === undefined) return undefined
  const [separator, ...rest] = prompted.rest
  const prompt = prompted.prompt === undefined ? {} : { prompt: prompted.prompt }
  if (separator === undefined) return { act, member, args: [], ...prompt }
  return separator === '--' ? { act, member, args: rest, ...prompt } : undefined
}

/** `up [--prompt <text>]` (martha#919): the prompt typed into every Claude Code member up starts in Martha's tmux. */
function upOf(act: string, argv: readonly string[]): Asked | undefined {
  const prompted = aFirstPromptOf(argv.slice(1))
  return prompted === undefined || prompted.rest.length > 0 ? undefined : { act, args: [], ...(prompted.prompt === undefined ? {} : { prompt: prompted.prompt }) }
}

/** `stop [<member>]` and `attach [<member>]`: one member's name at most, and no switch. */
function stopOf(act: string, argv: readonly string[]): Asked | undefined {
  const [, member] = argv
  if (argv.length === 1) return { act, args: [] }
  return argv.length === 2 && member !== undefined && member !== '' && !member.startsWith('-') ? { act, member, args: [] } : undefined
}

/** The switch that restarts a member with no handover. */
const FRESH = '--fresh'

/** `restart <member> [--fresh]`: one member's name, and the one switch. */
function restartOf(act: string, argv: readonly string[]): Asked | undefined {
  const [, member, ...rest] = argv
  if (member === undefined || member === '' || member.startsWith('-')) return undefined
  if (rest.length === 0) return { act, member, args: [] }
  return rest.length === 1 && rest[0] === FRESH ? { act, member, args: [FRESH] } : undefined
}

/** An act of one argument: exactly one, and not empty. */
function actOfOne(act: string, argv: readonly string[]): Asked | undefined {
  const argument = argv[1]
  return argv.length === 2 && argument !== undefined && argument !== '' ? { act, args: [argument] } : undefined
}

/** Runs the command `argv` names; resolves to the status it ends with. */
export async function runMarthaCommand(argv: readonly string[], unescaped: CommandIo): Promise<number> {
  const io = showingSafely(unescaped)
  try {
    return await runAct(argv, io)
  } catch (error) {
    // An error nothing expected still reaches the owner as one escaped line of Martha's, never as Node's own trace.
    return refused(io, error instanceof Error ? error.message : String(error))
  }
}

/** The act `argv` names, run with an io that shows every line safely. */
async function runAct(argv: readonly string[], io: CommandIo): Promise<number> {
  const [word] = argv
  if (word !== undefined && HELP_WORDS.includes(word) && argv.length === 1) {
    HELP.forEach((line) => io.out(line))
    return EXIT_DONE
  }
  if (word !== undefined && !HELP_WORDS.includes(word) && !isAnAct(word)) {
    io.err(`${UNKNOWN_COMMAND} ${word}`)
    HELP.forEach((line) => io.err(line))
    return EXIT_USAGE
  }
  const asked = actOf(argv)
  if (asked === undefined) {
    io.err(USAGE)
    return EXIT_USAGE
  }
  return actOfPlaces(asked, io)
}

/**
 * The acts that need no place: a version, a shape the launcher runs, and an install, which must work with no checkout.
 * Every act but the version and the install is held to this machine's version floor first (martha#21): a release
 * below it still says what it is, and still puts the highest signed release back.
 */
async function actOfPlaces(asked: Asked, io: CommandIo): Promise<number> {
  if (VERSION_WORDS.includes(asked.act)) {
    io.out(version())
    return EXIT_DONE
  }
  if (asked.act === 'install') return install(io, asked.args)
  const below = belowTheFloor()
  if (below !== undefined) return refused(io, below)
  if (asked.act === 'run') return run(io, asked.args[0]!)
  const places = placesOf(io)
  return typeof places === 'string' ? refused(io, places) : actIn(asked, places, io)
}

/** The acts that work inside a project: the owner's two, and the four that read or start a member. */
async function actIn(asked: Asked, places: Places, io: CommandIo): Promise<number> {
  const act = ACTS_IN_A_PROJECT[asked.act]
  if (isAnOwnersOwnAct(asked, act)) {
    const inside = theMemberThisRunsInside(io, places, asked.act)
    if (inside !== undefined) return refused(io, inside)
  }
  if (act === undefined) return asked.member === undefined ? openTheCrew(io, places) : start(io, places, asked.member, asked.args, asked.prompt)
  return isAnOwnersOwnAct(asked, act) ? await recordedWhereItWasTyped(io, places, asked, act) : act(io, places, asked)
}

/** When the owner first approved this project, as the approvals record it; undefined when none can be read. */
function theFirstApprovalAt(places: Places): string | undefined {
  const read = readApprovals(places.state)
  return 'approvals' in read ? read.approvals[0]?.approved_at : undefined
}

/**
 * An owner's act that writes a record, made, then its lines named in the log of where the owner's acts were typed
 * (martha#619): the record first, the entries after it, for every line the act added, whether it ended done or not: a
 * `martha answer` the launch refuses has kept its line first, and with no entry it would read as forged (#541 9a).
 * What the act shows the owner of that log is printed here, once the entry is kept, never inside the act (martha#765).
 */
async function recordedWhereItWasTyped(io: CommandIo, places: Places, asked: Asked, act: (io: CommandIo, places: Places, asked: Asked) => Promise<number>): Promise<number> {
  const file = theRecordFilesOf(places)[asked.act]
  const at = new Date().toISOString()
  if (file !== undefined) theCutoverTakenOnce(places, at)
  const before = file === undefined ? 0 : linesOf(file).length
  const done = await act(io, places, asked)
  if (file === undefined) return done
  const unkept = keepWhereItWasTyped(places, asked.act, before, at, seenFromThisProcess())
  if (unkept !== undefined) io.err(`${done === EXIT_DONE ? 'The act is made' : 'The act ended refused, after its record kept a line'}, but where it was typed is not kept: ${unkept}`)
  // Kept, so the listing can be read: an entry that could not be kept would show the owner's own act as forged.
  else if (done === EXIT_DONE && asked.act === 'approve') ([['Your approvals, and where each was typed (martha#619):', 'approve'], ['Your pinned keys, and where each was typed:', 'pin-key']] as const).forEach(([what, act]) => {
    const lines = whatTheOwnerReadsOf(places, act, theFirstApprovalAt(places))
    if (lines.length > 0) [what, ...lines].forEach((line) => io.out(line))
  })
  return done
}

/** The acts only the owner makes, each of which already asks for a terminal (martha#619). */
const THE_OWNERS_OWN_ACTS: Readonly<Record<string, (io: CommandIo, places: Places, asked: Asked) => Promise<number>>> = {
  'pin-key': (io, places, asked) => pinKey(io, places, asked.args[0]!),
  'keep-shapes': (io, places, asked) => keepShapes(io, places, asked.args[0]!),
  approve: (io, places) => approve(io, places),
  release: (io, places, asked) => release(io, places, asked.args[0]!),
  [UP]: (io, places, asked) => up(io, places, asked.prompt),
  [ATTACH]: (io, places, asked) => attach(io, places, asked.member),
  answer: (io, places, asked) => answerInAProject(io, places, asked.member, asked.args),
}

/**
 * Whether an act is the owner's own: one of theirs, `start` (every word no act takes), a flip of a member's bells, or a
 * change to a member of the crew (martha#307).
 */
const isAnOwnersOwnAct = (asked: Asked, act: ((io: CommandIo, places: Places, asked: Asked) => Promise<number>) | undefined): boolean =>
  act === undefined || Object.hasOwn(THE_OWNERS_OWN_ACTS, asked.act) || ((act === ACTS_IN_A_PROJECT['bells'] || act === ACTS_IN_A_PROJECT['crew']) && asked.member !== undefined)

/**
 * Why an owner's act is refused here, inside a member (martha#619): read once, at the verb's entry, over the launch
 * records of the state root this act writes into; or undefined. A state root whose records this will not vouch for is
 * a refusal too, since what cannot be read cannot clear the act.
 */
function theMemberThisRunsInside(io: CommandIo, places: Places, act: string): string | undefined {
  const records = launchRecordsUnder(THE_PLACES_A_STATE_ROOT_KEEPS)(places.home, io.env['XDG_STATE_HOME'])
  if ('cannot_tell' in records) return `martha ${act} cannot tell whether it runs inside a member: ${records.cannot_tell}`
  return whyAnOwnersActIsRefusedInsideAMember({
    act,
    env: io.env,
    ancestors: (io.ancestors ?? (() => ancestorsUnder(PROC_ROOT, process.pid)))(),
    launches: records.projects.flatMap((project) => launchesIn({ all: () => project.rows })),
    member_marks: { relay_socket_variable: RELAY_SOCKET_VARIABLE, config_dir_variable: CONFIG_DIR_VARIABLE, member_config_folder: MEMBER_CONFIG_FOLDER },
  })
}

/** Each act that works inside a project but `start`, which every other word falls to, by its word. */
const ACTS_IN_A_PROJECT: Readonly<Record<string, (io: CommandIo, places: Places, asked: Asked) => Promise<number>>> = {
  ...THE_OWNERS_OWN_ACTS,
  init: (io, places) => init(io, places),
  todo: (io, places) => todo(io, places),
  wake: (io, places, asked) => wake(io, places, asked.args[0]!),
  gate: (io, places, asked) => theGate(io, places, asked.member),
  bells: (io, places, asked) => bells(io, places, asked),
  ls: (io, places) => ls(io, places),
  crew: (io, places, asked) => (asked.member === undefined ? crew(io, places, asked.args[1]) : changeTheCrew(io, places, theCrewChangeAsked(asked.args)!)),
  [STOP]: (io, places, asked) => stop(io, places, asked.member),
  [RESTART]: (io, places, asked) => restart(io, places, asked.member!, asked.args.includes(FRESH)),
}

/**
 * Whether this process's standard input is a terminal; questions are asked on stderr. A speed bump, not proof that the
 * owner typed this: a member's shell can make a terminal of its own (martha#619), so an owner-only act also asks
 * ../refuse_an_owner_act_from_inside_a_member, and that is a speed bump too.
 */
export const terminalOfThisProcess: OwnersTerminal = {
  is_terminal: isatty(0),
  ask: async (question) => {
    const asking = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return await asking.question(question)
    } finally {
      asking.close()
    }
  },
}

/** This process's own io: its working directory, environment, terminal and standard streams. */
export const ioOfThisProcess: CommandIo = {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  terminal: terminalOfThisProcess,
  out: (line) => void process.stdout.write(`${line}\n`),
  outBytes: (bytes) => void process.stdout.write(bytes),
  err: (line) => void process.stderr.write(`${line}\n`),
}
