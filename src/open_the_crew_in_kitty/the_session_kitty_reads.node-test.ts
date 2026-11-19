// What bare `martha start` hands kitty (#547 S6): the session text exactly (K1), read back through kitty's own parser
// with a root holding a space and a `$`; the checker run through kitty's own authorizer (K2); kitty's arguments (K4);
// and the refusals (K5). The two reads through kitty run where kitty is installed, and are skipped by name elsewhere.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CHECKER_FILE, SESSION_FILE } from './open_the_crew_in_kitty.ts'
import {
  KITTY_FLOOR,
  KITTY_VARIABLE_PREFIX,
  THE_STRIPS_ACTIONS,
  THE_STRIPS_FIRST_SHARE,
  TAB_OF,
  THE_ACTS_A_TAB_RUNS,
  KITTY,
  asLaunchArgument,
  asLaunchOption,
  asLineRest,
  isBelow,
  shlexQuoted,
  theCheckerSource,
  theKittyArguments,
  theKittyVersionIn,
  theSessionText,
  whyKittyCannotOpen,
  withoutKittysVariables,
  type TheCrewsTabs,
} from './the_session_kitty_reads.ts'

const MARTHA = ['/usr/bin/node', '/opt/martha release/bin/martha']
const TABS: TheCrewsTabs = { root: '/srv/owner/a root $HOME', members: ['Vesta', 'Uranus'], martha: MARTHA, checker: `/state/my $dir/${CHECKER_FILE}` }

/** The text of one tab, written out by hand for K1: no function of the module builds what it is compared with. */
function aTabByHand(member: string): string {
  return [
    `new_tab ${member}`,
    'layout splits',
    'cd /srv/owner/a root $$HOME',
    `launch --hold --title ${member} -- /usr/bin/node '/opt/martha release/bin/martha' start ${member}`,
    'focus',
    `launch --location=hsplit --bias=${THE_STRIPS_FIRST_SHARE} --allow-remote-control --remote-control-password '!' --remote-control-password '"" '"'"'/state/my $$dir/${CHECKER_FILE}'"'"'' -- /usr/bin/node '/opt/martha release/bin/martha' crew --tab-of ${member}`,
  ].join('\n')
}

test('K1: the session is exactly one tab per member, the member held at the root, then focus, then its strip', () => {
  const session = theSessionText(TABS)
  assert.ok('text' in session)
  assert.equal(session.text, `${aTabByHand('Vesta')}\n${aTabByHand('Uranus')}\n`)
})

test('K1: a value that would start a line of its own, or lose white space, is refused by name and nothing is written', () => {
  for (const root of ['/srv/owner/a\nlaunch evil', '/srv/owner/a\rb', '/srv/owner/nul\0', ' /srv/owner/lead', '/srv/owner/trail ']) {
    const session = theSessionText({ ...TABS, root })
    assert.ok('refusal' in session, JSON.stringify(root))
    assert.match(session.refusal, new RegExp(JSON.stringify(root).replaceAll(/[\\^$.*+?()[\]{}|]/g, '\\$&')))
  }
})

test('each place writes a value as kitty reads it there', () => {
  assert.equal(asLineRest('a $b ${c} $$'), 'a $$b $${c} $$$$')
  assert.equal(asLaunchArgument('it\'s $x'), `'it'"'"'s $x'`)
  assert.equal(asLaunchOption('it\'s $x'), `'it'"'"'s $$x'`)
  assert.equal(shlexQuoted('plain/path-1.py'), 'plain/path-1.py')
})

/** kitty's own answer to a Python snippet, or undefined with the test skipped by name when kitty is not installed. */
function kittyRuns(t: TestContext, script: string, ...args: string[]): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'martha-kitty-'))
  try {
    const file = join(dir, 'probe.py')
    writeFileSync(file, script)
    const run = spawnSync(KITTY, ['+runpy', `import sys; sys.argv = ${JSON.stringify([file, ...args])}; exec(open(${JSON.stringify(file)}).read(), {})`], { encoding: 'utf8' })
    if (run.error !== undefined) {
      t.skip('kitty is not installed here, so kitty\'s own parser is not asked')
      return undefined
    }
    assert.equal(run.status, 0, run.stderr)
    return run.stdout
  } finally {
    removeTheTree(dir)
  }
}

