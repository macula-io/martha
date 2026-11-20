// `martha up` and `martha attach` on tmux (martha#932). Against a stand-in tmux: a refusal runs and writes nothing;
// the first member opens the session and each other one a window, each with its strip; a running member and a live
// window are left as they are; a window whose member ended is closed and opened again; attach refuses a kitty crew, an
// unknown member and a session that is not open, and otherwise attaches at the window asked for. Against the real
// tmux, on a server of the test's own (skipped by name where tmux is not installed, as kitty's reads are): one session, one window per member, each with its strip, Martha's config in
// force, and a window whose member ended kept, then opened again in its place.

import assert from 'node:assert/strict'
import { THE_FIRST_PROMPT_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { writeOwnerOnly } from '../open_the_crew_in_kitty/open_the_crew_in_kitty.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  CONFIG_FILE,
  attachToTheCrew,
  isMarthasOwnSocket,
  openTheCrewInTmux,
  tmuxOnThisMachine,
  tmuxSaysOnThisMachine,
  typeTheFirstPrompt,
  type AttachingToTheCrew,
  type OpeningTheCrewInTmux,
  type TmuxSaid,
} from './open_the_crew_in_tmux.ts'
import { theSocketOfThisTmux } from './the_commands_tmux_runs.ts'

interface Seen {
  readonly out: string[]
  readonly err: string[]
  readonly written: Map<string, string>
  readonly ran: (readonly string[])[]
}

/** A stand-in tmux: sessions by name, each a list of windows; every command it is run with is kept, minus the server's words. */
type Sessions = Map<string, { name: string; ended: boolean }[]>

/** What each tmux verb does to the stand-in's sessions, given its words after the verb and its target's session and window. */
const VERBS: Readonly<Record<string, (sessions: Sessions, words: readonly string[], session: string, window: string | undefined) => TmuxSaid>> = {
  'has-session': (sessions, _words, session) => ({ status: sessions.has(session) ? 0 : 1, said: '' }),
  'list-windows': (sessions, _words, session) => ({ status: 0, said: (sessions.get(session) ?? []).map((one) => `${one.ended ? 1 : 0} ${one.name}\n`).join('') }),
  'new-session': (sessions, words) => (sessions.set(words[words.indexOf('-s') + 1]!, [{ name: words[words.indexOf('-n') + 1]!, ended: false }]), DONE),
  'new-window': (sessions, words, session) => (sessions.get(session.replace(/:$/, ''))!.push({ name: words[words.indexOf('-n') + 1]!, ended: false }), DONE),
  'split-window': () => DONE,
  'send-keys': () => DONE,
  'kill-window': (sessions, _words, session, window) => {
    const left = sessions.get(session)!.filter((one) => one.name !== window)
    if (left.length === 0) sessions.delete(session)
    else sessions.set(session, left)
    return DONE
  },
}
const DONE: TmuxSaid = { status: 0, said: '' }

function aTmux(seen: Seen, sessions: Sessions) {
  return (args: readonly string[]): TmuxSaid => {
    assert.deepEqual(args.slice(0, 4), ['-L', 'a-server', '-f', join('/state/place', CONFIG_FILE)])
    const [verb, ...rest] = args.slice(4)
    seen.ran.push([verb!, ...rest])
    const [session, window] = (rest[rest.indexOf('-t') + 1] ?? '').replace(/^=/, '').split(':=')
    return VERBS[verb!]!(sessions, rest, session!, window)
  }
}

function opening(sessions: Sessions = new Map(), changes: Partial<OpeningTheCrewInTmux> = {}) {
  const seen: Seen = { out: [], err: [], written: new Map(), ran: [] }
  const run = aTmux(seen, sessions)
  const asking: OpeningTheCrewInTmux = {
    server: 'a-server',
    id: 'widget-crew',
    root: '/srv/owner/widget',
    members: ['Vesta', 'Uranus', 'Ceres'],
    isRunning: (member) => member === 'Uranus',
    martha: ['/usr/bin/node', '/opt/martha/bin/martha'],
    env: { HOME: '/srv/owner', TMUX: '/tmp/tmux-1000/default,1,0' },
    place: '/state/place',
    tmuxSays: () => 'tmux 3.8',
    write: (path, text) => void seen.written.set(path, text),
    tmux: (args, env) => {
      assert.deepEqual(env, { HOME: '/srv/owner' })
      return run(args)
    },
    ...changes,
  }
  return { seen, asking, sessions }
}

const io = (seen: Seen) => ({ out: (line: string) => void seen.out.push(line), err: (line: string) => void seen.err.push(line) })

