// On the recorded host, a permission prompt the host really draws reaches the owner's row, and clears when the owner
// answers it (martha#363, design test 12 of martha#313).
//
// This exists so an owner can trust the row: while a member Martha launched waits on a prompt at the terminal, the row
// says "needs you", and once the owner has answered and the call has run, it reads what it read before.
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay and launcher; only the model
// is a stand-in (./drive_the_recorded_host.ts). It skips on RECORDED_HOST_SKIP: ci.yml's
// relay job runs it with the recorded host, as prove_the_relay_loads/recorded_host_runs.json lists, and fails a run that
// skipped it.
//
// The relay half (./the_hosts_dialogs_reach_the_owners_row.node-test.ts) feeds the launcher the order the host raises
// its events in, and prove_the_relay_loads/prove_the_order_of_the_dialogs.mjs measures that order on the host. What only
// this test proves is the seam between them: a prompt drawn inside a session Martha launched, answered at the terminal,
// moving the row it belongs to.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_FILE_WRITING_TOOLS } from '../claude_code_host/claude_code_file_tools.ts'
import { crewStateDirectory, CREW_ROW_PLACE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { OWNER_DIALOGS_FIELD, rowFileNameOf, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theKeyOfAPermission, theWordsOfADialog, whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import {
  driveTheRecordedHost,
  firstRunDone,
  marthaOnATerminal,
  plainTextOf,
  standInCallId,
  stateHomeUnder,
  type TheOwnersHands,
} from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'
import { HOST_SILENCE_MS, POLL_MS } from './wait_while_the_host_keeps_showing.ts'

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
/**
 * The project's approved settings: the file tools run without asking and the shell does not, so the one shell call the
 * stand-in offers is a prompt the host draws. The mode is pinned to the one where the allow list alone decides.
 */
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: Object.keys(CLAUDE_CODE_FILE_WRITING_TOOLS) } })
/**
 * The file the asked-about call makes: there once the owner has allowed it, and only then. It is made in the run's home,
 * outside the checkout, because a file a shell call makes in the checkout is not the member's own write (only the file
 * tools' are, martha#132) and would stop the member as an outsider's change.
 */
const MADE = 'allowed.txt'
/** The model request that offers the shell call; the call's result rides in the one after it. */
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

/** A checkout with a crew declared and its config approved by the owner, in a home made for the test. */
function approvedProject(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-prompt-host-')))
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
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew')
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

/** The words the row reads for a permission the host asks about the shell. */
const ASKED = { state: 'needs-you', needs: theWordsOfADialog({ kind: 'permission', agent: '', tool: CLAUDE_CODE_SHELL_TOOL, input: {} }) }

/**
 * The question the host's permission dialog asks the owner. Under `martha start` the host draws no "Waiting for
 * permission" line (the probe's bare host does), and it draws this question a word at a time with the cursor moved
 * between, so it is compared with every gap taken out.
 */
const PERMISSION_PROMPT_SHOWN = 'Do you want to proceed?'

/** The terminal's text with every gap taken out: a line the host draws in pieces still reads whole. */
const withoutGaps = (text: string): string => plainTextOf(text).replaceAll(/\s/g, '')

/** Whether the host has drawn its permission dialog, given everything the terminal has shown. */
const theHostIsAsking = (shown: string): boolean => withoutGaps(shown).includes(withoutGaps(PERMISSION_PROMPT_SHOWN))

/**
 * How long after the prompt is drawn the owner answers it: the host draws the dialog a moment before the dialog takes
 * its input, and a Return typed into that moment is dropped (measured by prove_the_order_of_the_dialogs.mjs).
 */
const ANSWER_AFTER_MS = 1_200

/**
 * How long the row may take to follow what the host did: the prompt drawn, or the allowed call run. The launcher writes
 * the row as the relay hears each event, before the host goes on, so this bound only absorbs a busy runner; a row that
 * never moves fails by name instead of waiting out the run's silence budget. It is also how long an answered prompt may
 * go without its call running before the owner answers it again: the dropped Return.
 */
const WITHIN_MS = 20_000

/** Whether `holds` comes true within `ms`, asked again at every look: a plain bound, which no silence refills. */
async function holdsWithin(holds: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (holds()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return holds()
}

/**
 * The owner allows the call the prompt asks about with its first choice, by the probe's own rule: answer a moment after
 * the prompt is drawn, and answer again if the call has not run by WITHIN_MS, because the first Return can land before
 * the dialog takes input. Resolves once the call ran.
 */
async function theOwnerAllows(hands: TheOwnersHands, callHasRun: () => boolean): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ANSWER_AFTER_MS))
  hands.type('\r')
  if (await holdsWithin(callHasRun, WITHIN_MS)) return
  hands.type('\r')
  await hands.until('the call the owner allowed running', callHasRun)
}

