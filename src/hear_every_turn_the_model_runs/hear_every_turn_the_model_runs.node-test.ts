// The launcher hears every main turn the model runs, whatever started it (martha#440).
//
// These cases drive the relay as the host and the mod drive it over the socket: `prompt_submitted` for a prompt the
// host raised, and the mod's `a_turn_started` ask for every turn start. Each reads back what the launcher kept: the
// session's record (one ingestion per path), the screen's turn starts, the turns raised to listeners, and the journal's
// words for a turn of unnamed source. The crew's carrier is the real one, over a channel in the test's own rows.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { crewToolsOver } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { THE_NEXT_MESSAGE_ASK, THE_TURN_STARTED_ASK, carryingTo } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import type { ArrivingTurn } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { appendToTheChannel, takenInBy } from '../keep_the_crew_channel/crew_channel.ts'
import { memberRelay, type MemberRelay } from '../launch_a_claude_code_member/answer_the_relay.ts'
import type { RelayJournal } from '../launch_a_claude_code_member/keep_the_relays_journal.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { ARRIVAL_OF_A_PLUGINS_PROMPT, CLAUDE_CODE_PROMPT_ORIGINS, SOURCE_OF_AN_UNKNOWN_ORIGIN } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { turnsRaised } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { ownerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { WhatTheHostSaid } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import { recordOf, sessionRecordStreamOf, sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { PATH_OF_SOURCE } from '../take_in_a_turn/take_in_a_turn.ts'
import { A_TURN_OF_UNNAMED_SOURCE, theCommandLineOf } from './hear_every_turn_the_model_runs.ts'

const MEMBER = 'Builder'
const SENDER = 'Reviewer'
const SESSION = 'session-440'
/** The owner's typing, as the engine stamps it. */
const THE_OWNERS_KIND = 'composer'
/** The path a crew message the mod submitted is recorded on: a plugin's prompt, as the engine stamps one. */
const THE_CREW_PATH = 'source' in ARRIVAL_OF_A_PLUGINS_PROMPT ? PATH_OF_SOURCE[ARRIVAL_OF_A_PLUGINS_PROMPT.source] : ''
/** The path the owner's own typing is recorded on. */
const THE_OWNERS_PATH = PATH_OF_SOURCE[CLAUDE_CODE_PROMPT_ORIGINS.sources[THE_OWNERS_KIND] ?? SOURCE_OF_AN_UNKNOWN_ORIGIN]
/** The path a turn of unnamed source is recorded on. */
const THE_UNNAMED_PATH = PATH_OF_SOURCE[SOURCE_OF_AN_UNKNOWN_ORIGIN]

/** One member's launch, as the relay sees it, with everything it says written down for the test to read. */
interface ALaunch {
  readonly relay: MemberRelay
  readonly channel: Parameters<typeof appendToTheChannel>[0]
  /** The paths the session's record holds, in the order it took them in. */
  readonly paths: () => Promise<readonly string[]>
  readonly screen: WhatTheHostSaid[]
  readonly raised: ArrivingTurn[]
  readonly noted: { readonly event: string; readonly why: string }[]
}

