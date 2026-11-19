// The launcher's beat over a member's crew tools (martha#658): the Supervisor is told once per loss, the window is
// closed by the successor and named by what closed it, the beats a window owes are handed to the first successor that
// starts, and the session that lost its own tools is told only the times (Done-when 4).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, ServedToolsHeld } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { REPORT_WHERE_THE_WORK_STANDS, SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import type { TheStartLine } from '../hand_a_member_its_crew_text/the_start_line.ts'
import {
  countForTheWindow,
  heedTheCrewTools,
  theBeatsMarkedOn,
  theOwedLineAtStart,
  withTheOwedLine,
  withTheTimesLineOnAReturn,
  type ACallInASession,
  type TheWindowPlaces,
} from './heed_the_crew_tools.ts'
import { COUNTED_GIT_COMMANDS, CREW_TOOLS_BACK, CREW_TOOLS_LOST, CREW_TOOLS_STREAM, REFRESH, RELAUNCH, SAME_SESSION, theBackLineOf, theNoticeOf, theOwedLineOf, theTimesLineOf, theWindowOf, type ACrewToolsWindow } from './keep_a_members_crew_tools_window.ts'

const MEMBER = 'Terra'
const THE_SUPERVISOR = 'Juno'
const LOST_IN = 'session-that-lost'
const SUCCESSOR = 'successor'
const FROM = Date.parse('2026-11-18T05:48:00.000Z')
const BACK = Date.parse('2026-11-18T06:30:00.000Z')
const WITHDRAWN: ServedToolsHeld = { state: 'withdrawn', at: FROM, cause_neutral: true, causes: ['left_the_configuration'], failed_servers: 0 }
const HELD: ServedToolsHeld = { state: 'held', at: BACK }
const timeOf = (at: number): string => new Date(at).toISOString()

const SETTINGS = {
  owner: 'owner',
  members: [
    { name: THE_SUPERVISOR, role: SUPERVISOR },
    { name: MEMBER, role: 'builder' },
  ],
  mode: { may: {} },
} as unknown as CrewSettings

/** The crew place in memory, whose keep can be refused once. */
function aPlace(): CrewPlace & { refuseNextKeep(): void } {
  const files = new Map<string, string>()
  let refuse = false
  return {
    path: '/in/memory',
    keep: (name, text) => {
      if (refuse) {
        refuse = false
        return { refusal: 'the disk would not take it' }
      }
      files.set(name, text)
      return undefined
    },
    read: (name) => (files.has(name) ? { text: files.get(name) ?? '' } : undefined),
    names: () => [...files.keys()],
    refuseNextKeep: () => void (refuse = true),
  }
}

/** A launch whose watch answers the facts and predecessors the test sets. */
function aLaunch() {
  const { host } = hostForTests()
  const place = aPlace()
  const facts = new Map<string, ServedToolsHeld>()
  const predecessors = new Map<string, string>()
  const calls: ACallInASession[] = []
  const places: TheWindowPlaces = {
    member: MEMBER,
    ledger: host,
    stores: { crew: { place: () => place } },
    settings: SETTINGS,
    served_tools: { factOf: (id) => facts.get(id) ?? { state: 'unknown' }, predecessorOf: (id) => predecessors.get(id) ?? null, takeTheCalls: () => calls.splice(0) },
  }
  const told = async () => (await readTheChannel(host)).map(({ message }) => ({ to: message.to, text: message.text }))
  const rows = async () => (await host.stores.rows.read(CREW_TOOLS_STREAM)).map(({ row }) => row as unknown as ACrewToolsWindow & { event: string })
  return { places, place, facts, predecessors, calls, told, rows }
}

/**
 * One start's hand as the crew's own composition makes it: the line the start is handed, and the mark left once the
 * start is taken — or, for a refused start, no mark at all (martha#658 Done-when 4).
 */
function aStartHandedAt(launch: ReturnType<typeof aLaunch>, session_id: string, taken = true): TheStartLine | null {
  const handed = withTheOwedLine(launch.places, session_id, null)
  if (handed.beats_read !== undefined && taken) theBeatsMarkedOn(launch.places, handed.beats_read)
  return handed.line
}

