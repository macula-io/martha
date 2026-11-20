// The environment a Claude Code member is handed holds no variable kitty sets for the programs it starts (#572 T6,
// #547 S6), so a member opened in a kitty tab cannot find that kitty's remote-control line or window.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { KITTY_VARIABLE_PREFIX } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'
import { PLUGIN_DIRS_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { theDroppedPluginsLines, theEnvironmentAMemberIsGiven } from './the_environment_a_member_is_given.ts'

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

/** A member's environment built from `inherited`, the rest of the asking held still. */
const theEnvironmentFrom = (inherited: Readonly<Record<string, string>>) =>
  theEnvironmentAMemberIsGiven({
    inherited,
    switches: { args: [], env: {}, env_dropped: [] },
    crew: { state_root: '/state/martha', rows: '/state/martha/c/r' },
    member_config: '/state/martha/members/Vesta',
    host: CLAUDE_CODE,
  })

test('#511 (#601 row 72): a member is not handed the plugin folders the launcher\'s shell names, and the owner is told so in one line', () => {
  const inherited = { HOME: '/srv/owner', [PLUGIN_DIRS_VARIABLE]: '/srv/owner/crew-code/plugins' }
  const env = theEnvironmentFrom(inherited)
  assert.equal(Object.hasOwn(env, PLUGIN_DIRS_VARIABLE), false)
  assert.equal(env['HOME'], '/srv/owner')
  const lines = theDroppedPluginsLines('Vesta', inherited)
  assert.equal(lines.length, 1)
  assert.ok(lines[0]!.startsWith(`Vesta is not handed ${PLUGIN_DIRS_VARIABLE} `), lines[0]!)
})

test('#511: with no plugin folder named, or a blank one, nothing is said', () => {
  assert.deepEqual(theDroppedPluginsLines('Vesta', { HOME: '/srv/owner' }), [])
  assert.deepEqual(theDroppedPluginsLines('Vesta', { [PLUGIN_DIRS_VARIABLE]: '  ' }), [])
})
