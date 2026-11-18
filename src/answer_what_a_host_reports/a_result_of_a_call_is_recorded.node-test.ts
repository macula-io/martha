// A tool's result, an agent's start and stop, and the crew's tool ask, answered by the entry (martha#541, packages 2-4,
// PR 3).
//
// This exists because PR 3 moves the recording of a ran tool out of the Claude Code adapter and into the entry every
// host reaches, so a second host's results meet the same rechecks and the same record. The adapter's tests drive the
// result through the relay and would still pass if the recording stayed in the adapter; these drive the entry alone,
// in the contract's words, with a host this file makes up. So a step the entry does not really take fails here by name.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { holdingTheEnds } from '../end_a_running_turn/hold_the_end.ts'
import type { AResultOfACall, ToolNames } from '../host_contract/host_contract.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { reviewSpawnsRemembered, type TheReviewSpawns } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import type { ToolResultRows } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { agentRunsKept, answersOver, NO_CREW_TOOLS, NOWHERE_TO_RECORD, type TheAnswersOfOneLaunch } from './answer_what_a_host_reports.ts'
import { runOf, type TheRunTable } from '../vouch_for_the_agents_a_session_started/vouch_for_the_agents_a_session_started.ts'

/** The made-up host's names: a called tool is its own name. */
const A_MADE_UP_HOSTS_NAMES: ToolNames = { ownNameOf: (called) => called }
/** The made-up host's own tools, by what their result reads: one fetches the web, one hands an agent's answer back. */
const ITS_FETCH = 'fetch-a-page'
const ITS_AGENT = 'start-an-agent'
const ITS_ROWS: ToolResultRows = {
  [ITS_FETCH]: { reads: 'a_source', source: 'web' },
  [ITS_AGENT]: { reads: 'an_agents_answer', source: 'subagent' },
}
const THE_SETTINGS_TURNED_OFF = 'the owner’s settings now turn the relay off'
const THE_WRITE_UNKEPT = 'the write this call made could not be kept'
const THE_PREDECESSOR = 'session-before'
const THE_REVIEWER_MODEL = 'the-reviewer'

interface Seen {
  readonly steps: string[]
}

/** What the made-up launch does: which check fails, what a signed run says, and what the crew holds. */
interface TheLaunchDoes {
  readonly settings_fail?: boolean
  readonly write_unkept?: boolean
  readonly signed_run_exact?: boolean
  readonly end_held_for?: string
  readonly refreshed?: string
  readonly no_crew?: boolean
  readonly nowhere_to_record?: boolean
}

function aCrew(does: TheLaunchDoes, seen: Seen): CrewTools {
  const ends = holdingTheEnds()
  if (does.end_held_for !== undefined) {
    ends.aCallAllowed(does.end_held_for, 'call-1')
    ends.hold(does.end_held_for, 'turn-1')
  }
  return {
    tools: [],
    answer: async (name, _args, session) => {
      seen.steps.push(`crew answered ${name} for ${session}`)
      return { answer: 'done' }
    },
    startBeating: () => () => {},
    theContractInForce: async () => undefined,
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    ends,
    thePredecessorOf: async (session_id) => (session_id === does.refreshed ? THE_PREDECESSOR : null),
    theSpendInForce: async () => undefined,
    noteTheCallCounted: async () => undefined,
    theReviewModelOfTheCall: async () => null,
    theReviewModel: async () => THE_REVIEWER_MODEL,
    noteTheCallsAnswer: (call) => void seen.steps.push(`menu answer noted ${call.tool}`),
    refusesTheSubagent: async () => undefined,
  }
}

interface AnEntry {
  readonly answers: TheAnswersOfOneLaunch
  readonly seen: Seen
  readonly reviews: TheReviewSpawns
  readonly agents: TheRunTable
}

