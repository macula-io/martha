// The Supervisor's standing items (martha#317): what an item may hold, how what stands is folded from its stream, when
// a hold is due, and the part of a starting session's line that hands them over. Each test names the mutant of the
// design that it kills.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import type { TodoHost } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import {
  DUE,
  FIELDS_OF_KIND,
  ITEM_CLOSED,
  ITEM_HELD,
  ITEMS_HANDED_AT_START,
  MAX_STANDING_FIELD,
  NOTHING_STANDS,
  STANDING,
  STANDING_KINDS,
  STANDING_STREAM,
  closeAStandingItem,
  isADay,
  isDue,
  recordAStandingItem,
  theItemAsked,
  theStandingItems,
  theStandingList,
  theStandingPartOfTheStart,
  type StandingItem,
  type StandingKind,
} from './keep_the_supervisors_standing_items.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-standing-'))
after(() => removeTheTree(homeOfAll))

const NOW = Date.UTC(2026, 10, 13, 9, 0, 0)
const TODAY = '2026-11-13'

/** A host over a row store of its own, in a directory no other test shares. */
let storesSoFar = 0
function aHost(now: number = NOW): TodoHost {
  storesSoFar += 1
  const rows = join(homeOfAll, `rows-${storesSoFar}`)
  mkdirSync(rows, { mode: STREAM_DIRECTORY_MODE })
  return { clock: { now: () => now }, stores: { rows: rowStreamsDirectory(rows) } }
}

/** One item of each kind as a call records it. */
const A_CALL: Readonly<Record<StandingKind, Readonly<Record<string, unknown>>>> = {
  held: { kind: 'held', id: 'martha-353', item: 'PR 353', reason: 'lands after the demo', until: '2026-11-20 or the demo is over' },
  awaiting: { kind: 'awaiting', id: 'martha-353', owes: 'Uranus', what: 'the r=2 verdict' },
  decided: { kind: 'decided', id: 'martha-319', rule: 'two packages', date: '2026-11-13', words: 'do them all' },
}

const told = (said: { told: string } | { refused: string }): string => {
  assert.ok('told' in said, 'refused' in said ? said.refused : '')
  return said.told
}
const refused = (said: { told: string } | { refused: string }): string => {
  assert.ok('refused' in said, 'told' in said ? said.told : '')
  return said.refused
}

// --- test 1: every kind refuses a missing field, a line break, a hidden character, and a ruling a non-day -------------

test('each kind refuses a missing field, a line break, a hidden character and an overlong field, by the field\'s name', () => {
  for (const kind of STANDING_KINDS) {
    for (const field of FIELDS_OF_KIND[kind]) {
      const missing = theItemAsked({ ...A_CALL[kind], [field]: undefined }, 'Supervisor', NOW)
      assert.ok('refused' in missing && missing.refused.includes(`${field} is missing`), `${kind}.${field} missing`)
      for (const bad of ['two\nlines', 'a‮hidden turn', 'a​zero width']) {
        const said = theItemAsked({ ...A_CALL[kind], [field]: bad }, 'Supervisor', NOW)
        assert.ok('refused' in said && said.refused.includes(`${field} holds a line break`), `${kind}.${field} ${JSON.stringify(bad)}`)
      }
      const long = theItemAsked({ ...A_CALL[kind], [field]: 'x'.repeat(MAX_STANDING_FIELD + 1) }, 'Supervisor', NOW)
      assert.ok('refused' in long && long.refused.includes(`${field} is longer than ${MAX_STANDING_FIELD}`), `${kind}.${field} long`)
    }
  }
})

test('a ruling\'s date must be a day the calendar has (mutant: accept a date that is not a day)', () => {
  for (const date of ['2026-02-31', '2026-13-01', '13-11-2026', '2026-11-13T09:00', 'today']) {
    const said = theItemAsked({ ...A_CALL.decided, date }, 'Supervisor', NOW)
    assert.ok('refused' in said && said.refused.includes('date is not a day'), date)
  }
  assert.ok(!('refused' in theItemAsked(A_CALL.decided, 'Supervisor', NOW)))
  assert.equal(isADay('2028-02-29'), true)
  assert.equal(isADay('2027-02-29'), false)
})