test('#932: each refusal before tmux opens anything runs no tmux command and writes nothing', () => {
  for (const changes of [{ tmuxSays: () => undefined }, { tmuxSays: () => 'tmux 3.2a' }, { id: null }, { id: 'my.crew' }, { members: ['Vesta', 'a:b'] }] as Partial<OpeningTheCrewInTmux>[]) {
    const { seen, asking } = opening(undefined, changes)
    assert.equal(openTheCrewInTmux(io(seen), asking), 1)
    assert.deepEqual(seen.ran, [])
    assert.equal(seen.written.size, 0)
  }
})

test('#932: the first member opens the session and the next one a window, each with its strip; a running member gets none', () => {
  const { seen, asking, sessions } = opening()
  assert.equal(openTheCrewInTmux(io(seen), asking), 0)
  assert.ok(seen.written.get(join('/state/place', CONFIG_FILE))?.includes('set -g remain-on-exit on'))
  assert.deepEqual(seen.ran.map(([verb]) => verb), ['has-session', 'has-session', 'new-session', 'split-window', 'has-session', 'list-windows', 'has-session', 'new-window', 'split-window'])
  assert.deepEqual(sessions.get('widget-crew')?.map((one) => one.name), ['Vesta', 'Ceres'])
  assert.deepEqual(seen.err, [
    'martha: Uranus is already running, so it gets no window.',
    'martha: Vesta opened in tmux',
    'martha: Ceres opened in tmux',
    'martha: the crew is in tmux session widget-crew: martha attach shows it, from any terminal.',
  ])
})

test('#932: a window whose member ended is closed and opened again; a live one is left and named', () => {
  const { seen, asking, sessions } = opening(new Map([['widget-crew', [{ name: 'Vesta', ended: true }, { name: 'Ceres', ended: false }]]]))
  assert.equal(openTheCrewInTmux(io(seen), asking), 0)
  assert.deepEqual(seen.ran.filter(([verb]) => verb === 'kill-window' || verb === 'new-window' || verb === 'new-session').map((words) => [words[0], words.at(-1) === 'Vesta' ? 'Vesta' : words[2]]), [
    ['kill-window', '=widget-crew:=Vesta'],
    ['new-window', 'Vesta'],
  ])
  assert.deepEqual(sessions.get('widget-crew')?.map((one) => [one.name, one.ended]), [['Ceres', false], ['Vesta', false]])
  assert.ok(seen.err.includes('martha: Ceres has a window that is still open, so it gets no other: martha attach Ceres'))
})

test('#932: a window or strip tmux does not open is refused with what tmux said, and no later member is opened', () => {
  for (const failing of ['new-session', 'split-window']) {
    const { seen, asking } = opening()
    const asked: OpeningTheCrewInTmux = { ...asking, tmux: (args, env) => (args[4] === failing ? (seen.ran.push([failing]), { status: 1, said: 'a tmux complaint\n' }) : asking.tmux(args, env)) }
    assert.equal(openTheCrewInTmux(io(seen), asked), 1, failing)
    assert.equal(seen.err.at(-1), "martha: tmux did not open Vesta's window: a tmux complaint", failing)
    assert.equal(seen.ran.some(([verb]) => verb === 'new-window'), false, failing)
  }
})

test('#919: a member up gives a first prompt is started with it; one given none is started without', () => {
  const { seen, asking } = opening(undefined, { promptFor: (member) => (member === 'Ceres' ? 'read the brief' : undefined) })
  assert.equal(openTheCrewInTmux(io(seen), asking), 0)
  const starts = seen.ran.filter(([verb]) => verb === 'new-session' || verb === 'new-window').map((words) => words.slice(words.indexOf('start')))
  assert.deepEqual(starts, [['start', 'Vesta'], ['start', 'Ceres', THE_FIRST_PROMPT_SWITCH, 'read the brief']])
})

test('#919: the first prompt is typed into the pane named, on Martha\'s server, then Enter; a refusal from tmux is said', () => {
  const { seen, asking } = opening()
  assert.equal(typeTheFirstPrompt(asking, '%3', '-read the brief'), undefined)
  assert.deepEqual(seen.ran, [['send-keys', '-t', '%3', '-l', '--', '-read the brief'], ['send-keys', '-t', '%3', 'Enter']])
  const refusing = { ...asking, tmux: () => ({ status: 1, said: "can't find pane: %3\n" }) }
  assert.equal(typeTheFirstPrompt(refusing, '%3', 'go'), "can't find pane: %3")
})

