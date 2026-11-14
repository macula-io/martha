// On the recorded host, a review that stops at its reviewer model's limit is named to the member and to its row
// (martha#390).
//
// This exists so a stop at the reviewer model's limit is told rather than silent: the host retries the refused model a
// few times, gives up on the agent, and submits a `task-notification` turn to the member — and until this case, nothing
// said so on the owner's row or in the crew's channel. What only this test can prove is that the launcher reads the
// envelope the pinned host really writes, end to end, with the real `martha` command, the real relay and launcher; only
// the model is a stand-in (./drive_the_recorded_host.ts), and it refuses the reviewer model the way an account at its
// limit is refused (the observation at ~/.claude/sessions/juno-390-probe/OBSERVATION.md, martha#390).
//
// It skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it with the recorded host, as
// prove_the_relay_loads/recorded_host_runs.json lists, and fails a run that skipped it.
//
// Nothing relaunches the review and no second model is chosen here: the line names the model the call resolved to and
// the host's own words for the stop, and the member decides what to do about it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_SHELL_TOOL, CLAUDE_CODE_SUBAGENT_SPAWN } from '../claude_code_host/claude_code_host.ts'
import { EDIT_TOOL, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'
import { addressedTo, readTheChannel, type PlacedMessage } from '../keep_the_crew_channel/crew_channel.ts'
import { crewStateDirectory, CREW_ROW_PLACE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { rowFileNameOf, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { crewRowsDirectoryOf, driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, stateHomeUnder, whatTheLaunchSaw } from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

/**
 * The name Martha signs a line of its own with, read from the manifest that names the program rather than spelled here:
 * the sender is pinned exactly, so a line from another member or another word fails this case (martha#390 r=4).
 */
const THE_PROGRAMS_NAME = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { readonly name: string }).name

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
/** The model the member is launched on, and the crew's reviewer model: two the host runs, so the review is allowed. */
const LAUNCHED_ON = 'sonnet'
const THE_REVIEWER_MODEL = 'opus'
/**
 * The host's own name for the model the crew's `opus` alias resolves to. The host publishes no alias table, so it is
 * pinned here the way the recorded envelope pins it: that envelope's summary ends `model sent to the API: ` and this
 * name, and the line the member is told names it too, because it comes from the allowed call's `resolvedModel`.
 */
const THE_RESOLVED_REVIEW_MODEL = 'claude-opus-5-5'
/**
 * The refusal the stand-in answers the reviewer model with: the API's own answer to an account at its limit, and the
 * reason the host repeats verbatim in the envelope's summary. Martha adds nothing to it.
 */
const THE_APIS_ANSWER = {
  status: 429,
  type: 'rate_limit_error',
  message: 'Your account has reached its usage limit for opus. Please wait or upgrade.',
  retry_after: 1,
}
/** The description the member gives the review: its word "review" is what makes the spawn a review of the crew's. */
const THE_REVIEW = { subagent_type: 'general-purpose', description: 'review the patch', prompt: 'read the diff and judge it', model: THE_REVIEWER_MODEL }
/** What the line about the failed review starts with: the model, and that it was a review. */
const THE_LINE_STARTS = `review on ${THE_RESOLVED_REVIEW_MODEL}: `
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: [WHOLE_FILE_TOOL, EDIT_TOOL, CLAUDE_CODE_SHELL_TOOL] } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/**
 * A checkout whose crew declares its own models, and its config approved by the owner: `martha init` writes a solo
 * declaration that names no model, and a crew that wants a reviewer model gives it one before the owner approves it.
 */
function approvedProjectWithModels(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-limit-host-')))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'project')
  for (const [path, text] of Object.entries({ 'README.md': 'a project\n', '.claude/settings.json': SETTINGS })) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'init', '-q', '.')
  // The owner's name for the crew is read from the checkout's own git identity, which is written here rather than set
  // with a `git config` call: this file spells no subcommand of its own, and the identity has to outlive the helper.
  appendFileSync(join(checkout, '.git', CONFIG), `[user]\n\tname = ${GIT_NAME}\n\temail = ${GIT_EMAIL}\n`)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  const place = { claude: recordedHost(), home, checkout }
  firstRunDone(home, checkout)
  const declared = marthaOnATerminal(place, ['init'])
  assert.equal(declared.exit_code, 0, plainTextOf(declared.shown))
  declareTheModels(checkout)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew, with its models')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

/** Gives the crew's declaration its models: the builder's own, and the one every review runs on. */
function declareTheModels(checkout: string): void {
  const declaration = join(checkout, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as {
    members: { name: string; model?: string }[]
    house_rules?: Record<string, unknown>
  }
  for (const member of held.members) if (member.name === MEMBER) member.model = LAUNCHED_ON
  held.house_rules = { ...(held.house_rules ?? {}), review_model: THE_REVIEWER_MODEL }
  writeFileSync(declaration, `${JSON.stringify(held, null, 2)}\n`)
}

/** The crew's own place, under which the launcher keeps this member's dashboard row. */
function theCrewPlace(project: Project): string {
  const crew = crewStateDirectory(join(stateHomeUnder(project.home), STATE_ROOT_NAME), project.checkout)
  if ('refusal' in crew) throw new Error(crew.refusal)
  return crew.path
}

/** This member's row as it stands, or undefined while the launcher has written none. */
function theRowNow(project: Project): DashboardRow | undefined {
  const file = join(theCrewPlace(project), CREW_ROW_PLACE, rowFileNameOf(MEMBER))
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DashboardRow) : undefined
}

/** The crew's channel as the run's own store holds it: what every member wrote, and what Martha wrote to this member. */
async function theChannelOf(project: Project): Promise<readonly PlacedMessage[]> {
  return readTheChannel({
    clock: { now: () => Date.now() },
    stores: { rows: rowStreamsDirectory(crewRowsDirectoryOf(stateHomeUnder(project.home), project.checkout)) },
  })
}

/** Whether the row names a failed review: the line is written once, and only once the host has reported the failure. */
const theRowNamesIt = (project: Project): boolean => (theRowNow(project)?.needs ?? '').startsWith(THE_LINE_STARTS)

/**
 * What a run saw, whether it ended by itself or was stopped for showing nothing new: a host whose agent died under it
 * may hold its prompt open, so a run whose observation is complete is read rather than failed on its exit.
 */
async function whatTheRunSaw(run: () => Promise<{ readonly requests: readonly { readonly body: Readonly<Record<string, unknown>> }[]; readonly shown: string; readonly exit_code: number | null }>): Promise<{ readonly shown: string }> {
  try {
    return await run()
  } catch (error) {
    const seen = whatTheLaunchSaw(error)
    if (seen === undefined) throw error
    return { shown: seen.shown }
  }
}

test('on the recorded host a review the reviewer model refused is named to the member and its row', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectWithModels(t)
  let told: DashboardRow | undefined
  const ran = await whatTheRunSaw(() =>
    driveTheRecordedHost({
      claude: recordedHost(),
      ...project,
      member: MEMBER,
      owner_turn: OWNER_TURN,
      // The host retries the refused model about eleven times of its own accord, so what ends this run is the row it
      // writes, never a count: the ceiling is only what a host that reported nothing would be waited for.
      requests: 40,
      completesWhen: () => theRowNamesIt(project),
      silence_ms: HOST_SILENCE_MS,
      // The member's own model answers; the reviewer model is refused, exactly as an account at its limit is.
      script: ({ number, body }) =>
        number === 1
          ? { tool: 'Agent', input: THE_REVIEW }
          : body[CLAUDE_CODE_SUBAGENT_SPAWN.model_field] === THE_RESOLVED_REVIEW_MODEL
            ? { refused: THE_APIS_ANSWER }
            : { text: 'Done.' },
      atTheTerminal: async (hands) => {
        await hands.until('the owner\'s row naming the failed review', () => theRowNamesIt(project))
        // The host's own notification is a turn in the member's session: the member takes it in, and asks the model
        // again, which is the run reaching the point every assertion below is about.
        const heardByThen = hands.heard.length
        await hands.until('the member taking in the host\'s own notification', () => hands.heard.length > heardByThen)
        told = theRowNow(project)
      },
    }),
  )
  const screen = plainTextOf(ran.shown).slice(-3000)
  assert.ok(told !== undefined, `the owner's row never named the failed review:\n${screen}`)
  // The row names the model the allowed call resolved to, and the host's own words for the stop, verbatim: nothing here
  // reads the summary to decide anything, and nothing Martha writes is added to it.
  assert.ok(told.needs.startsWith(THE_LINE_STARTS), `the row's line does not name the model the review resolved to:\n${told.needs}`)
  assert.ok(told.needs.includes(THE_APIS_ANSWER.message), `the row's line does not repeat the host's own reason:\n${told.needs}`)
  // The member is told through the crew's channel, by Martha's own name and to this member, in the same words the owner
  // reads on the row: a member that never looks at the dashboard still learns its review stopped.
  const theLine = told.needs
  const mine = (await theChannelOf(project)).filter(({ message }) => message.from === THE_PROGRAMS_NAME && addressedTo(message, MEMBER) && message.text === theLine)
  assert.equal(mine.length, 1, `the crew's channel holds ${mine.length} line(s) from the program itself, to ${MEMBER}, in the row's own words: ${JSON.stringify(mine)}`)
  assert.equal(mine.at(0)?.message.text, theLine, 'the member was told something other than what the owner\'s row says')
})
