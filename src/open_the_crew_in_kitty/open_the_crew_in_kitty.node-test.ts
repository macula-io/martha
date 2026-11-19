// Bare `martha start` (#547 S6): a refusal writes nothing and starts nothing (K5); a member already running gets no tab
// and is named (K1); the two files sit in the place given, owner-only, and kitty is started on the session file with
// no KITTY_ variable (K3, K4); and the strip's kitten calls only its two actions on itself (K2).

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { CHECKER_FILE, SESSION_FILE, openTheCrewInKitty, writeOwnerOnly, type OpeningTheCrew } from './open_the_crew_in_kitty.ts'
import { KITTY_FLOOR, THE_STRIPS_ACTIONS, theCheckerSource } from './the_session_kitty_reads.ts'
import { theStripsKitten, type AKittenCall } from './the_strips_kitten.ts'

interface Seen {
  readonly out: string[]
  readonly err: string[]
  readonly written: Map<string, string>
  readonly started: { args: readonly string[]; env: Readonly<Record<string, string>> }[]
}

function opening(changes: Partial<OpeningTheCrew> = {}): { readonly seen: Seen; readonly asking: OpeningTheCrew } {
  const seen: Seen = { out: [], err: [], written: new Map(), started: [] }
  const asking: OpeningTheCrew = {
    root: '/srv/owner/widget',
    members: ['Vesta', 'Uranus', 'Ceres'],
    isRunning: (member) => member === 'Uranus',
    martha: ['/usr/bin/node', '/opt/martha/bin/martha'],
    env: { HOME: '/srv/owner', WAYLAND_DISPLAY: 'wayland-1', KITTY_WINDOW_ID: '7', KITTY_LISTEN_ON: 'unix:/run/k' },
    place: '/state/place',
    kittySays: () => `kitty ${KITTY_FLOOR} created by Kovid Goyal`,
    write: (path, text) => void seen.written.set(path, text),
    startKitty: (args, env) => void seen.started.push({ args, env }),
    ...changes,
  }
  return { seen, asking }
}

const io = (seen: Seen) => ({ out: (line: string) => void seen.out.push(line), err: (line: string) => void seen.err.push(line) })

test('K5: each refusal writes nothing and starts nothing', () => {
  for (const changes of [{ kittySays: () => undefined }, { kittySays: () => 'kitty 0.49.0 created by Kovid Goyal' }, { env: { HOME: '/srv/owner' } }, { root: '/srv/owner/a\nb' }] as Partial<OpeningTheCrew>[]) {
    const { seen, asking } = opening(changes)
    assert.equal(openTheCrewInKitty(io(seen), asking), 1)
    assert.equal(seen.written.size, 0)
    assert.deepEqual(seen.started, [])
  }
})

test('K1, K3, K4: a running member gets no tab and is named; the files go in the place, and kitty starts on the session with no KITTY_ variable', () => {
  const { seen, asking } = opening()
  assert.equal(openTheCrewInKitty(io(seen), asking), 0)
  const session = seen.written.get(join(asking.place, SESSION_FILE)) ?? ''
  assert.deepEqual(session.split('\n').filter((line) => line.startsWith('new_tab ')), ['new_tab Vesta', 'new_tab Ceres'])
  assert.equal(seen.written.get(join(asking.place, CHECKER_FILE)), theCheckerSource(THE_STRIPS_ACTIONS))
  assert.ok(session.includes(`'"" ${join(asking.place, CHECKER_FILE)}'`))
  assert.deepEqual(seen.started, [{ args: ['-o', 'allow_remote_control=no', '-o', 'listen_on=none', '--session', join(asking.place, SESSION_FILE)], env: { HOME: '/srv/owner', WAYLAND_DISPLAY: 'wayland-1' } }])
  assert.deepEqual(seen.err, ['martha: Uranus is already running, so it gets no tab.', 'martha: Vesta opened in kitty', 'martha: Ceres opened in kitty'])
})

test('K1: with every member running nothing is opened, and it says so', () => {
  const { seen, asking } = opening({ isRunning: () => true })
  assert.equal(openTheCrewInKitty(io(seen), asking), 0)
  assert.equal(seen.written.size, 0)
  assert.deepEqual(seen.started, [])
  assert.equal(seen.err.at(-1), 'martha: every member of this crew is running, so nothing was opened.')
})

test('K4: a file is written owner-only, in place of a link left where it goes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-kitty-write-'))
  t.after(() => removeTheTree(dir))
  const target = join(dir, 'elsewhere')
  writeFileSync(target, 'untouched')
  const path = join(dir, SESSION_FILE)
  symlinkSync(target, path)
  writeOwnerOnly(path, 'the session')
  assert.equal(readFileSync(path, 'utf8'), 'the session')
  assert.equal(readFileSync(target, 'utf8'), 'untouched')
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

test('K2: the strip calls only its two actions, on itself, and the list holds no action it never calls', () => {
  const calls: AKittenCall[] = []
  const kitten = theStripsKitten('Vesta', (call) => void calls.push(call))
  assert.equal(kitten.title.member, 'Vesta')
  kitten.title.set('(!) Vesta · needs-you')
  kitten.fit(4, 7)
  kitten.fit(4, 4)
  kitten.fit(4, undefined)
  assert.deepEqual(calls, [['set-tab-title', '(!) Vesta · needs-you'], ['resize-window', '--self', '--axis=vertical', '--increment=-3']])
  assert.deepEqual([...new Set(calls.map(([action]) => action))].sort(), [...THE_STRIPS_ACTIONS].sort())
  assert.ok(calls.every((call) => !call.some((word) => word.startsWith('--match') || word === '--all')))
})
