// `martha up` and `martha attach` on tmux (martha#932). Against a stand-in tmux: a refusal runs and writes nothing;
// the first member opens the session and each other one a window, each with its strip; a running member and a live
// window are left as they are; a window whose member ended is closed and opened again; attach refuses a kitty crew, an
// unknown member and a session that is not open, and otherwise attaches at the window asked for. Against the real
// tmux, on a server of the test's own (skipped by name where tmux is not installed, as kitty's reads are): one session, one window per member, each with its strip, Martha's config in
// force, and a window whose member ended kept, then opened again in its place.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { writeOwnerOnly } from '../open_the_crew_in_kitty/open_the_crew_in_kitty.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  CONFIG_FILE,
  attachToTheCrew,
  openTheCrewInTmux,
  tmuxOnThisMachine,
  tmuxSaysOnThisMachine,
  type AttachingToTheCrew,
  type OpeningTheCrewInTmux,
  type TmuxSaid,
} from './open_the_crew_in_tmux.ts'

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
})
