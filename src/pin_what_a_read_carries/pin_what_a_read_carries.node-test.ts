// Which instruction text a host attaches to a member's session, pinned by a run rather than by prose (martha#165).
//
// The markers this case plants are INSTRUCTION_TEXT_OWNERS' own entries (martha#135): one file per entry, carrying the
// entry's `text`. It runs the recorded host three times over one arrangement of files, and reads the request bodies
// the host sends the model, never the transcript: the second request is what the model has in front of it once the
// Read has come back, so a marker in it is text the HOST put in front of the model — attached to the read, or loaded
// as the session started.
//
//   by hand, project config on   the control: every text the table does not mark "not observed" is in its requests
//   Martha's switches            no text of the table's at all
//   Martha's switches + relay    no text at all, and the stand-in launcher heard the session start and the answered read
//
// What it proves, and what it does not. The stand-in answers a script, so a marker's presence shows what the host
// attached to a result, never what a model did with it: this pins the attachment, not a model's behaviour. It is also
// the only case in this tree that plants the CLAUDE.md of the directory above the checkout and the top CLAUDE.local.md.
//
// The case skips unless the recorded host's binary is named, and ci.yml's relay job is the one place that names it
// (prove_the_relay_loads/recorded_host_runs.json). It is never skipped there: a skipped case fails that run by name.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import type { MemberRelay, RelayReply } from '../answer_the_relay/answer_the_relay.ts'
import { RELAY_PLUGIN_DIR } from '../ask_the_host_what_it_loads/what_the_host_loads.ts'
import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { ALLOW, RELAY_SOCKET_VARIABLE, TAKEN, type Refused, type RelayEvent } from '../claude_code_relay/hooks/relay_protocol.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { environmentOf, firstRunDone, theStandInModel, type ModelRequest, type ModelScript } from '../drive_the_recorded_host/drive_the_recorded_host.ts'
import { INSTRUCTION_FILES, INSTRUCTION_TEXT_OWNERS, INSTRUCTION_TEXT_WORDING, type InstructionText } from '../inbound_paths/inbound_paths.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import {
  fingerprintOf,
  launchEnvironment,
  prepareLaunch,
  readLaunchState,
  type HostSwitches,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { copyTheRelay, removeTheTree, RELAY_COPY_NAME } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { makeRelayDirectory } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { serveTheRelay } from '../serve_the_relay_to_a_launch/serve_the_relay.ts'

/** The host's own name for the tool that reads a file: the one tool a scripted turn calls. */
const READ_TOOL = 'Read'

/** How a run is started: by hand as an owner would, and the two ways Martha starts a member (martha#135). */
type Arrangement = 'by-hand' | 'marthas-switches' | 'marthas-switches-and-relay'

/** Where the checkout sits, and the directory above it: both hold a copy of an instruction file the table names. */
const CHECKOUT_DIR = 'checkout'
const DIRECTORY_ABOVE = 'above'
/** The directory below the checkout whose file the scripted read reaches, which is what loads that directory's text. */
const NESTED_DIR = 'notes'
const THE_READ_FILE = join(NESTED_DIR, 'notes.txt')
/** A marker only that file carries: in the second request, it is the read's own result having come back. */
const THE_READ_FILES_OWN_MARKER = 'the note only the file a run reads carries'

/** How many model requests one run makes: the call, and the text that ends the turn after it. Any other number fails. */
const REQUESTS_OF_A_RUN = 2

/**
 * The host's own headless shape: print mode, with a turn to spend on the scripted call and the turns to finish after it.
 * The model is the stand-in, so no model is named here, and the prompt is this case's own: what the stand-in answers is
 * the script, whatever the owner typed.
 */
const HEADLESS_ARGS = ['-p', '--max-turns', '3']
const THE_OWNERS_TURN = 'Read the project notes and tell me what they hold.'

/** How long one headless run may take before its whole group is killed: a run that hangs fails, it never holds the job. */
const A_RUNS_OWN_BOUND_MS = MINUTE_MS