test('#932: with every member running nothing is opened, and it says so', () => {
  const { seen, asking } = opening(undefined, { isRunning: () => true })
  assert.equal(openTheCrewInTmux(io(seen), asking), 0)
  assert.deepEqual(seen.ran, [])
  assert.equal(seen.err.at(-1), 'martha: every member of this crew is running, so nothing was opened.')
})

function attaching(changes: Partial<AttachingToTheCrew> = {}) {
  const { seen, asking } = opening(new Map([['widget-crew', [{ name: 'Vesta', ended: false }]]]))
  const attached: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = []
  const asked: AttachingToTheCrew = { ...asking, terminal: 'tmux', member: undefined, attach: (args, env) => (attached.push({ args, env }), 0), ...changes }
  return { seen, asked, attached }
}

test('#932: martha attach shows the crew\'s session, at the member\'s window when one is named, on Martha\'s server', () => {
  for (const [member, target] of [[undefined, '=widget-crew'], ['Vesta', '=widget-crew:=Vesta']] as const) {
    const { seen, asked, attached } = attaching({ member })
    assert.equal(attachToTheCrew(io(seen), asked), 0)
    assert.deepEqual(attached, [{ args: ['-L', 'a-server', '-f', join('/state/place', CONFIG_FILE), 'attach-session', '-t', target], env: { HOME: '/srv/owner' } }])
  }
})

