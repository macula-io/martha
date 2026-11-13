// What the host says about the owner's screen, and which of its events opens and closes a dialog (martha#313).
//
// What is pinned here is the pairing, not the row: the row is ../tell_the_owner_a_session_waits's and the bell is
// ../ring_the_owner's. A permission is keyed by the call the host checked before it asked; the call's own answer, and
// nothing the host says earlier, closes exactly the dialogs that call raised; a menu is the host's own call, open from
// its posting until its answer; an elicitation with no id closes on the oldest one its server has open; and a turn's
// start drops whatever a dialog left behind.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theKeyOf } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import {
  MENU_TOOL,
  NOTHING_IS_ASKED,
  theAsksAfter,
  type ACallTheHostMade,
  type WhatTheHostIsAsking,
  type WhatTheHostSaid,
} from './say_what_the_host_is_asking.ts'

const AT = 1000

/** The state and the events one thing the host said leaves. */
function said(held: WhatTheHostIsAsking, it: WhatTheHostSaid, at = AT): { readonly state: WhatTheHostIsAsking; readonly keys: readonly string[] } {
  const left = theAsksAfter(held, it, at)
  return {
    state: left.state,
    keys: left.events.flatMap((event) => (event.change === 'closed' ? [event.key] : event.change === 'opened' ? [theKeyOf(event.raised)] : ['turn-started'])),
  }
}

/** A call the host checked, and then asked about. */
const aCall = (id: string, input: unknown = { command: 'rm -rf build' }, tool = CLAUDE_CODE_SHELL_TOOL, agent?: string): ACallTheHostMade => ({
  id,
  tool,
  input,
  ...(agent === undefined ? {} : { agent }),
})