/**
 * Where each text the table names is planted: the entry's own file, in one corner of the arrangement. The names are
 * the table's `text` values, and `gapsInThePlants` holds this list and the table together, so a text added there
 * without a place here fails by name rather than passing.
 */
interface APlant {
  readonly text: string
  /** True for the directory above the checkout: the host loads these as it starts, from outside the tree. */
  readonly above: boolean
  /** The folders below the checkout the file goes in: none for the checkout's own top. */
  readonly folders: readonly string[]
}

const PLANTS: readonly APlant[] = [
  { text: 'NESTED_CLAUDE_MD', above: false, folders: [NESTED_DIR] },
  { text: 'ABOVE_CLAUDE_MD', above: true, folders: [] },
  { text: 'NESTED_LOCAL_MD', above: false, folders: [NESTED_DIR] },
  { text: 'ROOT_LOCAL_MD', above: false, folders: [] },
  { text: 'NESTED_AGENTS_MD', above: false, folders: [NESTED_DIR] },
  { text: 'ABOVE_AGENTS_MD', above: true, folders: [] },
]

/** Every way the table and this case disagree: a text with no place here, a place that answers no text, or a text twice. */
function gapsInThePlants(
  entries: readonly InstructionText[] = INSTRUCTION_TEXT_OWNERS,
  plants: readonly APlant[] = PLANTS,
): readonly string[] {
  const named = entries.map((entry) => entry.text)
  const gaps = named.filter((text) => !plants.some((plant) => plant.text === text)).map((text) => `${text} is a text the table names, and this case plants no file for it`)
  gaps.push(...plants.filter((plant) => !named.includes(plant.text)).map((plant) => `${plant.text} is planted here, and the table names no such text`))
  gaps.push(...plants.filter((plant) => plants.filter((other) => other.text === plant.text).length > 1).map((plant) => `${plant.text} is planted more than once`))
  return [...new Set(gaps)]
}

/** The table's entry for a text, which no run without a gap can miss. */
const entryFor = (text: string): InstructionText => {
  const entry = INSTRUCTION_TEXT_OWNERS.find((candidate) => candidate.text === text)
  if (entry === undefined) throw new Error(`the table names no ${text}`)
  return entry
}

/** True for a text whose table entry says no run has seen it load: the control must show exactly these as absent. */
const notObserved = (entry: InstructionText): boolean => entry.words.includes(INSTRUCTION_TEXT_WORDING.not_observed)

/** One scratch arrangement: the owner's home for the run, the checkout, and the directory above it. */
interface APlace {
  readonly scratch: string
  readonly home: string
  readonly checkout: string
  readonly above: string
}

/** The identity every commit in this case is made with, so a run needs no identity in a home that is thrown away. */
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'

/** Runs git in `where`, and fails the case rather than letting a checkout without its commit pass for one with it. */
const git = (where: string, ...args: readonly string[]): void => {
  execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd: where, stdio: 'ignore' })
}

/** Writes a file, making the folders above it: this case writes its own files rather than load a program's part (martha#443). */
function putTheFile(dir: string, name: string, content: string): void {
  mkdirSync(dirname(join(dir, name)), { recursive: true })
  writeFileSync(join(dir, name), content)
}

/** A checkout holding the arrangement: one tracked file to read, the table's files, and an ignored CLAUDE.local.md. */
function plantTheArrangement(scratch: string): APlace {
  const home = join(scratch, 'home')
  const above = join(scratch, DIRECTORY_ABOVE)
  const checkout = join(above, CHECKOUT_DIR)
  mkdirSync(home, { recursive: true })
  mkdirSync(checkout, { recursive: true })
  // Git ignores a CLAUDE.local.md, so a member may write one and no owner approved it (the table's `local` file).
  putTheFile(checkout, '.gitignore', `${INSTRUCTION_FILES.local}\n`)
  putTheFile(checkout, THE_READ_FILE, `${THE_READ_FILES_OWN_MARKER}\n`)
  for (const plant of PLANTS) {
    const folder = plant.above ? above : join(checkout, ...plant.folders)
    putTheFile(folder, entryFor(plant.text).file, `${plant.text}\n`)
  }
  git(checkout, 'init', '-q', '.')
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the arrangement')
  firstRunDone(home, checkout)
  return { scratch, home, checkout, above }
}

