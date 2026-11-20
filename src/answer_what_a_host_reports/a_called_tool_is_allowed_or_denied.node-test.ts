// A called tool, allowed or denied by the entry (martha#541, packages 2-4, PR 2).
//
// This exists because PR 2 moves the tool call's decision out of the Claude Code adapter and into the entry every host
// reaches, so a second host's permission request meets the same gates. The adapter's tests drive the call through the
// relay and would still pass if the decision stayed in the adapter; these drive the entry alone, in the contract's
// words, with a host this file makes up. So a step the entry does not really take fails here by name.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { holdingTheEnds, A_TOOL_WHILE_THE_END_IS_HELD } from '../end_a_running_turn/hold_the_end.ts'
import type { ACalledTool, ToolNames } from '../host_contract/host_contract.ts'
import { theNoticeOfACallPastTheBudget, type ASpendInForce } from '../hold_a_package_to_its_budget/refuse_a_call_past_the_budget.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { reviewSpawnsRemembered, type TheReviewSpawns } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { theNoticeOfACallOutsideTheContract, type TheContractInForce } from '../refuse_calls_outside_the_package_contract/refuse_a_call_outside_the_contract.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { sessionRecordsIn, type SessionRecords } from '../session_records_in_rows/session_records_in_rows.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'
import { A_CALL_NOT_COUNTED, agentRunsKept, answersOver, type TheAnswersOfOneLaunch } from './answer_what_a_host_reports.ts'
import { runOf, type TheRunTable } from '../vouch_for_the_agents_a_session_started/vouch_for_the_agents_a_session_started.ts'

/** The made-up host's names: a called tool is its own name, as a host with no tool servers names it. */
const A_MADE_UP_HOSTS_NAMES: ToolNames = { ownNameOf: (called) => called }
/** A synthetic package, never a real one: this repository is public. */
const A_PACKAGE = 'synthetic-owner/repo#7'
/** A tool of the made-up host that runs commands: no read-only list names it, so the shell rules hold it. */
const ITS_SHELL = 'run-a-command'
const THE_REVIEWER_MODEL = 'the-reviewer'
const THE_SETTINGS_REFUSAL = 'that call writes the owner’s settings'
const THE_MEMORY_REFUSAL = 'that call writes the owner’s memory'
const THE_BILLING_REFUSAL = 'that call needs a login this member is not billed by'
const WHY_THE_SPEND_ROW_WAS_NOT_KEPT = 'the spend row could not be kept'

/** What each step the entry may take left behind, in the order it was taken. */
interface Seen {
  readonly steps: string[]
}

/** What the made-up launch does: which callback refuses, and what the crew answers. */
interface TheLaunchDoes {
  readonly settings_refuse?: boolean
  readonly memory_refuse?: boolean
  readonly billing_refuse?: boolean
  readonly spend_unkept?: boolean
  readonly review_model_of_the_call?: string | null
  readonly end_held_for?: string
  /** The contract the crew answers for every call: none when absent. */
  readonly contract?: TheContractInForce
  /** The spend the crew answers for every session: none when absent. */
  readonly spend?: ASpendInForce
}

function aCrew(does: TheLaunchDoes, seen: Seen): CrewTools {
  const ends = holdingTheEnds()
  if (does.end_held_for !== undefined) ends.hold(does.end_held_for, 'turn-1')
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    theContractInForce: async () => {
      seen.steps.push('the contract read')
      return does.contract
    },
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    noteTheStart: () => undefined,
    ends: {
      ...ends,
      deniesACall: (session) => ends.deniesACall(session),
      aCallAllowed: (session, id) => {
        seen.steps.push(`a call allowed ${id}`)
        ends.aCallAllowed(session, id)
      },
    },
    thePredecessorOf: async () => null,
    theSpendInForce: async () => does.spend,
    noteTheCallCounted: async () => {
      seen.steps.push('counted')
      return does.spend_unkept === true ? WHY_THE_SPEND_ROW_WAS_NOT_KEPT : undefined
    },
    theReviewModelOfTheCall: async () => does.review_model_of_the_call ?? null,
    theReviewModel: async () => THE_REVIEWER_MODEL,
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async () => undefined,
  }
}

