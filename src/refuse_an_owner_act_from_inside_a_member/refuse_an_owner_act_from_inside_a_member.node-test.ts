// `martha answer` is refused inside a member, by the member's own environment or by its host above the act, and every
// other owner's act goes ahead there (martha#619, cut to one act at martha#601). The decision only: the CLI's own
// tests drive it through bin/martha under `script`.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { MEMBER_CONFIG_FOLDER } from '../give_a_member_its_own_config/give_a_member_its_own_config.ts'
import { CONFIG_DIR_VARIABLE } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { RESTART, STOP } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { isStillRefusedFromInsideAMember, NOT_A_WALL, whyAnOwnersActIsRefusedInsideAMember, type WhereAnOwnersActRuns } from './refuse_an_owner_act_from_inside_a_member.ts'

const HOST: MemberLaunch = { member_name: 'builder', node_id: 'ab'.repeat(32), pid: 4242, process_started_at: 'a-boot:777' }
const marks = { relay_socket_variable: RELAY_SOCKET_VARIABLE, config_dir_variable: CONFIG_DIR_VARIABLE, member_config_folder: MEMBER_CONFIG_FOLDER }
const where = (more: Partial<WhereAnOwnersActRuns>): WhereAnOwnersActRuns => ({ act: 'answer', env: {}, ancestors: [], launches: [HOST], member_marks: marks, ...more })

test('#619: nothing a member leaves is seen, and the act is not refused: the owner at their own terminal', () => {
  assert.equal(whyAnOwnersActIsRefusedInsideAMember(where({ ancestors: [{ pid: 10, identity: 'a-boot:1' }, { pid: 1, identity: 'a-boot:0' }] })), undefined)
  // An empty socket variable names no socket, and a config folder of another name is the owner's own.
  assert.equal(whyAnOwnersActIsRefusedInsideAMember(where({ env: { [RELAY_SOCKET_VARIABLE]: '', [CONFIG_DIR_VARIABLE]: join('/an-owners-home', 'an-owners-own-config') } })), undefined)
})

test("#619: the member's host above the act refuses it, by pid and start time both, wherever it is above (mutant: the identity not compared)", () => {
  for (const ancestors of [[{ pid: HOST.pid, identity: HOST.process_started_at }], [{ pid: 10, identity: 'a-boot:1' }, { pid: HOST.pid, identity: HOST.process_started_at }]]) {
    const refusal = whyAnOwnersActIsRefusedInsideAMember(where({ ancestors }))
    assert.ok(refusal?.includes("inside builder's session") && refusal.endsWith(NOT_A_WALL), String(refusal))
  }
  // The same pid, another process: reused, or one the kernel would not show.
  assert.equal(whyAnOwnersActIsRefusedInsideAMember(where({ ancestors: [{ pid: HOST.pid, identity: 'another-boot:777' }] })), undefined)
  assert.equal(whyAnOwnersActIsRefusedInsideAMember(where({ ancestors: [{ pid: HOST.pid, identity: null }] })), undefined)
})

test("#619: a member's relay socket, or its own config folder, in the environment refuses the act, naming the variable", () => {
  const socket = whyAnOwnersActIsRefusedInsideAMember(where({ env: { [RELAY_SOCKET_VARIABLE]: '/run/a-socket' } }))
  assert.ok(socket?.includes(RELAY_SOCKET_VARIABLE) && socket.endsWith(NOT_A_WALL), String(socket))
  const folder = whyAnOwnersActIsRefusedInsideAMember(where({ env: { [CONFIG_DIR_VARIABLE]: join('/state', 'snapshots', 'launch-1', MEMBER_CONFIG_FOLDER) } }))
  assert.ok(folder?.includes(CONFIG_DIR_VARIABLE) && folder.endsWith(NOT_A_WALL), String(folder))
})

test('#601: only answering the owner ask is still refused; every other owner act goes ahead inside a member', () => {
  assert.equal(isStillRefusedFromInsideAMember('answer'), true)
  // The whole of what a member leaves: the socket, its own config folder, and its host above the act, all at once.
  const inside = { env: { [RELAY_SOCKET_VARIABLE]: '/run/a-socket', [CONFIG_DIR_VARIABLE]: join('/state', 'snapshots', 'launch-1', MEMBER_CONFIG_FOLDER) }, ancestors: [{ pid: HOST.pid, identity: HOST.process_started_at }] }
  for (const act of ['approve', 'release', 'start', 'bells', 'pin-key', 'keep-shapes', THE_WHOLE_CREW, STOP, RESTART, 'week']) {
    assert.equal(isStillRefusedFromInsideAMember(act), false, act)
    assert.equal(whyAnOwnersActIsRefusedInsideAMember(where({ ...inside, act })), undefined, act)
  }
})