function anEntry(t: TestContext, does: TheLaunchDoes = {}): AnEntry {
  const home = mkdtempSync(join(tmpdir(), 'martha-541-3-entry-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  const seen: Seen = { steps: [] }
  const reviews = reviewSpawnsRemembered()
  const agents = agentRunsKept()
  const answers = answersOver({
    records: sessionRecordsIn(rowStreamsDirectory(rows)),
    launch: { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home, approved_fingerprints: [] },
    machine: thisMachine,
    binder: bindNothing,
    handed_at_start: [],
    crew: does.no_crew === true ? undefined : aCrew(does, seen),
    reviews,
    agents,
    policy: { may_send_executable_text: [] },
    names: A_MADE_UP_HOSTS_NAMES,
    signed_runs: {
      callAllowed: () => {},
      callAnswered: (tool) => {
        seen.steps.push(`receipt taken ${tool}`)
        return does.signed_run_exact === true ? { why: undefined } : undefined
      },
    },
    refusesAWriteToTheOwnersSettings: () => undefined,
    refusesAWriteToTheOwnersMemory: () => undefined,
    results: does.nowhere_to_record === true ? undefined : {
      tool_result_rows: ITS_ROWS,
      read_attaches_nothing: undefined,
      started_with: undefined,
      noteWhatThisCallWrote: (call) => {
        seen.steps.push(`own write kept ${call.tool} in ${call.session}`)
        return does.write_unkept === true ? THE_WRITE_UNKEPT : undefined
      },
      checkTheSettingsStillHold: () => {
        seen.steps.push('settings checked')
        return does.settings_fail === true ? THE_SETTINGS_TURNED_OFF : undefined
      },
    },
  })
  return { answers, seen, reviews, agents }
}

const aResult = (over: Partial<AResultOfACall> = {}): AResultOfACall => ({
  session_id: 'session-a',
  tool: ITS_FETCH,
  input: { url: 'https://example.org/' },
  call_id: 'call-1',
  answer: { text: 'a page' },
  from_a_tool_server: false,
  ...over,
})

/** The paths the session's record holds, as the entry reads it now. */
function recordedIn(answers: TheAnswersOfOneLaunch, session_id: string): readonly string[] {
  const session = answers.named(session_id)
  return typeof session === 'string' ? [] : session.gate.ingested.map((ingestion) => ingestion.path)
}

const started = async (answers: TheAnswersOfOneLaunch, session_id = 'session-a'): Promise<void> => {
  assert.deepEqual(await answers.aSessionStarted({ session_id, outcome: 'fresh' }), { taken: '' })
}

test('#541 3: a result for a call the entry never allowed is still recorded, after the own write and the recheck, in that order', async (t) => {
  const { answers, seen } = anEntry(t)
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  const answer = await answers.aResultCame(aResult())

  assert.deepEqual(answer, { taken: 1 })
  assert.equal(recordedIn(answers, 'session-a').length, before.length + 1, 'the fetched page was not recorded')
  assert.deepEqual(seen.steps, [`menu answer noted ${ITS_FETCH}`, `receipt taken ${ITS_FETCH}`, `own write kept ${ITS_FETCH} in session-a`, 'settings checked'])
})

test('#541 3: a result in a session never started stops the member by name, and nothing is asked', async (t) => {
  const { answers, seen } = anEntry(t)

  const answer = await answers.aResultCame(aResult({ session_id: 'session-z' }))

  assert.ok('stop' in answer && /no start of session session-z was taken/.test(answer.stop), 'an unknown session’s result did not stop the member')
  assert.deepEqual(seen.steps, [])
})

test('#541 3: settings that no longer hold stop the member with their reason, and the result is not recorded', async (t) => {
  const { answers } = anEntry(t, { settings_fail: true })
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  assert.deepEqual(await answers.aResultCame(aResult()), { stop: THE_SETTINGS_TURNED_OFF })
  assert.deepEqual(recordedIn(answers, 'session-a'), before)
})

test('#541 3: a launch given nowhere to record a result stops the member, and records nothing', async (t) => {
  const { answers } = anEntry(t, { nowhere_to_record: true })
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  assert.deepEqual(await answers.aResultCame(aResult()), { stop: NOWHERE_TO_RECORD })
  assert.deepEqual(recordedIn(answers, 'session-a'), before)
})

test('#541 3: an own write that cannot be kept stops the member before the settings are read again', async (t) => {
  const { answers, seen } = anEntry(t, { write_unkept: true })
  await started(answers)

  assert.deepEqual(await answers.aResultCame(aResult()), { stop: THE_WRITE_UNKEPT })
  assert.equal(seen.steps.includes('settings checked'), false, 'the settings were read before the own write was kept')
})

test('#541 3: an exact signed run records nothing (martha#129), and every other result records', async (t) => {
  const { answers } = anEntry(t, { signed_run_exact: true })
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  assert.deepEqual(await answers.aResultCame(aResult()), { taken: 1 })
  assert.deepEqual(recordedIn(answers, 'session-a'), before)
})

test('#541 3: a tool server’s result is recorded as one, whatever the host’s own rows say of its name', async (t) => {
  const { answers } = anEntry(t)
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  assert.deepEqual(await answers.aResultCame(aResult({ tool: 'some-server-tool', from_a_tool_server: true })), { taken: 1 })
  assert.equal(recordedIn(answers, 'session-a').length, before.length + 1, 'a tool server’s answer was not recorded')
})

test('#541 3: the end of the turn rides on a taken result only, never on a stop', async (t) => {
  const kept = anEntry(t, { end_held_for: 'session-a' })
  await started(kept.answers)
  assert.deepEqual(await kept.answers.aResultCame(aResult()), { taken: 1, end_turn: 'turn-1' })

  const stopped = anEntry(t, { end_held_for: 'session-a', settings_fail: true })
  await started(stopped.answers)
  assert.deepEqual(await stopped.answers.aResultCame(aResult()), { stop: THE_SETTINGS_TURNED_OFF })
})

test('#541 3: a review this launch allowed is kept with the model the host says it resolved to', async (t) => {
  const { answers, reviews } = anEntry(t)
  await started(answers)
  reviews.remember('call-1', THE_REVIEWER_MODEL)

  await answers.aResultCame(aResult({ resolved_model: 'a-resolved-model' }))

  assert.equal(reviews.theSpawn('call-1')?.resolved_model, 'a-resolved-model')
})

test('#541 3: an agent’s answered call is noted on its run, and what it read keeps the agent unvouched', async (t) => {
  const { answers, agents } = anEntry(t)
  await started(answers)
  await answers.anAgentStarted({ session_id: 'session-a', agent_id: 'agent-1' })

  await answers.aResultCame(aResult({ agent_id: 'agent-1', call_id: 'call-7' }))

  const run = runOf(agents, 'session-a', 'agent-1')
  assert.ok(run.calls_answered.has('call-7'), 'the agent’s answered call was not noted')
  assert.equal(run.calls_recorded.length, 1, 'what the agent’s call read was not kept on its run')
})

test('#541 3: an agent that stops vouched for records nothing; one never seen to start records its answer as a subagent’s', async (t) => {
  const { answers } = anEntry(t)
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  assert.deepEqual(await answers.anAgentStarted({ session_id: 'session-a', agent_id: 'agent-1' }), { taken: 1 })
  assert.deepEqual(await answers.anAgentStopped({ session_id: 'session-a', agent_id: 'agent-1' }), { taken: 1 })
  assert.deepEqual(recordedIn(answers, 'session-a'), before, 'a vouched agent’s stop recorded its answer')

  assert.deepEqual(await answers.anAgentStopped({ session_id: 'session-a', agent_id: 'agent-2' }), { taken: 1 })
  assert.equal(recordedIn(answers, 'session-a').length, before.length + 1, 'an unvouched agent’s answer was not recorded')
})

test('#541 3: an agent of a session never started is refused by name', async (t) => {
  const { answers } = anEntry(t)

  const answer = await answers.anAgentStopped({ session_id: 'session-z', agent_id: 'agent-1' })

  assert.ok('refused' in answer && /no start of session session-z was taken/.test(answer.refused))
})

test('#541 3: the crew’s tool ask takes a refreshed session in first, then the crew answers it', async (t) => {
  const { answers, seen } = anEntry(t, { refreshed: 'session-b' })

  const answer = await answers.aCrewToolAsked({ session_id: 'session-b', tool: 'crew_status', args: {} })

  assert.deepEqual(answer, { answer: 'done' })
  assert.deepEqual(seen.steps, ['crew answered crew_status for session-b'])
  assert.equal(typeof answers.named('session-b'), 'object', 'the refreshed session was not taken in before the crew answered')
})

test('#541 3: a launch with no crew answers no tool, by name', async (t) => {
  const { answers } = anEntry(t, { no_crew: true })

  assert.deepEqual(await answers.aCrewToolAsked({ session_id: 'session-a', tool: 'crew_status', args: {} }), { refused: NO_CREW_TOOLS })
})

test('#541 3: a turn the host never raised is kept in a session the entry holds, and refused in one it does not', async (t) => {
  const { answers } = anEntry(t)
  await started(answers)
  const before = recordedIn(answers, 'session-a')

  assert.equal(await answers.aTurnTheHostNeverRaised('session-a', { source: 'checkout_hook' }), true)
  assert.equal(recordedIn(answers, 'session-a').length, before.length + 1, 'the turn was not kept')
  assert.equal(await answers.aTurnTheHostNeverRaised('session-z', { source: 'checkout_hook' }), false)
})
