// The beat of a launch that watches its crew tools (martha#658): the beat lands first, then the look at the tools
// writes what the row says of them, and a session that starts while the window is open is handed what it owes.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'

import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import type { ServedToolsHeld } from '../host_contract/host_contract.ts'
import { theOwedLineAtStart, type TheServedToolsWatch } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import { CREW_TOOLS_STREAM } from '../keep_a_members_crew_tools_window/keep_a_members_crew_tools_window.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { REPORT_WHERE_THE_WORK_STANDS, SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { BEAT_INTERVAL_MS, CREW_TOOLS_FIELD, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { crewToolsOver, THE_TOOLS_ASK } from './a_crews_tools.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-658-beat-'))
after(() => removeTheTree(home))

// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'
const BUILDER = 'Builder1'
const SESSION = 'session-builder'
const LOST_AT = 1_794_000_000_000
const declaration = JSON.stringify({
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: 'Lead', role: SUPERVISOR },
    { name: BUILDER, role: 'builder' },
  ],
  mode: { name: 'team', roles: [SUPERVISOR, 'builder'], may: { ...Object.fromEntries(ACTS.map((act) => [act, [SUPERVISOR]])), approve_landing: [OWNER] } },
  channel_read_seconds: 30,
})
const documents = {
  read: async (path: string): Promise<string> => {
    if (path === join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)) return declaration
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  },
}
const WITHDRAWN: ServedToolsHeld = { state: 'withdrawn', at: LOST_AT, cause_neutral: true, causes: ['left_the_configuration'], failed_servers: 0 }
const HELD: ServedToolsHeld = { state: 'held', at: LOST_AT + 1_000 }

/** A member's tools over its own places on disk, watching a session whose tools the host withdrew. */
function aWatchedMember(t: TestContext) {
  const place = mkdtempSync(join(home, 'member-'))
  t.after(() => removeTheTree(place))
  const clock = { at: 1_000 }
  const beats = dashboardRowsIn(place)
  // The crew's streams folder, as a launch's state already holds it before any beat.
  mkdirSync(join(place, CREW_ROWS_PLACE))
  let fact: ServedToolsHeld = WITHDRAWN
  const served_tools: TheServedToolsWatch = { factOf: () => fact, predecessorOf: () => null, takeTheCalls: () => [] }
  const places = {
    member: BUILDER,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(place, CREW_ROWS_PLACE)) } },
    beats,
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(place, 'the-crew-store')) },
    served_tools,
  }
  const theRow = (): DashboardRow => {
    const row = beats.read(BUILDER)
    assert.ok(row !== null, 'the store holds the member\'s row')
    return row
  }
  return { clock, places, tools: crewToolsOver(places), theRow, setFact: (next: ServedToolsHeld): void => void (fact = next) }
}

/** Lets the look a beat started settle: its last write is the window's row on the crew's stream, then it tells. */
async function untilTheLookSettles(places: ReturnType<typeof aWatchedMember>['places'], rows = 1): Promise<void> {
  const written = async (): Promise<boolean> => (await places.ledger.stores.rows.read(CREW_TOOLS_STREAM)).length >= rows
  for (let wait = 0; wait < 200 && !(await written()); wait += 1) await new Promise((settled) => setTimeout(settled, 5))
  for (let turn = 0; turn < 10; turn += 1) await new Promise((settled) => setImmediate(settled))
}

test('crew tools built over places that hold a watch hold that same watch, as a launch\'s builder must return them (martha#710)', (t) => {
  // Typed by the overload as HoldingTheWatch<CrewTools>: places with a watch are answered by the first overload, which a builder
  // that left the watch out could not return. At run time the field is the watch the places carried, not another.
  const member = aWatchedMember(t)
  assert.equal(member.tools.served_tools, member.places.served_tools, 'the tools carry a watch other than the one their places held')
})

test('a beat of a watched launch writes on the row that the member has lost its crew tools, since the host withdrew them', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const member = aWatchedMember(t)
  member.clock.at += 1_000
  const said = await member.tools.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'build', step: 1, of: 3 }, SESSION)
  assert.ok('answer' in said)
  assert.equal(member.theRow()[CREW_TOOLS_FIELD], undefined, 'a report says nothing of the tools')
  member.clock.at += 1_000
  const stop = member.tools.startBeating()
  t.mock.timers.tick(BEAT_INTERVAL_MS)
  assert.equal(member.theRow().at, member.clock.at, 'the beat landed before the tools were looked at')
  await untilTheLookSettles(member.places)
  // The next beat writes what the look found, at the same moment of the test's clock as the first: it is newer by the clock's next tick.
  member.clock.at += 1
  t.mock.timers.tick(BEAT_INTERVAL_MS)
  stop()
  assert.deepEqual(member.theRow()[CREW_TOOLS_FIELD], { state: 'lost', since: LOST_AT })
})

test('a session that starts while its member\'s window is open is handed the owed line, word for word', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const member = aWatchedMember(t)
  await member.tools.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'build', step: 1, of: 3 }, SESSION)
  const stop = member.tools.startBeating()
  t.mock.timers.tick(BEAT_INTERVAL_MS)
  stop()
  await untilTheLookSettles(member.places)
  const owed = theOwedLineAtStart(member.places)
  assert.ok(owed !== null, 'the beat opened the window')
  const handed = await member.tools.theLineToHandAtStart()
  assert.ok(handed !== null, 'a line is handed')
  assert.equal(handed.line.split('\n\n').at(-1), owed)
})

test('the owed line rides only the report: a turn\'s answer is still the act alone (martha#658)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const member = aWatchedMember(t)
  await member.tools.answer(REPORT_WHERE_THE_WORK_STANDS, { task: 'build', step: 1, of: 3 }, SESSION)
  const stop = member.tools.startBeating()
  t.mock.timers.tick(BEAT_INTERVAL_MS)
  await untilTheLookSettles(member.places)
  // The same session earns its tools back: the beat closes the window SAME_SESSION.
  member.setFact(HELD)
  member.clock.at += 1_000
  t.mock.timers.tick(BEAT_INTERVAL_MS)
  await untilTheLookSettles(member.places, 2)
  stop()
  const said = await member.tools.answer(THE_TOOLS_ASK, {}, SESSION)
  const text = 'answer' in said ? said.answer : said.refused
  assert.ok(!text.includes('You owe one'), `the owed line did not ride the turn's answer: ${text}`)
  if ('answer' in said) assert.doesNotThrow(() => JSON.parse(said.answer), `the turn's answer is still the act alone: ${said.answer}`)
})
