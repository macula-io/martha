// The environment a Claude Code member is handed holds no variable kitty sets for the programs it starts (#572 T6,
// #547 S6), so a member opened in a kitty tab cannot find that kitty's remote-control line or window. And it holds the
// one credential its billing picks, never both (martha#916). Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { API_KEY_ANSWERS_KEY, API_KEY_VARIABLE, apiKeyAnsweredYes, HOST_TRUST_RECORD_FILE, SIGN_IN_QUESTION_ARGS } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { CLAUDE_CODE_SIGN_IN_STORE_VARIABLE } from '../claude_code_host/recorded_claude_code_host.ts'
import { BILLED_BY_API_KEY, BILLED_BY_SUBSCRIPTION, type Billing } from '../declare_crew/declare_crew.ts'
import { SIGNED_IN_ANSWER } from '../drive_the_recorded_host/host_stand_in.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { CONFIG_DIR_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { KITTY_VARIABLE_PREFIX } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { giveAMemberItsStart, theBillingOfALaunch, theEnvironmentAMemberIsGiven, type TheBillingOfALaunch } from './the_environment_a_member_is_given.ts'

test('K3: a member is handed none of KITTY_LISTEN_ON, KITTY_WINDOW_ID, KITTY_PID and KITTY_PUBLIC_KEY, and keeps the rest', () => {
  const inherited = { HOME: '/srv/owner', TERM: 'xterm-kitty', KITTY_LISTEN_ON: 'fd:5', KITTY_WINDOW_ID: '3', KITTY_PID: '9', KITTY_PUBLIC_KEY: '1:abc' }
  const env = theEnvironmentAMemberIsGiven({
    inherited,
    switches: { args: [], env: {}, env_dropped: [] },
    crew: { state_root: '/state/martha', rows: '/state/martha/c/r' },
    member_config: '/state/martha/members/Vesta',
    host: CLAUDE_CODE,
    billing: BILLED_BY_SUBSCRIPTION,
  })
  assert.deepEqual(Object.keys(env).filter((name) => name.startsWith(KITTY_VARIABLE_PREFIX)), [])
  assert.equal(env['HOME'], '/srv/owner')
  assert.equal(env['TERM'], 'xterm-kitty')
})

/** A start of a member in a folder of the test's own, removed after it, under `billing`, with `inherited` over a home. */
function aStart(
  t: TestContext,
  billing: Billing,
  inherited: Readonly<Record<string, string>>,
): { readonly started: Record<string, string> | string; readonly record: () => Record<string, unknown>; readonly member_config: string } {
  const dir = mkdtempSync(join(tmpdir(), 'martha-916-'))
  t.after(() => removeTheTree(dir))
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  const member_config = join(dir, 'the-members-config')
  const started = giveAMemberItsStart({
    inherited: { HOME: '/srv/owner', ...inherited },
    switches: { args: [], env: {}, env_dropped: [] },
    crew: { state_root: join(dir, 'state'), rows: join(dir, 'state', 'its-rows') },
    member_config,
    host: CLAUDE_CODE,
    billing,
    checkout,
    skills: {},
  })
  return { started, member_config, record: () => JSON.parse(readFileSync(join(member_config, HOST_TRUST_RECORD_FILE), 'utf8')) as Record<string, unknown> }
}

/** A key the launcher's environment carries in these tests: no real key, and no constant's value. */
const A_LAUNCHERS_KEY = 'a-key-the-owners-shell-carries-916'

test('martha#916: a member billed by the subscription starts with no API key though its launcher carries one, and its host record answers none', (t) => {
  const start = aStart(t, BILLED_BY_SUBSCRIPTION, { [API_KEY_VARIABLE]: A_LAUNCHERS_KEY })
  assert.notEqual(typeof start.started, 'string', `the start was refused: ${String(start.started)}`)
  const env = start.started as Record<string, string>
  assert.equal(env[CONFIG_DIR_VARIABLE], start.member_config, "the member's own config folder is handed over")
  assert.equal(env[CLAUDE_CODE_SIGN_IN_STORE_VARIABLE], '', "the owner's sign-in store is handed over")
  assert.ok(!(API_KEY_VARIABLE in env), `the member's environment holds ${API_KEY_VARIABLE}`)
  assert.ok(!(API_KEY_ANSWERS_KEY in start.record()), `the member's host record answers a key: ${API_KEY_ANSWERS_KEY}`)
})

test("martha#916: a member billed by the key starts with the launcher's key and no sign-in store, an inherited one too, and its host record answers that key yes", (t) => {
  const start = aStart(t, BILLED_BY_API_KEY, { [API_KEY_VARIABLE]: A_LAUNCHERS_KEY, [CLAUDE_CODE_SIGN_IN_STORE_VARIABLE]: '' })
  assert.notEqual(typeof start.started, 'string', `the start was refused: ${String(start.started)}`)
  const env = start.started as Record<string, string>
  assert.equal(env[CONFIG_DIR_VARIABLE], start.member_config, "the member's own config folder is handed over")
  assert.equal(env[API_KEY_VARIABLE], A_LAUNCHERS_KEY, "the launcher's key is handed over")
  assert.ok(!(CLAUDE_CODE_SIGN_IN_STORE_VARIABLE in env), `the member's environment holds ${CLAUDE_CODE_SIGN_IN_STORE_VARIABLE}`)
  assert.deepEqual(start.record()[API_KEY_ANSWERS_KEY], apiKeyAnsweredYes(A_LAUNCHERS_KEY))
})

test('martha#916: a member billed by the key whose launcher carries none is refused by name, and nothing of it is made', (t) => {
  for (const inherited of [{}, { [API_KEY_VARIABLE]: '' }]) {
    const start = aStart(t, BILLED_BY_API_KEY, inherited)
    assert.equal(typeof start.started, 'string')
    assert.match(String(start.started), new RegExp(`${BILLED_BY_API_KEY}.*${API_KEY_VARIABLE}`))
    assert.ok(!existsSync(start.member_config), "the member's config folder was made")
  }
})

