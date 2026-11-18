// The launcher's beat over a member's crew tools (martha#658): the Supervisor is told once per loss, the window is
// closed by the successor and named by what closed it, and the successor is handed what the lost session owes.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, ServedToolsHeld } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { countForTheWindow, heedTheCrewTools, theOwedLineAtStart, type ACallInASession, type TheWindowPlaces } from './heed_the_crew_tools.ts'
import { COUNTED_GIT_COMMANDS, CREW_TOOLS_BACK, CREW_TOOLS_LOST, CREW_TOOLS_STREAM, REFRESH, theBackLineOf, theNoticeOf, type ACrewToolsWindow } from './keep_a_members_crew_tools_window.ts'

const MEMBER = 'Terra'
const THE_SUPERVISOR = 'Juno'
const LOST_IN = 'session-that-lost'
const SUCCESSOR = 'successor'
const FROM = Date.parse('2026-11-18T05:48:00.000Z')
const BACK = Date.parse('2026-11-18T06:30:00.000Z')
const WITHDRAWN: ServedToolsHeld = { state: 'withdrawn', at: FROM, cause_neutral: true, causes: ['left_the_configuration'], failed_servers: 0 }
const HELD: ServedToolsHeld = { state: 'held', at: BACK }

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
  assert.equal(theOwedLineAtStart(launch.places), null, 'a closed window owes the next start nothing')
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
  assert.equal(theOwedLineAtStart(launch.places), null, 'no window, nothing owed')
  launch.facts.set(LOST_IN, WITHDRAWN)
  await heedTheCrewTools(launch.places, LOST_IN)
  const [push, merge] = Object.keys(COUNTED_GIT_COMMANDS)
  countForTheWindow(launch.places, LOST_IN, { turn: true })
  countForTheWindow(launch.places, LOST_IN, { turn: true })
  countForTheWindow(launch.places, LOST_IN, { shell: `git ${push} origin terra/x` })
  countForTheWindow(launch.places, LOST_IN, { shell: `git ${merge} origin/main` })
  countForTheWindow(launch.places, SUCCESSOR, { shell: `git ${push} origin terra/x` })
  const owed = theOwedLineAtStart(launch.places) ?? ''
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
  const owed = theOwedLineAtStart(launch.places) ?? ''
  for (const part of ['1 turn(s)', '1 push(es)']) assert.ok(owed.includes(part), `${part} in ${owed}`)
  assert.deepEqual(launch.calls, [])
})
