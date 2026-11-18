// What one launch answers a host's reports from (martha#541, packages 2-4, 1a).
//
// The entry that holds the state every gate is answered from. In 1a that state is all there is: the sessions this launch
// has taken a start of, the record kept for each, one order its events are answered in, and the tree the owner
// approved. These cases prove the state itself — a session it never took a start of is refused by name, one it kept is
// named and held, work asked for in one order is answered in that order, and a launch the owner approved nothing for
// exempts no read — because the adapter's own tests drive the same state through the relay and would not say which of
// the two held it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { reviewSpawnsRemembered } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { beginSession, takeInTurn } from '../take_in_a_turn/take_in_a_turn.ts'
import { agentRunsKept, answersOver, type TheAnswersOfOneLaunch } from './answer_what_a_host_reports.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-541-entry-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

/** The answers of one launch over its own places, as the launcher builds them for the entry. */
function answersOn(t: TestContext): TheAnswersOfOneLaunch {
  const places = placesOf(t)
  const records = sessionRecordsIn(rowStreamsDirectory(places.rows))
  const launch = { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] }
  return answersOver({
    records,
    launch,
    machine: thisMachine,
    binder: bindNothing,
    handed_at_start: [],
    reviews: reviewSpawnsRemembered(),
    // The tool call's places (PR 2), which no case here calls: no agent, a policy that sends nothing, names as called.
    agents: agentRunsKept(),
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: (called) => called },
    refusesAWriteToTheOwnersSettings: () => undefined,
    refusesAWriteToTheOwnersMemory: () => undefined,
  })
}

test('#541 1a: a session this launch never took a start of is refused by name, and one it kept is named', async (t) => {
  const answers = answersOn(t)

  assert.equal(answers.holds('session-a'), false)
  assert.match(String(answers.named('session-a')), /no start of session session-a was taken/, 'a session with no start was answered for')

  await answers.records.load('session-a')
  const why = await answers.keep(takeInTurn(beginSession(answers.records.store, 'session-a'), { source: 'owner_typed' }, bindNothing))

  assert.equal(why, undefined, `the record of the session was not kept: ${why}`)
  assert.equal(answers.holds('session-a'), true)
  assert.equal(typeof answers.named('session-a'), 'object', 'the session it kept was not named')
})

test('#541 1a: every answer this launch gives is asked for in one order, so a slower one asked for first still answers first', async (t) => {
  const answers = answersOn(t)
  const order: string[] = []

  const slow = answers.inOrder(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
    order.push('asked for first')
  })
  const fast = answers.inOrder(async () => void order.push('asked for second'))
  await Promise.all([slow, fast])

  assert.deepEqual(order, ['asked for first', 'asked for second'], 'two answers ran out of order, so a call and a turn could interleave')
})

test('#541 1a: a launch the owner approved no tree for exempts no read (martha#127)', (t) => {
  const answers = answersOn(t)

  assert.equal(answers.approved_start, null, 'a launch with no approved fingerprint exempted a read of its checkout')
})
