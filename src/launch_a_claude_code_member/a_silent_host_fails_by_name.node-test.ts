// The relay job's budget counts silence, not time (martha#210).
//
// A real model request rides inside the budget, so on a busy hosted runner the runner's speed decided the verdict: run
// 42747883703 went red on `No model request 3 within 120000 ms` for a diff that job never runs, and the same tree
// passed on a re-run. These two cases are the rule the check must hold: a host that stops working fails by name, and a
// host that is only slow is never cut off by how long it takes.
//
// Neither case needs the recorded host, a terminal or the clock, so both run in every CI run and not only in the relay
// job: the wait is given a clock the test moves and a host whose output the test writes.
//
// The cases after them are martha#240's: a run can go quiet in the middle of a call with the host still working, so the
// launcher keeps a journal (./keep_the_relays_journal.ts) and the wait reads it. They are the rule the check must hold:
// a call the launcher holds open is never read as a silent host, a call that never comes back is named as the tool's,
// a launcher that takes too long to decide or to answer is named as the launcher's, a call the launcher denied never
// opens, a late allow is the deny the host took, and a run whose launcher keeps no journal behaves exactly as it did
// before all of this.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RELAY_DEADLINE_MS } from '../claude_code_relay/hooks/relay_protocol.ts'
import { journalNeverWritten } from './drive_the_recorded_host.ts'
import {
  GAVE_UP_BEFORE_ALLOW,
  NO_JOURNAL,
  readTheNewestRelayJournal,
  relayJournalKeptIn,
  type RelayJournal,
  type RelayJournalRead,
} from './keep_the_relays_journal.ts'
import { removeTheTree } from './relay_copy.ts'
import { HOST_SILENCE_MS, OPEN_WORK_MS, POLL_MS, waitWhileTheHostKeepsShowing } from './wait_while_the_host_keeps_showing.ts'

/** Looks a wait may take before the test calls it a wait that never gives up, rather than asking the harness.
 * Far above the slowest case here (ten budgets of looks, 12 000), so only a wait that never ends reaches it. */
const LOOKS_BEFORE_GIVING_UP = 100_000

/** The host as the wait sees it: a terminal the test writes on and a count of requests the test adds to. */
interface HostOfTheTests {
  readonly shown: () => string
  readonly heard: () => number
  /** Draws on the terminal: output the host showed because it was working. */
  draw: (text: string) => void
  /** A model request arrives from the host. */
  saysARequest: () => void
  readonly now: () => number
  /** Moves the clock by `ms`, without sleeping. */
  readonly sleep: (ms: number) => Promise<void>
}

function aHostOfTheTests(): HostOfTheTests {
  let now = 1_000_000
  let shown = ''
  let heard = 0
  return {
    shown: () => shown,
    heard: () => heard,
    draw: (text) => void (shown += text),
    saysARequest: () => void (heard += 1),
    now: () => now,
    sleep: async (ms) => void (now += ms),
  }
}

/** Fails the test rather than the harness when a wait does not end: a wait that never gives up is the thing at issue. */
const countingLooks = (host: HostOfTheTests, onLook: () => void): ((ms: number) => Promise<void>) => {
  let looks = 0
  return async (ms) => {
    looks += 1
    if (looks > LOOKS_BEFORE_GIVING_UP) throw new Error(`the wait took ${looks} looks without ending`)
    onLook()
    await host.sleep(ms)
  }
}

test('#210: a host that goes silent fails by name, saying how long nothing came and how long the run took', async () => {
  const host = aHostOfTheTests()
  // The run began a minute before this wait did, and this is the run's third wait: the figure the red reports is the
  // run's own time, so it must count that minute and not start again at this wait (martha#210 r=1).
  const run_started_at = host.now() - 60_000
  const started = host.now()
  const why = await waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: () => false,
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at,
    now: host.now,
    sleep: countingLooks(host, () => {}),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.ok(why !== undefined, 'a host that shows nothing and sends nothing must fail the wait')
  assert.match(why.message, /showed nothing new/, 'the red names silence, not a total time that passed')
  const taken = host.now() - started
  assert.ok(taken >= HOST_SILENCE_MS && taken < HOST_SILENCE_MS + 2 * POLL_MS, `the wait gave up after ${taken} ms, which is not the budget it was given`)
  assert.match(
    why.message,
    /has taken 180100 ms in all/,
    'the red reports the run\'s own time: the minute before this wait plus the silence it gave up on',
  )
})

