// A turn the relay refused names no failed review, however well its envelope reads (martha#541, package 2-4, 1a).
//
// This exists because the naming of a failed review is about to leave the turn handler and become a report of its own
// (#541's packages 2-4). Today it is named only after the session was known, the turn was kept and the turn was raised;
// a report that arrives on its own could name a review failed for a turn the member never took in, which is a line in the
// owner's row and in the crew's channel about nothing. This case pins the refusal side before the move, so the move has
// to keep it.
//
// It is not a red-first case: the behaviour it pins is the behaviour today's tree already has. It is green here, and it
// must stay green.
//
// Both halves run the same envelope. The refused half proves a refusal names nothing; the kept half proves the envelope
// itself is one this tree names a review from, so the first half's silence is the refusal and not a report nobody reads.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SUBAGENT_SPAWN, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { THE_HOSTS_FAILED_REVIEW } from '../claude_code_host/the_failed_reviews_envelope.ts'
import { holdingTheEnds } from '../end_a_running_turn/hold_the_end.ts'
import { sourcesALaunchHandsTheModel } from '../install_the_mesh_server_for_claude_code/what_a_launch_hands_the_model.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE_CODE, CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { hookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { isAReview } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { memberRelay, type MemberRelay, type TheMembersTelling } from './answer_the_relay.ts'

const KEPT = 'the-session-that-took-the-turn'
const REFUSED = 'the-session-this-launcher-never-started'
/** The crew's reviewer model, as the declaration names it, and the model the host says the call resolved to. */
const THE_REVIEWER_MODEL = 'opus'
const THE_RESOLVED_REVIEW_MODEL = 'claude-opus-5-5'
const THE_REVIEWS_CALL = 'toolu_the_review_1'
const THE_REVIEW = { subagent_type: 'general-purpose', description: 'review the patch', prompt: 'read the diff and judge it', model: THE_REVIEWER_MODEL }

/** The envelope the counted host writes for an agent that failed, with this launcher's own call in it. */
const THE_ENVELOPE = [
  `<${THE_HOSTS_FAILED_REVIEW.notification}>`,
  `<${THE_HOSTS_FAILED_REVIEW.tool_use}>${THE_REVIEWS_CALL}</${THE_HOSTS_FAILED_REVIEW.tool_use}>`,
  `<${THE_HOSTS_FAILED_REVIEW.status}>${THE_HOSTS_FAILED_REVIEW.failed}</${THE_HOSTS_FAILED_REVIEW.status}>`,
  `<${THE_HOSTS_FAILED_REVIEW.summary}>Agent "review the patch" failed: the account is at its limit (model sent to the API: ${THE_RESOLVED_REVIEW_MODEL})</${THE_HOSTS_FAILED_REVIEW.summary}>`,
  `</${THE_HOSTS_FAILED_REVIEW.notification}>`,
].join('\n')

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-541-refused-envelope-'))
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
  reported_output_styles_dir: join(home, CLAUDE_FOLDER, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** What this launcher told the owner's row, and the member. */
interface Told {
  readonly rows: string[]
  readonly member: string[]
}

/** A telling that records both halves, so a line about nothing is read as one. */
function aTellingThatRecords(told: Told): TheMembersTelling {
  return {
    theRow: (line) => void told.rows.push(line),
    theMember: async (line) => void told.member.push(line),
    takeTheLineBack: () => {},
  }
}

/** A crew whose review-model rule names the model every review runs on, and refuses nothing. */
function aCrewNamingItsReviewerModel(): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    theContractInForce: async () => undefined,
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    ends: holdingTheEnds(),
    thePredecessorOf: async () => null,
    theSpendInForce: async () => undefined,
    noteTheCallCounted: async () => undefined,
    theReviewModelOfTheCall: async (call) => (isAReview(call.input, CLAUDE_CODE_SUBAGENT_SPAWN) ? THE_REVIEWER_MODEL : null),
    theReviewModel: async () => THE_REVIEWER_MODEL,
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async () => undefined,
  }
}

function relayFor(places: Places, crew: CrewTools, telling: TheMembersTelling): MemberRelay {
  return memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, CLAUDE_FOLDER, USER_SETTINGS_FILE),
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
    telling,
    stopMember: () => {},
  })
}

/** The review this launcher allowed, and the model the host answered it with: what a line about it needs. */
async function allowedAReviewOn(relay: MemberRelay, session_id: string): Promise<void> {
  const call = { session_id, call: { tool: CLAUDE_CODE_SUBAGENT_SPAWN.tools[0], tool_use_id: THE_REVIEWS_CALL, ...THE_REVIEW } }
  const allowed = await relay.answer('tool_called', call)
  assert.deepEqual(allowed, { answered: true, body: { allow: 1 } }, 'the review was not allowed, so this launcher has no call to name')
  const answered = await relay.answer('tool_answered', { ...call, answer: { result: { resolvedModel: THE_RESOLVED_REVIEW_MODEL } } })
  assert.equal(answered.answered, true, 'the answer to the review did not reach the relay')
}

async function startedOn(relay: MemberRelay, session_id: string): Promise<void> {
  const reply = await relay.answer('session_started', { session_id, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(reply.answered, true, 'the session was not started')
}

test('#541 1a: a turn this launcher refused names no failed review, though its envelope names one it allowed', async (t) => {
  const places = placesOf(t)
  const told: Told = { rows: [], member: [] }
  const relay = relayFor(places, aCrewNamingItsReviewerModel(), aTellingThatRecords(told))
  await startedOn(relay, KEPT)
  await allowedAReviewOn(relay, KEPT)

  const refused = await relay.answer('prompt_submitted', { session_id: REFUSED, text: THE_ENVELOPE, origin: { kind: THE_HOSTS_FAILED_REVIEW.notification } })

  assert.equal(refused.answered, true)
  assert.notEqual((refused.body as { refused?: string }).refused, undefined, 'the prompt was taken in for a session this launcher never started')
  assert.deepEqual(told, { rows: [], member: [] }, 'a turn the member never took in named a review failed, on the owner\'s row and in the crew\'s channel')
})

test('#541 1a: the same envelope, on a turn this launcher kept, names the review it allowed', async (t) => {
  const places = placesOf(t)
  const told: Told = { rows: [], member: [] }
  const relay = relayFor(places, aCrewNamingItsReviewerModel(), aTellingThatRecords(told))
  await startedOn(relay, KEPT)
  await allowedAReviewOn(relay, KEPT)

  const taken = await relay.answer('prompt_submitted', { session_id: KEPT, text: THE_ENVELOPE, origin: { kind: THE_HOSTS_FAILED_REVIEW.notification } })

  assert.deepEqual(taken, { answered: true, body: { taken: 1 } })
  assert.equal(told.rows.length, 1, 'the envelope named no review on the kept turn, so the refused half above proves nothing')
  assert.equal(told.member.length, 1)
  assert.ok(told.rows[0]?.includes(THE_RESOLVED_REVIEW_MODEL) === true, `the line did not name the model the call resolved to: ${told.rows[0]}`)
})