test('a permission is keyed by the call the host checked before it asked, and the call\'s answer closes that one', () => {
  const checked = said(NOTHING_IS_ASKED, { said: 'checked', call: aCall('toolu_1') })
  const asked = said(checked.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  assert.deepEqual(asked.keys, ['permission:toolu_1'], 'the dialog carries the id of the call the host checked')
  assert.deepEqual(asked.state.checks.map((check) => check.id), ['toolu_1'])
  const answered = said(asked.state, { said: 'answered', call: aCall('toolu_1') }, AT + 1)
  assert.deepEqual(answered.keys, ['permission:toolu_1'], 'the call is answered, and the dialog it asked about closes')
  assert.deepEqual(answered.state.dialogs, [])
})

test('two identical calls in flight are two dialogs, and the one answered closes only its own (Pluto\'s point 3)', () => {
  const one = said(NOTHING_IS_ASKED, { said: 'checked', call: aCall('toolu_a') })
  const two = said(one.state, { said: 'checked', call: aCall('toolu_b') })
  const askedOne = said(two.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  const askedTwo = said(askedOne.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  assert.deepEqual(askedTwo.keys, ['permission:toolu_b'], 'the second ask is its own dialog, not the first one again')
  assert.equal(askedTwo.state.dialogs.length, 2)
  const answered = said(askedTwo.state, { said: 'answered', call: aCall('toolu_a') }, AT + 1)
  assert.deepEqual(answered.keys, ['permission:toolu_a'])
  assert.deepEqual(answered.state.dialogs.map((dialog) => dialog.key), ['permission:toolu_b'], 'the other call is still being asked about')
})

test('a host that checked no call leaves the dialog keyed by what asked, and the call that answers still closes it', () => {
  const asked = said(NOTHING_IS_ASKED, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  assert.equal(asked.keys.length, 1)
  assert.ok(asked.keys[0]?.startsWith('permission:'), 'the fallback key is what asked')
  const answered = said(asked.state, { said: 'answered', call: aCall('toolu_1') }, AT + 1)
  assert.deepEqual(answered.keys, asked.keys, 'the call that answered is the one the owner allowed')
  assert.deepEqual(answered.state.dialogs, [])
})

test('a call of another tool does not close a permission dialog it did not raise', () => {
  const asked = said(NOTHING_IS_ASKED, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  const other = said(asked.state, { said: 'answered', call: aCall('toolu_9', { file_path: '/tmp/x' }, 'Read') }, AT + 1)
  assert.deepEqual(other.keys, [])
  assert.equal(other.state.dialogs.length, 1)
})

test('a call of the same tool and another input does not close a permission keyed by what asked (r=3 M5)', () => {
  const asked = said(NOTHING_IS_ASKED, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  const other = said(asked.state, { said: 'answered', call: aCall('toolu_2', { command: 'ls' }) }, AT + 1)
  assert.deepEqual(other.keys, [], 'the owner was asked about one command, and another command is not it')
  assert.equal(other.state.dialogs.length, 1)
  const same = said(other.state, { said: 'answered', call: aCall('toolu_3') }, AT + 2)
  assert.deepEqual(same.keys, asked.keys, 'the call whose input is the input that was asked about is the one that closes it')
  assert.deepEqual(same.state.dialogs, [])
})

test('a call by another agent does not close a permission keyed by what asked (r=3 M4)', () => {
  const asked = said(NOTHING_IS_ASKED, {
    said: 'permission',
    call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' }, agent: 'the-first-agent' },
  })
  const other = said(asked.state, { said: 'answered', call: aCall('toolu_4', undefined, CLAUDE_CODE_SHELL_TOOL, 'the-second-agent') }, AT + 1)
  assert.deepEqual(other.keys, [], 'another agent running the same command is not the call the owner was asked about')
  assert.equal(other.state.dialogs.length, 1)
  const same = said(other.state, { said: 'answered', call: aCall('toolu_5', undefined, CLAUDE_CODE_SHELL_TOOL, 'the-first-agent') }, AT + 2)
  assert.deepEqual(same.keys, asked.keys, 'the agent that asked is the agent whose answer closes it')
  assert.deepEqual(same.state.dialogs, [])
})

test('an answered call leaves no check pending, so the next identical ask takes the next call\'s id (r=3 M8)', () => {
  const first = said(NOTHING_IS_ASKED, { said: 'checked', call: aCall('toolu_a') })
  const asked = said(first.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  assert.deepEqual(asked.keys, ['permission:toolu_a'], 'the ask takes the one check pending')
  const answered = said(asked.state, { said: 'answered', call: aCall('toolu_a') }, AT + 1)
  assert.deepEqual(answered.state.checks, [], 'the check went with the call it belonged to')
  const again = said(answered.state, { said: 'checked', call: aCall('toolu_b') })
  const askedAgain = said(again.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  assert.deepEqual(askedAgain.keys, ['permission:toolu_b'], 'a second identical ask takes the check still pending, never the one a call already answered')
  const closes = said(askedAgain.state, { said: 'answered', call: aCall('toolu_b') }, AT + 2)
  assert.deepEqual(closes.keys, ['permission:toolu_b'], 'and its own call\'s answer closes it')
  assert.deepEqual(closes.state.dialogs, [])
})

test('a menu is the host\'s own call: open while it runs, closed when the host answers it', () => {
  const checked = said(NOTHING_IS_ASKED, { said: 'checked', call: aCall('toolu_q', { questions: [] }, MENU_TOOL) })
  const ran = said(checked.state, { said: 'ran', call: aCall('toolu_q', { questions: [] }, MENU_TOOL) })
  assert.deepEqual(ran.keys, [`menu:toolu_q`], 'the menu opens when its call runs')
  const answered = said(ran.state, { said: 'answered', call: aCall('toolu_q', { questions: [] }, MENU_TOOL) }, AT + 1)
  assert.deepEqual(answered.keys, [`menu:toolu_q`])
  assert.deepEqual(answered.state.dialogs, [])
})

test('a call the host named no id for closes a menu only when it is the menu tool\'s own answer (r=3 R1)', () => {
  const ran = said(NOTHING_IS_ASKED, { said: 'ran', call: aCall('toolu_q', { questions: [] }, MENU_TOOL) })
  // Every answer reaches the close now, and a call of any other tool carries no id when the host named none: it says
  // nothing about the menu the owner is still looking at.
  const other = said(ran.state, { said: 'answered', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'ls' } } }, AT + 1)
  assert.deepEqual(other.keys, [], 'a Bash call the host named no id for is not the menu\'s answer')
  assert.equal(other.state.dialogs.length, 1)
  const answered = said(other.state, { said: 'answered', call: { tool: MENU_TOOL, input: { questions: [] } } }, AT + 2)
  assert.deepEqual(answered.keys, [`menu:toolu_q`], 'the menu tool\'s own answer, with no id, closes the oldest menu open')
  assert.deepEqual(answered.state.dialogs, [])
})

test('a call the host posts closes nothing, because on this host it is posted before the owner is asked (r=2 R1)', () => {
  const checked = said(NOTHING_IS_ASKED, { said: 'checked', call: aCall('toolu_1') })
  const asked = said(checked.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  // The host's real order is tool.call, then tool.check, then PermissionRequest: a posted call that closed a dialog
  // would close it before it existed, and the dialog an owner then sees would never be closed by it.
  const posted = said(asked.state, { said: 'ran', call: aCall('toolu_1') }, AT + 1)
  assert.deepEqual(posted.keys, [], 'a call posted says nothing about the dialog it raises')
  assert.equal(posted.state.dialogs.length, 1)
})

test('an elicitation named by its id closes on that id, and one named by nothing closes the oldest its server has open', () => {
  const first = said(NOTHING_IS_ASKED, { said: 'elicitation', server: 'a-server', question: 'which file?' })
  const second = said(first.state, { said: 'elicitation', server: 'a-server', question: 'and then?' })
  assert.deepEqual(second.keys, [second.keys[0] ?? ''], 'each ask is its own dialog')
  const closed = said(second.state, { said: 'elicitation-answered', server: 'a-server' }, AT + 1)
  assert.deepEqual(closed.keys, first.keys, 'the first one asked is the first one answered')
  assert.equal(closed.state.dialogs.length, 1)
  const byId = said(NOTHING_IS_ASKED, { said: 'elicitation', server: 'a-server', question: 'which file?', id: 'e-7' })
  assert.deepEqual(byId.keys, ['elicitation:e-7'])
  const closedById = said(byId.state, { said: 'elicitation-answered', server: 'a-server', id: 'e-7' }, AT + 1)
  assert.deepEqual(closedById.keys, ['elicitation:e-7'])
})

test('a notification the owner is not told of changes nothing, and one that is the owner\'s opens a dialog', () => {
  const idle = said(NOTHING_IS_ASKED, { said: 'notification', type: 'idle_prompt', message: 'Claude is waiting' })
  assert.deepEqual(idle.keys, [])
  const theOwners = said(NOTHING_IS_ASKED, { said: 'notification', type: 'agent_needs_input', message: 'An agent needs you' })
  assert.equal(theOwners.keys.length, 1)
  assert.equal(theOwners.state.dialogs[0]?.kind, 'notification')
})

test('a turn\'s start drops every dialog and every check an earlier turn left (test 3)', () => {
  const checked = said(NOTHING_IS_ASKED, { said: 'checked', call: aCall('toolu_1') })
  const asked = said(checked.state, { said: 'permission', call: { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } } })
  const started = said(asked.state, { said: 'turn-started' }, AT + 1)
  assert.deepEqual(started.keys, ['turn-started'])
  assert.deepEqual(started.state, NOTHING_IS_ASKED)
})

test('the same ask twice is one dialog, and the same words twice are one notification', () => {
  const one = said(NOTHING_IS_ASKED, { said: 'elicitation', server: 'a-server', question: 'which file?', id: 'e-7' })
  const twice = said(one.state, { said: 'elicitation', server: 'a-server', question: 'which file?', id: 'e-7' }, AT + 1)
  assert.deepEqual(twice.keys, [], 'nothing new is opened')
  assert.equal(twice.state.dialogs.length, 1)
})