/** What every launch here hands its relay alike: its records, launch, policy, names and the owner's settings and memory. */
function theFixedPlaceOf(home: string, checkout: string, rows: ReturnType<typeof rowStreamsDirectory>) {
  return {
    records: sessionRecordsIn(rows),
    launch: { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(home, DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE),
      home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({
      launcher_env: { HOME: home },
      member_env: { HOME: home },
      home,
      launch_dir: checkout,
      settings_files: [],
      user_scope: {
        markdown_kinds: RECORDED_HOST.markdown_kinds,
        output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
        reported_output_styles_dir: join(home, DEFAULT_CONFIG_DIR, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
      },
    }),
  }
}

function aLaunch(t: TestContext): ALaunch {
  const home = mkdtempSync(join(tmpdir(), 'martha-440-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rowsPath = join(home, 'row-streams')
  mkdirSync(rowsPath, { mode: 0o700 })
  const rows = rowStreamsDirectory(rowsPath)
  const { host } = hostForTests({ now: 1_000 })
  const channel = { clock: host.clock, stores: { rows } }
  const turns = turnsRaised()
  const raised: ArrivingTurn[] = []
  turns.onTurn((turn) => void raised.push(turn))
  const screen: WhatTheHostSaid[] = []
  const noted: { event: string; why: string }[] = []
  const journal: RelayJournal = { received: () => ({ answered: () => {} }), noted: (event, why) => void noted.push({ event, why }) }
  const relay = memberRelay({
    ...theFixedPlaceOf(home, checkout, rows),
    crew: crewToolsOver({
      member: MEMBER,
      ledger: channel,
      beats: dashboardRowsIn(join(home, 'the-owners-rows')),
      root: checkout,
      documents: host.stores.documents,
      stores: { crew: crewFilesDirectory(join(home, 'crew-files')) },
      carrier: carryingTo({ member: MEMBER, host: channel }),
    }),
    turns,
    journal,
    screen: { held: () => ({ checks: [], dialogs: [] }), heard: (_session, said) => void screen.push(said) },
    stopMember: () => {},
  })
  const paths = async (): Promise<readonly string[]> => {
    const kept = await rows.read(sessionRecordStreamOf(SESSION))
    const last = kept[kept.length - 1]
    return last === undefined ? [] : recordOf(last.row).ingested.map((ingestion) => ingestion.path)
  }
  return { relay, channel, paths, screen, raised, noted }
}

/** How many times the record holds `path`. */
const countOf = (paths: readonly string[], path: string): number => paths.filter((held) => held === path).length

/** The session starts, as the host's SessionStart hook says; the record's own start is what the counts are read past. */
async function started(launch: ALaunch): Promise<readonly string[]> {
  const answered = await launch.relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(answered.answered, true)
  return await launch.paths()
}

/** The mod asks the launcher for the next message to hand, as its idle read does; the framed text, or ''. */
async function handed(launch: ALaunch, text: string): Promise<string> {
  await appendToTheChannel(launch.channel, { from: SENDER, to: [MEMBER], text, sent_at: 1_000 })
  const answer = await launch.relay.answerTool({ session_id: SESSION, tool: THE_NEXT_MESSAGE_ASK, args: {} })
  assert.ok('answer' in answer && answer.answer !== '', `the launcher handed nothing: ${JSON.stringify(answer)}`)
  return answer.answer
}

/** The host raises a prompt to the relay, as it does for one typed or one submitted inside a host event. */
async function heard(launch: ALaunch, text: string, kind: string, command?: string): Promise<void> {
  const marks = command === undefined ? {} : { command: { name: command, args: '' } }
  const answered = await launch.relay.answer('prompt_submitted', { session_id: SESSION, text, origin: { kind }, ...marks })
  assert.equal(answered.answered, true)
}

/** The mod reports a turn start, with the text the host put on it, as `turn.start` hands it. */
async function aTurnStarted(launch: ALaunch, text: string, agentId?: string): Promise<void> {
  const answer = await launch.relay.answerTool({ session_id: SESSION, tool: THE_TURN_STARTED_ASK, args: { turnId: `turn-${text.length}`, text, ...(agentId === undefined ? {} : { agentId }) } })
  assert.ok('answer' in answer, `the turn start was not answered: ${JSON.stringify(answer)}`)
}

const turnStarts = (screen: readonly WhatTheHostSaid[]): number => screen.filter((said) => said.said === 'turn-started').length

test("#440: an idle member's message-started turn is kept in its record", async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)
  const frame = await handed(launch, 'a verdict, in words')

  // The mod's timer submitted it, so the host never raised it to the mod's prompt hook: only the turn start is heard.
  await aTurnStarted(launch, frame)

  const after = await launch.paths()
  assert.equal(countOf(after, THE_CREW_PATH) - countOf(before, THE_CREW_PATH), 1, 'the turn the crew message started is not in the record, so the launcher never heard a turn its model ran')
  assert.equal(turnStarts(launch.screen), 1, "the owner's row never heard the turn start, so a dialog an earlier turn left open still pins it")
  assert.deepEqual(launch.raised, [{ text: frame, arrival: ARRIVAL_OF_A_PLUGINS_PROMPT }], 'the turn listeners did not hear the crew message exactly once')
  assert.deepEqual(launch.noted, [], 'a crew message the launcher handed was noted as a turn of unnamed source')
  assert.deepEqual([...(await takenInBy(launch.channel, MEMBER))], [0], 'the count and the record disagree about the turn')
})

test('#440: a message raised from inside a host event is kept once, and the next one the idle tick submits is kept once too', async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)

  // The first is submitted inside a host event, so the host raises it: the prompt hook records it, the start adds nothing.
  const first = await handed(launch, 'the first message')
  // The engine stamps a plugin's own prompt with this kind.
  await heard(launch, first, 'plugin')
  await aTurnStarted(launch, first)
  // The second comes while the member is idle, by the mod's timer: only its turn start is heard.
  const second = await handed(launch, 'the second message')
  await aTurnStarted(launch, second)

  const after = await launch.paths()
  assert.equal(countOf(after, THE_CREW_PATH) - countOf(before, THE_CREW_PATH), 2, 'two crew messages were not recorded exactly once each: one was counted twice or one was lost')
  assert.deepEqual(launch.raised.map((turn) => turn.text), [first, second], 'the turn listeners did not hear each message exactly once')
  assert.deepEqual(launch.noted, [], 'a heard turn was noted as one of unnamed source, so its text was checked after the start emptied what was heard')
})

