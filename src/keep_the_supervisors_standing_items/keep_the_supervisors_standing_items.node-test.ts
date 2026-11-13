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
  STANDING_ADD_DESCRIPTION,
  STANDING_CLOSE,
  STANDING_KINDS,
  STANDING_STREAM,
  closeAStandingItem,
  isADay,
  isDue,
  recordAStandingItem,
  theItemAsked,
  theStandingItems,
  theStandingList,
  theHeldPackageOf,
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

/** Every field of every kind, with each value it refuses and the words its refusal says. */
const REFUSED_FIELDS = STANDING_KINDS.flatMap((kind) =>
  FIELDS_OF_KIND[kind].flatMap((field) => [
    { kind, field, value: undefined, says: `${field} is missing` },
    ...['two\nlines', 'a\u202Ehidden turn', 'a\u200Bzero width'].map((value) => ({ kind, field, value, says: `${field} holds a line break` })),
    { kind, field, value: 'x'.repeat(MAX_STANDING_FIELD + 1), says: `${field} is longer than ${MAX_STANDING_FIELD}` },
  ]),
)

test('each kind refuses a missing field, a line break, a hidden character and an overlong field, by the field\'s name', () => {
  for (const { kind, field, value, says } of REFUSED_FIELDS) {
    const said = theItemAsked({ ...A_CALL[kind], [field]: value }, 'Supervisor', NOW)
    assert.ok('refused' in said && said.refused.includes(says), `${kind}.${field} ${JSON.stringify(value)}`)
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
  assert.ok('refused' in id && id.refused.startsWith('id is a slug'))
})

test('a package ref as an id is refused by name, the refusal shows the slug form, and the tool says slug', () => {
  const asked = theItemAsked({ ...A_CALL.awaiting, id: 'macula-io/martha#317' }, 'Supervisor', NOW)
  assert.ok('refused' in asked && asked.refused.startsWith('id is a slug such as martha-317, never a package ref'))
  assert.ok(!('refused' in theItemAsked({ ...A_CALL.awaiting, id: 'martha-317' }, 'Supervisor', NOW)))
  assert.match(STANDING_ADD_DESCRIPTION, /the id is a slug naming the package, such as martha-317\)/)
  assert.doesNotMatch(STANDING_ADD_DESCRIPTION, /the id is the package\)/)
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

// --- a hold that names the package it holds (martha#364) ---------------------------------------------------------

const A_HOLD_ON_A_PACKAGE = { ...A_CALL.held, package: 'macula-io/martha#364' }

test('#364: a hold may name the package it holds, and is drawn with it; a hold without one still records', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_HOLD_ON_A_PACKAGE, 'Supervisor'))
  told(await recordAStandingItem(host, { ...A_CALL.held, id: 'no-package' }, 'Supervisor'))
  const standing = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  assert.deepEqual(standing.map((item) => theHeldPackageOf(item)), ['macula-io/martha#364', undefined])
  assert.match(theStandingList(standing, TODAY)[0] ?? '', /^- HELD martha-353 \(macula-io\/martha#364\): /)
  assert.ok(STANDING_ADD_DESCRIPTION.includes('package: the package it holds'), 'standing_add does not say a hold may name its package')
})

test('#364: a package that is not owner/repo#n is refused by name, and nothing is written (test 9)', async () => {
  const host = aHost()
  for (const bad of ['martha-364', 'macula-io/martha', 'macula-io/martha#0', 'macula-io/martha#364\n', 'macula-io/martha #1']) {
    assert.match(refused(await recordAStandingItem(host, { ...A_CALL.held, package: bad }, 'Supervisor')), /^a held item: package /)
  }
  assert.deepEqual(await host.stores.rows.read(STANDING_STREAM), [])
})

test('#364: moving a hold\'s day must keep its package: dropping or changing it is refused, and the hold still names it (test 10; mutant: let the re-record through)', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_HOLD_ON_A_PACKAGE, 'Supervisor'))
  const dropped = refused(await recordAStandingItem(host, { ...A_CALL.held, until: '2026-11-27' }, 'Supervisor'))
  assert.match(dropped, /martha-353 is held on macula-io\/martha#364: name the same package to move its day, or close it first/)
  assert.ok(dropped.includes(STANDING_CLOSE))
  refused(await recordAStandingItem(host, { ...A_HOLD_ON_A_PACKAGE, package: 'macula-io/martha#365' }, 'Supervisor'))
  const kept = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  assert.deepEqual(kept.map((item) => [theHeldPackageOf(item), item.fields['until']]), [['macula-io/martha#364', A_CALL.held['until']]])

  told(await recordAStandingItem(host, { ...A_HOLD_ON_A_PACKAGE, package: 'Macula-IO/Martha#364', until: '2026-11-27' }, 'Supervisor'))
  const moved = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  assert.deepEqual(moved.map((item) => item.fields['until']), ['2026-11-27'], 'the same package, in another case, did not move the day')
})

test('#364: a hold that named no package may be given one when its day moves', async () => {
  const host = aHost()
  told(await recordAStandingItem(host, A_CALL.held, 'Supervisor'))
  told(await recordAStandingItem(host, A_HOLD_ON_A_PACKAGE, 'Supervisor'))
  assert.deepEqual(theStandingItems(await host.stores.rows.read(STANDING_STREAM)).map((item) => theHeldPackageOf(item)), ['macula-io/martha#364'])
})
