// On the recorded host, a member switches its model, and a review off the crew's reviewer model is refused (#315).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay, mod and launcher; only the
// model is a stand-in (./drive_the_recorded_host.ts). The relay CI job installs the recorded host and names it in
// MARTHA_RECORDED_HOST; without it these tests are skipped.
//
// What only this test can prove: `command.run({command, args})` had never been run with arguments anywhere in the tree
// — the refresh clear uses it without any — so the switch's whole mechanism rests on the host's own model command
// taking the model as its argument and resolving. The row is written only when the mod reports that the command
// resolved, so a row that says the new model is a command that ran.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'
import { rowFileNameOf, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { crewStateDirectory, CREW_ROW_PLACE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { theModelMarker, MODEL_PLACE, type ModelMarker } from '../switch_a_members_model/switch_a_members_model.ts'
import { stateHomeUnder, driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, RECORDED_HOST_VARIABLE, whatTheLaunchSaw, type RecordedHostRan } from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

const recordedHost = process.env[RECORDED_HOST_VARIABLE]
const skip = recordedHost === undefined && `needs ${RECORDED_HOST_VARIABLE}, the recorded host's binary, which the relay CI job sets`

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
const THE_PACKAGE = 'macula-io/martha#315'
/** The model the member is launched on, and the crew's reviewer model: two the host runs, so a switch is allowed. */
const LAUNCHED_ON = 'sonnet'
const THE_REVIEWER_MODEL = 'opus'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: [WHOLE_FILE_TOOL, 'Edit', CLAUDE_CODE_SHELL_TOOL] } })
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
 * A checkout whose crew declares its own models, and its config approved by the owner. `martha init` writes a solo
 * declaration that names no model, so the declaration is given one before the owner approves it — which is what a crew
 * that wants a reviewer model does.
 */
function approvedProjectWithModels(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-model-host-')))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'project')
  for (const [path, text] of Object.entries({ 'README.md': 'a project\n', '.claude/settings.json': SETTINGS })) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'init', '-q', '.')
  git(checkout, 'config', 'user.name', GIT_NAME)
  git(checkout, 'config', 'user.email', GIT_EMAIL)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  const place = { claude: recordedHost ?? '', home, checkout }
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

/** The crew's own place, under which the launcher keeps this member's dashboard row and its model record. */
function theCrewPlace(project: Project): string {
  const crew = crewStateDirectory(join(stateHomeUnder(project.home), STATE_ROOT_NAME), project.checkout)
  if ('refusal' in crew) throw new Error(crew.refusal)
  return crew.path
}

/** This member's row, as the owner's pane reads it. */
function theRowOf(project: Project): DashboardRow {
  return JSON.parse(readFileSync(join(theCrewPlace(project), CREW_ROW_PLACE, rowFileNameOf(MEMBER)), 'utf8')) as DashboardRow
}

/** This member's model record, as a later session reads it. */
function theRecordOf(project: Project): ModelMarker {
  return JSON.parse(readFileSync(join(theCrewPlace(project), MODEL_PLACE, theModelMarker(MEMBER)), 'utf8')) as ModelMarker
}

/** The text the host sent the stand-in for one request, as the model would read it. */
const whatTheModelSaw = (ran: { readonly requests: readonly { readonly body: Readonly<Record<string, unknown>> }[] }, at: number): string =>
  JSON.stringify(ran.requests[at]?.body['messages'] ?? null)

/**
 * What the host drew, with every space taken out: the terminal stream carries only the cells that changed, so a line
 * the host draws over itself (`Set model to Opus 5.5`) arrives as the words it redrew, glued. A comparison that keeps
 * the spaces fails on a screen the host really drew, which is a red the command never earned.
 */
const drawnWithoutGaps = (shown: string): string => plainTextOf(shown).replaceAll(/\s/g, '')

const END = { text: 'Done.' }

/**
 * What a run saw, whether it ended by itself or was stopped for showing nothing new: a run that switched its model
 * leaves the host holding its own confirmation open, so waiting for its exit would fail a run whose observation is
 * already complete.
 */
async function whatTheRunSaw(run: () => Promise<RecordedHostRan>): Promise<Pick<RecordedHostRan, 'requests' | 'shown'>> {
  try {
    const ran = await run()
    return { requests: ran.requests, shown: ran.shown }
  } catch (error) {
    const seen = whatTheLaunchSaw(error)
    if (seen === undefined) throw error
    return seen
  }
}

/**
 * How long a switching run may show nothing new before the test stops waiting: the host holds its own model-switch
 * confirmation open after the command, and an owner's `/exit` does not reach a prompt behind it. The observation is
 * complete before that — the row is written the moment the command resolved — so the run is read for what it saw.
 */
const SWITCH_SILENCE_MS = 20_000

test('a member switches its model with the tool, and the row says so once the host resolved the command', { skip }, async (t) => {
  const project = approvedProjectWithModels(t)
  const seen = await whatTheRunSaw(() =>
    driveTheRecordedHost({
      claude: recordedHost ?? '',
      ...project,
      member: MEMBER,
      owner_turn: OWNER_TURN,
      requests: 2,
      silence_ms: SWITCH_SILENCE_MS,
      script: ({ number }) =>
        number === 1
          ? { tool: 'mcp__martha__switch_your_model', input: { model: THE_REVIEWER_MODEL, package: THE_PACKAGE, reason: 'the review needs it' } }
          : END,
    }),
  )
  // The tool answered the member, and the answer says when the switch happens.
  assert.match(whatTheModelSaw(seen, 1), new RegExp(`Switching to ${THE_REVIEWER_MODEL} for ${THE_PACKAGE}`), whatTheModelSaw(seen, 1).slice(-2000))
  // The host itself says it switched: this is `command.run({command, args})` running on the pinned host, which nothing
  // in the tree had ever done. Its answer also says the model was "saved as your default for new sessions", which is
  // the owner's own setting moving under a member's switch — observed here, and filed as martha#359 rather than
  // asserted either way: what this test holds is the session, and the row below is the model that session runs on.
  assert.match(drawnWithoutGaps(seen.shown), /SetmodeltoOpus/i, `the host never answered the model command:\n${plainTextOf(seen.shown).slice(-3000)}`)
  // The row says the model this session runs on, and only a command that resolved writes that.
  assert.equal(theRowOf(project).host.model, THE_REVIEWER_MODEL, 'the row does not say the model the member switched to, so the host command did not resolve')
  const record = theRecordOf(project)
  assert.equal(record.switched, true, 'the switch was directed and no record of it was kept')
  assert.equal(record.directed, true, 'the switch was never directed at the session')
})

test('on the recorded host a review off the crew\'s reviewer model is refused, and the refusal says the model to use', { skip }, async (t) => {
  const project = approvedProjectWithModels(t)
  const ran = await driveTheRecordedHost({
    claude: recordedHost ?? '',
    ...project,
    member: MEMBER,
    owner_turn: OWNER_TURN,
    requests: 2,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) =>
      number === 1
        ? { tool: 'Agent', input: { subagent_type: 'Explore', description: 'review the patch', prompt: 'read the diff and judge it', model: LAUNCHED_ON } }
        : END,
  })
  assert.equal(ran.exit_code, 0, plainTextOf(ran.shown))
  const told = whatTheModelSaw(ran, 1)
  assert.match(told, new RegExp(`crew reviews run on ${THE_REVIEWER_MODEL}`), `the off-model review was not refused, or the refusal does not name the reviewer model: ${told.slice(-2000)}`)
  assert.match(told, new RegExp(`model: '${THE_REVIEWER_MODEL}'`), 'the refusal does not say how to call it again')
})