test('a call of no kind, or with an id that is a path, is refused by name', () => {
  const kind = theItemAsked({ ...A_CALL.held, kind: 'maybe' }, 'Supervisor', NOW)
  assert.ok('refused' in kind && kind.refused.startsWith('kind is one of held, awaiting, decided'))
  const id = theItemAsked({ ...A_CALL.held, id: '../escape' }, 'Supervisor', NOW)
  assert.ok('refused' in id && id.refused.startsWith('id is a package ref'))
})

test('a refused item writes nothing to the stream', async () => {
  const host = aHost()
  refused(await recordAStandingItem(host, { ...A_CALL.decided, date: '2026-02-31' }, 'Supervisor'))
  assert.equal((await host.stores.rows.read(STANDING_STREAM)).length, 0)
})

// --- test 2: a hold closes only on evidence, and the close keeps it --------------------------------------------------

test('closing a hold with no evidence is refused and the stream is unchanged (mutant: drop the evidence check)', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  for (const evidence of [undefined, '']) {
    const said = refused(await closeAStandingItem(host, { id: 'martha-353', evidence }, 'Supervisor'))
    assert.match(said, /is held until 2026-11-20 or the demo is over: say, in one line of evidence/)
  }
  assert.equal((await host.stores.rows.read(STANDING_STREAM)).length, 1)
  assert.equal(theStandingItems(await host.stores.rows.read(STANDING_STREAM)).length, 1)
})

test('a close with evidence carries it in its row, and the hold no longer stands', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  told(await closeAStandingItem(host, { id: 'martha-353', evidence: 'the demo ran on 2026-11-19' }, 'Supervisor'))
  const stored = await host.stores.rows.read(STANDING_STREAM)
  assert.deepEqual(stored.at(-1)?.row, { kind: ITEM_CLOSED, id: 'martha-353', standing_kind: 'held', evidence: 'the demo ran on 2026-11-19', closed_by: 'Supervisor', at: NOW })
  assert.deepEqual(theStandingItems(stored), [])
})

test('evidence that breaks a line is refused, even on a close that does not need it', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.awaiting, 'Supervisor'))
  assert.match(refused(await closeAStandingItem(host, { id: 'martha-353', evidence: 'in\nlines' }, 'Supervisor')), /evidence holds a line break/)
  told(await closeAStandingItem(host, { id: 'martha-353' }, 'Supervisor'))
})

// --- test 3: an id that stands as two kinds needs its kind named -----------------------------------------------------

test('an id held and awaited: a close with no kind names both, and closing the wait leaves the hold (mutant: match on id alone)', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  told(await recordAStandingItem(host, A_CALL.awaiting, 'Supervisor'))
  assert.equal(refused(await closeAStandingItem(host, { id: 'martha-353', evidence: 'merged' }, 'Supervisor')), 'martha-353 stands as held and awaiting: name the kind to close')
  told(await closeAStandingItem(host, { id: 'martha-353', kind: 'awaiting' }, 'Supervisor'))
  const standing = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  assert.deepEqual(standing.map((item) => `${item.kind}:${item.id}`), ['held:martha-353'])
})

test('a close of an id that does not stand, or of a kind that is none, is refused by name', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  assert.equal(refused(await closeAStandingItem(host, { id: 'martha-353', kind: 'decided' }, 'Supervisor')), 'martha-353 does not stand as decided')
  assert.equal(refused(await closeAStandingItem(host, { id: 'martha-999', kind: 'held', evidence: 'x' }, 'Supervisor')), 'martha-999 does not stand as held')
  assert.match(refused(await closeAStandingItem(host, { id: 'martha-353', kind: 'maybe' }, 'Supervisor')), /^kind is one of/)
})

test('recording a kind and id again replaces it, which is how a hold\'s day moves', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  told(await recordAStandingItem(host, { ...A_CALL.held, until: '2026-11-27' }, 'Supervisor'))
  const standing = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  assert.deepEqual(standing.map((item) => item.fields['until']), ['2026-11-27'])
})