test('#932: martha attach refuses a crew that opens in kitty, a member not on it, and a session that is not open', () => {
  for (const [changes, said] of [
    [{ terminal: 'kitty' }, /opens in kitty, its declaration's "terminal"/],
    [{ member: 'Pluto' }, /Pluto is not on this crew/],
    [{ id: 'other-crew' }, /tmux session other-crew is not open\. Open it with: martha up/],
  ] as const) {
    const { seen, asked, attached } = attaching(changes)
    assert.equal(attachToTheCrew(io(seen), asked), 1)
    assert.match(seen.err.join('\n'), said)
    assert.deepEqual(attached, [])
  }
})

test('#932 live: on a tmux server of the test\'s own, one session, a window and a strip per member, Martha\'s config in force', (t) => {
  const said = tmuxSaysOnThisMachine()
  if (said === undefined) {
    t.skip('tmux is not installed here, so no tmux server is opened (CI installs one)')
    return
  }
  const place = mkdtempSync(join(tmpdir(), 'martha-tmux-'))
  const server = `martha-test-${process.pid}-${Date.now()}`
  const env = { PATH: process.env['PATH'] }
  const tmux = (args: readonly string[]) => tmuxOnThisMachine(['-L', server, ...args], { PATH: process.env['PATH'] ?? '' })
  let socket: string | undefined
  t.after(() => {
    tmux(['kill-server'])
    // tmux leaves its socket behind when its server is killed: the test removes the one its server made.
    if (socket !== undefined) rmSync(socket, { force: true })
    removeTheTree(place)
  })
  const seen: Seen = { out: [], err: [], written: new Map(), ran: [] }
  const live = (martha: readonly string[], members: readonly string[]): OpeningTheCrewInTmux => ({
    server, id: 'live-crew', root: place, members, isRunning: () => false, martha, env, place, tmuxSays: () => said, write: writeOwnerOnly, tmux: tmuxOnThisMachine,
  })
  assert.equal(openTheCrewInTmux(io(seen), live(['/bin/sh', '-c', 'sleep 60', 'a-martha'], ['Vesta', 'Ceres'])), 0, seen.err.join('\n'))
  socket = tmux(['display-message', '-p', '#{socket_path}']).said.trim()
  assert.ok(socket.endsWith(`/${server}`), socket)
  assert.equal(statSync(join(place, CONFIG_FILE)).mode & 0o777, 0o600)
  assert.ok(readFileSync(join(place, CONFIG_FILE), 'utf8').includes('allow-passthrough'))
  assert.equal(tmux(['list-windows', '-t', '=live-crew', '-F', '#{window_name} #{window_panes}']).said, 'Vesta 2\nCeres 2\n')
  for (const option of ['extended-keys', 'allow-passthrough', 'remain-on-exit', 'set-clipboard']) assert.equal(tmux(['show-options', '-gv', option]).said.trim(), 'on', option)
  // A member that ends keeps its window (remain-on-exit), and the next up opens it again in its place.
  assert.equal(openTheCrewInTmux(io(seen), live(['/bin/true'], ['Juno'])), 0, seen.err.join('\n'))
  const ended = () => tmux(['list-windows', '-t', '=live-crew', '-F', '#{window_name} #{pane_dead}']).said
  for (let i = 0; i < 50 && !ended().includes('Juno 1'); i += 1) spawnSync('sleep', ['0.1'])
  assert.ok(ended().includes('Juno 1'), ended())
  assert.equal(openTheCrewInTmux(io(seen), live(['/bin/sh', '-c', 'sleep 60', 'a-martha'], ['Juno'])), 0, seen.err.join('\n'))
  assert.equal(ended(), 'Vesta 0\nCeres 0\nJuno 0\n')
  // r=1: a member that ended while its strip runs on, the strip the pane the owner last looked at, is still told ended:
  // tmux's window flags are its active pane's, so the member's own pane, the first, is the one read.
  const theStripRunsOn = ['/bin/sh', '-c', '[ "$0" = crew ] && exec sleep 60; exit 0']
  assert.equal(openTheCrewInTmux(io(seen), live(theStripRunsOn, ['Pallas'])), 0, seen.err.join('\n'))
  assert.equal(tmux(['select-pane', '-t', '=live-crew:=Pallas.1']).status, 0)
  const pallas = () => tmux(['list-panes', '-t', '=live-crew:=Pallas', '-F', '#{pane_index} #{pane_dead}']).said
  for (let i = 0; i < 50 && !pallas().includes('0 1'); i += 1) spawnSync('sleep', ['0.1'])
  assert.equal(pallas(), '0 1\n1 0\n')
  assert.equal(openTheCrewInTmux(io(seen), live(['/bin/sh', '-c', 'sleep 60', 'a-martha'], ['Pallas'])), 0, seen.err.join('\n'))
  assert.equal(pallas(), '0 0\n1 0\n', 'the ended member was left in its window, read as running by its strip')
  // #919: what is typed in arrives as written: a leading -, a format and a variable are text, never read as keys or expanded.
  assert.equal(openTheCrewInTmux(io(seen), live(['/bin/sh', '-c', '[ "$0" = crew ] && exec sleep 60; exec cat', 'a-martha'], ['Ceres-typed'])), 0, seen.err.join('\n'))
  const typedPane = tmux(['display-message', '-p', '-t', '=live-crew:=Ceres-typed.0', '#{pane_id}']).said.trim()
  const text = '-v #{pid} $HOME Enter'
  assert.equal(typeTheFirstPrompt({ server, id: 'live-crew', env, place, tmuxSays: () => said, write: writeOwnerOnly, tmux: tmuxOnThisMachine }, typedPane, text), undefined)
  const screen = () => tmux(['capture-pane', '-p', '-t', typedPane]).said
  for (let i = 0; i < 50 && !screen().includes(text); i += 1) spawnSync('sleep', ['0.1'])
  assert.equal(screen().split('\n').filter((line) => line !== '').slice(0, 2).join('\n'), `${text}\n${text}`, 'cat echoes the line once Enter ended it')
  theSocketAWindowReadsIsTheServers(seen, live, { server, env, place, said })
})

/**
 * #919 review r=1: the socket a window of the server reads in TMUX is the one the server names as its own; the same name
 * in another folder is not.
 */
function theSocketAWindowReadsIsTheServers(
  seen: Seen,
  live: (martha: readonly string[], members: readonly string[]) => OpeningTheCrewInTmux,
  on: { readonly server: string; readonly env: Readonly<Record<string, string | undefined>>; readonly place: string; readonly said: string },
): void {
  const told = join(on.place, 'tmux-told')
  assert.equal(openTheCrewInTmux(io(seen), live(['/bin/sh', '-c', `printf '%s' "$TMUX" > '${told}'; exec sleep 60`, 'a-martha'], ['Ceres-told'])), 0, seen.err.join('\n'))
  const written = (): boolean => existsSync(told) && readFileSync(told, 'utf8') !== ''
  for (let i = 0; i < 50 && !written(); i += 1) spawnSync('sleep', ['0.1'])
  const inTheWindow = theSocketOfThisTmux({ TMUX: readFileSync(told, 'utf8') })!
  const onTheServer = { server: on.server, id: 'live-crew', env: on.env, place: on.place, tmuxSays: () => on.said, write: writeOwnerOnly, tmux: tmuxOnThisMachine }
  assert.equal(isMarthasOwnSocket(onTheServer, inTheWindow), true, inTheWindow)
  assert.equal(isMarthasOwnSocket(onTheServer, join(on.place, 'elsewhere', on.server)), false)
}
