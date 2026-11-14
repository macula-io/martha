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

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { REFRESH_THIS_SESSION } from '../a_crews_tools/a_crews_tools.ts'
import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, HANDOVER_CEILING_MINUTES_LEAST } from '../declare_crew/declare_crew.ts'
import { appendToTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { crewStateDirectory, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { refreshesPlace, theFlowOf, theHandoverPrompt } from '../refresh_a_member/refresh_a_member.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { crewRowsDirectoryOf, stateHomeUnder, driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, whatTheLaunchSaw, type ModelRequest } from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: [CLAUDE_CODE_SHELL_TOOL] } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
/**
 * A long tool: a process still running when the second beat orders the end, and done well inside the shell tool's own
 * limit. Not a bare `sleep`, which the host refuses to run in the foreground and answers at once, so the turn never
 * waits. The turn would go on after it; only an end carried in that tool's after-hook stops it there.
 */
const THE_LONG_TOOL = 'node -e "setTimeout(() => {}, 150000)"'
/** The shell tool's own limit for that call, above the wait, so the tool finishes by itself. */
const THE_SHELL_LIMIT_MS = 600_000
/** The message that waits in the crew channel for the member to be idle. */
const THE_WAITING_MESSAGE = 'A message that waited in the crew channel while the long turn ran.'
/** The first sentence of the handover prompt a refresh someone asked for submits: how a request is known to carry it. */
const THE_HANDOVER_ASK = theHandoverPrompt({ at_limit: false, percent: 0 }).split('.')[0] ?? ''
/**
 * How long the host may show nothing new: the turn sleeps while the mod's beats come a minute apart, and the end
 * comes on the second beat at the earliest, so the run waits well past that before calling the host silent.
 */
const END_SILENCE_MS = 240_000
const END = { text: 'Done.' }

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
  const place = refreshesPlace({ stores: { crew: crewFilesDirectory(crew.path) } })
  if ('refusal' in place) throw new Error(place.refusal)
  return place
}

/** The text a request carried to the model. */
const whatTheModelSaw = (request: ModelRequest): string => JSON.stringify(request.body['messages'] ?? null)

/** The requests after the long turn's own, which are the turns that ran once it was ended. */
const afterTheLongTurn = (requests: readonly ModelRequest[]): readonly ModelRequest[] => requests.filter((request) => request.number > 2)

test('an end ordered while a long tool runs is carried after that tool\'s report: the member is not stopped, and the handover runs next', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectWithTheLeastCeiling(t)
  const streams = theCrewsStreams(project)
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
        if (number !== 2) return END
        await appendToTheChannel(streams, { from: 'the-owner', to: [MEMBER], text: THE_WAITING_MESSAGE, sent_at: Date.now() })
        return { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: THE_LONG_TOOL, description: 'a tool still running when the end is ordered', timeout: THE_SHELL_LIMIT_MS } }
      },
    })
  const ran = await run().catch((error: unknown) => {
    throw new Error(`the run did not end as a member does: ${String(error).split('\n')[0]}`, { cause: whatTheLaunchSaw(error) })
  })
  const { requests, shown } = ran
  // A member the after-tool gate stopped ends on SIGKILL; one that was handed over ends on the owner's /exit.
  assert.equal(ran.exit_code, 0, `the member did not end as the owner ended it, so something stopped it:\n${plainTextOf(shown).slice(-3000)}`)
  const after = afterTheLongTurn(requests)
  const handover = after.find((request) => whatTheModelSaw(request).includes(THE_HANDOVER_ASK))?.number
  const message = after.find((request) => whatTheModelSaw(request).includes(THE_WAITING_MESSAGE))?.number
  // The ordering is recorded, not asserted: the design asks which runs first, and the answer is the host's.
  t.diagnostic(`after the end: the handover ran in request ${handover ?? 'none'}, the waiting message in ${message ?? 'none'}`)
  t.diagnostic(`the flow after the run: ${JSON.stringify(theFlowOf(theCrewsRefreshes(project), MEMBER))}`)
  // The end was carried inside the long tool's after-hook: the turn the tool ran in asked the model nothing more, so
  // the very next request is the handover. And the flow counted the end, which only an outcome of `ended` does.
  assert.equal(after[0]?.number, handover, `the long turn went on after its tool, or the handover never ran:\n${plainTextOf(shown).slice(-3000)}`)
  assert.ok(handover !== undefined, 'the handover queued behind the long tool never ran')
  const flow = theFlowOf(theCrewsRefreshes(project), MEMBER)
  assert.ok(flow !== undefined && !('refusal' in flow), 'the member has no refresh flow to read')
  assert.equal(flow.forced?.ends, 1, `the flow did not count one end the host made: ${JSON.stringify(flow)}`)
})
