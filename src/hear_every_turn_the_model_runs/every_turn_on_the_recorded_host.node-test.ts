// On the recorded host, the launcher hears every main turn the member's model runs (martha#440).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay, mod and launcher; only the
// model is a stand-in (../launch_a_claude_code_member/drive_the_recorded_host.ts). The cases skip on
// RECORDED_HOST_SKIP: ci.yml's relay job runs them with the recorded host, as
// prove_the_relay_loads/recorded_host_runs.json lists.
//
// What only these cases can prove are the host facts the design rests on, read from the host's code and never measured
// before: that `turn.start` carries the turn's `text`, equal byte for byte to the prompt the host raised to the relay
// (a heard turn that did not match would be recorded a second time, as a turn of unnamed source); and that a prompt the
// host raises reaches the launcher before that turn's start does (else the start would find it unheard and record the
// turn twice). The three cases are the design's: a message the mod's timer submits into an idle member; one submitted
// inside a host event and then one by the timer; and a prompt the owner types into a running turn, then a message by
// the timer.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { appendToTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import {
  crewRowsDirectoryOf,
  driveTheRecordedHost,
  firstRunDone,
  marthaOnATerminal,
  plainTextOf,
  stateHomeUnder,
  whatTheLaunchSaw,
  type ModelRequest,
  type RecordedHostRun,
  type TheOwnersHands,
} from '../launch_a_claude_code_member/drive_the_recorded_host.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { A_PLUGINS_ORIGIN, CLAUDE_CODE_PROMPT_ORIGINS, SOURCE_OF_AN_UNKNOWN_ORIGIN } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { recordOf, sessionRecordStreamOf } from '../session_records_in_rows/session_records_in_rows.ts'
import { PATH_OF_SOURCE } from '../take_in_a_turn/take_in_a_turn.ts'

