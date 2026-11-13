// The launcher keeps the end of a running turn at a tool boundary (martha#311, ruling D, placed by the follow-up
// ruling): the hold may only narrow the gate's answers. On a call, every other check answers first and the hold can
// only turn a yes into a no; on a ran tool's report, the end rides only on a yes, after the own write was kept, the
// recheck ran and the result was taken in; a no stays a no and the member is still stopped; and with no crew there is
// no hold at all.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SHELL_TOOL, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { A_TOOL_WHILE_THE_END_IS_HELD, holdingTheEnds, type TheEndsHold } from '../refresh_a_member/hold_the_end.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

const SESSION = 'the-session'

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-311-held-end-relay-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, DEFAULT_CONFIG_DIR, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** A crew that refuses no call, over the one hold on the end of a running turn the test drives (martha#311). */
function aCrewHolding(ends: TheEndsHold): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    ends,
    thePredecessorOf: async () => null,
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async () => undefined,
  }
}

/** The receipts the launcher takes for a call that will run: a denied call may leave none. */
function theReceiptsTaken(allowed: string[]): SignedRuns {
  return {
    callAllowed: (tool) => void allowed.push(tool),
    callAnswered: () => undefined,
    run: async () => ({ refused: 'this test runs no signed shape' }),
  }
}

/** The relay for one member, over a crew's own tools and the receipts a call would take. */
function relayFor(places: Places, crew: CrewTools | undefined, signed_runs: SignedRuns, stops: string[] = []): MemberRelay {
  return memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE),
      home: places.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(places.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({
      launcher_env: { HOME: places.home },
      member_env: { HOME: places.home },
      home: places.home,
      launch_dir: places.checkout,
      settings_files: [],
      user_scope: userScopeFor(places.home),
    }),
    ...(crew === undefined ? {} : { crew }),
    signed_runs,
    stopMember: (why) => void stops.push(why),
  })
}

/** A started session, on a relay: the first thing every tool call is answered against. */
async function startedOn(relay: MemberRelay): Promise<void> {
  const reply = await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(reply.answered, true, 'the session was not started, so no call could be judged')
}

const call = (tool: string, more: Readonly<Record<string, unknown>> = {}) => ({ session_id: SESSION, call: { tool, tool_use_id: `toolu_${tool}`, ...more } })

const THE_TURN = 'the-running-turn'

/** The owner's user settings file, where a member's launch reads it (martha#122). */
const ownersSettingsOf = (places: Places): string => join(places.home, DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE)

/** A relay over a crew holding `ends`, its session started, with what it took receipts for and why it stopped. */
async function aStartedRelay(t: TestContext, ends: TheEndsHold | undefined) {
  const places = placesOf(t)
  mkdirSync(join(places.home, DEFAULT_CONFIG_DIR), { recursive: true })
  writeFileSync(ownersSettingsOf(places), '{}\n')
  const allowed: string[] = []
  const stops: string[] = []
  const relay = relayFor(places, ends === undefined ? undefined : aCrewHolding(ends), theReceiptsTaken(allowed), stops)
  await startedOn(relay)
  return { places, relay, allowed, stops }
}

const A_COMMAND = call(CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })

test('#311 placement ruling: while an end is held, a call naming the owner\'s settings is refused in #122\'s own words, not the hold\'s (mutant: ask the hold first)', async (t) => {
  const plain = await aStartedRelay(t, holdingTheEnds())
  const touching = call(WHOLE_FILE_TOOL, { file_path: ownersSettingsOf(plain.places), content: '{}' })
  const unheld = await plain.relay.answer('tool_called', touching)
  assert.ok(unheld.answered && 'deny' in unheld.body && unheld.body.deny !== A_TOOL_WHILE_THE_END_IS_HELD, 'the owner\'s settings file was not refused by #122 to begin with')
  const ends = holdingTheEnds()
  const held = await aStartedRelay(t, ends)
  ends.hold(SESSION, THE_TURN)
  const touchingHeld = call(WHOLE_FILE_TOOL, { file_path: ownersSettingsOf(held.places), content: '{}' })
  const answer = await held.relay.answer('tool_called', touchingHeld)
  assert.deepEqual(answer, { answered: true, body: { deny: unheld.body.deny.replaceAll(plain.places.home, held.places.home) } }, 'a held end answered for a call #122 refuses')
})

test('#311 placement ruling: a call the gate allows is denied while an end is held, and takes no receipt (mutant: no deny)', async (t) => {
  const ends = holdingTheEnds()
  const { relay, allowed } = await aStartedRelay(t, ends)
  ends.hold(SESSION, THE_TURN)
  assert.deepEqual(await relay.answer('tool_called', A_COMMAND), { answered: true, body: { deny: A_TOOL_WHILE_THE_END_IS_HELD } }, 'a call started in a turn whose end was held')
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})

test('#311 placement ruling: the end rides on the yes to the last call in flight, and on nothing before it (mutant: carry while in flight)', async (t) => {
  const ends = holdingTheEnds()
  const { relay, stops } = await aStartedRelay(t, ends)
  assert.deepEqual(await relay.answer('tool_called', A_COMMAND), { answered: true, body: { allow: 1 } }, 'the gate did not allow the call this test runs')
  assert.equal(ends.hold(SESSION, THE_TURN), 'held', 'the launcher did not count the allowed call in flight')
  assert.deepEqual(await relay.answer('tool_answered', A_COMMAND), { answered: true, body: { taken: 1, end_turn: THE_TURN } }, 'the end did not ride on the last call\'s yes')
  assert.deepEqual(stops, [], 'the member was stopped on a yes')
})

test('#311 placement ruling: a report the recheck refuses stays a no while an end is held, and the member is still stopped (mutants: the end added to a no; the hold before the recheck)', async (t) => {
  const ends = holdingTheEnds()
  const { places, relay, stops } = await aStartedRelay(t, ends)
  assert.deepEqual(await relay.answer('tool_called', A_COMMAND), { answered: true, body: { allow: 1 } })
  ends.hold(SESSION, THE_TURN)
  // The call turned the hooks off in the owner's settings: the recheck after it ran must stop the member (#122).
  writeFileSync(ownersSettingsOf(places), `${JSON.stringify({ disableAllHooks: true })}\n`)
  const answer = await relay.answer('tool_answered', A_COMMAND)
  assert.equal(answer.answered, false, 'a refused report was answered yes because an end rode on it')
  assert.equal(stops.length, 1, 'the member was not stopped on a refused report')
})

test('#311 placement ruling: with no crew there is no hold, and a call\'s report is a plain yes', async (t) => {
  const { relay } = await aStartedRelay(t, undefined)
  assert.deepEqual(await relay.answer('tool_called', A_COMMAND), { answered: true, body: { allow: 1 } })
  assert.deepEqual(await relay.answer('tool_answered', A_COMMAND), { answered: true, body: { taken: 1 } })
})
