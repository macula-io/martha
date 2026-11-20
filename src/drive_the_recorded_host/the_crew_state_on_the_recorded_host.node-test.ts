// On the recorded host, the member who assigns work reads the crew's live state in its system prompt on every request,
// not only at its start (martha#984, gap 5 of martha#957).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay, mod and launcher; only the
// model is a stand-in (./drive_the_recorded_host.ts). It skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it with
// the recorded host, as prove_the_relay_loads/recorded_host_runs.json lists.
//
// What only this test can prove (Terra's design review R2): that the host fires `prompt.compose` for each request it
// renders, takes the section the mod adds, puts it in the request's system prompt, and replaces it on the next render
// rather than keeping a stale copy. How the launcher builds the text and how long the mod waits for it are proven beside
// each (../hand_a_member_its_crew_text/the_crew_state_of_a_turn.ts, ../claude_code_relay/hooks/crew_state_section.ts).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { A_CASES_HOME } from '../../prove_the_core/a_test_run_ends/every_test_file_cleans_up.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, SOLO_MEMBERS } from '../declare_crew/declare_crew.ts'
import { STANDING_ADD, STANDING_CLOSE, STANDING_HEADING } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, type ModelRequest, type RecordedHostRan, type TheOwnersHands } from './drive_the_recorded_host.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

/** The member whose tab the owner types in, and the other member of the solo crew `martha init` declares. */
const [THE_MEMBER, THE_OTHER_MEMBER] = SOLO_MEMBERS
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default' } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
const OWNER_TURN = 'Note what is held, then stop.'
const NEXT_TURN = 'The hold is over: close it.'
/** What the member's model answers when its turn is done; the second turn is typed once the host has drawn it. */
const TURN_ENDED = 'Turn one ended.'
const END = { text: TURN_ENDED }

/** The item the member records mid-turn: only the crew state of a later render can carry it into a system prompt. */
const HELD = { kind: 'held', id: 'the-landing', item: 'the landing waits for the owner', reason: 'the owner reads it first', until: 'the owner says yes' }
const ADD = { tool: `mcp__martha__${STANDING_ADD}`, input: HELD }
const CLOSE = { tool: `mcp__martha__${STANDING_CLOSE}`, input: { id: HELD.id, evidence: 'the owner said yes' } }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `user.name=${GIT_NAME}`, '-c', `user.email=${GIT_EMAIL}`, '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
}

interface Project {
  readonly home: string
  readonly checkout: string
}

/**
 * A checkout with a solo crew declared, its table granting `assign_work` to `role` alone, and its config approved by the
 * owner, in a home made for the test. A solo crew's own table names only the owner, which grants every member.
 */
function approvedProjectGranting(t: TestContext, role: string): Project {
  const home = realpathSync(mkdtempSync(join(tmpdir(), A_CASES_HOME)))
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
  const declaration = join(checkout, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as { mode: { may: Record<string, string[]> } }
  held.mode.may.assign_work = [role]
  writeFileSync(declaration, `${JSON.stringify(held, null, 2)}\n`)
  git(checkout, 'add', '--all')
  git(checkout, 'commit', '-q', '-m', 'the crew')
  const approved = marthaOnATerminal(place, ['approve'], 'yes\r')
  assert.equal(approved.exit_code, 0, plainTextOf(approved.shown))
  return { home, checkout }
}

/** What the host drew, with every space taken out: a line it draws over itself arrives as its words, glued. */
const drawnWithoutGaps = (shown: string): string => plainTextOf(shown).replaceAll(/\s/g, '')

const systemOf = (request: ModelRequest | undefined): string => JSON.stringify(request?.body['system'] ?? null)
const messagesOf = (request: ModelRequest): string => JSON.stringify(request.body['messages'])
const lastOf = (ran: RecordedHostRan): string => plainTextOf(ran.shown).slice(-3000)

test('#984: an item recorded mid-turn is in the system prompt of the very next request, and none of the state is kept in the conversation', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectGranting(t, THE_MEMBER.role)
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: THE_MEMBER.name,
    owner_turn: OWNER_TURN,
    requests: 2,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) => (number === 1 ? ADD : END),
  })
  assert.equal(ran.exit_code, 0, lastOf(ran))
  const [first, second] = ran.requests
  assert.ok(!systemOf(first).includes(HELD.item), `the first request already carried the item: ${systemOf(first).slice(-2000)}`)
  assert.ok(systemOf(second).includes(HELD.item), `the request after the item was recorded did not carry it in its system prompt: ${systemOf(second).slice(-2000)}\n${lastOf(ran)}`)
  assert.ok(systemOf(second).includes(STANDING_HEADING), systemOf(second).slice(-2000))
  for (const request of ran.requests) assert.ok(!messagesOf(request).includes(STANDING_HEADING), `request ${String(request.number)} kept the crew state in the conversation: ${messagesOf(request).slice(-2000)}`)
})

// The other half of R1: the section is replaced on each render, so an item closed in a later turn leaves no stale copy.
test("#984: an item closed on the owner's next turn is gone from the system prompt of the request after the close", { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectGranting(t, THE_MEMBER.role)
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: THE_MEMBER.name,
    owner_turn: OWNER_TURN,
    requests: 4,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) => (number === 1 ? ADD : number === 3 ? CLOSE : END),
    atTheTerminal: async (hands: TheOwnersHands) => {
      await hands.until(`the host drawing ${TURN_ENDED}`, () => hands.heard.length >= 2 && drawnWithoutGaps(hands.shown()).includes(drawnWithoutGaps(TURN_ENDED)))
      hands.type(`${NEXT_TURN}\r`)
    },
  })
  assert.equal(ran.exit_code, 0, lastOf(ran))
  assert.ok(ran.requests.length >= 4, `the owner's next turn did not run to its end: ${String(ran.requests.length)} request(s)\n${lastOf(ran)}`)
  const [, second, third, fourth] = ran.requests
  assert.ok(systemOf(second).includes(HELD.item) && systemOf(third).includes(HELD.item), `the open item was not carried while it was open:\n${lastOf(ran)}`)
  assert.ok(!systemOf(fourth).includes(HELD.item), `a stale copy of the closed item stayed in the system prompt: ${systemOf(fourth).slice(-2000)}`)
  for (const request of ran.requests) assert.ok(!messagesOf(request).includes(STANDING_HEADING), `request ${String(request.number)} kept the crew state in the conversation: ${messagesOf(request).slice(-2000)}`)
})

// Not vacuous: the member granted the work records the item first, and its own next request carries it.
test('#984: a member the table grants no work is handed no crew state on any request, though the crew holds an item', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectGranting(t, THE_OTHER_MEMBER.role)
  const granted = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: THE_OTHER_MEMBER.name,
    owner_turn: OWNER_TURN,
    requests: 2,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) => (number === 1 ? ADD : END),
  })
  assert.equal(granted.exit_code, 0, lastOf(granted))
  assert.ok(systemOf(granted.requests[1]).includes(HELD.item), `the granted member was not handed the item it recorded:\n${lastOf(granted)}`)
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: THE_MEMBER.name,
    owner_turn: OWNER_TURN,
    requests: 1,
    silence_ms: HOST_SILENCE_MS,
    script: () => END,
  })
  assert.equal(ran.exit_code, 0, lastOf(ran))
  assert.ok(ran.requests.length > 0, lastOf(ran))
  for (const request of ran.requests) assert.ok(!systemOf(request).includes(HELD.item), `request ${String(request.number)} carried crew state to a member granted no work: ${systemOf(request).slice(-2000)}`)
})