/** What the stand-in host prints on the sign-in question for an owner who is not signed in, in the shape 2.1.329 prints. */
const NOT_SIGNED_IN_ANSWER = JSON.stringify({ loggedIn: false, authMethod: 'none' })

/** A signed-in answer by a method that is not the subscription's, as a later host may add one: never "not signed in". */
const A_SIGN_IN_BY_ANOTHER_METHOD = JSON.stringify({ loggedIn: true, authMethod: 'a-method-this-test-made-up' })

/** A stand-in host in a folder of the test's own that answers the sign-in question with `lines`, and the launch's billing asked of it. */
async function billedBy(
  t: TestContext,
  lines: readonly string[],
  inherited: Readonly<Record<string, string>>,
  declared: Billing | null = null,
): Promise<{ readonly billed: TheBillingOfALaunch; readonly saw: () => string }> {
  const dir = mkdtempSync(join(tmpdir(), 'martha-916-host-'))
  t.after(() => removeTheTree(dir))
  const host = join(dir, 'a-host')
  const saw = join(dir, 'saw')
  const sees = `printf '%s|%s|%s|%s|%s\\n' "$*" "\${${API_KEY_VARIABLE}-unset}" "\${${CLAUDE_CODE_SIGN_IN_STORE_VARIABLE}-unset}" "$${CONFIG_DIR_VARIABLE}" "$PWD" > '${saw}'`
  writeFileSync(host, ['#!/bin/sh', sees, ...lines, ''].join('\n'), { mode: 0o700 })
  const billed = await theBillingOfALaunch({ declared, inherited: { PATH: process.env.PATH ?? '', ...inherited }, command: host, cwd: dir })
  return { billed, saw: () => (existsSync(saw) ? readFileSync(saw, 'utf8') : '') }
}

test("martha#916: with no billing declared, the host is asked whether the owner is signed in, without the key and with the sign-in store, and a signed-in owner's member is billed by the subscription", async (t) => {
  const asked = await billedBy(t, [`printf '%s' '${SIGNED_IN_ANSWER}'`], { [API_KEY_VARIABLE]: A_LAUNCHERS_KEY })
  assert.equal(asked.billed.billing, BILLED_BY_SUBSCRIPTION)
  const [args, key, store, folder, ran_in] = asked.saw().trim().split('|')
  assert.equal(args, SIGN_IN_QUESTION_ARGS.join(' '))
  assert.equal(key, 'unset', 'the key reached the sign-in question')
  assert.equal(store, '', 'the sign-in store was not handed to the sign-in question')
  assert.ok(folder !== undefined && folder !== '' && !existsSync(folder), "the question's own config folder is left behind")
  assert.equal(ran_in, folder, 'the sign-in question ran in the checkout, not in its own folder')
  assert.equal(asked.billed.told, undefined, "the usual start is told")
})

test("martha#916: with no billing and no sign-in, the member is billed by the launcher's key, and by the subscription when it carries none", async (t) => {
  // As the host answers it in a fresh home: the answer, and exit 1 (seen in CI, PR 920).
  const notSignedIn = [`printf '%s' '${NOT_SIGNED_IN_ANSWER}'`, 'exit 1']
  const byKey = await billedBy(t, notSignedIn, { [API_KEY_VARIABLE]: A_LAUNCHERS_KEY })
  assert.equal(byKey.billed.billing, BILLED_BY_API_KEY)
  assert.match(byKey.billed.told ?? '', new RegExp(`not signed in, so the member is billed by ${BILLED_BY_API_KEY}`))
  assert.equal((await billedBy(t, notSignedIn, {})).billed.billing, BILLED_BY_SUBSCRIPTION)
})

test('martha#916: a sign-in the host cannot tell (an exit that is not 0, an answer that is not JSON or says nothing of loggedIn, a host that is not there) bills the member by the subscription, and the owner is told why', async (t) => {
  const withKey = { [API_KEY_VARIABLE]: A_LAUNCHERS_KEY }
  // A signed-in answer on an exit that is not 0 is no answer either: only "not signed in" is read from one.
  for (const lines of [['exit 3'], [`printf 'not json'`], [`printf '%s' '${JSON.stringify({ authMethod: 'none' })}'`], [`printf '%s' '${SIGNED_IN_ANSWER}'`, 'exit 1'], [`printf '%s' '${A_SIGN_IN_BY_ANOTHER_METHOD}'`]]) {
    const asked = await billedBy(t, lines, withKey)
    assert.equal(asked.billed.billing, BILLED_BY_SUBSCRIPTION, lines.join(' '))
    assert.match(asked.billed.told ?? '', /could not say/)
  }
  const missing = await theBillingOfALaunch({ declared: null, inherited: { PATH: '', ...withKey }, command: 'a-host-that-is-not-there-916', cwd: tmpdir() })
  assert.equal(missing.billing, BILLED_BY_SUBSCRIPTION)
  assert.match(missing.told ?? '', /could not say/)
})

test('martha#916: a declared billing is never second-guessed: the host is not asked, and the owner is told nothing', async (t) => {
  for (const declared of [BILLED_BY_SUBSCRIPTION, BILLED_BY_API_KEY] as const) {
    const asked = await billedBy(t, [`printf '%s' '${SIGNED_IN_ANSWER}'`], { [API_KEY_VARIABLE]: A_LAUNCHERS_KEY }, declared)
    assert.deepEqual(asked.billed, { billing: declared, told: undefined })
    assert.equal(asked.saw(), '', 'the host was asked')
  }
})