const READ_THE_SESSION = `
import json, sys
from kitty.config import load_config
from kitty.session import parse_session
out = []
for s in parse_session(open(sys.argv[1]).read(), load_config(), environ={'HOME': '/expanded'}):
    for t in s.tabs:
        out.append({'tab': t.name, 'cwd': t.cwd, 'windows': [{'args': w.launch_spec.args, 'title': w.launch_spec.opts.window_title,
            'passwords': w.launch_spec.opts.remote_control_password} for w in t.windows]})
print(json.dumps(out))
`

test('K1: kitty\'s own parser reads back the root, each title and each argument unchanged', (t) => {
  const session = theSessionText(TABS)
  assert.ok('text' in session)
  const dir = mkdtempSync(join(tmpdir(), 'martha-kitty-session-'))
  t.after(() => removeTheTree(dir))
  const file = join(dir, SESSION_FILE)
  writeFileSync(file, session.text)
  const said = kittyRuns(t, READ_THE_SESSION, file)
  if (said === undefined) return
  const tabs = JSON.parse(said) as { tab: string; cwd: string; windows: { args: string[]; title: string | null; passwords: string[] }[] }[]
  assert.deepEqual(tabs.map((tab) => [tab.tab, tab.cwd]), TABS.members.map((member) => [member, TABS.root]))
  for (const [i, member] of TABS.members.entries()) {
    const [held, strip] = tabs[i]!.windows
    assert.deepEqual(held, { args: [...MARTHA, THE_ACTS_A_TAB_RUNS.held, member], title: member, passwords: [] })
    assert.deepEqual(strip, { args: [...MARTHA, THE_ACTS_A_TAB_RUNS.strip, TAB_OF, member], title: null, passwords: ['!', `"" ${shlexQuoted(TABS.checker)}`] })
  }
})

const JUDGE = `
import json, sys
from kitty.launch import parse_remote_control_passwords
from kitty.remote_control import remote_control_allowed
pw = parse_remote_control_passwords(True, ['!', '"" ' + sys.argv[1]])
class Strip: allow_remote_control = True
class Member: allow_remote_control = False
def judged(pcmd, window, self_window):
    try:
        return remote_control_allowed(pcmd, pw, window, {'self_window': self_window})
    except PermissionError:
        return 'refused'
print(json.dumps({name: judged(pcmd, Strip() if on_terminal else None, Strip() if own else Member()) for name, pcmd, on_terminal, own in json.loads(sys.argv[2])}))
`

/** Each request the strip's line may be asked, with what the checker must answer. */
const THE_REQUESTS: readonly (readonly [string, Record<string, unknown>, boolean, boolean, true | 'refused'])[] = [
  ['its own title over the fd', { cmd: THE_STRIPS_ACTIONS[0], payload: { title: 'x' } }, false, true, true],
  ['its own size over the fd', { cmd: THE_STRIPS_ACTIONS[1], payload: { self: true, increment: 1 } }, false, true, true],
  ['a title written to its terminal', { cmd: THE_STRIPS_ACTIONS[0], payload: { title: 'x' } }, true, true, 'refused'],
  ['a title with --match', { cmd: THE_STRIPS_ACTIONS[0], payload: { title: 'x', match: 'title:Uranus' } }, false, true, 'refused'],
  ['a title with --all', { cmd: THE_STRIPS_ACTIONS[0], payload: { title: 'x', all: true } }, false, true, 'refused'],
  ['a resize without --self', { cmd: THE_STRIPS_ACTIONS[1], payload: { self: false, increment: 1 } }, false, true, 'refused'],
  ['send-text', { cmd: 'send-text', payload: { data: 'text:y' } }, false, true, 'refused'],
  ['launch', { cmd: 'launch', payload: { args: ['sh'] } }, false, true, 'refused'],
  ['another password', { cmd: THE_STRIPS_ACTIONS[0], password: 'guess', payload: { title: 'x' } }, false, true, 'refused'],
  ['a self that is no strip', { cmd: THE_STRIPS_ACTIONS[0], payload: { title: 'x' } }, false, false, 'refused'],
]