/** A loss, a few beats counted in it, and the same session earning its tools back: the window its own report must tell. */
async function aLossToldAndClosed(launch: ReturnType<typeof aLaunch>): Promise<ACrewToolsWindow> {
  const [push, merge] = Object.keys(COUNTED_GIT_COMMANDS)
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  countForTheWindow(launch.places, LOST_IN, { turn: true })
  countForTheWindow(launch.places, LOST_IN, { shell: `git ${push} origin x && git ${merge} origin/main` })
  launch.facts.set(LOST_IN, HELD)
  await heedTheCrewTools(launch.places, LOST_IN)
  const closed = (await launch.rows())[1]!
  assert.equal(closed.closed_by, SAME_SESSION, 'the same session did not close its own window')
  return closed
}

test('a loss is told to the Supervisor once, however many beats read it, and the row says lost since then', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  assert.deepEqual(await heedTheCrewTools(launch.places, LOST_IN), { state: 'lost', since: FROM })
  assert.deepEqual(await heedTheCrewTools(launch.places, LOST_IN), { state: 'lost', since: FROM })
  const told = await launch.told()
  assert.equal(told.length, 1)
  assert.deepEqual(told[0]?.to, [THE_SUPERVISOR])
  const rows = await launch.rows()
  assert.deepEqual(rows.map((row) => row.event), [CREW_TOOLS_LOST])
  assert.equal(told[0]?.text, theNoticeOf(rows[0]!))
})

test('the successor of a refresh closes the window as a refresh, the Supervisor hears it is back, and the row reads held', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  launch.facts.set(SUCCESSOR, HELD)
  launch.predecessors.set(SUCCESSOR, LOST_IN)
  assert.deepEqual(await heedTheCrewTools(launch.places, SUCCESSOR), { state: 'held' })
  const rows = await launch.rows()
  assert.deepEqual(rows.map((row) => row.event), [CREW_TOOLS_LOST, CREW_TOOLS_BACK])
  assert.equal(rows[1]?.closed_by, REFRESH)
  assert.equal(rows[1]?.to, BACK)
  const told = await launch.told()
  assert.equal(told.length, 2)
  assert.equal(told[1]?.text, theBackLineOf(rows[1]!))
})

test('a window the store would not keep says nothing, and the next beat tells it once', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  launch.place.refuseNextKeep()
  assert.deepEqual(await heedTheCrewTools(launch.places, LOST_IN), { state: 'unknown' })
  assert.deepEqual(await launch.told(), [])
  assert.deepEqual(await launch.rows(), [])
  await heedTheCrewTools(launch.places, LOST_IN)
  assert.equal((await launch.told()).length, 1)
})

test("the lost session's turns, pushes and merges are counted, and a starting successor is handed what it owes", async () => {
  const launch = aLaunch()
  assert.equal(theOwedLineAtStart(launch.places, SUCCESSOR), null, 'no window, nothing owed')
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  const [push, merge] = Object.keys(COUNTED_GIT_COMMANDS)
  countForTheWindow(launch.places, LOST_IN, { turn: true })
  countForTheWindow(launch.places, LOST_IN, { turn: true })
  countForTheWindow(launch.places, LOST_IN, { shell: `git ${push} origin terra/x` })
  countForTheWindow(launch.places, LOST_IN, { shell: `git ${merge} origin/main` })
  countForTheWindow(launch.places, SUCCESSOR, { shell: `git ${push} origin terra/x` })
  const owed = theOwedLineAtStart(launch.places, SUCCESSOR)?.line ?? ''
  for (const part of ['2 turn(s)', '1 push(es)', '1 merge(s)']) assert.ok(owed.includes(part), `${part} in ${owed}`)
})

test('a launch that watches no tools leaves the row as it was and keeps nothing', async () => {
  const launch = aLaunch()
  const { served_tools: _, ...without } = launch.places
  assert.equal(await heedTheCrewTools(without, LOST_IN), undefined)
  assert.deepEqual(launch.place.names(), [])
})

test("the calls the watch answered are counted on the next beat, each into its own session's window, and taken once", async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  const [push] = Object.keys(COUNTED_GIT_COMMANDS)
  launch.calls.push({ session: LOST_IN, call: { turn: true } }, { session: LOST_IN, call: { shell: `git ${push} origin x` } }, { session: SUCCESSOR, call: { turn: true } })
  await heedTheCrewTools(launch.places, LOST_IN)
  await heedTheCrewTools(launch.places, LOST_IN)
  const owed = theOwedLineAtStart(launch.places, SUCCESSOR)?.line ?? ''
  for (const part of ['1 turn(s)', '1 push(es)']) assert.ok(owed.includes(part), `${part} in ${owed}`)
  assert.deepEqual(launch.calls, [])
})

