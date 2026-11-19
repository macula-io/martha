// On the recorded host, a member's running turn is ended so the handover queued behind it runs (martha#311).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay, mod and launcher; only the
// model is a stand-in (./drive_the_recorded_host.ts). The case skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it
// with the recorded host, as prove_the_relay_loads/recorded_host_runs.json lists.
//
// What only this test can prove is the one host fact the design rests on: that the host's own abort, called by the mod
// on the launcher's order, ends a turn that would not end by itself (a long shell sleep), and that a prompt the mod
// submitted while that turn ran then runs. It also records, rather than asserts, which runs first once the turn is
// ended: the queued handover, or a channel message that was waiting for the member to be idle — the ordering the
// draft named as one way an end fails.
//
// The order this run made after the long turn can only be judged when the journal shows the end rode that tool's own
// answer (martha#498): an end ordered after the tool finished says nothing about the hold, and reading the request
// numbers as a regression is what made run 43649753458 red on a tree that changed nothing about it. The case below
// waits for that record and fails by name without it. The planted late end — an end ordered after the tool finished,
// where the record is missing — needs no host, so it is the second `#498` case in
// ../answer_the_relay/the_relay_holds_the_end_of_a_turn.node-test.ts rather than a case of this file.
//
// That named failure still turned the relay job red on a slow runner (martha#891, run 44598893743): the long tool slept
// a fixed 150 s, and the second beat came after it. So the tool no longer sleeps a fixed time: it runs until the run has
// seen the end ordered on disk, up to a bound, and the race is gone at its source. A run that can judge and finds the
// wrong order still fails on the ordering assertion; a run whose end never came within the bound still fails by name.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REFRESH_THIS_SESSION } from '../a_crews_tools/a_crews_tools.ts'
import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, HANDOVER_CEILING_MINUTES_LEAST, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { whyTheOrderCannotBeJudged } from '../end_a_running_turn/the_end_rode_on_a_call.ts'
import { appendToTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { crewStateDirectory, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { readTheNewestRelayJournal, relayJournalDirectory } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { refreshesPlace, theFlowOf } from '../refresh_a_member/refresh_a_member.ts'
import { theHandoverPrompt } from '../write_my_handover/write_my_handover.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { crewRowsDirectoryOf, driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, standInCallId, whatTheLaunchSaw, type ModelRequest } from './drive_the_recorded_host.ts'
import { stateHomeUnder } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: [CLAUDE_CODE_SHELL_TOOL] } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
/** The file that defines the time limit every recorded-host run carries (--test-timeout), and the line that says it. */
const THE_RUNS_BOUNDS = join(import.meta.dirname, '..', '..', 'prove_the_relay_loads', 'the_runs_bounds.sh')
const THE_RUNS_TIMEOUT_LINE = /^RUN_TIMEOUT_MS=(\d+)$/m
/**
 * The time limit node gives this file's one case, read from its one definition and never typed again here. A run
 * that outlasts it is cancelled with node's own words, before any of this file's can say why (martha#891 r=1 R1).
 */
const theRunsTimeoutMs = (): number => {
  const said = THE_RUNS_TIMEOUT_LINE.exec(readFileSync(THE_RUNS_BOUNDS, 'utf8'))?.[1]
  if (said === undefined) throw new Error(`${THE_RUNS_BOUNDS} defines no RUN_TIMEOUT_MS, so this file cannot keep its waits inside it`)
  return Number(said)
}
/**
 * How long the long tool waits at most for the end to be ordered (martha#891). It no longer sleeps a fixed time the
 * runner's speed could outlast — run 44598893743's second beat came after a fixed 150 s had already run out — but
 * until the run has seen the end ordered, so on any runner the end is ordered while the tool still runs. This bound
 * only ends a run whose end never came, and that run then fails by name as one that cannot judge the order. So it
 * sits two minutes inside the run's time limit: the silence below takes one of them, and the run's start the other,
 * so the case's own words come before node cancels it.
 */
const THE_LONG_TOOLS_BOUND_MS = theRunsTimeoutMs() - 2 * MINUTE_MS
/** How often the run looks for the ordered end, and the tool for the run's word that it came. */
const A_LOOK_MS = 250
/**
 * A long tool: a process still running when a beat orders the end, ending once `marker` exists (the run writes it when
 * it sees the end ordered) or at its bound, well inside the shell tool's own limit. Not a bare `sleep`, which the host
 * refuses to run in the foreground and answers at once, so the turn never waits. The turn would go on after it; only
 * an end carried in that tool's after-hook stops it there.
 */
const theLongTool = (marker: string): string =>
  `node -e "const fs = require('fs'); const until = Date.now() + ${String(THE_LONG_TOOLS_BOUND_MS)}; const look = setInterval(() => { if (fs.existsSync(process.argv[1]) || Date.now() > until) clearInterval(look) }, ${String(A_LOOK_MS)})" ${marker}`
/** The file the run writes once it has seen the end ordered, which ends the long tool. */
const THE_END_WAS_ORDERED = 'the-end-was-ordered'
/** The shell tool's own limit for that call, above the tool's bound, so the tool finishes by itself. */
const THE_SHELL_LIMIT_MS = 600_000
/** The message that waits in the crew channel for the member to be idle. */
const THE_WAITING_MESSAGE = 'A message that waited in the crew channel while the long turn ran.'
/** The first sentence of the handover prompt a refresh someone asked for submits: how a request is known to carry it. */
const THE_HANDOVER_ASK = theHandoverPrompt({ at_limit: false, percent: 0 }).split('.')[0] ?? ''
/**
 * How long the host may show nothing new: the turn waits in its long tool while the mod's beats come a minute apart, so
 * the run waits a beat past the tool's own bound before calling the host silent.
 */
const END_SILENCE_MS = THE_LONG_TOOLS_BOUND_MS + MINUTE_MS
const END = { text: 'Done.' }
/**
 * The request whose turn runs the long tool (martha#498): the end has to ride that call's own answer for the order of
 * the requests after it to say anything, and its host id is the one the journal's record names.
 */
const THE_LONG_TOOLS_REQUEST = 2
/** The host's id for the long tool's call, as the stand-in offered it, which is how the journal names the call. */
const THE_LONG_TOOLS_CALL = standInCallId(THE_LONG_TOOLS_REQUEST)

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/** A checkout whose crew waits the least ceiling behind a running turn, its config approved by the owner. */
function approvedProjectWithTheLeastCeiling(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-end-host-')))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'project')
  for (const [path, text] of Object.entries({ 'README.md': 'a project\n', '.claude/settings.json': SETTINGS })) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'init', '-q', '.')
  // martha init reads the owner's name from the checkout's own git config: on a runner with no global name, only this.
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
  writeFileSync(declaration, `${JSON.stringify({ ...held, handover_ceiling_minutes: HANDOVER_CEILING_MINUTES_LEAST }, null, 2)}\n`)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew, with the least ceiling')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

/** The crew's own streams, where the channel and the ledger are kept. */
const theCrewsStreams = (project: Project) => ({
  clock: { now: () => Date.now() },
  stores: { rows: rowStreamsDirectory(crewRowsDirectoryOf(stateHomeUnder(project.home), project.checkout)) },
})

/** Where the launcher keeps this crew's refresh flows. */
function theCrewsRefreshes(project: Project) {
  const crew = crewStateDirectory(join(stateHomeUnder(project.home), STATE_ROOT_NAME), project.checkout)
  if ('refusal' in crew) throw new Error(crew.refusal)
  const place = refreshesPlace({ stores: { crew: keepTheCrewsFilesAsDirectories(crew.path) } })
  if ('refusal' in place) throw new Error(place.refusal)
  return place
}

/**
 * Whether the launcher has ordered the end: the flow on disk holds the pending end. The launcher keeps that flow and
 * takes the hold in one synchronous step (announceTheEnd in ../end_a_running_turn/end_the_running_turn.ts), so once a
 * run reads it here, the tool's answer that comes after is the one the end rides (martha#891).
 */
function theEndIsOrdered(project: Project): boolean {
  try {
    const flow = theFlowOf(theCrewsRefreshes(project), MEMBER)
    return flow !== undefined && !('refusal' in flow) && flow.ending !== undefined
  } catch {
    return false
  }
}

/**
 * Writes `marker` once the end is ordered, which ends the long tool: so the end is always ordered while that tool runs,
 * however slow the runner. Stopped by the function returned, and by the test's end.
 */
function endTheLongToolOnceTheEndIsOrdered(t: TestContext, project: Project, marker: string): () => void {
  const look = setInterval(() => {
    if (!theEndIsOrdered(project)) return
    writeFileSync(marker, '')
    clearInterval(look)
  }, A_LOOK_MS)
  const stop = (): void => clearInterval(look)
  t.after(stop)
  return stop
}

/** The text a request carried to the model. */
const whatTheModelSaw = (request: ModelRequest): string => JSON.stringify(request.body['messages'] ?? null)

/** The requests after the long turn's own, which are the turns that ran once it was ended. */
const afterTheLongTurn = (requests: readonly ModelRequest[]): readonly ModelRequest[] => requests.filter((request) => request.number > THE_LONG_TOOLS_REQUEST)

/**
 * Which of the run's two queued requests a request number is, in the words a diagnostic says it: the handover, the
 * channel message that waited for the member to be idle, or neither (martha#498).
 */
function whichAfterTheEnd(number: number | undefined, handover: number | undefined, message: number | undefined): string {
  if (number === undefined) return 'no request at all'
  if (number === handover) return 'the handover'
  if (number === message) return 'the waiting message'
  return `request ${number}, which is neither`
}

/**
 * What the run's ordering shows once the journal says the end rode the long call's answer (martha#498): the turn the
 * tool ran in asked the model nothing more, so the first request after it is one of the two the run queued behind it —
 * the handover, or the channel message waiting for the member to be idle. Which of the two goes first is the host's to
 * choose, so only their numbers are compared.
 */
function theTurnWentOnWith(number: number | undefined, handover: number | undefined, message: number | undefined, shown: string): void {
  const nextIsOneOfTheTwo = number !== undefined && (number === handover || number === message)
  assert.ok(nextIsOneOfTheTwo, `the long turn went on after its tool, or neither the handover nor the waiting message ran after it:\n${plainTextOf(shown).slice(-3000)}`)
}

/**
 * The journal's record that the end rode `call`'s own answer, without which the order of the requests this run made
 * after the long tool cannot be judged (martha#498). A run without it fails here, in the run's own words, rather than
 * on an ordering assertion that reads like a regression.
 */
function theEndRodeTheCallsAnswer(t: TestContext, run: Project, call: string): void {
  const journal = readTheNewestRelayJournal(relayJournalDirectory(stateHomeUnder(run.home), run.checkout))
  const cannot = whyTheOrderCannotBeJudged(journal, call)
  if (cannot !== undefined) assert.fail(cannot)
  t.diagnostic(`the journal shows the end rode the answer to ${call}, so this run can judge the order of its requests`)
}

test('an end ordered while a long tool runs is carried after that tool\'s report: the member is not stopped, and the handover runs next', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectWithTheLeastCeiling(t)
  const streams = theCrewsStreams(project)
  const theEndWasOrdered = join(project.home, THE_END_WAS_ORDERED)
  const stopLooking = endTheLongToolOnceTheEndIsOrdered(t, project, theEndWasOrdered)
  const run = async () =>
    await driveTheRecordedHost({
      claude: recordedHost(),
      ...project,
      member: MEMBER,
      owner_turn: OWNER_TURN,
      requests: 8,
      silence_ms: END_SILENCE_MS,
      completesWhen: (requests) => afterTheLongTurn(requests).some((request) => whatTheModelSaw(request).includes(THE_HANDOVER_ASK)),
      script: async ({ number }) => {
        // First the member asks for its own refresh, which the next beat takes up; then a turn that will not end.
        if (number === 1) return { tool: `mcp__martha__${REFRESH_THIS_SESSION}`, input: { reason: 'the test moves this member off its context' } }
        if (number !== THE_LONG_TOOLS_REQUEST) return END
        await appendToTheChannel(streams, { from: 'the-owner', to: [MEMBER], text: THE_WAITING_MESSAGE, sent_at: Date.now() })
        return { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: theLongTool(theEndWasOrdered), description: 'a tool still running when the end is ordered', timeout: THE_SHELL_LIMIT_MS } }
      },
    })
  const ran = await run().catch((error: unknown) => {
    throw new Error(`the run did not end as a member does: ${String(error).split('\n')[0]}`, { cause: whatTheLaunchSaw(error) })
  }).finally(stopLooking)
  const { requests, shown } = ran
  // A member the after-tool gate stopped ends on SIGKILL; one that was handed over ends on the owner's /exit.
  assert.equal(ran.exit_code, 0, `the member did not end as the owner ended it, so something stopped it:\n${plainTextOf(shown).slice(-3000)}`)
  // Judged only once the journal says the end rode the long call's own answer (martha#498): an end ordered after that
  // tool finished leaves the request numbers below measuring the runner, not the hold.
  theEndRodeTheCallsAnswer(t, project, THE_LONG_TOOLS_CALL)
  const after = afterTheLongTurn(requests)
  const handover = after.find((request) => whatTheModelSaw(request).includes(THE_HANDOVER_ASK))?.number
  const message = after.find((request) => whatTheModelSaw(request).includes(THE_WAITING_MESSAGE))?.number
  // The ordering is recorded, not asserted: the design asks which runs first, and the answer is the host's.
  const firstAfter = after[0]?.number
  t.diagnostic(`after the end: the handover ran in request ${handover ?? 'none'}, the waiting message in ${message ?? 'none'}; ${whichAfterTheEnd(firstAfter, handover, message)} ran first`)
  t.diagnostic(`the flow after the run: ${JSON.stringify(theFlowOf(theCrewsRefreshes(project), MEMBER))}`)
  // The end was carried inside the long tool's after-hook, so the turn it ran in asked the model nothing more; and the
  // flow counted the end, which only an outcome of `ended` does.
  theTurnWentOnWith(firstAfter, handover, message, shown)
  assert.ok(handover !== undefined, 'the handover queued behind the long tool never ran')
  const flow = theFlowOf(theCrewsRefreshes(project), MEMBER)
  assert.ok(flow !== undefined && !('refusal' in flow), 'the member has no refresh flow to read')
  assert.equal(flow.forced?.ends, 1, `the flow did not count one end the host made: ${JSON.stringify(flow)}`)
})
