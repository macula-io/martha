// On the recorded host, the owner types `/crew` at a member's tab and sees the crew, or says one thing to a member, and
// the member's model takes no turn (martha#927).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay, mod and launcher; only the
// model is a stand-in (./drive_the_recorded_host.ts). It skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it with
// the recorded host, as prove_the_relay_loads/recorded_host_runs.json lists.
//
// What only this test can prove: that the host takes the command the mod registers, hands its typed words to the
// mod's own answer, draws the text it is given, and sends the model nothing, which is the whole of Done-when 6. The
// command's reading of what was typed and of what the launcher said is ./../claude_code_relay/hooks/crew_command.ts's,
// proven beside it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, type RecordedHostRan, type TheOwnersHands } from './drive_the_recorded_host.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

/** The member whose tab the owner types in, and the other member of the solo crew `martha init` declares. */
const MEMBER = 'builder'
const THE_OTHER_MEMBER = 'reviewer'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default' } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
/** What the owner says to the other member through `/crew`. */
const SAID = 'the review is yours when you are free'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/** A checkout with a solo crew declared and its config approved by the owner, in a home made for the test. */
function approvedProject(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-crew-command-')))
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

/**
 * What the host drew, with every space taken out: the terminal stream carries only the cells that changed, so a line
 * the host draws over itself arrives as the words it redrew, glued.
 */
const drawnWithoutGaps = (shown: string): string => plainTextOf(shown).replaceAll(/\s/g, '')

/** The owner types `/crew` and its words, and the run waits until the host has drawn what the launcher answered. */
async function theOwnerTypesTheCommand(project: Project, owner_turn: string, drawn: string): Promise<RecordedHostRan> {
  return await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: MEMBER,
    owner_turn,
    script: () => ({ text: 'Done.' }),
    // No request is waited for: the command takes no turn, so the run ends once the answer is drawn.
    requests: 0,
    silence_ms: HOST_SILENCE_MS,
    atTheTerminal: async (hands: TheOwnersHands) => await hands.until(`the host drawing ${drawn}`, () => drawnWithoutGaps(hands.shown()).includes(drawn)),
  })
}

test('#927 DW1 DW6: /crew at a member\'s tab draws every member\'s line, and the model is sent nothing', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  // The pane's header says how many members are online; each member's line starts with its name.
  const ran = await theOwnerTypesTheCommand(project, '/crew', `${THE_OTHER_MEMBER}:`)
  assert.equal(ran.exit_code, 0, plainTextOf(ran.shown).slice(-3000))
  const drawn = drawnWithoutGaps(ran.shown)
  assert.match(drawn, /\d+\/\d+online·/, `the crew's header was not drawn:\n${plainTextOf(ran.shown).slice(-3000)}`)
  assert.ok(drawn.includes(`${MEMBER}:`), `the member's own line was not drawn:\n${plainTextOf(ran.shown).slice(-3000)}`)
  assert.equal(ran.requests.length, 0, `the model was sent ${ran.requests.length} request(s) for a /crew: ${JSON.stringify(ran.requests.map((request) => request.body['messages'])).slice(-2000)}`)
})

test('#927 DW2 DW6: /crew <member> <text> sends it as this member and draws the receipt, and the model is sent nothing', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  const receipt = `to${THE_OTHER_MEMBER}.`
  const ran = await theOwnerTypesTheCommand(project, `/crew ${THE_OTHER_MEMBER} ${SAID}`, receipt)
  assert.equal(ran.exit_code, 0, plainTextOf(ran.shown).slice(-3000))
  assert.match(drawnWithoutGaps(ran.shown), new RegExp(`sentasmessage\\d+to${THE_OTHER_MEMBER}\\.`), `the launcher's receipt was not drawn:\n${plainTextOf(ran.shown).slice(-3000)}`)
  assert.equal(ran.requests.length, 0, `the model was sent ${ran.requests.length} request(s) for a /crew: ${JSON.stringify(ran.requests.map((request) => request.body['messages'])).slice(-2000)}`)
})