test('#440: a prompt folded into a running turn does not swallow the next crew message', async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)

  await heard(launch, 'do the first task', THE_OWNERS_KIND)
  await aTurnStarted(launch, 'do the first task')
  // The owner types while the turn runs: the host raises it and folds it into that turn, which starts no turn of its own.
  await heard(launch, 'and mind the tests', THE_OWNERS_KIND)
  // The turn ends; a crew message comes while the member is idle, by the mod's timer.
  const frame = await handed(launch, 'a hand-off')
  await aTurnStarted(launch, frame)

  const after = await launch.paths()
  assert.equal(countOf(after, THE_OWNERS_PATH) - countOf(before, THE_OWNERS_PATH), 2, "the owner's two prompts were not recorded exactly once each")
  assert.equal(countOf(after, THE_CREW_PATH) - countOf(before, THE_CREW_PATH), 1, 'the folded prompt swallowed the crew message: the turn it started is not in the record')
  assert.deepEqual(launch.noted, [], "the owner's heard turn was noted as one of unnamed source")
})

test('#440: a turn of unnamed source is recorded from an origin the launcher cannot name, never as a crew message', async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)

  // No prompt was heard and no message handed: the launcher cannot name what started this turn.
  await aTurnStarted(launch, 'text from nowhere the launcher heard')

  const after = await launch.paths()
  assert.equal(countOf(after, THE_UNNAMED_PATH) - countOf(before, THE_UNNAMED_PATH), 1, 'the turn of unnamed source is not in the record exactly once')
  assert.equal(countOf(after, THE_CREW_PATH) - countOf(before, THE_CREW_PATH), 0, 'a turn of unnamed source was recorded as a crew message')
  assert.deepEqual(launch.noted, [{ event: THE_TURN_STARTED_ASK, why: A_TURN_OF_UNNAMED_SOURCE }], 'the journal does not say exactly once that a turn of unnamed source ran')
  assert.deepEqual(launch.raised, [], 'a turn of unnamed source was raised to the turn listeners as a prompt')
  assert.deepEqual([...(await takenInBy(launch.channel, MEMBER))], [], 'a turn of unnamed source counted a crew message taken in')
  assert.equal(turnStarts(launch.screen), 1, "the owner's row never heard the turn start")
})

test("#440: a subagent's turn start records nothing", async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)
  await handed(launch, 'a message')

  await aTurnStarted(launch, 'a subagent at work', 'agent-1')

  assert.deepEqual(await launch.paths(), before, "a subagent's turn start changed the member's record")
  assert.deepEqual(launch.noted, [])
  assert.deepEqual(launch.raised, [])
})

test("#440: a slash command's turn is the prompt the host raised, though it starts on the command's line", async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)

  // The host raises what the owner typed, marked as a command; the turn starts on the line it wrote for the model.
  await heard(launch, '/init', THE_OWNERS_KIND, 'init')
  await aTurnStarted(launch, `<command-message>init</command-message>\n${theCommandLineOf('init')}`)

  const after = await launch.paths()
  assert.equal(countOf(after, THE_UNNAMED_PATH) - countOf(before, THE_UNNAMED_PATH), 0, "the command's turn was recorded again as one of unnamed source")
  assert.deepEqual(launch.noted, [], "the command's heard turn was noted as one of unnamed source")
})

test('#440: a heard command names only its own turn', async (t) => {
  const launch = aLaunch(t)
  const before = await started(launch)

  // A command was heard, but the turn that starts names another: the launcher cannot name what started it.
  await heard(launch, '/init', THE_OWNERS_KIND, 'init')
  await aTurnStarted(launch, `<command-message>review</command-message>\n${theCommandLineOf('review')}`)

  const after = await launch.paths()
  assert.equal(countOf(after, THE_UNNAMED_PATH) - countOf(before, THE_UNNAMED_PATH), 1, 'a turn naming another command was taken for the heard one')
  assert.deepEqual(launch.noted, [{ event: THE_TURN_STARTED_ASK, why: A_TURN_OF_UNNAMED_SOURCE }])
})
