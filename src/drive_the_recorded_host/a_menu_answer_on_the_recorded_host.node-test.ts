// On the recorded host, the owner's answer to the host's own menu is still the answer the ask queue's reader was written
// from (martha#608): ../queue_the_owners_asks/recorded_menu_answers.json.
//
// This exists because a settle of the owner's asks stands on that answer's shape: one string per question, a multi-select
// question's picks joined in the order the owner ticked them, and an "Other" answer as the owner's bare words. The reader
// is proven on the recording; this case drives the real host at its terminal through the same ticks and fails by name
// when the host now answers the model differently, so the recording cannot go stale under a new host.
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay and launcher; only the model
// is a stand-in (./drive_the_recorded_host.ts). It skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it with the
// recorded host, as prove_the_relay_loads/recorded_host_runs.json lists, and fails a run that skipped it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { CLAUDE_CODE_FILE_WRITING_TOOLS } from '../claude_code_host/claude_code_file_tools.ts'
import { MENU_TOOL } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import { driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, standInCallId } from './drive_the_recorded_host.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

const MEMBER = 'builder'
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: Object.keys(CLAUDE_CODE_FILE_WRITING_TOOLS) } })
/** The model request that offers the menu; the owner's answer rides in the one after it. */
const ASKING_REQUEST = 1
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'

const RECORDED = JSON.parse(readFileSync(new URL('../queue_the_owners_asks/recorded_menu_answers.json', import.meta.url), 'utf8')) as {
  readonly input: { readonly questions: readonly { readonly question: string }[] }
  readonly ticked: { readonly model_saw: string }
}

/** The keys the recording was made with: Green; Plum, then Apple; then Birch typed as the third question's Other. */
const DOWN = '\u001b[B'
const UP = '\u001b[A'
const RIGHT = '\u001b[C'
const RETURN = '\r'
const THE_TICKS = [DOWN, RETURN, DOWN, DOWN, RETURN, UP, UP, RETURN, RIGHT, DOWN, DOWN, 'Birch', RETURN, RETURN]

/** How long after each key the next is typed: the menu redraws between keys, and a key typed into a redraw is dropped. */
const KEY_GAP_MS = 1_200

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

/** A checkout with a crew declared and its config approved by the owner, in a home made for the test. */
function approvedProject(t: TestContext): { readonly home: string; readonly checkout: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-menu-host-')))
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

/** The text of the tool result for the stand-in's menu call, in the request the host sent after it. */
function theAnswerTheModelGot(body: Readonly<Record<string, unknown>>): unknown {
  const messages = body['messages'] as readonly { readonly content: unknown }[] | undefined
  const last = messages?.at(-1)?.content
  const result = Array.isArray(last) ? (last as readonly Record<string, unknown>[]).find((block) => block['tool_use_id'] === standInCallId(ASKING_REQUEST)) : undefined
  return result?.['content']
}

test('the owner\'s answer to the host\'s menu, ticked at the terminal, is still the one the ask queue\'s reader was recorded from', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProject(t)
  const first = RECORDED.input.questions[0]?.question ?? assert.fail('the recording holds no question')
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: MEMBER,
    owner_turn: 'Ask me.',
    requests: ASKING_REQUEST + 1,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) => (number === ASKING_REQUEST ? { tool: MENU_TOOL, input: RECORDED.input } : { text: 'Done.' }),
    atTheTerminal: async (hands) => {
      await hands.until('the host drawing the menu', () => plainTextOf(hands.shown()).includes(first))
      for (const key of [...THE_TICKS]) {
        await new Promise((resolve) => setTimeout(resolve, KEY_GAP_MS))
        hands.type(key)
      }
      await hands.until('the host handing the model the owner\'s answer', () => hands.heard.length > ASKING_REQUEST)
    },
  })
  const answered = ran.requests[ASKING_REQUEST]
  assert.ok(answered !== undefined, plainTextOf(ran.shown).slice(-3000))
  assert.equal(theAnswerTheModelGot(answered.body), RECORDED.ticked.model_saw, 'the host now answers its menu differently from the recording the reader stands on')
})
