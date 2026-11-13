// On the recorded host, a member's model switch leaves the owner's own default for new sessions alone (martha#359).
//
// The host's `/model` command says so itself: "Set model to … and saved as your default for new sessions". This is the
// end-to-end proof that Martha undoes it — the real `martha` command, the real Claude Code at the recorded version, the
// real relay, mod and launcher, and only the model a stand-in (./drive_the_recorded_host.ts). Without the recorded host
// these tests are skipped, as the rest of this file's neighbours are.
//
// What only this test can prove: the file the host really wrote is the file Martha puts back. The mechanism's own tests
// (../a_crews_tools/a_switch_leaves_the_owners_default_alone) write the host's save themselves, and could agree with a
// mistake about what the host writes; here the bytes before and after are the host's own work.

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
import { theModelMarker, MODEL_PLACE, type ModelMarker } from '../switch_a_members_model/switch_a_members_model.ts'
import { OWNERS_SETTINGS_FILE } from '../put_the_owners_model_back/the_owners_settings_file.ts'
import { crewSubdirectory, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { stateHomeUnder, driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, RECORDED_HOST_VARIABLE, whatTheLaunchSaw, type RecordedHostRan } from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'

const recordedHost = process.env[RECORDED_HOST_VARIABLE]
const skip = recordedHost === undefined && `needs ${RECORDED_HOST_VARIABLE}, the recorded host's binary, which the relay CI job sets`

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
const THE_PACKAGE = 'macula-io/martha#359'
/** The model the member is launched on, and the crew's reviewer model: two the host runs, so a switch is allowed. */
const LAUNCHED_ON = 'sonnet'
const THE_REVIEWER_MODEL = 'opus'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: [WHOLE_FILE_TOOL, 'Edit', CLAUDE_CODE_SHELL_TOOL] } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
/**
 * A setting of the owner's own, beside the model: the file's bytes must come back whole, so the test's owner has
 * something in it that the host has no business touching.
 */
const AN_OWNERS_SETTING = { includeCoAuthoredBy: false }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/**
 * A checkout whose crew declares its own models and whose config the owner approved, and the owner's own settings file
 * in their config folder — the one the host's `/model` command saves a default into.
 */
function approvedProjectWithModels(t: TestContext, ownersSettings: Record<string, unknown>): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-model-default-host-')))
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
  writeTheOwnersSettings(home, ownersSettings)
  const declared = marthaOnATerminal(place, ['init'])
  assert.equal(declared.exit_code, 0, plainTextOf(declared.shown))
  declareTheModels(checkout)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew, with its models')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

/** The owner's own settings file, as they wrote it: the file the host's model command saves a default into. */
function writeTheOwnersSettings(home: string, settings: Record<string, unknown>): void {
  const config = join(home, '.claude')
  mkdirSync(config, { recursive: true })
  writeFileSync(join(config, OWNERS_SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`)
}

/** The owner's settings file as it is now, byte for byte. */
const theOwnersSettingsNow = (project: Project): string => readFileSync(join(project.home, '.claude', OWNERS_SETTINGS_FILE), 'utf8')

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

/** This member's model record, as a later session reads it. */
function theRecordOf(project: Project): ModelMarker {
  const place = crewSubdirectory(join(stateHomeUnder(project.home), STATE_ROOT_NAME), project.checkout, MODEL_PLACE)
  if ('refusal' in place) throw new Error(place.refusal)
  return JSON.parse(readFileSync(join(place.path, theModelMarker(MEMBER)), 'utf8')) as ModelMarker
}

/**
 * What the host drew, with every space taken out: the terminal stream carries only the cells that changed, so a line the
 * host draws over itself arrives as the words it redrew, glued.
 */
const drawnWithoutGaps = (shown: string): string => plainTextOf(shown).replaceAll(/\s/g, '')

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
 * confirmation open after the command, as ../a_switch_on_the_recorded_host's own note says.
 */
const SWITCH_SILENCE_MS = 20_000

/** The one switch this file drives: the member moves to the crew's reviewer model, with the tool. */
const theSwitch = { tool: 'mcp__martha__switch_your_model', input: { model: THE_REVIEWER_MODEL, package: THE_PACKAGE, reason: 'the review needs it' } }

test('on the recorded host a switch leaves a settings file that held a model byte for byte as the owner wrote it (martha#359)', { skip }, async (t) => {
  const owners = { ...AN_OWNERS_SETTING, model: LAUNCHED_ON }
  const project = approvedProjectWithModels(t, owners)
  const before = theOwnersSettingsNow(project)
  const seen = await whatTheRunSaw(() =>
    driveTheRecordedHost({
      claude: recordedHost ?? '',
      ...project,
      member: MEMBER,
      owner_turn: OWNER_TURN,
      requests: 2,
      silence_ms: SWITCH_SILENCE_MS,
      script: ({ number }) => (number === 1 ? theSwitch : { text: 'Done.' }),
    }),
  )
  // The host's own words, kept as the observation they are: today it still says "and saved as your default for new
  // sessions", and the restore is what makes that untrue. Only the file's bytes are the pass condition, because the
  // wording is the host's to change and Martha's answer must not depend on it.
  assert.match(drawnWithoutGaps(seen.shown), /SetmodeltoOpus/i, `the host never answered the model command:\n${plainTextOf(seen.shown).slice(-3000)}`)
  assert.equal(theOwnersSettingsNow(project), before, `the owner's default moved: ${join(project.home, '.claude', OWNERS_SETTINGS_FILE)} no longer holds what the owner wrote`)
  assert.equal(theRecordOf(project).settings, undefined, 'the record of what the switch did to the owner\'s default outlived the restore')
})

test('on the recorded host a switch leaves an owner with no model where they were: no file key appears (martha#359)', { skip }, async (t) => {
  const project = approvedProjectWithModels(t, AN_OWNERS_SETTING)
  const before = theOwnersSettingsNow(project)
  await whatTheRunSaw(() =>
    driveTheRecordedHost({
      claude: recordedHost ?? '',
      ...project,
      member: MEMBER,
      owner_turn: OWNER_TURN,
      requests: 2,
      silence_ms: SWITCH_SILENCE_MS,
      script: ({ number }) => (number === 1 ? theSwitch : { text: 'Done.' }),
    }),
  )
  assert.equal(theOwnersSettingsNow(project), before, `the owner's default moved: ${join(project.home, '.claude', OWNERS_SETTINGS_FILE)} gained a model the owner never chose`)
  assert.equal(theRecordOf(project).settings, undefined, 'the record of what the switch did to the owner\'s default outlived the restore')
})
