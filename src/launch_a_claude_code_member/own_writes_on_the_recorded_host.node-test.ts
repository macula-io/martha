// On the recorded host, a member's own writes do not stop it, and an outsider's change still does (martha#132).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay and launcher; only the
// model is a stand-in (./drive_the_recorded_host.ts). The relay CI job installs the recorded host and names it in
// MARTHA_RECORDED_HOST; without it these tests are skipped. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { approveAgain } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import {
  driveTheRecordedHost,
  firstRunDone,
  marthaOnATerminal,
  plainTextOf,
  RECORDED_HOST_VARIABLE,
  type ModelScript,
  type RecordedHostRan,
} from './drive_the_recorded_host.ts'
import { removeTheTree } from './relay_copy.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

const recordedHost = process.env[RECORDED_HOST_VARIABLE]
const skip = recordedHost === undefined && `needs ${RECORDED_HOST_VARIABLE}, the recorded host's binary, which the relay CI job sets`

const MEMBER = 'builder'
const OWNER_TURN = 'Do the first task.'
const CRLF_FILE = 'windows.txt'
const OUTSIDER_BRANCH = 'outsider'
/**
 * The project's approved settings: the file tools and the shell may run without asking. The recorded host starts in
 * auto mode, which asks the model to judge each shell command first; the stand-in plays the member, not that judge,
 * so the mode is pinned to the one where the allow list alone decides.
 */
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default', allow: ['Write', 'Edit', 'Bash'] } })

const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/** A checkout with a crew declared and its config approved by the owner, in a home made for the test. */
function approvedProject(t: TestContext, more: Readonly<Record<string, string>> = {}): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-real-host-')))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'project')
  const files = { 'README.md': 'a project\n', [CRLF_FILE]: 'one\r\ntwo\r\n', '.claude/settings.json': SETTINGS, ...more }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  git(checkout, 'init', '-q', '.')
  // The run's home is fresh, so it has no global git identity; `martha init` names the owner from the checkout's.
  git(checkout, 'config', 'user.name', GIT_NAME)
  git(checkout, 'config', 'user.email', GIT_EMAIL)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')
  git(checkout, 'checkout', '-q', '-b', OUTSIDER_BRANCH)
  writeFileSync(join(checkout, 'README.md'), 'changed on a branch the member did not write\n')
  git(checkout, 'commit', '-q', '-am', 'an outsider change')
  git(checkout, 'checkout', '-q', '-')

  const place = { claude: recordedHost ?? '', home, checkout }
  firstRunDone(home, checkout)
  const declared = marthaOnATerminal(place, ['init'])
  assert.equal(declared.exit_code, 0, plainTextOf(declared.shown))
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

async function run(project: Project, requests: number, script: ModelScript): Promise<RecordedHostRan> {
  return driveTheRecordedHost({
    claude: recordedHost ?? '',
    ...project,
    member: MEMBER,
    owner_turn: OWNER_TURN,
    script,
    requests,
    silence_ms: HOST_SILENCE_MS,
  })
}

/** The terminal's text on one line, so a message the terminal wrapped still reads whole. */
const flat = (shown: string): string => plainTextOf(shown).replaceAll(/\s+/g, ' ')

const stoppedLine = (paths: string): string =>
  `${MEMBER} is stopped: The checkout changed since the owner approved it, and not by this member's own file writes: ${paths}. ${approveAgain(MEMBER)}`

const END = { text: 'Done.' }

test("a member's own Write, then one shell command that branches and commits it, does not stop it", { skip }, async (t) => {
  const project = approvedProject(t)
  const ran = await run(project, 3, ({ number }) =>
    [
      { tool: 'Write', input: { file_path: join(project.checkout, 'hello.txt'), content: 'hello\n' } },
      { tool: 'Bash', input: { command: 'git checkout -q -b first-task && git add hello.txt && git commit -q -m "the hello note"' } },
    ][number - 1] ?? END,
  )
  // Every scripted turn was asked for; the host may send one more as it ends.
  assert.ok(ran.requests.length >= 3, flat(ran.shown))
  assert.ok(!flat(ran.shown).includes(`${MEMBER} is stopped`), flat(ran.shown))
  assert.equal(ran.exit_code, 0, flat(ran.shown))
  assert.equal(git(project.checkout, 'show', 'first-task:hello.txt'), 'hello')
  assert.equal(git(project.checkout, 'log', '-1', '--format=%s', 'first-task'), 'the hello note')
})

test('an outsider change brought in by a shell command stops the member, naming the path and martha approve', { skip }, async (t) => {
  const project = approvedProject(t)
  const ran = await run(project, 2, ({ number }) => (number === 1 ? { tool: 'Bash', input: { command: `git checkout -q ${OUTSIDER_BRANCH}` } } : END))
  assert.ok(flat(ran.shown).includes(stoppedLine('README.md')), flat(ran.shown))
  assert.notEqual(ran.exit_code, 0)
})

test('an outsider writing beside the member is refused before its next call, and the model is told why', { skip }, async (t) => {
  const project = approvedProject(t)
  const read = { tool: 'Read', input: { file_path: join(project.checkout, 'README.md') } }
  const ran = await run(project, 3, ({ number }) => {
    // Request 2 follows turn 1's result: the outsider writes before the model's next call is answered.
    if (number === 2) writeFileSync(join(project.checkout, 'planted.txt'), 'from outside the member\n')
    return number <= 2 ? read : END
  })
  const third = JSON.stringify(ran.requests[2]?.body['messages'] ?? null)
  assert.ok(third.includes('planted.txt') && third.includes('martha approve'), third.slice(-2000))
})

test("a member's own Write over a file whose lines end in CRLF does not stop it", { skip }, async (t) => {
  const project = approvedProject(t)
  const ran = await run(project, 2, ({ number }) =>
    number === 1 ? { tool: 'Write', input: { file_path: join(project.checkout, CRLF_FILE), content: 'one\r\ntwo\r\nthree\r\n' } } : END,
  )
  assert.ok(!flat(ran.shown).includes(`${MEMBER} is stopped`), flat(ran.shown))
  assert.equal(readFileSync(join(project.checkout, CRLF_FILE), 'utf8'), 'one\r\ntwo\r\nthree\r\n')
})

test("a member's own CRLF Write where git normalises line ends as it adds (text=auto) does not stop it", { skip }, async (t) => {
  const project = approvedProject(t, { '.gitattributes': '* text=auto\n' })
  const ran = await run(project, 2, ({ number }) =>
    number === 1 ? { tool: 'Write', input: { file_path: join(project.checkout, 'notes.txt'), content: 'one\r\ntwo\r\n' } } : END,
  )
  assert.ok(!flat(ran.shown).includes(`${MEMBER} is stopped`), flat(ran.shown))
  assert.equal(readFileSync(join(project.checkout, 'notes.txt'), 'utf8'), 'one\r\ntwo\r\n')
})
