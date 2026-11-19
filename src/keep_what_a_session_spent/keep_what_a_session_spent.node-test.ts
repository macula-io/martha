// The writer of what a session spent (martha#860): which questions write a reading, which stream it goes to, and how a
// hold opens and closes. And the two cases Venus's ruling pins: a null on the session's own first question is a 0
// baseline, a null on any later reading is unknown.
//
// The mutant each test kills is named in its title.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewPlace, StoredRow } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { theRowWithNothingSaid, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { keepWhatTheSessionSpent, theReadingsIn, theUsageFile, usageStreamOf, USAGE_PLACE, type AReadingAsked, type AUsageHost, type TheUsagePlaces } from './keep_what_a_session_spent.ts'
import { theSpendBetween } from './the_spend_between.ts'

const MEMBER = 'builder'
const THE_PACKAGE = 'macula-io/martha#860'
const ANOTHER_PACKAGE = 'macula-io/martha#308'
const MODEL = 'sonnet'
const SESSION = 'a-session'
const STARTED_AT = 1_794_998_340_000
const ENGINE: AUsageHost = 'martha-engine'

/** A crew place held in memory. */
function aPlace(): CrewPlace & { readonly holding: Map<string, string> } {
  const holding = new Map<string, string>()
  return {
    path: `/the-crew/${USAGE_PLACE}`,
    holding,
    keep: (name, text) => void holding.set(name, text),
    read: (name) => (holding.has(name) ? { text: holding.get(name) as string } : undefined),
    names: () => [...holding.keys()],
  }
}

/** The member's row, holding whichever package the test says. */
function aRow(): { beats: DashboardStore; hold: (package_name: string) => void } {
  let row: DashboardRow = { ...theRowWithNothingSaid(), member: MEMBER, session: SESSION, at: STARTED_AT }
  return {
    beats: { read: () => row, change: () => ({ kept: true }) } as unknown as DashboardStore,
    hold: (package_name) => void (row = { ...row, holds: package_name }),
  }
}

interface AWriter {
  readonly places: TheUsagePlaces
  readonly place: ReturnType<typeof aPlace>
  readonly hold: (package_name: string) => void
  readonly later: () => void
  readonly stream: (package_name: string | null) => Promise<readonly StoredRow[]>
}

function aWriter(host_name: AUsageHost = CLAUDE_CODE): AWriter {
  const host = hostForTests({ now: STARTED_AT })
  const place = aPlace()
  const row = aRow()
  return {
    places: { member: MEMBER, host: host_name, beats: row.beats, ledger: host.host, row_model: MODEL, kept: place },
    place,
    hold: row.hold,
    later: () => host.advanceClock(MINUTE_MS),
    stream: (package_name) => host.host.stores.rows.read(usageStreamOf(package_name)),
  }
}

/** A question as the mod or the engine's adapter asks it. */
const asked = (cost_usd: number | null, at_start = false, more: Partial<AReadingAsked> = {}): AReadingAsked => ({
  session_id: SESSION, cost_usd, started_at: STARTED_AT, unknown_price: 0, billing: 'metered', at_start, turn_running: false, ...more,
})

async function kept(writer: AWriter, question: AReadingAsked): Promise<void> {
  writer.later()
  assert.equal(await keepWhatTheSessionSpent(writer.places, question), undefined, 'the reading was not kept')
}

const theCostsIn = (rows: readonly StoredRow[]): readonly unknown[] => rows.map((stored) => [stored.row['usd'], stored.row['opens']])

test('#860: a session\'s first question always writes, even when its host reported nothing (mutant: a null first reading skipped)', async () => {
  const writer = aWriter()
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(null, true))
  assert.deepEqual(theCostsIn(await writer.stream(THE_PACKAGE)), [[null, 1]], 'a session that said nothing at its start left no row naming it')
})

test('#860: a beat taken while a turn runs writes nothing, and neither does a reading that changed nothing (mutant: every question writes)', async () => {
  const writer = aWriter()
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(0.25, true))
  await kept(writer, asked(0.5, false, { turn_running: true }))
  await kept(writer, asked(0.25))
  assert.deepEqual(theCostsIn(await writer.stream(THE_PACKAGE)), [[0.25, 1]], 'a beat or an unchanged reading was written')
  await kept(writer, asked(0.25, false, { billing: 'subscription' }))
  assert.deepEqual(theCostsIn(await writer.stream(THE_PACKAGE)), [[0.25, 1], [0.25, 0]], 'a reading whose billing changed was not written')
})

test('#860 R4: a member holding no package writes to the crew\'s stream (mutant: a package-less reading dropped)', async () => {
  const writer = aWriter()
  await kept(writer, asked(0, true))
  assert.deepEqual(theCostsIn(await writer.stream(null)), [[0, 1]])
  assert.equal((await writer.stream(null))[0]?.row['package'], null)
})

