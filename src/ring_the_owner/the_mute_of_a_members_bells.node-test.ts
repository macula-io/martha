// The owner's own silence for one member's bells (martha#371): the file every flip is kept in, the fold that reads it,
// and the reader the owner's screen asks before it builds a bell.
//
// What is pinned here is that a flip is one line and survived by the next reader, that the newest flip wins, and that
// nothing about a broken file silences a bell: an unreadable file and a line that is not a flip both leave the bell
// ringing, and both say why, so the owner learns their mute is not being honoured instead of believing in a silence.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import {
  BELLS_HEARD,
  BELLS_MUTED,
  bellsFileIn,
  flipTheBellsOf,
  THE_BELLS_FILE,
  theMuteOf,
  type TheBellsPlace,
} from './the_mute_of_a_members_bells.ts'

/** A crew's own place under a temporary home, with the lines seam the launcher and `martha start` are given. */
function aPlace(t: { after: (fn: () => void) => void }): TheBellsPlace {
  const home = mkdtempSync(join(tmpdir(), 'martha-bells-'))
  t.after(() => removeTheTree(home))
  const directory = join(home, 'the-bells')
  mkdirSync(directory)
  return {
    directory,
    lines: {
      append: (path, line, what) => {
        writeFileSync(path, `${line}\n`, { flag: 'a' })
        assert.ok(what !== '', 'a write says what it is writing')
        return undefined
      },
      read: (path) => {
        try {
          return { text: readFileSync(path, 'utf8') }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          return code === 'ENOENT' ? { text: '' } : { refusal: `${path} could not be read (${code ?? String(error)}).` }
        }
      },
    },
  }
}

const NOW = 1_700_000_000_000
const MOMENT = new Date(NOW).toISOString()

test('nothing is muted until the owner says so, and the file is named inside the crew own place', (t) => {
  const place = aPlace(t)
  assert.deepEqual(theMuteOf(place, 'Vesta'), { muted: false, by: '', at: '', why: '' })
  assert.equal(bellsFileIn(place), join(place.directory, THE_BELLS_FILE))
})

test('a flip is one line, and the next reader finds it (martha#371)', (t) => {
  const place = aPlace(t)
  const flipped = flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  assert.deepEqual(flipped, { flipped: true })
  assert.deepEqual(theMuteOf(place, 'Vesta'), { muted: true, by: 'Raf', at: MOMENT, why: '' })
  const kept = readFileSync(bellsFileIn(place), 'utf8').split('\n').filter((line) => line !== '')
  assert.equal(kept.length, 1, 'one flip is one line')
  assert.deepEqual(JSON.parse(kept[0]!), { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
})

test('the newest flip wins, and the history stays: a mute lifted reads as ringing again', (t) => {
  const place = aPlace(t)
  flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_HEARD, by: 'Raf', at: MOMENT })
  assert.equal(theMuteOf(place, 'Vesta').muted, false, 'the newest flip is the one in force')
  const kept = readFileSync(bellsFileIn(place), 'utf8').split('\n').filter((line) => line !== '')
  assert.equal(kept.length, 2, 'both flips are kept, so who silenced it and when is still on disk')
})

test('one member is muted and another rings: the file is per member, not per crew', (t) => {
  const place = aPlace(t)
  flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  assert.equal(theMuteOf(place, 'Vesta').muted, true)
  assert.equal(theMuteOf(place, 'Uranus').muted, false)
  flipTheBellsOf(place, { member: 'Uranus', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  assert.equal(theMuteOf(place, 'Vesta').muted, true)
  assert.equal(theMuteOf(place, 'Uranus').muted, true)
  flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_HEARD, by: 'Raf', at: MOMENT })
  assert.equal(theMuteOf(place, 'Vesta').muted, false, 'lifting one member\'s mute leaves the other muted')
  assert.equal(theMuteOf(place, 'Uranus').muted, true)
})

test('a typed name is matched the way the command matches one', (t) => {
  const place = aPlace(t)
  flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  assert.equal(theMuteOf(place, 'vesta').muted, true, 'the same member under another case is the same member')
})

test('a file that cannot be read is not a mute: the bell rings, and the reader says why', (t) => {
  const place = { ...aPlace(t), lines: { append: () => undefined, read: () => ({ refusal: 'the file is not mine' }) } }
  assert.deepEqual(theMuteOf(place, 'Vesta'), { muted: false, by: '', at: '', why: 'the file is not mine' })
})

test('a line that is not a flip makes no mute: the bell rings rather than a silence nobody can explain', (t) => {
  const place = aPlace(t)
  flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  writeFileSync(bellsFileIn(place), `${readFileSync(bellsFileIn(place), 'utf8')}not a flip\n`)
  const mute = theMuteOf(place, 'Vesta')
  assert.equal(mute.muted, false, 'a garbled line makes the whole file untrustworthy')
  assert.ok(mute.why.includes('not a flip'), `the reader names the line it could not read: ${mute.why}`)
})

test('a flip the file refuses is a flip that did not happen, and the owner is told', (t) => {
  const place = { ...aPlace(t), lines: { append: () => ({ refusal: 'no room on the disk' }), read: () => ({ text: '' }) } }
  const flipped = flipTheBellsOf(place, { member: 'Vesta', bells: BELLS_MUTED, by: 'Raf', at: MOMENT })
  assert.deepEqual(flipped, { flipped: false, refusal: 'no room on the disk' })
})
