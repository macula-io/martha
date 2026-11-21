// On the recorded host, the member who assigns work is handed the crew's state with each prompted turn, and not again
// while it is unchanged (martha#984, gap 5 of martha#957, design r=2: issuecomment-7049814244).
//
// The real `martha` command, the real Claude Code at the recorded version, the real relay, mod and launcher; only the
// model is a stand-in (./drive_the_recorded_host.ts). It skips on RECORDED_HOST_SKIP: ci.yml's relay job runs it with
// the recorded host, as prove_the_relay_loads/recorded_host_runs.json lists.
//
// What only this test can prove: that the host takes the `context` the relay's prompt.submit hook passes on, and
// puts it into the turn's request. The system prompt is composed once per session on this host, so the state rides
// the turn, and a change made inside a turn reaches the member on its next one.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { RECORDED_HOST_SKIP, recordedHost } from '../check_every_recorded_host_test_is_run/recorded_host_skip.ts'
import { A_CASES_HOME } from '../../prove_the_core/a_test_run_ends/every_test_file_cleans_up.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, SOLO_MEMBERS } from '../declare_crew/declare_crew.ts'
import { STANDING_ADD, STANDING_HEADING } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { driveTheRecordedHost, firstRunDone, marthaOnATerminal, plainTextOf, type ModelRequest, type RecordedHostRan, type TheOwnersHands } from './drive_the_recorded_host.ts'
import { HOST_SILENCE_MS } from './wait_while_the_host_keeps_showing.ts'

/** The member whose tab the owner types in, and the other member of the solo crew `martha init` declares. */
const [THE_MEMBER, THE_OTHER_MEMBER] = SOLO_MEMBERS
const SETTINGS = JSON.stringify({ permissions: { defaultMode: 'default' } })
const GIT_NAME = 'martha-test'
const GIT_EMAIL = 'martha-test@example.invalid'
const OWNER_TURN = 'Note what is held, then stop.'
const NEXT_TURN = 'What stands now?'

/** The item the member records in turn 1: only the crew state handed with a later turn can carry its heading. */
const HELD = { kind: 'held', id: 'the-landing', item: 'the landing waits for the owner', reason: 'the owner reads it first', until: 'the owner says yes' }
const ADD = { tool: `mcp__martha__${STANDING_ADD}`, input: HELD }

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

const messagesOf = (request: ModelRequest | undefined): string => JSON.stringify(request?.body['messages'] ?? null)
const lastOf = (ran: RecordedHostRan): string => plainTextOf(ran.shown).slice(-3000)
const timesIn = (text: string, part: string): number => text.split(part).length - 1

/** Each reply names its request, so the owner's next turn is typed once the host has drawn the one before it. */
const REPLY = (number: number): { readonly text: string } => ({ text: `Reply ${String(number)} done.` })

/**
 * One drive of `turns` owner turns: the member records the item in turn 1, and the owner types the next turn once the
 * host has drawn the reply before it. Request 1 is the tool call, so turn n's reply is request n + 1.
 */
async function turnsAfterAnItem(project: Project, member: string, turns: readonly string[]): Promise<RecordedHostRan> {
  return await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member,
    owner_turn: OWNER_TURN,
    requests: turns.length + 2,
    silence_ms: HOST_SILENCE_MS,
    script: ({ number }) => (number === 1 ? ADD : REPLY(number)),
    atTheTerminal: async (hands: TheOwnersHands) => {
      for (const [at, turn] of turns.entries()) {
        const drawn = drawnWithoutGaps(REPLY(at + 2).text)
        await hands.until(`the host drawing ${drawn}`, () => drawnWithoutGaps(hands.shown()).includes(drawn))
        hands.type(`${turn}\r`)
      }
    },
  })
}

test("#984: an item recorded in one turn is handed with the owner's next turn, and never inside the turn it was recorded in", { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectGranting(t, THE_MEMBER.role)
  const ran = await turnsAfterAnItem(project, THE_MEMBER.name, [NEXT_TURN])
  assert.equal(ran.exit_code, 0, lastOf(ran))
  const next = ran.requests.filter((request) => messagesOf(request).includes(NEXT_TURN))
  assert.ok(next.length > 0, `the owner's next turn reached no request:\n${lastOf(ran)}`)
  for (const request of ran.requests.filter((one) => !next.includes(one))) {
    assert.ok(!messagesOf(request).includes(STANDING_HEADING), `request ${String(request.number)}, inside the turn the item was recorded in, was handed the crew state: ${messagesOf(request).slice(-2000)}`)
  }
  assert.ok(messagesOf(next[0]).includes(STANDING_HEADING) && messagesOf(next[0]).includes(HELD.item), `the owner's next turn was not handed the item: ${messagesOf(next[0]).slice(-2000)}\n${lastOf(ran)}`)
})

test('#984: a turn whose crew state did not change is handed no second copy', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectGranting(t, THE_MEMBER.role)
  const THIRD_TURN = 'Anything else?'
  const ran = await turnsAfterAnItem(project, THE_MEMBER.name, [NEXT_TURN, THIRD_TURN])
  assert.equal(ran.exit_code, 0, lastOf(ran))
  const third = ran.requests.filter((request) => messagesOf(request).includes(THIRD_TURN))
  assert.ok(third.length > 0, `the third turn reached no request:\n${lastOf(ran)}`)
  assert.equal(timesIn(messagesOf(third[0]), STANDING_HEADING), 1, `the unchanged crew state was handed again: ${messagesOf(third[0]).slice(-3000)}`)
})

// Not vacuous: the member granted the work records the item and is handed it on its next turn; the other is not.
test('#984: a member the table grants no work is handed no crew state, though the crew holds an item', { skip: RECORDED_HOST_SKIP }, async (t) => {
  const project = approvedProjectGranting(t, THE_OTHER_MEMBER.role)
  const granted = await turnsAfterAnItem(project, THE_OTHER_MEMBER.name, [NEXT_TURN])
  assert.equal(granted.exit_code, 0, lastOf(granted))
  assert.ok(granted.requests.some((request) => messagesOf(request).includes(NEXT_TURN) && messagesOf(request).includes(HELD.item)), `the granted member was not handed the item:\n${lastOf(granted)}`)
  const ran = await driveTheRecordedHost({
    claude: recordedHost(),
    ...project,
    member: THE_MEMBER.name,
    owner_turn: OWNER_TURN,
    requests: 1,
    silence_ms: HOST_SILENCE_MS,
    script: () => REPLY(1),
  })
  assert.equal(ran.exit_code, 0, lastOf(ran))
  assert.ok(ran.requests.length > 0, lastOf(ran))
  for (const request of ran.requests) assert.ok(!JSON.stringify(request.body).includes(HELD.item), `request ${String(request.number)} handed the crew state to a member granted no work`)
})