/** One event the relay posted to the stand-in launcher, in the order it posted them. */
interface HeardEvent {
  readonly event: RelayEvent
  readonly body: Readonly<Record<string, unknown>>
}

/**
 * The launcher the relay talks to in the last run: it takes every event, allows a tool call and nothing else, so a
 * run reaches its end without a launcher's own decisions in it, and it keeps what it heard.
 */
function standInLauncher(heard: HeardEvent[]): MemberRelay {
  const nothingToRun: Refused = { refused: 'the stand-in launcher runs no signed shape' }
  return {
    answer: async (event, body): Promise<RelayReply> => {
      heard.push({ event, body: body as Readonly<Record<string, unknown>> })
      // A tool call is the one event the relay acts on as a verdict; every other event is only taken in.
      return { answered: true, body: event === 'tool_called' ? ALLOW : TAKEN }
    },
    answerTool: async () => nothingToRun,
    run: async () => nothingToRun,
    // The workspace guard's two seams are not what this run measures: a stand-in with no crew refuses no git call.
    judgeAGitCall: async () => ({ verdict: ALLOW }),
    judgeARefTransaction: async () => ({ verdict: ALLOW }),
  }
}

/** What one arrangement starts: the switches Martha's launch passes, and, for the relay run, its folder and socket. */
interface AStart {
  readonly switches: HostSwitches
  readonly plugin_dir?: string
  readonly socket_path?: string
  close(): Promise<void>
}

/** Nothing to close: a start that made no relay. */
const nothingToClose = async (): Promise<void> => undefined

/** The switches `prepareLaunch` passes, on this arrangement's checkout, as the launcher passes them (martha#135). */
function marthasSwitches(place: APlace): HostSwitches {
  const where = { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.scratch }
  const prepared = prepareLaunch(
    { ...where, snapshot_root: join(place.scratch, 'snapshots'), approved_fingerprints: [fingerprintOf(readLaunchState(where, thisMachine))] },
    thisMachine,
  )
  if (!prepared.allow) throw new Error(`prepareLaunch refused: ${prepared.refusal}`)
  return prepared.switches
}

/** The relay folder and the socket the last run loads, as a launch makes them, with a stand-in launcher serving it. */
async function withTheRelay(place: APlace, heard: HeardEvent[]): Promise<Pick<AStart, 'plugin_dir' | 'socket_path' | 'close'>> {
  const copy = copyTheRelay(RELAY_PLUGIN_DIR, join(place.scratch, RELAY_COPY_NAME))
  if (!copy.made) throw new Error(copy.refusal)
  const directory = makeRelayDirectory(join(place.scratch, 'socket'))
  if (!directory.made) throw new Error(directory.refusal)
  const server = await serveTheRelay(standInLauncher(heard), directory.socket_path)
  return {
    plugin_dir: copy.plugin_dir,
    socket_path: directory.socket_path,
    close: async () => {
      await server.close()
      directory.remove()
    },
  }
}

/** How one arrangement is started, and how what it started is closed. */
async function startOf(place: APlace, arrangement: Arrangement, heard: HeardEvent[]): Promise<AStart> {
  if (arrangement === 'by-hand') return { switches: { args: [], env: {}, env_dropped: [] }, close: nothingToClose }
  const switches = marthasSwitches(place)
  if (arrangement === 'marthas-switches') return { switches, close: nothingToClose }
  return { switches, ...(await withTheRelay(place, heard)) }
}

/** The turn the stand-in answers request 1 with: a read of the tracked file below the top, which loads that folder's text. */
const scriptOf = (place: APlace): ModelScript => ({ number }: ModelRequest) =>
  number === 1 ? { tool: READ_TOOL, input: { file_path: join(place.checkout, THE_READ_FILE) } } : { text: 'done' }

/** The host's own command line for one arrangement, the prompt before the options that take words of their own. */
function argsOf(start: AStart): readonly string[] {
  const plugin = start.plugin_dir === undefined ? [] : ['--plugin-dir', start.plugin_dir]
  return [...HEADLESS_ARGS, THE_OWNERS_TURN, ...start.switches.args, ...plugin, '--allowedTools', READ_TOOL]
}