test('K2: kitty\'s own authorizer, with the checker Martha writes, allows the strip its two actions on itself and nothing else', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha kitty $checker-'))
  t.after(() => removeTheTree(dir))
  const checker = join(dir, CHECKER_FILE)
  writeFileSync(checker, theCheckerSource(THE_STRIPS_ACTIONS))
  const said = kittyRuns(t, JUDGE, shlexQuoted(checker), JSON.stringify(THE_REQUESTS.map(([name, pcmd, onTerminal, own]) => [name, pcmd, onTerminal, own])))
  if (said === undefined) return
  assert.deepEqual(JSON.parse(said), Object.fromEntries(THE_REQUESTS.map(([name, , , , answer]) => [name, answer])))
})

test('K2: the checker holds exactly the strip\'s actions, read from the one constant', () => {
  const source = theCheckerSource(THE_STRIPS_ACTIONS)
  assert.match(source, new RegExp(`^THE_STRIPS_ACTIONS = frozenset\\(${JSON.stringify(THE_STRIPS_ACTIONS).replaceAll(/[[\]]/g, '\\$&')}\\)$`, 'm'))
})

test('K4: kitty is started as its own instance with remote control off and no socket', () => {
  assert.deepEqual(theKittyArguments(`/state/${SESSION_FILE}`), ['-o', 'allow_remote_control=no', '-o', 'listen_on=none', '--session', `/state/${SESSION_FILE}`])
})

test('K3: the environment kitty is started with holds no variable of the kitty it may run inside', () => {
  const env = { HOME: '/srv/owner', KITTY_LISTEN_ON: 'unix:/tmp/k', KITTY_WINDOW_ID: '3', KITTY_PID: '9', KITTY_PUBLIC_KEY: 'k', TERM: 'xterm-kitty', GONE: undefined }
  assert.deepEqual(withoutKittysVariables(env), { HOME: '/srv/owner', TERM: 'xterm-kitty' })
  assert.ok(Object.keys(env).filter((name) => name.startsWith(KITTY_VARIABLE_PREFIX)).length === 4)
})

const DESKTOP = { WAYLAND_DISPLAY: 'wayland-1' }

test('K5: no kitty names the install; an old kitty names its version and the floor; no desktop names martha start <member>', () => {
  assert.match(whyKittyCannotOpen({ kitty: undefined, env: DESKTOP }) ?? '', /kitty \(with its kitten\) is not on your PATH\. Install kitty/)
  assert.match(whyKittyCannotOpen({ kitty: 'kitty 0.49.9 created by Kovid Goyal\n', env: DESKTOP }) ?? '', new RegExp(`needs kitty ${KITTY_FLOOR.replaceAll('.', '\\.')} or newer, and this kitty is 0\\.49\\.9`))
  assert.match(whyKittyCannotOpen({ kitty: 'not kitty', env: DESKTOP }) ?? '', /this kitty is one that says "not kitty"/)
  assert.match(whyKittyCannotOpen({ kitty: `kitty ${KITTY_FLOOR} created by Kovid Goyal`, env: {} }) ?? '', /no desktop session here .*run martha start <member> in a terminal of its own/)
  assert.equal(whyKittyCannotOpen({ kitty: `kitty ${KITTY_FLOOR} created by Kovid Goyal`, env: { DISPLAY: ':0' } }), undefined)
  assert.equal(whyKittyCannotOpen({ kitty: 'kitty 1.0.0 created by Kovid Goyal', env: DESKTOP }), undefined)
})

test('versions compare by number, not by text', () => {
  assert.equal(theKittyVersionIn('kitty 0.50.10 created by Kovid Goyal'), '0.50.10')
  assert.equal(isBelow('0.50.10', '0.50.9'), false)
  assert.equal(isBelow('0.9.0', KITTY_FLOOR), true)
  assert.equal(isBelow(KITTY_FLOOR, KITTY_FLOOR), false)
})
