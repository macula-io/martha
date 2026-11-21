// On the recorded host, a Read in a clone behind its origin carries the stale-clone note to the model (martha#969, gap 9
// of #957), and a Read in a clone that is current and freshly fetched carries none.
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay and launcher; only the model
// is a stand-in (./drive_the_recorded_host.ts). The checkout sits at `<clones>/<org>/<name>` with an origin naming the
// same pair, so `martha init` declares the workspace layout itself (martha#611): no declaration is edited by hand. Each
// case skips on RECORDED_HOST_SKIP: ci.yml's relay job runs them with the recorded host, as
// prove_the_relay_loads/recorded_host_runs.json lists. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, type RecordedHostRan } from './drive_the_recorded_host.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'
import { FILE_PATH_ARGUMENT } from '../claude_code_host/claude_code_file_tools.ts'
import { CLAUDE_CODE_READING_TOOLS } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_FOLDER } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { WORKTREES_BESIDE_CLONES } from '../declare_crew/declare_crew.ts'

const MEMBER = 'builder'
const OWNER_TURN = 'Read the README.'
const [READ] = CLAUDE_CODE_READING_TOOLS
/** The recorded host starts in auto mode; the stand-in plays the member, not the judge, so the mode is the plain one. */
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default' } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
const ORG = 'acme'
const NAME = 'project'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
  /** Another clone of the same origin, which moves origin on. */
  readonly elsewhere: string
}

/** A clone at `<clones>/acme/project` of an origin naming acme/project, its crew declared by init and approved. */
function aCloneWithItsCrew(t: TestContext): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-969-host-')))
  t.after(() => removeTheTree(home))
  const origin = join(home, 'origins', ORG, NAME)
  mkdirSync(origin, { recursive: true })
  git(origin, 'init', '-q', '--bare', '--initial-branch=main')
  const clones = join(home, 'repos')
  mkdirSync(join(clones, ORG), { recursive: true })
  mkdirSync(join(home, WORKTREES_BESIDE_CLONES))
  const checkout = join(clones, ORG, NAME)
  git(join(clones, ORG), 'clone', '-q', origin, NAME)
  git(checkout, 'checkout', '-q', '-b', 'main')
  mkdirSync(join(checkout, CLAUDE_FOLDER))
  writeFileSync(join(checkout, 'README.md'), 'a project\n')
  writeFileSync(join(checkout, CLAUDE_FOLDER, USER_SETTINGS_FILE), SETTINGS)
  git(checkout, 'config', 'user.name', GIT_NAME)
  git(checkout, 'config', 'user.email', GIT_EMAIL)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'start')

  const place = { claude: recordedHost(), home, checkout }
  firstRunDone(home, checkout)
  const declared = marthaOnATerminal(place, ['init'])
  assert.equal(declared.exit_code, 0, plainTextOf(declared.shown))
  assert.match(plainTextOf(declared.shown), /Workspace layout declared/, 'init declared no layout, so nothing here is a clone')
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew')
  git(checkout, 'push', '-q', '-u', 'origin', 'main')
  git(checkout, 'remote', 'set-head', 'origin', 'main')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  const elsewhere = join(home, 'elsewhere')
  git(home, 'clone', '-q', origin, elsewhere)
  return { home, checkout, elsewhere }
}

/** Origin moves on by two commits, and the clone fetches them without moving its branch. */
function originMovesOnAndTheCloneFetches(project: Project): void {
  for (const n of [1, 2]) {
    writeFileSync(join(project.elsewhere, `later-${n}.md`), `${n}\n`)
    git(project.elsewhere, 'add', '--all')
    git(project.elsewhere, 'commit', '-q', '-m', `a later commit ${n}`)
  }
  git(project.elsewhere, 'push', '-q', 'origin', 'main')
  git(project.checkout, 'fetch', '-q')
}

/** The member reads the README once, then ends. */
async function aReadOfTheReadme(project: Project): Promise<RecordedHostRan> {
  assert.ok(READ !== undefined)
  return driveTheRecordedHost({
    claude: recordedHost(),
    home: project.home,
    checkout: project.checkout,
    member: MEMBER,
    owner_turn: OWNER_TURN,
    script: ({ number }) => (number === 1 ? { tool: READ, input: { [FILE_PATH_ARGUMENT]: join(project.checkout, 'README.md') } } : { text: 'Done.' }),
    requests: 2,
    silence_ms: HOST_SILENCE_MS,
  })
}

/** What the model was sent after the Read: request 2's messages, whole. */
const afterTheRead = (ran: RecordedHostRan): string => JSON.stringify(ran.requests[1]?.body['messages'] ?? null)

test('#969 DW1: a Read in a clone two commits behind its origin carries the note to the model, beside the file it read', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = aCloneWithItsCrew(t)
  originMovesOnAndTheCloneFetches(project)
  const ran = await aReadOfTheReadme(project)
  const sent = afterTheRead(ran)
  assert.ok(sent.includes(`note: the clone ${project.checkout} is 2 commits behind origin/main as of the last fetch`), sent.slice(-3000))
  assert.ok(sent.includes(`Run git -C ${project.checkout} fetch and read origin/main`), sent.slice(-3000))
  assert.ok(sent.includes('a project'), 'the file the Read read was not handed on')
  assert.ok(!plainTextOf(ran.shown).includes(`${MEMBER} is stopped`), plainTextOf(ran.shown))
})

test('#969 DW2: a Read in a clone that is current and freshly fetched carries no note', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = aCloneWithItsCrew(t)
  git(project.checkout, 'fetch', '-q')
  const ran = await aReadOfTheReadme(project)
  const sent = afterTheRead(ran)
  assert.ok(sent.includes('a project'), sent.slice(-3000))
  assert.ok(!sent.includes(`note: the clone ${project.checkout}`), sent.slice(-3000))
})