function aSignedRuns(seen: Seen): SignedRuns {
  return {
    callAllowed: (tool) => void seen.steps.push(`signed run noted ${tool}`),
    callAnswered: () => undefined,
    run: async () => ({ refused: 'no shape' }),
  }
}

/** The record `records` keeps, but a session named in `failing` has its next check refused, once, as a full disk would. */
function recordsFailingTheCheckOnce(records: SessionRecords, failing: Set<string>): SessionRecords {
  return {
    load: (session_id) => records.load(session_id),
    get store() {
      return records.store
    },
    flush: (session_id) => records.flush(session_id),
    check: async (session_id) => {
      if (failing.delete(session_id)) throw Object.assign(new Error('the disk is full'), { code: 'ENOSPC' })
      return records.check(session_id)
    },
  }
}

interface AnEntry {
  readonly answers: TheAnswersOfOneLaunch
  readonly seen: Seen
  readonly reviews: TheReviewSpawns
  readonly agents: TheRunTable
  readonly failing_check: Set<string>
}

function anEntry(t: TestContext, does: TheLaunchDoes = {}): AnEntry {
  const home = mkdtempSync(join(tmpdir(), 'martha-541-2-entry-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  const seen: Seen = { steps: [] }
  const reviews = reviewSpawnsRemembered()
  const agents = agentRunsKept()
  const failing_check = new Set<string>()
  const answers = answersOver({
    records: recordsFailingTheCheckOnce(sessionRecordsIn(rowStreamsDirectory(rows)), failing_check),
    launch: { host: CLAUDE_CODE, launch_dir: checkout, stop_dir: home, approved_fingerprints: [] },
    machine: thisMachine,
    binder: bindNothing,
    handed_at_start: [],
    crew: aCrew(does, seen),
    reviews,
    agents,
    told: {
      theRow: () => {},
      theMember: async (line, call) => void seen.steps.push(`told the member ${call}: ${line}`),
      takeTheLineBack: () => void seen.steps.push('line taken back'),
    },
    journal: { noted: (event, why, call) => void seen.steps.push(`journal ${String(call)}: ${event}: ${why}`) },
    policy: { may_send_executable_text: [] },
    names: A_MADE_UP_HOSTS_NAMES,
    signed_runs: aSignedRuns(seen),
    refusesACallItsBillingCannotRun: () => {
      seen.steps.push('billing asked')
      return does.billing_refuse === true ? THE_BILLING_REFUSAL : undefined
    },
    refusesAWriteToTheOwnersSettings: () => {
      seen.steps.push('settings asked')
      return does.settings_refuse === true ? THE_SETTINGS_REFUSAL : undefined
    },
    refusesAWriteToTheOwnersMemory: () => {
      seen.steps.push('memory asked')
      return does.memory_refuse === true ? THE_MEMORY_REFUSAL : undefined
    },
  })
  return { answers, seen, reviews, agents, failing_check }
}

const aCall = (over: Partial<ACalledTool> = {}): ACalledTool => ({ session_id: 'session-a', tool: ITS_SHELL, input: { command: 'make' }, call_id: 'call-1', ...over })

const deniedBecause = (answer: unknown): string => (typeof answer === 'object' && answer !== null && 'denied' in answer ? String(answer.denied) : '')

test('#541 2: the made-up shell is one the shell rules hold, so the hold cases below test the hold', () => {
  assert.ok(isShellTool(ITS_SHELL))
})

test('#541 2: a call in a session the entry holds is allowed in the contract’s words, counted, noted and its end told, in that order', async (t) => {
  const { answers, seen } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const answer = await answers.aToolCalled(aCall())

  assert.deepEqual(answer, { allowed: 1 })
  assert.deepEqual(seen.steps, ['billing asked', 'settings asked', 'memory asked', 'the contract read', 'counted', `signed run noted ${ITS_SHELL}`, 'a call allowed call-1'])
})

test('#957 gap 13: a call the member\'s billing cannot run is denied first, with the launch\'s words, before anything else is asked (mutant: the billing not asked)', async (t) => {
  const { answers, seen } = anEntry(t, { billing_refuse: true, settings_refuse: true })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const answer = await answers.aToolCalled(aCall())

  assert.equal(deniedBecause(answer), THE_BILLING_REFUSAL)
  assert.deepEqual(seen.steps, ['billing asked'])
})

test('#541 2: a call in a session never started is denied by name, and nothing is asked', async (t) => {
  const { answers, seen } = anEntry(t)

  const answer = await answers.aToolCalled(aCall({ session_id: 'session-z' }))

  assert.match(deniedBecause(answer), /no start of session session-z was taken/)
  assert.deepEqual(seen.steps, [])
})

test('#541 2: a call in a session whose record can no longer be vouched for is denied with the reason, and the session stays broken', async (t) => {
  const { answers, seen, failing_check } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  failing_check.add('session-a')

  const first = await answers.aToolCalled(aCall())
  const again = await answers.aToolCalled(aCall({ call_id: 'call-2' }))

  assert.match(deniedBecause(first), /can no longer be vouched for \(ENOSPC\)/)
  assert.equal(deniedBecause(again), deniedBecause(first))
  assert.deepEqual(seen.steps, [])
})

test('#541 2: a write to the owner’s settings is denied first, before their memory and the gate are asked', async (t) => {
  const { answers, seen } = anEntry(t, { settings_refuse: true, memory_refuse: true })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const answer = await answers.aToolCalled(aCall())

  assert.equal(deniedBecause(answer), THE_SETTINGS_REFUSAL)
  assert.deepEqual(seen.steps, ['billing asked', 'settings asked'])
})

test('#541 2: a write to the owner’s memory is denied before the gate is asked', async (t) => {
  const { answers, seen } = anEntry(t, { memory_refuse: true })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const answer = await answers.aToolCalled(aCall())

  assert.equal(deniedBecause(answer), THE_MEMORY_REFUSAL)
  assert.deepEqual(seen.steps, ['billing asked', 'settings asked', 'memory asked'])
})

test('#541 2: the member’s shell is held while an agent of its session runs, and the agent’s own call is not, and is noted on its run', async (t) => {
  const { answers, agents } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  runOf(agents, 'session-a', 'agent-1').started = true

  const members = await answers.aToolCalled(aCall())
  const agents_own = await answers.aToolCalled(aCall({ call_id: 'call-2', agent_id: 'agent-1' }))

  assert.match(deniedBecause(members), /agent-1/)
  assert.deepEqual(agents_own, { allowed: 1 })
  assert.deepEqual([...runOf(agents, 'session-a', 'agent-1').calls_seen], ['call-2'])
})

test('#541 2: an agent of another session holds nothing in this one', async (t) => {
  const { answers, agents } = anEntry(t)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  runOf(agents, 'session-b', 'agent-1').started = true

  assert.deepEqual(await answers.aToolCalled(aCall()), { allowed: 1 })
})

test('#541 2: a review on the reviewer model is remembered by its call and the line taken back, only once it is allowed', async (t) => {
  const { answers, seen, reviews } = anEntry(t, { review_model_of_the_call: THE_REVIEWER_MODEL })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  assert.deepEqual(await answers.aToolCalled(aCall()), { allowed: 1 })

  assert.equal(reviews.theSpawn('call-1')?.allowed_model, THE_REVIEWER_MODEL)
  assert.ok(seen.steps.indexOf('line taken back') > seen.steps.indexOf('counted'), 'the line was taken back before the call was counted')
  assert.ok(seen.steps.indexOf('line taken back') < seen.steps.indexOf('a call allowed call-1'), 'the end was told before the review was noted')
})

test('#541 2: a review the gate denies is not remembered and leaves the line', async (t) => {
  const { answers, seen, reviews } = anEntry(t, { review_model_of_the_call: THE_REVIEWER_MODEL, memory_refuse: true })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  await answers.aToolCalled(aCall())

  assert.equal(reviews.theSpawn('call-1'), undefined)
  assert.ok(!seen.steps.includes('line taken back'))
})

test('#601 row 113: a call whose spend row cannot be kept runs, and why it was not counted is written in the journal', async (t) => {
  const { answers, seen } = anEntry(t, { spend_unkept: true })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const answer = await answers.aToolCalled(aCall())

  assert.deepEqual(answer, { allowed: 1 })
  assert.deepEqual(seen.steps, [
    'billing asked',
    'settings asked',
    'memory asked',
    'the contract read',
    'counted',
    `journal call-1: ${A_CALL_NOT_COUNTED}: ${WHY_THE_SPEND_ROW_WAS_NOT_KEPT}`,
    `signed run noted ${ITS_SHELL}`,
    'a call allowed call-1',
  ])
})

test('#601 rows 110 and 112: a call past its package\'s budget and outside its contract runs, and its member is told both in a notice each', async (t) => {
  const contract: TheContractInForce = { package: A_PACKAGE, version: 2, kind: 'bounded', allowed: [] }
  const spend: ASpendInForce = { package: A_PACKAGE, version: 2, units: [{ unit: 'tool calls', spent: 3, limit: 3 }] }
  const { answers, seen } = anEntry(t, { contract, spend })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  const pushes = aCall({ input: { command: 'git push origin main' } })

  const answer = await answers.aToolCalled(pushes)

  assert.deepEqual(answer, { allowed: 1 })
  const own = A_MADE_UP_HOSTS_NAMES.ownNameOf
  assert.deepEqual(seen.steps, [
    'billing asked',
    'settings asked',
    'memory asked',
    'the contract read',
    `told the member call-1: ${String(theNoticeOfACallPastTheBudget({ tool: pushes.tool }, spend, own))}`,
    `told the member call-1: ${String(theNoticeOfACallOutsideTheContract({ tool: pushes.tool, input: pushes.input }, contract, own))}`,
    'counted',
    `signed run noted ${ITS_SHELL}`,
    'a call allowed call-1',
  ])
  // Each notice is a real one, not an empty line the comparison above would also match.
  assert.ok(seen.steps.filter((step) => step.startsWith('told the member call-1: Notice: ')).length === 2)
})

test('#601 row 112: a member told once that its spend could not be read is still told when the spend is read and found spent', async (t) => {
  const unreadable: ASpendInForce = { package: A_PACKAGE, version: 2, units: [], why_unreadable: 'a row the test could not read' }
  const spent: ASpendInForce = { package: A_PACKAGE, version: 2, units: [{ unit: 'tool calls', spent: 3, limit: 3 }] }
  const does: { spend?: ASpendInForce } = { spend: unreadable }
  const { answers, seen } = anEntry(t, does)
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })
  const own = A_MADE_UP_HOSTS_NAMES.ownNameOf

  await answers.aToolCalled(aCall({ call_id: 'call-1' }))
  await answers.aToolCalled(aCall({ call_id: 'call-2' }))
  does.spend = spent
  await answers.aToolCalled(aCall({ call_id: 'call-3' }))
  await answers.aToolCalled(aCall({ call_id: 'call-4' }))

  assert.deepEqual(
    seen.steps.filter((step) => step.startsWith('told the member ')),
    [
      `told the member call-1: ${String(theNoticeOfACallPastTheBudget({ tool: ITS_SHELL }, unreadable, own))}`,
      `told the member call-3: ${String(theNoticeOfACallPastTheBudget({ tool: ITS_SHELL }, spent, own))}`,
    ],
  )
  // Two different lines, each a real notice: the comparison above cannot pass on two empty or equal ones.
  const [first, second] = [theNoticeOfACallPastTheBudget({ tool: ITS_SHELL }, unreadable, own), theNoticeOfACallPastTheBudget({ tool: ITS_SHELL }, spent, own)]
  assert.ok(first?.startsWith('Notice: ') === true && second?.startsWith('Notice: ') === true && first !== second)
})

test('#541 2: a held end of the turn denies the call last, after the gate, and the call is not counted', async (t) => {
  const { answers, seen } = anEntry(t, { end_held_for: 'session-a' })
  await answers.aSessionStarted({ session_id: 'session-a', outcome: 'fresh' })

  const answer = await answers.aToolCalled(aCall())

  assert.equal(deniedBecause(answer), A_TOOL_WHILE_THE_END_IS_HELD)
  assert.deepEqual(seen.steps, ['billing asked', 'settings asked', 'memory asked'])
})
