// How a record line reads against the log of where the owner's acts were typed (martha#619, design r=3): an act only
// when an entry names that file, that position and that hash; history before the cutover while its lines still hash
// as they did; and written without the martha command otherwise. The decision only: the CLI's tests drive the disk.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { APPROVALS_FILE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

import {
  aLateCutover,
  howTheLinesRead,
  sha256Of,
  theCutoverOver,
  theEntriesFor,
  theLineFor,
  theLogIn,
  type SeenFrom,
} from './record_where_an_owners_act_was_typed.ts'

const FILE = join('/state', 'project', APPROVALS_FILE)
const SEEN: SeenFrom = { tty: '/dev/pts/3', session: 4100 }
const CUTOVER_AT = '2026-11-18T10:00:00.000Z'
const LATER = '2026-11-18T11:00:00.000Z'
const OLD = ['{"old":1}', '{"old":2}', '{"old":3}']

/** A log of these entries, as the CLI appends them. */
const aLogOf = (...lines: readonly string[]): string => `${lines.join('\n')}\n`

test('#619: lines before the cutover read as history before it, a logged line as its act, and a line nothing logged as written without the martha command (conditions 1 and 4)', () => {
  const cutover = theCutoverOver({ [FILE]: OLD }, CUTOVER_AT)
  const lines = [...OLD, '{"by":"the act"}', '{"by":"a forger"}']
  const logged = theEntriesFor('approve', FILE, lines.slice(0, 4), OLD.length, LATER, SEEN)
  const read = howTheLinesRead(FILE, lines, theLogIn(aLogOf(...logged.map((entry) => JSON.stringify(entry)))), cutover)
  assert.deepEqual(read.slice(0, 3).map((how) => how.kind), ['history', 'history', 'history'])
  assert.equal(theLineFor(read[0]!), `history before ${CUTOVER_AT}`)
  assert.equal(read[3]?.kind, 'act')
  assert.match(theLineFor(read[3]!), /typed at \/dev\/pts\/3 \(session 4100\)/)
  assert.equal(read[4]?.kind, 'without_the_martha_command')
  assert.match(theLineFor(read[4]!), /WRITTEN WITHOUT THE MARTHA COMMAND/)
})

test('#619: an entry vouches only for its own position: the same line hash at another position is no act (condition 2, mutant: the position not compared)', () => {
  const line = '{"the":"same"}'
  const entry = { act: 'approve', file: FILE, position: 0, sha256: sha256Of(line), at: LATER, seen_from: SEEN }
  const read = howTheLinesRead(FILE, [line, line], theLogIn(aLogOf(JSON.stringify(entry))), undefined)
  assert.deepEqual(read.map((how) => how.kind), ['act', 'without_the_martha_command'])
  // Nor for another file, nor for other bytes at its own position.
  assert.equal(howTheLinesRead('/another/file', [line], theLogIn(aLogOf(JSON.stringify(entry))), undefined)[0]?.kind, 'without_the_martha_command')
  assert.equal(howTheLinesRead(FILE, [`${line} `], theLogIn(aLogOf(JSON.stringify(entry))), undefined)[0]?.kind, 'without_the_martha_command')
})

test('#619: a history edited after the cutover reads as changed, never as history (mutant: the prefix hash not checked)', () => {
  const cutover = theCutoverOver({ [FILE]: OLD }, CUTOVER_AT)
  const read = howTheLinesRead(FILE, ['{"old":1}', '{"forged":2}', '{"old":3}'], { entries: [], unreadable: [] }, cutover)
  assert.deepEqual(read.map((how) => how.kind), ['history_changed', 'history_changed', 'history_changed'])
  assert.match(theLineFor(read[0]!), /CHANGED since/)
})

test('#619: a log line that is no entry is named and vouches for nothing: its record reads without the martha command (condition 3)', () => {
  const line = '{"by":"the act"}'
  const entry = JSON.stringify({ act: 'approve', file: FILE, position: 0, sha256: sha256Of(line), at: LATER, seen_from: SEEN })
  const log = theLogIn(aLogOf('not an entry', entry.replace('"position":0', '"position":"0"')))
  assert.deepEqual(log.unreadable, [1, 2])
  assert.equal(howTheLinesRead(FILE, [line], log, undefined)[0]?.kind, 'without_the_martha_command')
})

test('#619: a cutover taken after the first approval it covers is named as late, and one taken before it is not (condition 4)', () => {
  assert.match(aLateCutover(theCutoverOver({}, LATER), CUTOVER_AT) ?? '', /after your first approval/)
  assert.equal(aLateCutover(theCutoverOver({}, CUTOVER_AT), LATER), undefined)
  assert.equal(aLateCutover(theCutoverOver({}, LATER), undefined), undefined)
})

test('#619: a whole record its act rewrote after the cutover reads as that act, not as changed history (review r=1, mutant: history decided before the log)', () => {
  const shapes = join('/state', 'project', 'the-kept-shapes')
  const cutover = theCutoverOver({ [shapes]: ['{"shapes":"old"}'] }, CUTOVER_AT)
  const rewritten = ['{"shapes":"new"}']
  const logged = theEntriesFor('keep-shapes', shapes, rewritten, 0, LATER, SEEN)
  const read = howTheLinesRead(shapes, rewritten, theLogIn(aLogOf(...logged.map((entry) => JSON.stringify(entry)))), cutover)
  assert.deepEqual(read.map((how) => how.kind), ['act'])
  // The same rewrite with no entry is still changed history, never an act.
  assert.deepEqual(howTheLinesRead(shapes, rewritten, { entries: [], unreadable: [] }, cutover).map((how) => how.kind), ['history_changed'])
})
