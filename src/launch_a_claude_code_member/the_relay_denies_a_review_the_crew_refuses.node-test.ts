// The relay asks the crew's reviewer-model rule about a tool call, beside the gate and never inside it (martha#315).
//
// Nothing else proves the relay ever asks. The rule is well tested on its own (../run_reviews_on_the_review_model),
// and the one relay-level stub answers none for every call, so a relay that stopped asking — or that asked before the
// gate instead of after it — would leave every test green. These two hold each half: a call the crew refuses is denied
// with the crew's own reason and takes no signed-run receipt, and a call the gate refuses is denied by the gate even
// though the crew refuses it too.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { holdingTheEnds } from '../refresh_a_member/hold_the_end.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SUBAGENT_SPAWN, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { CLAUDE_CODE, startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { WHO_DECIDES_REACH, MESH_TOOLS_THAT_WIDEN_REACH } from '../refuse_widening_a_member_reach/refuse_widening_a_member_reach.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { memberRelay, type MemberRelay, type RelayReply } from './answer_the_relay.ts'
import { removeTheTree } from './relay_copy.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

const SESSION = 'the-session'

/**
 * The reason this crew gives for a call it does not run. What these tests read is that the relay hands the crew's own
 * reason on, and how it stands against the gate's — not the wording of the rule, which has its own tests.
 */
const A_REFUSED_REVIEW = 'Not run: this crew holds its reviews to the model its owner declared.'

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-315-review-relay-'))
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

/**
 * A crew that refuses every call it is asked about, so what a test reads is the relay's own order: a real crew refuses
 * only a review, and a call it would not refuse is one these tests do not need.
 */
function aCrewRefusingEverything(asked: string[]): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    ends: holdingTheEnds(),
    thePredecessorOf: async () => null,
    // This crew hears no menu close, which is what the ask queue reads a settle on (martha#313).
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async (call) => {
      asked.push(call.tool)
      return A_REFUSED_REVIEW
    },
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
function relayFor(places: Places, crew: CrewTools, signed_runs: SignedRuns): MemberRelay {
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
    crew,
    signed_runs,
    stopMember: () => {},
  })
}

/** A started session, on a relay: the first thing every tool call is answered against. */
async function startedOn(relay: MemberRelay): Promise<void> {
  const reply = await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(reply.answered, true, 'the session was not started, so no call could be judged')
}

const call = (tool: string, more: Readonly<Record<string, unknown>> = {}) => ({ session_id: SESSION, call: { tool, tool_use_id: `toolu_${tool}`, ...more } })

const denied = (why: string): RelayReply => ({ answered: true, body: { deny: why } })

test('#315: the relay denies a call the crew refuses, with the crew\'s own reason, and takes no signed-run receipt', async (t) => {
  const places = placesOf(t)
  const asked: string[] = []
  const allowed: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything(asked), theReceiptsTaken(allowed))
  await startedOn(relay)

  const review = call(CLAUDE_CODE_SUBAGENT_SPAWN.tools[0]!, { [CLAUDE_CODE_SUBAGENT_SPAWN.type_field]: 'Explore', [CLAUDE_CODE_SUBAGENT_SPAWN.description_field]: 'review the patch' })
  assert.deepEqual(await relay.answer('tool_called', review), denied(A_REFUSED_REVIEW), 'the call the gate allows and the crew refuses was not denied with the crew\'s reason')
  assert.deepEqual(asked, [CLAUDE_CODE_SUBAGENT_SPAWN.tools[0]!], 'the relay never asked the crew about the call it judged')
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})

test('#315: the gate\'s own answer comes first, so a call the gate denies is denied by the gate though the crew refuses it', async (t) => {
  const places = placesOf(t)
  const asked: string[] = []
  const allowed: string[] = []
  const relay = relayFor(places, aCrewRefusingEverything(asked), theReceiptsTaken(allowed))
  await startedOn(relay)

  const widening = MESH_TOOLS_THAT_WIDEN_REACH[0]!
  assert.deepEqual(
    await relay.answer('tool_called', call(widening)),
    denied(`${widening} is not called in a member's session: ${WHO_DECIDES_REACH}.`),
    'the crew\'s review rule answered for a call the gate refuses, so it sits before the gate rather than beside it',
  )
  assert.deepEqual(allowed, [], 'a receipt was taken for a call that never ran')
})