test('a permission prompt the recorded host draws for a launched member reaches the owner\'s row, and clears once answered', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  let whileAsked: DashboardRow | undefined
  let afterTheAnswer: DashboardRow | undefined
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: MEMBER,
    owner_turn: OWNER_TURN,
    requests: ASKING_REQUEST + 1,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) =>
      number === ASKING_REQUEST
        ? { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: `touch '${join(project.home, MADE)}'`, description: 'make the allowed file' } }
        : { text: 'Done.' },
    atTheTerminal: async (hands) => {
      const callHasRun = (): boolean => hands.heard.length > ASKING_REQUEST
      await hands.until('the host drawing its permission prompt', () => theHostIsAsking(hands.shown()))
      // The row reads "needs you" while the prompt is on the screen and nobody has answered it.
      const asked = (): boolean => {
        const row = theRowNow(project)
        return row !== undefined && whatTheOwnerIsShown(row).state === ASKED.state
      }
      assert.ok(await holdsWithin(asked, WITHIN_MS), `the owner's row never read needs-you while the host was asking: ${JSON.stringify(theRowNow(project))}`)
      assert.ok(!callHasRun(), 'the shell call ran before the owner answered the prompt')
      whileAsked = theRowNow(project)
      await theOwnerAllows(hands, callHasRun)
      // The call's own answer is what closes the dialog, and the launcher hears it before the host asks the model again.
      const cleared = (): boolean => theRowNow(project)?.[OWNER_DIALOGS_FIELD] === undefined
      assert.ok(await holdsWithin(cleared, WITHIN_MS), `the owner's row still holds the answered prompt: ${JSON.stringify(theRowNow(project))}`)
      afterTheAnswer = theRowNow(project)
    },
  })
  const screen = plainTextOf(ran.shown).slice(-3000)
  assert.ok(whileAsked !== undefined && afterTheAnswer !== undefined, screen)
  // While asked: one dialog, keyed by the very call the stand-in offered, read as the shell's permission.
  assert.deepEqual(whatTheOwnerIsShown(whileAsked), ASKED, screen)
  assert.deepEqual(
    whileAsked[OWNER_DIALOGS_FIELD]?.map((dialog) => dialog.key),
    [theKeyOfAPermission('', CLAUDE_CODE_SHELL_TOOL, {}, standInCallId(ASKING_REQUEST))],
    'the dialog on the row is not the one the host raised for the stand-in\'s call',
  )
  // Once answered: no dialog, and the row reads the member's own state and words, as it did before it was asked.
  const { [OWNER_DIALOGS_FIELD]: _asked, ...before } = whileAsked
  assert.deepEqual(whatTheOwnerIsShown(afterTheAnswer), whatTheOwnerIsShown(before))
  // The owner's answer was an allow, and the call ran because of it.
  assert.ok(existsSync(join(project.home, MADE)), `the allowed call never ran:\n${screen}`)
  assert.equal(ran.exit_code, 0, screen)
})