test('#210: a host that stays slow but keeps showing new output is not cut off by how long it takes', async () => {
  const host = aHostOfTheTests()
  const started = host.now()
  const slow_run = 10 * HOST_SILENCE_MS
  const why = await waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: () => host.now() - started >= slow_run,
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at: started,
    now: host.now,
    sleep: countingLooks(host, () => host.draw('.')),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.equal(why, undefined, `a host still drawing ten times the budget was cut off: ${why?.message}`)
  assert.ok(host.now() - started >= slow_run, 'the wait ended before the slow run was done, so it proved nothing')
})

test('#210: a host that draws nothing but keeps sending model requests is progress too', async () => {
  const host = aHostOfTheTests()
  const started = host.now()
  const slow_run = 5 * HOST_SILENCE_MS
  const why = await waitWhileTheHostKeepsShowing({
    what: 'end of martha start',
    holds: () => host.now() - started >= slow_run,
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at: started,
    now: host.now,
    sleep: countingLooks(host, () => host.saysARequest()),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.equal(why, undefined, `a host still answering was cut off: ${why?.message}`)
})

test('#210: what ruled a run out is said at once, and is not reported as silence', async () => {
  const host = aHostOfTheTests()
  const before = host.now()
  const why = await waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: () => false,
    cannotHappen: () => 'the stand-in could not answer: a planted fault',
    shown: host.shown,
    heard: host.heard,
    silence_ms: HOST_SILENCE_MS,
    run_started_at: before,
    now: host.now,
    sleep: countingLooks(host, () => {}),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
  assert.ok(why !== undefined)
  assert.equal(why.message, 'the stand-in could not answer: a planted fault')
  assert.equal(host.now(), before, 'a ruled-out run must be ended at once, not held for its budget')
})

// --- martha#240: what the launcher is doing, read beside the terminal -------------------------------------------------

/** The host a case moves, as the cases above build it. */
type Host = ReturnType<typeof aHostOfTheTests>

/** A tool call as the relay posts it: the host's own id for it, and the tool. */
const aCall = (tool: string, tool_use_id: string) => ({ session_id: 'session-of-the-test', call: { tool, tool_use_id } })

/** The call each case makes, and the tool a red may name it by. */
const THE_CALL = aCall('Write', 'call_00_the_test')
const THE_TOOL = 'Write'

/**
 * A journal of the tests: the launcher's own writer, in a directory the test removes, on the clock the test moves. The
 * rules that turn a receipt and an answer into lines, and an allow into the deny the host took, are the shipping ones.
 */
function aJournalOfTheTests(t: TestContext, host: Host): { readonly journal: RelayJournal; readonly read: () => RelayJournalRead } {
  const directory = mkdtempSync(join(tmpdir(), 'martha-journal-'))
  t.after(() => removeTheTree(directory))
  return { journal: relayJournalKeptIn(directory, 'launch-of-the-test', host.now), read: () => readTheNewestRelayJournal(directory) }
}

/** Runs a wait over the host and the journal, handing back the red it ended with, if it ended with one. */
async function theRed(host: Host, journal: (() => RelayJournalRead) | undefined, more: { readonly holds?: () => boolean; readonly onLook?: () => void } = {}): Promise<Error | undefined> {
  return waitWhileTheHostKeepsShowing({
    what: 'model request 3',
    holds: more.holds ?? (() => false),
    shown: host.shown,
    heard: host.heard,
    ...(journal === undefined ? {} : { journal }),
    silence_ms: HOST_SILENCE_MS,
    run_started_at: host.now(),
    now: host.now,
    sleep: countingLooks(host, more.onLook ?? (() => {})),
  }).then(
    () => undefined,
    (error: Error) => error,
  )
}

/** How long case 1 keeps its call open: a quarter more than the silence budget, and less than the call's own. */
const OPEN_FOR = HOST_SILENCE_MS + (OPEN_WORK_MS - HOST_SILENCE_MS) / 2

test('#240: a call the launcher holds open is not a silent host, however long the terminal stays still', async (t) => {
  const host = aHostOfTheTests()
  const { journal, read } = aJournalOfTheTests(t, host)
  const started = host.now()
  journal.received('tool_called', THE_CALL).answered('allow', undefined)
  let returned = false
  const why = await theRed(host, read, {
    holds: () => host.now() - started >= OPEN_FOR + 10_000,
    // The tool comes back after OPEN_FOR, and the run carries on.
    onLook: () => {
      if (returned || host.now() - started < OPEN_FOR) return
      returned = true
      journal.received('tool_answered', THE_CALL).answered('taken', undefined)
    },
  })
  assert.ok(returned, 'the case never got as far as the tool returning, so it proved nothing')
  assert.equal(why, undefined, `a call left open for ${OPEN_FOR} ms was cut off as a silent host: ${why?.message}`)
  assert.ok(host.now() - started > HOST_SILENCE_MS, 'the run ended before the silence budget could have cut it off, so it proved nothing')
})

test('#240: a call that never comes back is named as the tool, with its own budget, and never as silence', async (t) => {
  const host = aHostOfTheTests()
  const { journal, read } = aJournalOfTheTests(t, host)
  const started = host.now()
  journal.received('tool_called', THE_CALL).answered('allow', undefined)
  const why = await theRed(host, read)
  assert.ok(why !== undefined, 'a call the launcher allowed and never saw answered must fail the wait')
  assert.match(why.message, new RegExp(`^The tool \`${THE_TOOL}\` has not returned in \\d+ ms \\(the launcher allowed it at \\d{4}-`), why.message)
  assert.doesNotMatch(why.message, /showed nothing new/, 'the red blamed the terminal for a tool that was still running')
  const taken = host.now() - started
  assert.ok(taken >= OPEN_WORK_MS && taken <= OPEN_WORK_MS + 2 * POLL_MS, `the wait gave up after ${taken} ms, which is not the call's own budget`)
})

test('#240: a launcher that takes too long to decide a call is named as the launcher, by the tool it is deciding', async (t) => {
  const host = aHostOfTheTests()
  const { journal, read } = aJournalOfTheTests(t, host)
  // The call arrived and the launcher has not answered it: the stretch is the launcher's own work, not the tool's.
  journal.received('tool_called', THE_CALL)
  const why = await theRed(host, read)
  assert.ok(why !== undefined, 'a launcher that received a call and never answered it must fail the wait')
  assert.match(why.message, new RegExp(`^The launcher has been deciding \`${THE_TOOL}\` for \\d+ ms`), why.message)
  assert.doesNotMatch(why.message, /has not returned|showed nothing new/, 'the red booked the launcher\'s own deciding to the tool or to the terminal')
})

test('#240: a launcher that stops answering is named as the launcher, not as the tool', async (t) => {
  const host = aHostOfTheTests()
  const { journal, read } = aJournalOfTheTests(t, host)
  journal.received('tool_called', THE_CALL).answered('allow', undefined)
  // The tool came back and the launcher took the answer in; answering it is the launcher's work, and it stalled.
  journal.received('tool_answered', THE_CALL)
  const why = await theRed(host, read)
  assert.ok(why !== undefined, 'a launcher that received an answer and never answered it must fail the wait')
  assert.match(why.message, /^The launcher has been answering `tool_answered` for \d+ ms/, why.message)
  assert.doesNotMatch(why.message, new RegExp(`has not returned|${THE_TOOL}`), 'the red booked the launcher\'s stall to the tool')
})

test('#240: a call the launcher denied never opens, so nothing is named for it', async (t) => {
  const host = aHostOfTheTests()
  const { journal, read } = aJournalOfTheTests(t, host)
  const denied_at = host.now()
  journal.received('tool_called', THE_CALL).answered('deny', 'the call writes outside the checkout')
  // The wait opens a minute after the deny, so the figure the red reports is the time since the answer and not the
  // silence this wait has counted on its own (martha#240 r=1).
  await host.sleep(60_000)
  const why = await theRed(host, read)
  assert.ok(why !== undefined, 'a denied call and then nothing must still fail the wait')
  assert.match(why.message, /showed nothing new/, 'a denied call was spent as if something were running')
  assert.match(
    why.message,
    new RegExp(`The launcher last answered tool_called ${host.now() - denied_at} ms ago`),
    'the red counts only its own silence, not the time since the launcher answered, so a reader is told a number that is too small',
  )
  assert.ok(host.now() - denied_at > HOST_SILENCE_MS, 'the case never waited past the deny by more than the silence budget, so the number it pins could be the budget alone')
  assert.doesNotMatch(why.message, new RegExp(THE_TOOL), 'the red named a tool the launcher had refused')
})

test('#240: an allow the relay gave up on is the deny the host took, and the call never opens', async (t) => {
  const host = aHostOfTheTests()
  const { journal, read } = aJournalOfTheTests(t, host)
  const entry = journal.received('tool_called', THE_CALL)
  await host.sleep(RELAY_DEADLINE_MS + 1)
  // The relay denied this call a millisecond before the launcher's allow: the tool never ran, so the journal says so.
  entry.answered('allow', undefined)
  const kept = read()
  const last = kept.events.at(-1)
  assert.equal(last?.phase, 'answered', 'the answer line was not written')
  assert.equal(last?.answer, 'deny', 'an allow the relay gave up on was journalled as an allow, so the next red blames a tool that never ran')
  assert.equal(last?.why, GAVE_UP_BEFORE_ALLOW)
  assert.deepEqual(kept.open, [], 'the late allow opened a call')
  const allowed_at = host.now()
  const why = await theRed(host, read)
  assert.ok(why !== undefined, 'a run that drew nothing after a late allow must fail the wait')
  assert.match(why.message, /showed nothing new/, 'the red is not the silence budget\'s')
  assert.doesNotMatch(why.message, new RegExp(THE_TOOL), 'the red named a tool that never ran')
  // The arithmetic the design states: the deadline's 30 000 ms, then the silence budget's 120 000 ms.
  assert.ok(host.now() - allowed_at >= HOST_SILENCE_MS, 'the red did not wait out the silence budget after the late allow')
})

test('#240: a run whose launcher keeps no journal behaves exactly as it did before', async (t) => {
  const host = aHostOfTheTests()
  const { read } = aJournalOfTheTests(t, host)
  const asBefore = /^No model request 3 for 120000 ms: the host showed nothing new in that time, and the run has taken \d+ ms in all$/
  for (const [what, journal] of [
    ['no journal at all', undefined],
    ['a journal no launch has written', read],
    ['an empty journal', () => NO_JOURNAL],
  ] as const) {
    const why = await theRed(host, journal)
    assert.ok(why !== undefined, `${what}: the wait did not fail at all`)
    assert.match(why.message, asBefore, `${what}: the red says something the run never said before #240`)
  }
})

// --- martha#240 r=1: the run says so when it reads no journal ---------------------------------------------------------

test('#240: a run that read no journal by the host\'s first model request fails by name, and one that read a line goes on', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-journal-'))
  t.after(() => removeTheTree(directory))
  const heard = [{ number: 1, body: {} }]
  assert.equal(journalNeverWritten([], directory), undefined, 'a run no request has arrived in yet was failed for a journal it has not needed')
  assert.match(
    journalNeverWritten(heard, directory) ?? '',
    /wrote no line to the journal at .+ by the host's first model request/,
    'a request arrived and the journal the run watches had no line in it, and the run said nothing: the wait would fall back to the terminal alone, and the false red #240 fixes would come back unnamed',
  )
  relayJournalKeptIn(directory, 'launch-of-the-test').received('session_started', {})
  assert.equal(journalNeverWritten(heard, directory), undefined, 'a journal with a line in it was read as no journal')
})
