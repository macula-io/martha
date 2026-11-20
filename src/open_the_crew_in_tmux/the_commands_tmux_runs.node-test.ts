// The words `martha up` and `martha attach` hand tmux (martha#932), each pinned word for word: Martha's own server and
// config, the exact targets, the commands that open a member's window and its strip, the refusals, and the
// environment the server starts with. Every expected value is spelt out here, never read from the constant it pins.

import assert from 'node:assert/strict'
import { THE_FIRST_PROMPT_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { test } from 'node:test'

import {
  THE_SERVERS_CONFIG,
  isBelow,
  onMarthasServer,
  outsideAnyTmux,
  theAttach,
  theSessionAsked,
  theSessionOpened,
  theStripSplit,
  thePaneOnMarthasServer,
  theTextTyped,
  theTmuxVersionIn,
  theTurnSent,
  theWindowClosed,
  theWindowOpened,
  theWindowsIn,
  theWindowsListed,
  whyNotAFirstPrompt,
  whyNotATarget,
  whyTmuxCannotOpen,
} from './the_commands_tmux_runs.ts'

const window = { id: 'widget-crew', root: '/srv/owner/widget', member: 'Vesta', martha: ['/usr/bin/node', '/opt/martha/bin/martha'] }

test('#932: every command is on Martha\'s own server, or a test\'s, with Martha\'s config, never the owner\'s default server', () => {
  assert.deepEqual(onMarthasServer('/state/a-config'), ['-L', 'martha', '-f', '/state/a-config'])
  assert.deepEqual(onMarthasServer('/state/a-config', 'a-tests-server'), ['-L', 'a-tests-server', '-f', '/state/a-config'])
})

test('#932: the config turns on extended keys, the clipboard, passthrough and windows that outlive their member', () => {
  const lines = THE_SERVERS_CONFIG.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
  assert.deepEqual(lines, [
    'set -g extended-keys on',
    "set -as terminal-features 'xterm*:extkeys'",
    'set -g set-clipboard on',
    'set -g allow-passthrough on',
    'set -g remain-on-exit on',
  ])
})

test('#932: a member\'s window and its strip are opened detached, at the root, with martha start and martha crew', () => {
  assert.deepEqual(theSessionOpened(window), ['new-session', '-d', '-s', 'widget-crew', '-n', 'Vesta', '-c', '/srv/owner/widget', '--', '/usr/bin/node', '/opt/martha/bin/martha', 'start', 'Vesta'])
  assert.deepEqual(theWindowOpened(window), ['new-window', '-d', '-t', '=widget-crew:', '-n', 'Vesta', '-c', '/srv/owner/widget', '--', '/usr/bin/node', '/opt/martha/bin/martha', 'start', 'Vesta'])
  assert.deepEqual(theStripSplit(window), ['split-window', '-d', '-v', '-l', '20%', '-t', '=widget-crew:=Vesta', '-c', '/srv/owner/widget', '--', '/usr/bin/node', '/opt/martha/bin/martha', 'crew'])
})

test('#932: the session and its windows are asked for, closed and attached by their whole names', () => {
  assert.deepEqual(theSessionAsked('widget-crew'), ['has-session', '-t', '=widget-crew'])
  assert.deepEqual(theWindowsListed('widget-crew'), ['list-windows', '-t', '=widget-crew', '-F', '#{P:#{?#{==:#{pane_index},0},#{pane_dead},}} #{window_name}'])
  assert.deepEqual(theWindowClosed('widget-crew', 'Vesta'), ['kill-window', '-t', '=widget-crew:=Vesta'])
  assert.deepEqual(theAttach('widget-crew', undefined), ['attach-session', '-t', '=widget-crew'])
  assert.deepEqual(theAttach('widget-crew', 'Ceres'), ['attach-session', '-t', '=widget-crew:=Ceres'])
})

test('#932: the windows listed are read by name, and a member that ended is told apart', () => {
  assert.deepEqual(theWindowsIn('0 Vesta\n1 Ceres\n0 a crew member\n'), [{ name: 'Vesta', ended: false }, { name: 'Ceres', ended: true }, { name: 'a crew member', ended: false }])
  assert.deepEqual(theWindowsIn(''), [])
})

test('#932: a name tmux would read as a pane or a window, or cannot hold, is refused; a plain one is not', () => {
  assert.equal(whyNotATarget('opus-1'), undefined)
  for (const name of ['a.b', 'a:b', 'a\nb', 'a\tb', ' a', 'a ', '']) assert.notEqual(whyNotATarget(name), undefined, name)
  // r=1: tmux expands a format in a session's and a window's name, and #(...) runs a shell: a # is refused.
  for (const name of ['crew#{pid}', 'crew#(true)', '#']) assert.match(whyNotATarget(name) ?? '', /#/, name)
})

test('#932: tmux\'s version is read from what tmux -V says, and 3.3 is the floor', () => {
  assert.equal(theTmuxVersionIn('tmux 3.8\n'), '3.8')
  assert.equal(theTmuxVersionIn('tmux 3.3a'), '3.3')
  assert.equal(theTmuxVersionIn('tmux next-3.6'), '3.6')
  assert.equal(theTmuxVersionIn('screen 4.9'), undefined)
  assert.equal(isBelow('3.2', '3.3'), true)
  assert.equal(isBelow('3.3', '3.3'), false)
  assert.equal(isBelow('3.10', '3.3'), false)
})

test('#932: tmux cannot open with no tmux, an old one, no id, or an id tmux cannot take; each refusal names its fix', () => {
  assert.match(whyTmuxCannotOpen(undefined, 'crew') ?? '', /tmux is not on your PATH/)
  assert.match(whyTmuxCannotOpen('tmux 3.2a', 'crew') ?? '', /needs tmux 3\.3 or newer, and this tmux is 3\.2/)
  assert.match(whyTmuxCannotOpen('tmux 3.8', null) ?? '', /names none\. Add "id"/)
  assert.match(whyTmuxCannotOpen('tmux 3.8', 'my.crew') ?? '', /holds a \. or a :/)
  assert.equal(whyTmuxCannotOpen('tmux 3.3', 'crew'), undefined)
})

test('#932: Martha\'s server starts with the owner\'s environment, minus a tmux it may run inside', () => {
  assert.deepEqual(outsideAnyTmux({ HOME: '/srv/owner', TMUX: '/tmp/tmux-1000/default,1,0', TMUX_PANE: '%3', TERM: 'xterm-kitty', GONE: undefined }), { HOME: '/srv/owner', TERM: 'xterm-kitty' })
})

test('#919: a member given a first prompt is started with it after --prompt, before any word for the host', () => {
  assert.deepEqual(theSessionOpened({ ...window, prompt: '-read the brief' }).slice(-5), ['/opt/martha/bin/martha', 'start', 'Vesta', THE_FIRST_PROMPT_SWITCH, '-read the brief'])
  assert.deepEqual(theWindowOpened({ ...window, prompt: 'go' }).slice(-4), ['start', 'Vesta', THE_FIRST_PROMPT_SWITCH, 'go'])
})

test('#919: the first prompt is typed as keys, each as written, into the member\'s own pane, then Enter ends the turn', () => {
  assert.deepEqual(theTextTyped('%7', '-v #{pid} Enter'), ['send-keys', '-t', '%7', '-l', '--', '-v #{pid} Enter'])
  assert.deepEqual(theTurnSent('%7'), ['send-keys', '-t', '%7', 'Enter'])
})

test('#919: a leading - is text; a leading / or !, a line break, a control character or nothing is refused by name', () => {
  assert.equal(whyNotAFirstPrompt('-read the brief'), undefined)
  assert.equal(whyNotAFirstPrompt('read the brief at docs/brief.md'), undefined)
  assert.match(whyNotAFirstPrompt('/hello') ?? '', /starts with \/, which the member would run as a slash command/)
  assert.match(whyNotAFirstPrompt('  /hello') ?? '', /slash command/)
  assert.match(whyNotAFirstPrompt('!git push origin main') ?? '', /starts with !, which the member would run as a shell command, not read as your words/)
  assert.match(whyNotAFirstPrompt(' !ls') ?? '', /shell command/)
  assert.equal(whyNotAFirstPrompt('read the brief!'), undefined)
  assert.match(whyNotAFirstPrompt('read\n/hello') ?? '', /line break/)
  assert.match(whyNotAFirstPrompt('read\u001b[2J') ?? '', /control character/)
  assert.match(whyNotAFirstPrompt('  ') ?? '', /empty/)
})

test('#919: the member\'s pane is known only in a window of Martha\'s own server', () => {
  assert.equal(thePaneOnMarthasServer({ TMUX: '/tmp/tmux-1000/martha,4242,0', TMUX_PANE: '%3' }), '%3')
  assert.equal(thePaneOnMarthasServer({ TMUX: '/tmp/tmux-1000/default,4242,0', TMUX_PANE: '%3' }), undefined)
  assert.equal(thePaneOnMarthasServer({ TMUX: '/tmp/tmux-1000/martha,4242,0' }), undefined)
  assert.equal(thePaneOnMarthasServer({ TMUX: '/tmp/tmux-1000/martha,4242,0', TMUX_PANE: '3' }), undefined)
  assert.equal(thePaneOnMarthasServer({}), undefined)
})