/** The environment one run's host starts in: its own home, the stand-in's address, and Martha's switches when it has them. */
function environmentFor(place: APlace, start: AStart, base_url: string): Record<string, string> {
  const runtime = join(place.scratch, 'runtime')
  mkdirSync(runtime, { recursive: true })
  const inherited = environmentOf({ claude: recordedHost(), home: place.home }, base_url, runtime)
  const env = launchEnvironment(inherited, start.switches, CLAUDE_CODE)
  return start.socket_path === undefined ? env : { ...env, [RELAY_SOCKET_VARIABLE]: start.socket_path }
}

/** What one host run printed, and how it ended. */
interface TheHostRan {
  readonly exit: number | null
  readonly printed: string
}

/** Kills the whole group the host leads, so a host that outstays its bound leaves nothing of itself behind. */
function killTheGroupOf(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // It was already gone.
  }
}

/** Runs the host to its end, killing its group if it outstays `A_RUNS_OWN_BOUND_MS`. */
async function runToItsEnd(place: APlace, start: AStart, base_url: string): Promise<TheHostRan> {
  // Spawned, not waited for in one call: the stand-in model answers this process's own event loop, and a wait that
  // blocked it would leave every model request unanswered until the run's bound ran out. Its own session, so the kill
  // takes everything it started with it.
  const child = spawn(recordedHost(), argsOf(start), { cwd: place.checkout, env: environmentFor(place, start, base_url), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let printed = ''
  const speaking = (chunk: Buffer): void => void (printed += chunk.toString('utf8'))
  child.stdout?.on('data', speaking)
  child.stderr?.on('data', speaking)
  const ended = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)))
  const bound = setTimeout(() => killTheGroupOf(child.pid), A_RUNS_OWN_BOUND_MS)
  try {
    return { exit: await ended, printed }
  } finally {
    clearTimeout(bound)
  }
}

/** What one run of one arrangement gave: its model requests, what the launcher heard, and where it ran. */
interface ARun {
  readonly requests: readonly ModelRequest[]
  readonly heard: readonly HeardEvent[]
  readonly exit: number | null
  readonly printed: string
  readonly scratch: string
}

/** Runs one arrangement to its end, and closes whatever it started for the relay, even when the run throws. */
async function runStarted(place: APlace, arrangement: Arrangement, heard: HeardEvent[], base_url: string): Promise<TheHostRan> {
  const start = await startOf(place, arrangement, heard)
  try {
    return await runToItsEnd(place, start, base_url)
  } finally {
    await start.close()
  }
}

/** One arrangement, run from a scratch of its own: a fresh home, a fresh checkout, and a fresh stand-in model. */
async function oneRunOf(t: TestContext, arrangement: Arrangement): Promise<ARun> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'martha-165-')))
  // Held for the whole case: a run that throws still leaves nothing behind.
  t.after(() => removeTheTree(scratch))
  const place = plantTheArrangement(scratch)
  const requests: ModelRequest[] = []
  const heard: HeardEvent[] = []
  let failure: string | undefined
  const model = await theStandInModel(scriptOf(place), requests, (why) => void (failure ??= why))
  try {
    const ran = await runStarted(place, arrangement, heard, model.url)
    if (failure !== undefined) throw new Error(`the stand-in could not answer: ${failure}`)
    return { requests, heard, ...ran, scratch }
  } finally {
    await model.close()
  }
}

/** Every request body of a run, as text: what the model had in front of it. */
const bodiesOf = (run: ARun): string => run.requests.map((request) => JSON.stringify(request.body)).join('\n')

/** Whether the text is in any request the run's model got. */
const reachedTheModel = (run: ARun, text: string): boolean => bodiesOf(run).includes(text)