test('a returning session is told more than the times: its answer carries both times and no count or owed beat (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  const closed = await aLossToldAndClosed(launch)
  const said = { answer: 'Progress noted: 1/1, working.' }
  const told = withTheTimesLineOnAReturn(launch.places, LOST_IN, said)
  assert.deepEqual(told, { answer: `${said.answer}\n\n${theTimesLineOf(closed)}` }, 'the returning session was not told the times')
  assert.ok('answer' in told)
  for (const when of [timeOf(FROM), timeOf(BACK)]) assert.ok(told.answer.includes(when), `the times line does not name ${when}: ${told.answer}`)
  assert.ok(!/owe/i.test(told.answer), `the returning session was handed what it owes, not only the times: ${told.answer}`)
  assert.ok(!/turn|push|merge/.test(told.answer), `the returning session was handed a count: ${told.answer}`)
})

test('the times line was not handed once: a second report carries nothing and the file holds times_told (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  await aLossToldAndClosed(launch)
  withTheTimesLineOnAReturn(launch.places, LOST_IN, { answer: 'Progress noted: 1/1, working.' })
  const again = withTheTimesLineOnAReturn(launch.places, LOST_IN, { answer: 'Progress noted: 2/2, done.' })
  assert.deepEqual(again, { answer: 'Progress noted: 2/2, done.' }, 'the times were told twice')
  assert.equal(theWindowOf(launch.place, MEMBER)?.times_told, true, 'the report did not mark the window it told')
})

test('a successor starting after a refresh is handed the owed beats, and the window it read (martha#658 Done-when 4)', async () => {
  for (const [closure, predecessor] of [[REFRESH, LOST_IN], [RELAUNCH, null]] as const) {
    const launch = aLaunch()
    launch.facts.set(LOST_IN, WITHDRAWN)
    await heedTheCrewTools(launch.places, LOST_IN)
    launch.facts.set(SUCCESSOR, HELD)
    if (predecessor !== null) launch.predecessors.set(SUCCESSOR, predecessor)
    await heedTheCrewTools(launch.places, SUCCESSOR)
    const closed = (await launch.rows())[1]!
    assert.equal(closed.closed_by, closure)
    const handed = withTheOwedLine(launch.places, 'a-successor-after', null)
    assert.equal(handed.line?.line, theOwedLineOf(closed), `a ${closure} close handed the successor no beats`)
    assert.deepEqual(handed.beats_read, { session: LOST_IN, from: FROM }, 'the hand did not name the window it read, so no start could mark it')
  }
})

test('a second successor is handed the beats twice: the first start marks the window, and no later one is handed it (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  launch.facts.set(SUCCESSOR, HELD)
  launch.predecessors.set(SUCCESSOR, LOST_IN)
  await heedTheCrewTools(launch.places, SUCCESSOR)
  const closed = (await launch.rows())[1]!
  assert.ok(aStartHandedAt(launch, 'first-successor')?.line.includes(theOwedLineOf(closed)) ?? false, 'the first start was handed no beats')
  assert.equal(aStartHandedAt(launch, 'second-successor'), null, 'a second start was handed the same beats again')
  assert.equal(theWindowOf(launch.place, MEMBER)?.beats_handed, true, 'the file does not hold the mark the first start left')
  assert.equal(theWindowOf(launch.place, MEMBER)?.times_told, undefined, 'a start wrote the report\'s mark')
})

test('the session that lost the tools is handed the beats at a start: its own start over its closed window carries nothing (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  const closed = await aLossToldAndClosed(launch)
  assert.equal(theOwedLineAtStart(launch.places, LOST_IN)?.line, undefined, `the session that lost the tools was handed its own beats: ${theOwedLineOf(closed)}`)
  assert.equal(theWindowOf(launch.place, MEMBER)?.beats_handed, undefined, 'a start that handed nothing marked the window')
})

test('a refused answer is left alone and hands nothing, so the line goes on the next report (martha#658)', async () => {
  const launch = aLaunch()
  const closed = await aLossToldAndClosed(launch)
  assert.deepEqual(withTheTimesLineOnAReturn(launch.places, LOST_IN, { refused: 'not now' }), { refused: 'not now' })
  assert.equal(theWindowOf(launch.place, MEMBER)?.times_told, undefined, 'a refused answer marked the times told')
  const said = withTheTimesLineOnAReturn(launch.places, LOST_IN, { answer: 'Progress noted: 1/1, working.' })
  assert.ok('answer' in said && said.answer.endsWith(theTimesLineOf(closed)), 'the times did not go on the next report')
})