test('a row in the stream that breaks a rule is left off, never drawn', async () => {
  const host = aHost()
  await host.stores.rows.append(STANDING_STREAM, { kind: ITEM_HELD, id: 'forged', item: 'x\ny', reason: 'r', until: 'u', recorded_by: 'Supervisor', since: NOW }, 0)
  await host.stores.rows.append(STANDING_STREAM, { kind: ITEM_HELD, id: 'no-author', item: 'x', reason: 'r', until: 'u', since: NOW }, 1)
  assert.deepEqual(theStandingItems(await host.stores.rows.read(STANDING_STREAM)), [])
})

test('what stands is listed held, then awaiting, then decided, oldest first within each', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.decided, 'Supervisor'))
  told(await recordAStandingItem(host, A_CALL.awaiting, 'Supervisor'))
  told(await recordAStandingItem(aHostSharing(host, NOW + 1), { ...A_CALL.held, id: 'later' }, 'Supervisor'))
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  const standing = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  assert.deepEqual(standing.map((item) => `${item.kind}:${item.id}`), ['held:martha-353', 'held:later', 'awaiting:martha-353', 'decided:martha-319'])
})

/** The same stores as `host`, read on another clock. */
const aHostSharing = (host: TodoHost, now: number): TodoHost => ({ ...host, clock: { now: () => now } })

// --- test 4: a hold is due on its day and after, never before, never for a condition --------------------------------

const aHold = (until: string): StandingItem => ({ kind: 'held', id: 'h', fields: { item: 'i', reason: 'r', until }, recorded_by: 'Supervisor', since: NOW })

test('a hold is due on its day and after it, not the day before (mutant: < for <=)', () => {
  assert.equal(isDue(aHold('2026-11-13'), TODAY), true)
  assert.equal(isDue(aHold('2026-11-12 after the review'), TODAY), true)
  assert.equal(isDue(aHold('2026-11-14'), TODAY), false)
})

test('a hold whose end is a condition with no day, or a day the calendar lacks, is never due', () => {
  assert.equal(isDue(aHold('the demo is over'), '2999-12-31'), false)
  assert.equal(isDue(aHold('2026-02-31'), '2999-12-31'), false)
  assert.equal(isDue({ ...aHold('2026-11-01'), kind: 'awaiting' }, TODAY), false)
})

test('a due hold reads DUE in its line, and a ruling says who recorded it', () => {
  const [line] = theStandingList([aHold('2026-11-13')], TODAY)
  assert.ok(line?.includes(`(${DUE})`), String(line))
  const ruling: StandingItem = { kind: 'decided', id: 'martha-319', fields: { rule: 'two packages', date: '2026-11-13', words: 'do them all' }, recorded_by: 'Supervisor', since: NOW }
  assert.equal(theStandingList([ruling], TODAY)[0], '- DECIDED, recorded by Supervisor: 2026-11-13 "do them all" (martha-319): two packages.')
  assert.deepEqual(theStandingList([], TODAY), [NOTHING_STANDS])
})

// --- test 6: the start hands at most the cap, and says how many more -------------------------------------------------

test('the start hands at most the cap and says how many more there are (mutant: drop the cut)', () => {
  const many = Array.from({ length: ITEMS_HANDED_AT_START + 3 }, (_, at) => ({ ...aHold('the demo is over'), id: `hold-${at}` }))
  const part = theStandingPartOfTheStart(many, TODAY) ?? ''
  const lines = part.split('\n')
  assert.equal(lines.filter((line) => line.startsWith('- HELD')).length, ITEMS_HANDED_AT_START)
  assert.equal(lines.at(-1), `… and 3 more: call ${STANDING} for the rest.`)
  assert.ok(!part.includes(`hold-${ITEMS_HANDED_AT_START}:`), 'an item past the cap is not handed')
})

test('a start with the cap or fewer hands them all and no tail; with none, nothing', () => {
  const few = Array.from({ length: ITEMS_HANDED_AT_START }, (_, at) => ({ ...aHold('the demo is over'), id: `hold-${at}` }))
  const part = theStandingPartOfTheStart(few, TODAY) ?? ''
  assert.equal(part.split('\n').filter((line) => line.startsWith('- HELD')).length, ITEMS_HANDED_AT_START)
  assert.ok(!part.includes('more: call'))
  assert.equal(theStandingPartOfTheStart([], TODAY), null)
})