const MEMBER = 'builder'
const SENDER = 'the-owner'
const OWNER_TURN = 'Do the first task.'
/** What the owner types while the member's long tool runs: the host folds it into that turn. */
const OWNER_MID_TURN = 'And mind the tests.'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: [CLAUDE_CODE_SHELL_TOOL] } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
/** How often the mod reads the channel while the member is idle: short, so an idle member is handed a message soon. */
const READ_EVERY_SECONDS = 2
/** How long the run waits, after the member's turn was answered, before it counts the member idle. */
const SETTLED_MS = 3_000
/** A tool still running while the owner types: long enough to type into, done well inside the shell tool's limit. */
const THE_LONG_TOOL = 'node -e "setTimeout(() => {}, 15000)"'
const THE_SHELL_LIMIT_MS = 120_000
const SILENCE_MS = 120_000
const END = { text: 'Done.' }
/** The path a plugin's prompt is recorded on, a crew message the mod submitted among them. */
const THE_CREW_PATH = PATH_OF_SOURCE[CLAUDE_CODE_PROMPT_ORIGINS.sources[A_PLUGINS_ORIGIN] ?? SOURCE_OF_AN_UNKNOWN_ORIGIN]
/** The path the owner's typing is recorded on. */
const THE_OWNERS_PATH = PATH_OF_SOURCE[CLAUDE_CODE_PROMPT_ORIGINS.sources['composer'] ?? SOURCE_OF_AN_UNKNOWN_ORIGIN]
/** The path a turn of unnamed source is recorded on. */
const THE_UNNAMED_PATH = PATH_OF_SOURCE[SOURCE_OF_AN_UNKNOWN_ORIGIN]

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/** A checkout whose crew reads its channel every READ_EVERY_SECONDS, its config approved by the owner. */
function approvedProject(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-440-host-')))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'project')
  for (const [path, text] of Object.entries({ 'README.md': 'a project\n', '.claude/settings.json': SETTINGS })) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'init', '-q', '.')
  git(checkout, 'config', 'user.name', GIT_NAME)
  git(checkout, 'config', 'user.email', GIT_EMAIL)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  const place = { claude: recordedHost(), home, checkout }
  firstRunDone(home, checkout)
  const declared = marthaOnATerminal(place, ['init'])
  assert.equal(declared.exit_code, 0, plainTextOf(declared.shown))
  const declaration = join(checkout, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as Record<string, unknown>
  writeFileSync(declaration, `${JSON.stringify({ ...held, channel_read_seconds: READ_EVERY_SECONDS }, null, 2)}\n`)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew, reading its channel often')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

/** The crew's own streams, where the channel and the session records are kept. */
const theCrewsStreams = (project: Project) => ({
  clock: { now: () => Date.now() },
  stores: { rows: rowStreamsDirectory(crewRowsDirectoryOf(stateHomeUnder(project.home), project.checkout)) },
})

/** Writes a message to the member, as a crewmate's send does. */
async function aMessageTo(project: Project, text: string): Promise<void> {
  await appendToTheChannel(theCrewsStreams(project), { from: SENDER, to: [MEMBER], text, sent_at: Date.now() })
}

/** The text a request carried to the model. */
const whatTheModelSaw = (request: ModelRequest): string => JSON.stringify(request.body['messages'] ?? null)

/** Whether some request the model was sent carries `text`. */
const someRequestCarries = (requests: readonly ModelRequest[], text: string): boolean => requests.some((request) => whatTheModelSaw(request).includes(text))

/** Waits until the request carrying `text` was answered and the host has had SETTLED_MS to end that turn. */
async function untilTheTurnCarryingItEnded(hands: TheOwnersHands, text: string): Promise<void> {
  await hands.until(`the turn carrying "${text}" to end`, () => {
    const answered = hands.heard.filter((request) => whatTheModelSaw(request).includes(text) && request.answered_at !== undefined)
    const last = answered[answered.length - 1]?.answered_at
    return last !== undefined && Date.now() - last > SETTLED_MS
  })
}

/** The sessions the host kept transcripts for in this run: the record of each is read by its id. */
function theSessionsOf(project: Project): readonly string[] {
  const projects = join(project.home, '.claude', 'projects')
  return readdirSync(projects, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.jsonl') && !name.includes('subagents'))
    .map((name) => basename(name, '.jsonl'))
}

/** The paths every session's record holds, as the launcher kept them. */
async function thePathsRecorded(project: Project): Promise<readonly string[]> {
  const rows = theCrewsStreams(project).stores.rows
  const all: string[] = []
  for (const session of theSessionsOf(project)) {
    const kept = await rows.read(sessionRecordStreamOf(session))
    const last = kept[kept.length - 1]
    if (last !== undefined) all.push(...recordOf(last.row).ingested.map((ingestion) => ingestion.path))
  }
  return all
}

const countOf = (paths: readonly string[], path: string): number => paths.filter((held) => held === path).length

/** Drives the run, failing with what the launch saw when it stopped short. */
async function ran(project: Project, run: Omit<RecordedHostRun, 'claude' | 'home' | 'checkout' | 'member' | 'owner_turn' | 'silence_ms'>) {
  const done = await driveTheRecordedHost({ claude: recordedHost(), ...project, member: MEMBER, owner_turn: OWNER_TURN, silence_ms: SILENCE_MS, ...run }).catch((error: unknown) => {
    throw new Error(`the run did not end as a member does: ${String(error).split('\n')[0]}`, { cause: whatTheLaunchSaw(error) })
  })
  assert.equal(done.exit_code, 0, `the member did not end as the owner ended it:\n${plainTextOf(done.shown).slice(-3000)}`)
  return done
}

test("#440 on the recorded host: an idle member's message-started turn is kept in its record", { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  const message = 'A verdict that arrives while the member is idle.'
  await ran(project, {
    requests: 6,
    completesWhen: (requests) => someRequestCarries(requests, message),
    script: () => END,
    atTheTerminal: async (hands) => {
      await untilTheTurnCarryingItEnded(hands, OWNER_TURN)
      await aMessageTo(project, message)
    },
  })
  const paths = await thePathsRecorded(project)
  t.diagnostic(`the record's paths: ${JSON.stringify(paths)}`)
  assert.equal(countOf(paths, THE_CREW_PATH), 1, 'the turn the idle tick started is not in the record exactly once')
  assert.equal(countOf(paths, THE_OWNERS_PATH), 1, "the owner's turn is not in the record exactly once")
  assert.equal(countOf(paths, THE_UNNAMED_PATH), 0, "a heard turn was recorded again as one of unnamed source: the host's turn text did not match the prompt it raised, or its start came first")
})

test('#440 on the recorded host: a message raised from inside a host event is kept once, and the next one by the idle tick once too', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  const first = 'The first message, waiting when the turn ends.'
  const second = 'The second message, arriving while the member is idle.'
  await ran(project, {
    requests: 8,
    completesWhen: (requests) => someRequestCarries(requests, second),
    script: async ({ number }) => {
      // Written while the owner's turn runs, so the mod hands it from the turn's end, inside a host event.
      if (number === 1) await aMessageTo(project, first)
      return END
    },
    atTheTerminal: async (hands) => {
      await untilTheTurnCarryingItEnded(hands, first)
      await aMessageTo(project, second)
    },
  })
  const paths = await thePathsRecorded(project)
  t.diagnostic(`the record's paths: ${JSON.stringify(paths)}`)
  assert.equal(countOf(paths, THE_CREW_PATH), 2, 'the two crew messages are not in the record exactly once each: one was counted twice or one was lost')
  assert.equal(countOf(paths, THE_UNNAMED_PATH), 0, 'a heard turn was recorded again as one of unnamed source')
})

test('#440 on the recorded host: a prompt the owner types into a running turn does not swallow the next crew message', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  const message = 'A hand-off that arrives after the long turn.'
  await ran(project, {
    requests: 8,
    completesWhen: (requests) => someRequestCarries(requests, message),
    script: ({ number }) =>
      number === 1 ? { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: THE_LONG_TOOL, description: 'a tool the owner types over', timeout: THE_SHELL_LIMIT_MS } } : END,
    atTheTerminal: async (hands) => {
      await hands.until('the long tool to start', () => hands.heard.some((request) => request.number === 1 && request.answered_at !== undefined))
      hands.type(OWNER_MID_TURN)
      await new Promise((resolve) => setTimeout(resolve, 500))
      hands.type('\r')
      await untilTheTurnCarryingItEnded(hands, OWNER_MID_TURN)
      await aMessageTo(project, message)
    },
  })
  const paths = await thePathsRecorded(project)
  t.diagnostic(`the record's paths: ${JSON.stringify(paths)}`)
  assert.equal(countOf(paths, THE_OWNERS_PATH), 2, "the owner's two prompts are not in the record exactly once each")
  assert.equal(countOf(paths, THE_CREW_PATH), 1, 'the prompt folded into the running turn swallowed the crew message: its turn is not in the record')
  assert.equal(countOf(paths, THE_UNNAMED_PATH), 0, 'a heard turn was recorded again as one of unnamed source')
})
