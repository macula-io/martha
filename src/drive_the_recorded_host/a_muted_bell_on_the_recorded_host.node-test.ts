// The owner's own mute of one member's bells reaches a member that is running, on the terminal its bell rings on
// (martha#371).
//
// This exists so an owner can trust `martha bells <member> muted`: the row still says "needs you" when the member's host
// asks, and the bell and its notification are what the silence takes away. Nothing here builds a screen of its own — the
// real command, the real launcher and the real relay are driven on a terminal, and the bell's own bytes are read off
// that terminal — because a test that built its screen would prove nothing about the line that hands the launcher the
// owner's mute. The same member is then started unmuted, and rings.
//
// It skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it with the recorded host, as
// prove_the_relay_loads/recorded_host_runs.json lists, and fails a run that skipped it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_FILE_WRITING_TOOLS } from '../claude_code_host/claude_code_file_tools.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, OWNER_BELL } from '../declare_crew/declare_crew.ts'
import { crewStateDirectory, CREW_ROW_PLACE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { rowFileNameOf, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { BELLS_MUTED, theMutedStartLine } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { theTitleFor } from '../ring_the_owner/ring_the_owner.ts'
import { driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, type TheOwnersHands } from './drive_the_recorded_host.ts'
import { stateHomeUnder } from '../find_a_homes_state_root/find_a_homes_state_root.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { HOST_SILENCE_MS, POLL_MS } from './wait_while_the_host_keeps_showing.ts'

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
/** The project's approved settings: the shell is not on the allow list, so the one shell call the stand-in offers is a prompt. */
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: Object.keys(CLAUDE_CODE_FILE_WRITING_TOOLS) } })
/** The file the asked-about call makes once the owner allows it: a call the host asks about, never one it runs unasked. */
const MADE = 'allowed.txt'

/** The model request that offers the shell call, so the host draws the prompt the bell is about. */
const ASKING_REQUEST = 1
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/** A checkout with a crew declared whose bells the owner left on, and its config approved, in a home of the test's own. */
function approvedProject(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-bells-host-')))
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
  const place = { claude: recordedHost(), home, checkout }
  firstRunDone(home, checkout)
  const declared = marthaOnATerminal(place, ['init'])
  assert.equal(declared.exit_code, 0, plainTextOf(declared.shown))
  // The declaration as the owner wrote it: every bell rings, unless the owner mutes one (house_rules.owner_bell).
  const declaration = join(checkout, DECLARATION_DIRECTORY, DECLARATION_FILE)
  writeFileSync(declaration, `${JSON.stringify({ ...JSON.parse(readFileSync(declaration, 'utf8')), house_rules: { [OWNER_BELL]: true } }, null, 2)}\n`)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew, its bells on')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

/** Where the launcher keeps this member's row, as the owner's pane reads it. */
function theRowFileOf(project: Project): string {
  const crew = crewStateDirectory(join(stateHomeUnder(project.home), STATE_ROOT_NAME), project.checkout)
  if ('refusal' in crew) throw new Error(crew.refusal)
  return join(crew.path, CREW_ROW_PLACE, rowFileNameOf(MEMBER))
}

/** This member's row as it stands, or undefined while the launcher has written none. */
function theRowNow(project: Project): DashboardRow | undefined {
  const file = theRowFileOf(project)
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DashboardRow) : undefined
}

/** Whether `holds` comes true within `ms`, asked again at every look. */
async function holdsWithin(holds: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (holds()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return holds()
}

/**
 * The question the host's permission dialog asks the owner. The host draws it a word at a time with the cursor moved
 * between, so it is compared with every gap taken out, as ./a_permission_prompt_on_the_recorded_host reads it.
 */
const PERMISSION_PROMPT_SHOWN = 'Do you want to proceed?'

/** The terminal's text with every gap taken out: a line the host draws in pieces still reads whole. */
const withoutGaps = (text: string): string => plainTextOf(text).replaceAll(/\s/g, '')

/** How long the row may take to follow what the host did: the prompt drawn, and the row moved for it. */
const WITHIN_MS = 20_000

/** The title chunk's payload for this member's bell: what the terminal is handed when the bell rings (martha#574). */
const THE_BELLS_TITLE_BYTES = Buffer.from(theTitleFor(MEMBER), 'utf8').toString('base64')

/** How long after the prompt is drawn the owner answers it: a Return typed into that moment is dropped. */
const ANSWER_AFTER_MS = 1_200

/**
 * One run of the real command on a terminal, with the recorded host and the stand-in model offering the shell call: the
 * host draws its prompt, the owner answers it, and the run ends. Resolves with everything the terminal was shown.
 */
async function aRun(project: Project, t: TestContext): Promise<string> {
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: MEMBER,
    owner_turn: OWNER_TURN,
    requests: ASKING_REQUEST + 1,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) =>
      number === ASKING_REQUEST ? { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: `touch '${join(project.home, MADE)}'`, description: 'a call the owner must allow' } } : { text: 'Done.' },
    atTheTerminal: async (hands: TheOwnersHands) => {
      await hands.until('the host drawing its permission prompt', () => withoutGaps(hands.shown()).includes(withoutGaps(PERMISSION_PROMPT_SHOWN)))
      // The row reads "needs you" while the prompt is on the screen: the beat the bell is about.
      const asked = (): boolean => {
        const row = theRowNow(project)
        return row !== undefined && whatTheOwnerIsShown(row).state === 'needs-you'
      }
      assert.ok(await holdsWithin(asked, WITHIN_MS), `the owner's row never read needs-you while the host was asking: ${JSON.stringify(theRowNow(project))}`)
      // Answering the prompt lets the call run and the member finish. A Return typed into the moment the dialog takes its
      // input is dropped, so a call that has not run by the bound is answered again.
      await new Promise((resolve) => setTimeout(resolve, ANSWER_AFTER_MS))
      hands.type('\r')
      if (!(await holdsWithin(() => hands.heard.length > ASKING_REQUEST, WITHIN_MS))) {
        hands.type('\r')
        await hands.until('the call the owner allowed running', () => hands.heard.length > ASKING_REQUEST)
      }
    },
  })
  const shown = `${ran.shown}`
  t.diagnostic(plainTextOf(shown).slice(-2000))
  return shown
}

test('the owner\'s mute silences a launched member\'s bell, and the same member unmuted rings', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  // Unmuted, the same launch the muting is compared with: the bell's own title bytes are handed to the terminal.
  const unmuted = await aRun(project, t)
  assert.ok(unmuted.includes(THE_BELLS_TITLE_BYTES), 'the launch of a member whose bells ring was handed no bell')
  assert.ok(!plainTextOf(unmuted).includes(theMutedStartLine(MEMBER)), 'a member with no mute was told its bell is muted')
  // The owner mutes this member's bell at their own terminal, and the next launch honours it.
  const muted = marthaOnATerminal({ claude: recordedHost(), ...project }, ['bells', MEMBER, BELLS_MUTED])
  assert.equal(muted.exit_code, 0, plainTextOf(muted.shown))
  const silenced = await aRun(project, t)
  assert.ok(plainTextOf(silenced).includes(theMutedStartLine(MEMBER)), `a muted member was not told so at its start: ${plainTextOf(silenced).slice(-1500)}`)
  assert.ok(!silenced.includes(THE_BELLS_TITLE_BYTES), 'a muted member\'s bell rang anyway')
})