test('#860: a package named mid-session closes the old hold and opens the new one at the same reading (mutant: no closing row)', async () => {
  const writer = aWriter()
  await kept(writer, asked(0, true))
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(0.25))
  writer.hold(ANOTHER_PACKAGE)
  await kept(writer, asked(0.75))
  assert.deepEqual(theCostsIn(await writer.stream(null)), [[0, 1], [0.25, 0]], 'the crew\'s hold was not closed where the package was named')
  assert.deepEqual(theCostsIn(await writer.stream(THE_PACKAGE)), [[0.25, 1], [0.75, 0]])
  assert.deepEqual(theCostsIn(await writer.stream(ANOTHER_PACKAGE)), [[0.75, 1]])
  const spend = theSpendBetween({ from: 0, to: Number.MAX_SAFE_INTEGER, usage: new Map([[THE_PACKAGE, await writer.stream(THE_PACKAGE)], [ANOTHER_PACKAGE, await writer.stream(ANOTHER_PACKAGE)]]), crew: await writer.stream(null) })
  assert.ok(!('refused' in spend))
  assert.deepEqual(spend.byPackage.map((one) => [one.package, one.usd.metered]), [[THE_PACKAGE, 0.5], [ANOTHER_PACKAGE, 0]], 'a turn was counted twice, or fell between two holds')
  assert.equal(spend.outsideAnyPackage.metered, 0.25)
})

test('#860: a new session, or the same id started over, opens a hold of its own (mutant: the start left out of the key)', async () => {
  const writer = aWriter()
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(0.5, true))
  await kept(writer, asked(0.25, true, { started_at: STARTED_AT + MINUTE_MS }))
  assert.deepEqual(theCostsIn(await writer.stream(THE_PACKAGE)), [[0.5, 1], [0.25, 1]], 'a /clear was kept as the same session going back')
})

test('#860 R1: a reading is kept under the model that ran the turn, as the launch hands it (mutant: the model read elsewhere)', async () => {
  const writer = aWriter()
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(0.5, true))
  assert.equal((await writer.stream(THE_PACKAGE))[0]?.row['model'], MODEL)
})

test('#860 ruling: a martha-engine session holding its package from its first question counts the cost it reports later (mutant: every null baseline unknown)', async () => {
  const writer = aWriter(ENGINE)
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(null, true, { started_at: null, billing: 'unknown' }))
  await kept(writer, asked(null, false, { started_at: null, billing: 'unknown' }))
  await kept(writer, asked(0.75, false, { started_at: null, billing: 'unknown' }))
  const spend = theSpendBetween({ from: 0, to: Number.MAX_SAFE_INTEGER, usage: new Map([[THE_PACKAGE, await writer.stream(THE_PACKAGE)]]), crew: [] })
  assert.ok(!('refused' in spend))
  assert.deepEqual(spend.byPackage[0]?.usd, { subscription: 0, metered: 0, unknown: 0.75 }, 'the cost of a session that held its package from its start was not counted')
  assert.deepEqual(spend.unknownBaseline, [])
})

test('#860 ruling: the same session picking its package up at a later null reading stays unknown (mutant: 0 taken for every null)', async () => {
  const writer = aWriter(ENGINE)
  await kept(writer, asked(null, true, { started_at: null, billing: 'unknown' }))
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(null, false, { started_at: null, billing: 'unknown' }))
  await kept(writer, asked(0.75, false, { started_at: null, billing: 'unknown' }))
  const spend = theSpendBetween({ from: 0, to: Number.MAX_SAFE_INTEGER, usage: new Map([[THE_PACKAGE, await writer.stream(THE_PACKAGE)]]), crew: await writer.stream(null) })
  assert.ok(!('refused' in spend))
  assert.deepEqual(spend.byPackage[0]?.usd, { subscription: 0, metered: 0, unknown: 0 }, 'a hold with no baseline was measured from 0')
  assert.deepEqual(spend.unknownBaseline.map((one) => [one.package, one.session, one.host]), [[THE_PACKAGE, SESSION, ENGINE]], 'the unknown hold was not named')
  assert.deepEqual(spend.byPackage[0]?.silent, [SESSION])
})

test('#860: the writer\'s memory is one file per member, written only once its rows were kept (mutant: memory written first)', async () => {
  const writer = aWriter()
  writer.hold(THE_PACKAGE)
  const refusing: TheUsagePlaces = { ...writer.places, ledger: { ...writer.places.ledger, stores: { rows: { append: () => Promise.reject(new Error('the disk is full')), read: async () => [] } } } }
  const said = await keepWhatTheSessionSpent(refusing, asked(0.5, true))
  assert.match(said ?? '', /could not keep what builder's session spent \(the disk is full\)/)
  assert.equal(writer.place.holding.has(theUsageFile(MEMBER)), false, 'a reading the store refused was remembered, so it would never be taken again')
  await kept(writer, asked(0.5, true))
  assert.deepEqual(theCostsIn(await writer.stream(THE_PACKAGE)), [[0.5, 1]], 'the refused reading was not taken again')
})

test('#860: a usage row that is not a reading of its stream is refused by name (mutant: a foreign row skipped)', async () => {
  const writer = aWriter()
  writer.hold(THE_PACKAGE)
  await kept(writer, asked(0.5, true))
  const rows = await writer.stream(THE_PACKAGE)
  assert.ok(!('refusal' in theReadingsIn(usageStreamOf(THE_PACKAGE), rows)))
  const moved = theReadingsIn(usageStreamOf(ANOTHER_PACKAGE), rows)
  assert.match('refusal' in moved ? moved.refusal : '', /row 0 of usage\/macula-io\/martha#308 is not a reading/)
  const torn = theReadingsIn(usageStreamOf(THE_PACKAGE), [{ position: 0, row: { ...rows[0]?.row, usd: 'a lot' } }])
  assert.ok('refusal' in torn, 'a reading whose cost is no number was read')
  assert.throws(() => usageStreamOf('not a package'), /is not a work package/)
})