/** What one run proves about its gate having run: the read came back, and the host sent the requests a run makes. */
function gapsInTheGate(run: ARun): readonly string[] {
  const gaps: string[] = []
  if (run.requests.length !== REQUESTS_OF_A_RUN) gaps.push(`the host sent ${run.requests.length} model request(s) where a run of this case makes ${REQUESTS_OF_A_RUN}: it refused the stand-in, or ended on something else`)
  if (run.exit !== 0) gaps.push(`the host exited ${String(run.exit)}, and a run of this case ends on its own`)
  if (!reachedTheModel(run, THE_READ_FILES_OWN_MARKER)) gaps.push(`the read of ${THE_READ_FILE} never came back to the model, so no text this run shows is about a read`)
  return gaps
}

/** What the control shows: exactly the texts whose table entry does not say "not observed". */
function gapsInTheControl(run: ARun): readonly string[] {
  return INSTRUCTION_TEXT_OWNERS.flatMap((entry) => {
    const seen = reachedTheModel(run, entry.text)
    if (notObserved(entry) && seen) return [`${entry.text} is in the control's requests, and its table entry says no run has seen it`]
    if (!notObserved(entry) && !seen) return [`${entry.text} is missing from the control's requests, which is the run that shows the others`]
    return []
  })
}

/** What a session Martha starts carries: none of the table's texts, by any of the ways the host could attach one. */
function gapsInMarthasRun(run: ARun, what: string): readonly string[] {
  return INSTRUCTION_TEXT_OWNERS.filter((entry) => reachedTheModel(run, entry.text)).map(
    (entry) => `${entry.text} reached a session started with ${what}, which the table says attaches none`,
  )
}

/** What the launcher must have heard in the relay run: the session's start, and the read's answer (martha#135). */
function gapsInWhatTheLauncherHeard(run: ARun): readonly string[] {
  const gaps: string[] = []
  if (!run.heard.some((event) => event.event === 'session_started')) gaps.push('the launcher heard no session_started in the relay run')
  const answered = run.heard.some((event) => event.event === 'tool_answered' && JSON.stringify(event.body).includes(THE_READ_FILES_OWN_MARKER))
  if (!answered) gaps.push(`the launcher heard no tool_answered carrying ${THE_READ_FILE}'s own marker in the relay run`)
  return gaps
}

test('every text the table names has a place this case plants, and a text added to the table fails here', () => {
  assert.deepEqual(gapsInThePlants(), [])
  // The check bites: a text the table names and this case does not plant is named, and so is a place the table lost.
  const grown = [...INSTRUCTION_TEXT_OWNERS, { text: 'A_TEXT_THE_TABLE_GAINED', file: INSTRUCTION_FILES.checkout, owner: 'A16', words: [] }]
  assert.deepEqual(gapsInThePlants(grown), ['A_TEXT_THE_TABLE_GAINED is a text the table names, and this case plants no file for it'])
  assert.deepEqual(gapsInThePlants([], PLANTS).length, PLANTS.length)
})

test('the control shows the text the table says a host attaches, and Martha\'s launch shows none (martha#165)', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const control = await oneRunOf(t, 'by-hand')
  const marthasSwitches = await oneRunOf(t, 'marthas-switches')
  const withTheRelay = await oneRunOf(t, 'marthas-switches-and-relay')
  const runs = [control, marthasSwitches, withTheRelay]
  for (const run of runs) removeTheTree(run.scratch)

  assert.deepEqual(gapsInTheGate(control), [], control.printed)
  assert.deepEqual(gapsInTheControl(control), [], bodiesOf(control))
  assert.deepEqual(gapsInTheGate(marthasSwitches), [], marthasSwitches.printed)
  assert.deepEqual(gapsInMarthasRun(marthasSwitches, "Martha's switches"), [], bodiesOf(marthasSwitches))
  assert.deepEqual(gapsInTheGate(withTheRelay), [], withTheRelay.printed)
  assert.deepEqual(gapsInMarthasRun(withTheRelay, 'the relay Martha loads'), [], bodiesOf(withTheRelay))
  assert.deepEqual(gapsInWhatTheLauncherHeard(withTheRelay), [])
  assert.deepEqual(runs.filter((run) => existsSync(run.scratch)).map((run) => run.scratch), [], 'a scratch HOME survived its run')
})