test('the times are told only to the session that lost the tools: another session reporting first is told nothing and marks nothing (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  const closed = await aLossToldAndClosed(launch)
  const said = { answer: 'Progress noted: 1/1, working.' }
  assert.deepEqual(withTheTimesLineOnAReturn(launch.places, SUCCESSOR, said), said, 'another session was told the times of a loss that was not its own')
  assert.equal(theWindowOf(launch.place, MEMBER)?.times_told, undefined, "another session's report marked the times told")
  const own = withTheTimesLineOnAReturn(launch.places, LOST_IN, said)
  assert.ok('answer' in own && own.answer.endsWith(theTimesLineOf(closed)), 'the session that lost the tools was not told its times after another session reported')
})

test('a new loss that opened before the start was answered is left unmarked by the hand the old window gave (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  const handed = withTheOwedLine(launch.places, 'a-successor', null)
  assert.ok(handed.beats_read !== undefined, 'the start was handed no beats to carry')
  // The window that hand read is gone by the time the start is answered: it closed, and a new loss opened.
  launch.facts.set(LOST_IN, HELD)
  await heedTheCrewTools(launch.places, LOST_IN)
  launch.facts.set('later', { ...WITHDRAWN, at: BACK + 1 } as ServedToolsHeld)
  await heedTheCrewTools(launch.places, 'later')
  theBeatsMarkedOn(launch.places, handed.beats_read!)
  assert.equal(theWindowOf(launch.place, MEMBER)?.session, 'later', 'the test did not leave a newer loss open')
  assert.equal(theWindowOf(launch.place, MEMBER)?.beats_handed, undefined, 'the hand the old window gave marked the new loss')
})

test('the beats were handed twice across a close: a start while the window is open marks it, and the start after the close carries nothing (martha#658 Done-when 4)', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  assert.ok(aStartHandedAt(launch, 'first-successor') !== null, 'a start over an open window was handed no beats')
  assert.equal(theWindowOf(launch.place, MEMBER)?.beats_handed, true, 'a hand over an open window was not marked, so the next start takes the beats again')
  launch.facts.set(SUCCESSOR, HELD)
  launch.predecessors.set(SUCCESSOR, LOST_IN)
  await heedTheCrewTools(launch.places, SUCCESSOR)
  assert.equal((await launch.rows())[1]?.closed_by, REFRESH)
  assert.equal(theWindowOf(launch.place, MEMBER)?.beats_handed, true, 'the close dropped the mark the open hand left')
  assert.equal(aStartHandedAt(launch, 'second-successor'), null, 'the start after the close took the beats a second time')
})

test('only the session that lost the tools is handed its line on return: a refresh or a relaunch hands none (martha#658)', async () => {
  for (const [closure, predecessor] of [[REFRESH, LOST_IN], [RELAUNCH, null]] as const) {
    const launch = aLaunch()
    launch.facts.set(LOST_IN, WITHDRAWN)
    await heedTheCrewTools(launch.places, LOST_IN)
    launch.facts.set(SUCCESSOR, HELD)
    if (predecessor !== null) launch.predecessors.set(SUCCESSOR, predecessor)
    await heedTheCrewTools(launch.places, SUCCESSOR)
    assert.equal((await launch.rows())[1]?.closed_by, closure)
    for (const session of [SUCCESSOR, LOST_IN]) {
      const said = { answer: 'Progress noted: 1/1, working.' }
      assert.deepEqual(withTheTimesLineOnAReturn(launch.places, session, said), said, `a ${closure} close told ${session} the times`)
    }
  }
})

test('a new loss before the report leaves nothing to hand, and its window is left as it is (martha#658)', async () => {
  const launch = aLaunch()
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  launch.facts.set(LOST_IN, HELD)
  await heedTheCrewTools(launch.places, LOST_IN)
  // The handing is lost, the beats are not: the back line already named them to the Supervisor as owed.
  const back = (await launch.rows())[1]!
  assert.equal(back.closed_by, SAME_SESSION)
  launch.facts.set('later', { ...WITHDRAWN, at: BACK + 1 } as ServedToolsHeld)
  await heedTheCrewTools(launch.places, 'later')
  const said = { answer: 'Progress noted: 1/1, working.' }
  assert.deepEqual(withTheTimesLineOnAReturn(launch.places, LOST_IN, said), said)
  assert.equal(theWindowOf(launch.place, MEMBER)?.to, undefined, 'the new loss is still the open window')
  assert.ok((await launch.told()).some(({ text }) => text === theBackLineOf(back) && text.includes(REPORT_WHERE_THE_WORK_STANDS)), 'the back line named no owed beats before the new loss')
})
