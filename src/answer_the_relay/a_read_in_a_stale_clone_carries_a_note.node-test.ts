// A read's report carries the stale-clone note (martha#969, gap 9 of #957): the launcher asks the launch's note for a
// Read or a Grep it took, at the path the call names as the host resolves it, and puts the note on its yes. A call that
// is not a read, a launch with no note, and a note that fails all leave the yes as it was. A main turn's start is what
// lets a clone be told again.
//
// The note itself is a stand-in here: what git says of a clone is pinned in ../ask_git_how_far_a_clone_is_behind.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import type { TheStaleReads } from '../ask_git_how_far_a_clone_is_behind/ask_git_how_far_a_clone_is_behind.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READING_TOOLS, ownNameOfCalledTool, readingArgumentOf } from '../claude_code_host/claude_code_host.ts'
import { FILE_PATH_ARGUMENT, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { holdingTheEnds } from '../end_a_running_turn/hold_the_end.ts'
import { THE_TURN_STARTED_ASK } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE_CODE, CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { sourcesALaunchHandsTheModel } from '../install_the_mesh_server_for_claude_code/what_a_launch_hands_the_model.ts'
import { ownerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { hookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'

const SESSION = 'the-session'
const A_NOTE = 'note: the clone /w/acme/widget is 2 commits behind origin/main as of the last fetch (3 minutes ago).'
const [READ, GREP] = CLAUDE_CODE_READING_TOOLS
/** Where a Grep call names its place, as the host's own result row reads it. */
const GREP_PATH_ARGUMENT = readingArgumentOf(GREP) ?? ''

/** A note that records what it was asked, and answers `answer` for every read. */
function aNote(answer: () => Promise<string>): TheStaleReads & { readonly asked: string[]; readonly turns: string[] } {
  const asked: string[] = []
  const turns: string[] = []
  return {
    asked,
    turns,
    aTurnStarted: (session) => void turns.push(session),
    theNoteForARead: async (session, path) => {
      asked.push(`${session} ${path}`)
      return answer()
    },
  }
}

/** A crew that refuses nothing and answers every tool with nothing. */
const aCrew = (): CrewTools => ({
  tools: [],
  answer: async () => ({ answer: '' }),
  startBeating: () => () => {},
  theContractInForce: async () => undefined,
  startSweeping: () => () => {},
  theLineToHandAtStart: async () => null,
  noteTheStart: () => undefined,
  ends: holdingTheEnds(),
  theReviewModelOfTheCall: async () => null,
  theReviewModel: async () => null,
  thePredecessorOf: async () => null,
  theSpendInForce: async () => undefined,
  noteTheCallCounted: async () => undefined,
  noteTheCallsAnswer: () => undefined,
  refusesTheSubagent: async () => undefined,
  refusesTheGitIn: async () => undefined,
  noteTheWorkInHand: () => {},
})

/** A started relay over a checkout of its own, with the note `stale_reads` (or none), and what stopped it. */
async function aStartedRelay(t: TestContext, stale_reads: TheStaleReads | undefined): Promise<{ readonly relay: MemberRelay; readonly checkout: string; readonly stops: string[] }> {
  const home = mkdtempSync(join(tmpdir(), 'martha-969-relay-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(rows, { mode: 0o700 })
  const stops: string[] = []
  const relay = memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(rows)),
    launch: { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(home, CLAUDE_FOLDER, USER_SETTINGS_FILE),
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
      user_scope: { markdown_kinds: RECORDED_HOST.markdown_kinds, output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER, reported_output_styles_dir: join(home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER) },
    }),
    crew: aCrew(),
    ...(stale_reads === undefined ? {} : { stale_reads }),
    stopMember: (why) => void stops.push(why),
  })
  const started = await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(started.answered, true, 'the session was not started, so no call could be judged')
  return { relay, checkout, stops }
}

/** One call, allowed and then reported ran: the launcher's yes to the report. */
async function theYesToARan(relay: MemberRelay, tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
  const call = { session_id: SESSION, call: { tool, tool_use_id: `toolu_${tool}`, ...args } }
  assert.deepEqual(await relay.answer('tool_called', call), { answered: true, body: { allow: 1 } }, `the gate did not allow the ${tool} this test runs`)
  return relay.answer('tool_answered', { ...call, answer: 'what the tool answered' })
}

test('#969: a Read\'s report is answered with the note for the file it names, on the yes', async (t) => {
  const note = aNote(async () => A_NOTE)
  const { relay, stops } = await aStartedRelay(t, note)
  assert.ok(READ !== undefined && GREP !== undefined)
  assert.deepEqual(await theYesToARan(relay, READ, { [FILE_PATH_ARGUMENT]: '/w/acme/widget/src/a.ts' }), { answered: true, body: { taken: 1, note: A_NOTE } })
  assert.deepEqual(note.asked, [`${SESSION} /w/acme/widget/src/a.ts`])
  assert.deepEqual(stops, [])
})

test('#969: a Grep is asked at the place it names, resolved from where the member was launched, or there when it names none', async (t) => {
  const note = aNote(async () => '')
  const { relay, checkout } = await aStartedRelay(t, note)
  assert.ok(GREP !== undefined)
  assert.deepEqual(await theYesToARan(relay, GREP, { pattern: 'x', [GREP_PATH_ARGUMENT]: 'src' }), { answered: true, body: { taken: 1 } }, 'an empty note changed the yes')
  await theYesToARan(relay, GREP, { pattern: 'x' })
  assert.deepEqual(note.asked, [`${SESSION} ${join(checkout, 'src')}`, `${SESSION} ${checkout}`])
})

test('#969: a call that is no read, a launch with no note, and a note that fails leave the yes as it was', async (t) => {
  const note = aNote(async () => A_NOTE)
  const writing = await aStartedRelay(t, note)
  assert.deepEqual(await theYesToARan(writing.relay, WHOLE_FILE_TOOL, { [FILE_PATH_ARGUMENT]: join(writing.checkout, 'a.md'), content: 'x' }), { answered: true, body: { taken: 1 } })
  assert.deepEqual(note.asked, [], 'a write was asked for a note')
  assert.ok(READ !== undefined)
  const none = await aStartedRelay(t, undefined)
  assert.deepEqual(await theYesToARan(none.relay, READ, { [FILE_PATH_ARGUMENT]: '/w/acme/widget/a.ts' }), { answered: true, body: { taken: 1 } })
  const failing = await aStartedRelay(t, aNote(async () => Promise.reject(new Error('git went away'))))
  assert.deepEqual(await theYesToARan(failing.relay, READ, { [FILE_PATH_ARGUMENT]: '/w/acme/widget/a.ts' }), { answered: true, body: { taken: 1 } })
  assert.deepEqual(failing.stops, [], 'a failed note stopped the member')
})

test('#969: a main turn\'s start tells the note a new turn began in that session', async (t) => {
  const note = aNote(async () => '')
  const { relay } = await aStartedRelay(t, note)
  await relay.answerTool({ session_id: SESSION, tool: THE_TURN_STARTED_ASK, args: { turnId: 'turn-1', text: 'go on' } })
  assert.deepEqual(note.turns, [SESSION])
  await relay.answerTool({ session_id: SESSION, tool: THE_TURN_STARTED_ASK, args: { turnId: 'turn-1b', text: 'a subagent\'s', agentId: 'agent-1' } })
  assert.deepEqual(note.turns, [SESSION], 'a subagent\'s turn was taken as a new main turn')
})
