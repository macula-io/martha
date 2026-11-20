// The environment a Claude Code member is handed holds no variable kitty sets for the programs it starts (#572 T6,
// #547 S6), so a member opened in a kitty tab cannot find that kitty's remote-control line or window. And it holds no
// API key, so a member handed the owner's subscription sign-in runs on it and never bills the API (martha#916).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { API_KEY_ANSWERS_KEY, API_KEY_VARIABLE, HOST_TRUST_RECORD_FILE } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { CONFIG_DIR_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { KITTY_VARIABLE_PREFIX } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { giveAMemberItsStart, theEnvironmentAMemberIsGiven } from './the_environment_a_member_is_given.ts'

test('K3: a member is handed none of KITTY_LISTEN_ON, KITTY_WINDOW_ID, KITTY_PID and KITTY_PUBLIC_KEY, and keeps the rest', () => {
  const inherited = { HOME: '/srv/owner', TERM: 'xterm-kitty', KITTY_LISTEN_ON: 'fd:5', KITTY_WINDOW_ID: '3', KITTY_PID: '9', KITTY_PUBLIC_KEY: '1:abc' }
  const env = theEnvironmentAMemberIsGiven({
    inherited,
    switches: { args: [], env: {}, env_dropped: [] },
    crew: { state_root: '/state/martha', rows: '/state/martha/c/r' },
    member_config: '/state/martha/members/Vesta',
    host: CLAUDE_CODE,
  })
  assert.deepEqual(Object.keys(env).filter((name) => name.startsWith(KITTY_VARIABLE_PREFIX)), [])
  assert.equal(env['HOME'], '/srv/owner')
  assert.equal(env['TERM'], 'xterm-kitty')
})

test("martha#916: a member handed the owner's sign-in starts with no API key though its launcher carries one, and its host record answers none", (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-916-'))
  t.after(() => removeTheTree(dir))
  const checkout = join(dir, 'checkout')
  mkdirSync(checkout)
  const member_config = join(dir, 'the-members-config')
  const started = giveAMemberItsStart({
    inherited: { HOME: '/srv/owner', [API_KEY_VARIABLE]: 'a-key-the-owners-shell-carries-916' },
    switches: { args: [], env: {}, env_dropped: [] },
    crew: { state_root: join(dir, 'state'), rows: join(dir, 'state', 'its-rows') },
    member_config,
    host: CLAUDE_CODE,
    checkout,
    skills: {},
  })
  assert.notEqual(typeof started, 'string', `the start was refused: ${String(started)}`)
  const env = started as Record<string, string>
  assert.equal(env[CONFIG_DIR_VARIABLE], member_config, "the member's own config folder is handed over")
  assert.ok(!(API_KEY_VARIABLE in env), `the member's environment holds ${API_KEY_VARIABLE}`)
  const record = JSON.parse(readFileSync(join(member_config, HOST_TRUST_RECORD_FILE), 'utf8')) as Record<string, unknown>
  assert.ok(!(API_KEY_ANSWERS_KEY in record), `the member's host record answers a key: ${API_KEY_ANSWERS_KEY}`)
})
