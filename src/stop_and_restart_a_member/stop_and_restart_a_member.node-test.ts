// Stopping and listing members, as martha#312's design states them: the owner's `martha ls` and `martha stop`, and the
// launcher's watch that answers a stop.
//
// The requests are kept in the crew store the host really composes on a disk (../crew_files_directory), so a request
// read back is the file a launcher would read. The processes are the test's: a table of pids and the identity each
// holds, and a signaller that records every signal it was asked to send and ends a group the way the kernel would.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, mock, test } from 'node:test'

import { launchesIn, type MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { OWNER } from '../declare_crew/declare_crew.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import type { CrewPlace, GroupSignal, KeyedRow, Processes } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'
import { BEAT_INTERVAL_MS, OFFLINE, OFFLINE_AFTER_MS, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { REQUEST_PENDING_LAUNCHER_GONE, theListLine, theMembersListed } from './list_the_members.ts'
import {
  ANSWER_AFTER_EXIT_MS,
  ANSWER_DEADLINE_MS,
  LIFECYCLE_PLACE,
  LIFECYCLE_STREAM,
  MEMBER_STOPPED,
  STOP,
  STOP_GRACE_MS,
  stopAMember,
  theRequestOf,
  watchForAStop,
  type LifecycleRequest,
  type StoppingHost,
  type TheRequest,
} from './stop_and_restart_a_member.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-stop-'))
after(() => removeTheTree(home))
let crews = 0
/** A fresh crew directory per test, so no request of one test is read by another. */
const aLifecyclePlace = (): CrewPlace => {
  const place = crewFilesDirectory(join(home, `crew-${++crews}`)).place(LIFECYCLE_PLACE)
  if ('refusal' in place) throw new Error(place.refusal)
  return place
}

const NODE = 'a'.repeat(64)
const OTHER_NODE = 'b'.repeat(64)
const START = Date.parse('2026-11-13T10:00:00Z')

const launchOf = (member: string, pid: number, identity: string, node_id = NODE): KeyedRow => ({
  key: member,
  row: { member_name: member, node_id, pid, process_started_at: identity, checkout: `/work/${member}`, started_at: '2026-11-13T09:00:00.000Z' } satisfies MemberLaunch,
})

/** A machine's processes as the test holds them: who holds each pid, and every signal asked for. */
function aMachine(running: Record<number, string>) {
  const table = new Map(Object.entries(running).map(([pid, identity]) => [Number(pid), identity]))
  const signals: { readonly pid: number; readonly identity: string; readonly signal: GroupSignal }[] = []
  let endsOn: GroupSignal | null = 'SIGTERM'
  const processes: Pick<Processes, 'identityOf' | 'signalGroup'> = {
    identityOf: (pid) => table.get(pid) ?? null,
    signalGroup: (pid, identity, signal) => {
      if (table.get(pid) !== identity) return { signalled: false, refusal: `process ${pid} is no longer the process that was recorded, so it was not signalled.` }
      signals.push({ pid, identity, signal })
      if (signal === endsOn || signal === 'SIGKILL') table.delete(pid)
      return { signalled: true }
    },
  }
  return {
    processes,
    signals,
    /** The member ignores a request to end, as a host mid-tool might. */
    ignoresSigterm: () => void (endsOn = null),
    /** The pid is handed to another process. */
    reuse: (pid: number, identity: string) => void table.set(pid, identity),
  }
}

/** The owner's verb's host: the test's clock advances whenever the verb waits. */
function aStoppingHost(place: CrewPlace, launches: readonly KeyedRow[], processes: StoppingHost['processes']) {
  const test_host = hostForTests({ now: START, launches })
  const host: StoppingHost = {
    stores: { lifecycle: place, rows: test_host.host.stores.rows },
    launches: () => launchesIn(test_host.host.stores.launches),
    processes,
    clock: test_host.host.clock,
    wait: async (ms) => test_host.advanceClock(ms),
  }
  return { host, rows: test_host.host.stores.rows, advance: (ms: number) => test_host.advanceClock(ms) }
}

const ASKING = { member: 'builder', by: OWNER, reason: 'stalled on a review', id: 'stop-1' }

// --- martha ls ----------------------------------------------------------------------------------------------------

const beat = (member: string, at: number, extra: Partial<DashboardRow> = {}): DashboardRow => ({
  member,
  session: `s-${member}`,
  state: 'working',
  holds: '',
  task: `${member}'s task`,
  progress: { step: 1, of: 3 },
  waits: null,
  needs: '',
  host: { model: 'opus', provider: 'anthropic', contextPercent: null, costUsd: null },
  at,
  ...extra,
})

const MEMBERS = [
  { name: 'lead', model: null },
  { name: 'builder', model: 'sonnet' },
  { name: 'reviewer', model: null },
] as const

function aList(options: { launches: readonly KeyedRow[]; running: Record<number, string>; beats?: Record<string, DashboardRow>; parks?: Record<string, ThePark>; requests?: Record<string, TheRequest>; now?: number }) {
  const now = options.now ?? START
  const { host } = hostForTests({ launches: options.launches })
  return theMembersListed({
    members: MEMBERS,
    rows: seeTheCrew({ members: MEMBERS }, options.beats ?? {}, now).rows,
    launches: launchesIn(host.stores.launches),
    processes: aMachine(options.running).processes,
    parks: options.parks ?? {},
    requests: options.requests ?? {},
    now,
  })
}

test('#312 test 1: ls lists every declared member in the declaration order, each running, stopped or parked', () => {
  const listed = aList({
    launches: [launchOf('builder', 101, 'boot:1')],
    running: { 101: 'boot:1' },
    beats: { builder: beat('builder', START - BEAT_INTERVAL_MS) },
    parks: { reviewer: { kind: 'parked', marker: { parked: true, reason: 'waits', since: '2026-11-13T08:00:00.000Z' } } },
  })
  assert.deepEqual(
    listed.map((one) => [one.member, one.state]),
    [
      ['lead', 'stopped'],
      ['builder', 'running'],
      ['reviewer', 'parked'],
    ],
  )
  assert.equal(theListLine(listed[1]!), "builder  running  /work/builder  since 2026-11-13T09:00:00.000Z  opus  builder's task")
  assert.equal(theListLine(listed[0]!), 'lead  stopped', 'a member nothing is known of shows its name and state, with no gaps')
})

test('#312 test 1: a record whose pid now names another process reads stopped, never running', () => {
  const listed = aList({ launches: [launchOf('builder', 101, 'boot:1')], running: { 101: 'boot:2' }, beats: { builder: beat('builder', START) } })
  assert.equal(listed[1]!.state, 'stopped')
  assert.equal(listed[1]!.checkout, '', 'a dead record lends the line no checkout')
  assert.equal(listed[1]!.task, '', 'nor the task its last row named')
})

test('#312: a running member whose row went quiet reads offline; a declared model shows until a row names one', () => {
  const listed = aList({
    launches: [launchOf('builder', 101, 'boot:1'), launchOf('lead', 102, 'boot:1', OTHER_NODE)],
    running: { 101: 'boot:1', 102: 'boot:1' },
    beats: { lead: beat('lead', START - OFFLINE_AFTER_MS - 1) },
  })
  assert.equal(listed[0]!.state, OFFLINE)
  assert.equal(listed[1]!.state, 'running', 'a member that never beat yet still runs')
  assert.equal(listed[1]!.model, 'sonnet')
})

test('#312: a request no launcher answered by the deadline is shown as pending with its launcher gone', () => {
  const request: LifecycleRequest = { id: 'r', act: STOP, fresh: false, by: OWNER, reason: 'r', at: new Date(START).toISOString(), launch: { pid: 101, process_started_at: 'boot:1' } }
  const pending: TheRequest = { kind: 'pending', request }
  const within = aList({ launches: [launchOf('builder', 101, 'boot:1')], running: { 101: 'boot:1' }, requests: { builder: pending }, now: START + ANSWER_DEADLINE_MS })
  assert.equal(within[1]!.note, `${STOP} asked by ${OWNER} at ${request.at}, pending`)
  const past = aList({ launches: [launchOf('builder', 101, 'boot:1')], running: { 101: 'boot:1' }, requests: { builder: pending }, now: START + ANSWER_DEADLINE_MS + 1 })
  assert.equal(past[1]!.note, REQUEST_PENDING_LAUNCHER_GONE)
})

test('#312 r=1 R2: a request left from an earlier launch puts no note on the member running now', () => {
  const request: LifecycleRequest = { id: 'r', act: STOP, fresh: false, by: OWNER, reason: 'r', at: new Date(START).toISOString(), launch: { pid: 101, process_started_at: 'boot:1' } }
  const listed = aList({ launches: [launchOf('builder', 202, 'boot:2')], running: { 202: 'boot:2' }, requests: { builder: { kind: 'pending', request } }, now: START + ANSWER_DEADLINE_MS + 1 })
  assert.equal(listed[1]!.state, 'running')
  assert.equal(listed[1]!.note, '')
})

// --- martha stop: the launcher answers ----------------------------------------------------------------------------

/** A request kept as a verb would keep it, for a launcher to find. */
function keepAPending(place: CrewPlace, id: string, by: string, launch: { pid: number; process_started_at: string }): void {
  const request = { id, act: STOP, fresh: false, by, reason: 'stalled', at: new Date(START).toISOString(), launch }
  assert.equal(place.keep('builder.json', JSON.stringify({ request, outcome: null })), undefined)
}

test('#312 test 2: a stop is answered by the launcher, which ends the group and keeps member_stopped with who and why', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    const place = aLifecyclePlace()
    const machine = aMachine({ 101: 'boot:1' })
    let ended: (() => void) | undefined
    const stopped = new Promise<void>((resolve) => (ended = resolve))
    // The member ends when its group is asked to, as a host at rest does.
    const processes: StoppingHost['processes'] = {
      identityOf: machine.processes.identityOf,
      signalGroup: (pid, identity, signal) => {
        const sent = machine.processes.signalGroup(pid, identity, signal)
        ended!()
        return sent
      },
    }
    const { host, rows, advance } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], processes)
    // The verb's every wait is the launcher's time passing too: its tick runs while the verb waits.
    const verb: StoppingHost = {
      ...host,
      wait: async (ms) => {
        advance(ms)
        mock.timers.tick(ms)
        await new Promise((resolve) => setImmediate(resolve))
      },
    }
    const told: string[] = []
    const stops: string[] = []
    watchForAStop(
      { stores: { lifecycle: place, rows }, processes, clock: host.clock },
      { member: 'builder', launch: { pid: 101, process_started_at: 'boot:1' }, stop: (why) => void stops.push(why), stopped, tellOwner: (line) => void told.push(line) },
      1_000,
    )
    assert.deepEqual(await stopAMember(verb, ASKING), { kind: 'stopped', ended_by: 'launcher', told: 'builder is stopped.' })
    assert.deepEqual(machine.signals, [{ pid: 101, identity: 'boot:1', signal: 'SIGTERM' }], 'the launcher asked the group to end, and nothing else was sent')
    assert.deepEqual(stops, [], 'a member that ended when asked is not made to')
    assert.deepEqual(told, [`builder is being stopped, asked by ${OWNER}: stalled on a review`])
    const ledger = await rows.read(LIFECYCLE_STREAM)
    assert.equal(ledger.length, 1)
    const { at, ...row } = ledger[0]!.row as Record<string, unknown>
    assert.deepEqual(row, { event: MEMBER_STOPPED, member: 'builder', by: OWNER, reason: 'stalled on a review', id: 'stop-1', ended_by: 'launcher' })
    assert.equal(typeof at, 'string')
  } finally {
    mock.timers.reset()
  }
})

test('#312 test 2: a member that ignores the request to end is made to once the grace is out, and not a tick before', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    const place = aLifecyclePlace()
    const machine = aMachine({ 101: 'boot:1' })
    machine.ignoresSigterm()
    keepAPending(place, 'stop-1', OWNER, { pid: 101, process_started_at: 'boot:1' })
    const stops: string[] = []
    const { host, rows } = aStoppingHost(place, [], machine.processes)
    const unwatch = watchForAStop(
      { stores: { lifecycle: place, rows }, processes: machine.processes, clock: host.clock },
      { member: 'builder', launch: { pid: 101, process_started_at: 'boot:1' }, stop: (why) => void stops.push(why), stopped: new Promise(() => {}), tellOwner: () => {} },
      1_000,
    )
    mock.timers.tick(1_000)
    mock.timers.tick(STOP_GRACE_MS - 1)
    assert.deepEqual(stops, [], 'not one tick before the grace is out')
    mock.timers.tick(1)
    assert.deepEqual(stops, [`asked by ${OWNER}: stalled`])
    mock.timers.tick(10 * STOP_GRACE_MS)
    assert.equal(machine.signals.length, 1, 'a request is acted on once')
    unwatch()
  } finally {
    mock.timers.reset()
  }
})

test('#312 test 2: stopping a member that is not running says so and asks nothing', async () => {
  const place = aLifecyclePlace()
  const machine = aMachine({})
  const { host } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], machine.processes)
  assert.deepEqual(await stopAMember(host, ASKING), { kind: 'not_running', told: 'builder is not running, so nothing was stopped.' })
  assert.deepEqual(theRequestOf(place, 'builder'), { kind: 'none' }, 'no request was written')
  assert.deepEqual(machine.signals, [])
})

test('#312: a launcher acts only on a request for its own launch, never on one left from an earlier one', () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    const place = aLifecyclePlace()
    const machine = aMachine({ 202: 'boot:2' })
    keepAPending(place, 'old', OWNER, { pid: 101, process_started_at: 'boot:1' })
    const { host, rows } = aStoppingHost(place, [], machine.processes)
    const unwatch = watchForAStop(
      { stores: { lifecycle: place, rows }, processes: machine.processes, clock: host.clock },
      { member: 'builder', launch: { pid: 202, process_started_at: 'boot:2' }, stop: () => {}, stopped: new Promise(() => {}), tellOwner: () => {} },
      1_000,
    )
    mock.timers.tick(10 * 1_000)
    assert.deepEqual(machine.signals, [])
    unwatch()
  } finally {
    mock.timers.reset()
  }
})

// --- martha stop: no launcher answers -----------------------------------------------------------------------------

test('#312 test 3: with no launcher answering, the verb ends the recorded group itself while it is the same process', async () => {
  const place = aLifecyclePlace()
  const machine = aMachine({ 101: 'boot:1' })
  const { host, rows } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], machine.processes)
  const stopped = await stopAMember(host, ASKING)
  assert.equal(stopped.kind, 'stopped')
  assert.equal(stopped.kind === 'stopped' && stopped.ended_by, 'owner_verb')
  assert.deepEqual(machine.signals, [{ pid: 101, identity: 'boot:1', signal: 'SIGTERM' }])
  const read = theRequestOf(place, 'builder')
  assert.equal(read.kind === 'answered' && read.outcome.ended_by, 'owner_verb', 'the request is answered, so ls shows nothing pending')
  assert.equal((await rows.read(LIFECYCLE_STREAM)).length, 1)
})

test('#312 test 3: a group that outlives the grace is made to end, and not before the grace is out', async () => {
  const place = aLifecyclePlace()
  const machine = aMachine({ 101: 'boot:1' })
  machine.ignoresSigterm()
  const sentAt: number[] = []
  let clock: { now(): number } | undefined
  const { host } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], {
    identityOf: machine.processes.identityOf,
    signalGroup: (pid, identity, signal) => {
      sentAt.push(clock!.now())
      return machine.processes.signalGroup(pid, identity, signal)
    },
  })
  clock = host.clock
  await stopAMember(host, ASKING)
  assert.deepEqual(
    machine.signals.map((one) => one.signal),
    ['SIGTERM', 'SIGKILL'],
  )
  assert.ok(sentAt[1]! - sentAt[0]! >= STOP_GRACE_MS, `the group was made to end ${sentAt[1]! - sentAt[0]!} ms after it was asked, inside the grace`)
})

test('#312 test 3: a pid handed to another process before the fallback is not signalled; the recorded member is gone, so it is stopped', async () => {
  const place = aLifecyclePlace()
  const machine = aMachine({ 101: 'boot:1' })
  const launches = [launchOf('builder', 101, 'boot:1')]
  const { host } = aStoppingHost(place, launches, {
    identityOf: machine.processes.identityOf,
    signalGroup: (pid, identity, signal) => {
      machine.reuse(101, 'boot:other')
      return machine.processes.signalGroup(pid, identity, signal)
    },
  })
  const stopped = await stopAMember(host, ASKING)
  assert.deepEqual(stopped, { kind: 'stopped', ended_by: 'itself', told: 'builder is stopped; it had ended before its launcher answered, so Martha recorded the stop itself.' })
  assert.deepEqual(machine.signals, [], 'nothing was sent to the process that holds the pid now')
})

// --- the member ends before anyone acts (r=1 R1) -----------------------------------------------------------------

test('#312 r=1 R1: a member gone before its launcher\'s tick is stopped by itself, without the verb waiting out its deadline', async () => {
  const place = aLifecyclePlace()
  const machine = aMachine({ 101: 'boot:1' })
  const { host, rows } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], machine.processes)
  const verb: StoppingHost = {
    ...host,
    // The member ends on its own while the verb waits for the first time.
    wait: async (ms) => {
      machine.reuse(101, 'gone')
      await host.wait(ms)
    },
  }
  const stopped = await stopAMember(verb, ASKING)
  assert.equal(stopped.kind === 'stopped' && stopped.ended_by, 'itself')
  assert.ok(host.clock.now() - START < ANSWER_DEADLINE_MS, `the verb waited ${host.clock.now() - START} ms for a member that had ended`)
  assert.ok(host.clock.now() - START >= ANSWER_AFTER_EXIT_MS, 'and gave its launcher its cleanup first')
  assert.deepEqual(machine.signals, [], 'nothing was signalled')
  const read = theRequestOf(place, 'builder')
  assert.equal(read.kind === 'answered' && read.outcome.ended_by, 'itself', 'the request ends answered, so ls shows nothing pending')
  const ledger = await rows.read(LIFECYCLE_STREAM)
  assert.deepEqual(ledger.map((one) => (one.row as Record<string, unknown>)['ended_by']), ['itself'])
})

test('#312 r=1 R1: a launcher whose member ended before its tick answers the request for it, ended by itself, once', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    const place = aLifecyclePlace()
    const machine = aMachine({})
    keepAPending(place, 'stop-1', OWNER, { pid: 101, process_started_at: 'boot:1' })
    const { host, rows } = aStoppingHost(place, [], machine.processes)
    let ended: (() => void) | undefined
    const stopped = new Promise<void>((resolve) => (ended = resolve))
    watchForAStop(
      { stores: { lifecycle: place, rows }, processes: machine.processes, clock: host.clock },
      { member: 'builder', launch: { pid: 101, process_started_at: 'boot:1' }, stop: () => {}, stopped, tellOwner: () => {} },
      1_000,
    )
    ended!()
    await stopped
    await new Promise((resolve) => setImmediate(resolve))
    const read = theRequestOf(place, 'builder')
    assert.equal(read.kind === 'answered' && read.outcome.ended_by, 'itself')
    assert.deepEqual(machine.signals, [], 'a member already gone is sent nothing')
    const ledger = await rows.read(LIFECYCLE_STREAM)
    assert.deepEqual(ledger.map((one) => (one.row as Record<string, unknown>)['ended_by']), ['itself'], 'one row')
  } finally {
    mock.timers.reset()
  }
})

// --- two at once --------------------------------------------------------------------------------------------------

test('#312 test 8: a second stop while one is in flight is answered with who asked and when', async () => {
  const place = aLifecyclePlace()
  const machine = aMachine({ 101: 'boot:1' })
  const { host, advance } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], machine.processes)
  keepAPending(place, 'first', 'lead', { pid: 101, process_started_at: 'boot:1' })
  advance(ANSWER_DEADLINE_MS)
  assert.deepEqual(await stopAMember(host, ASKING), { kind: 'in_flight', told: `a ${STOP} of builder asked by lead at ${new Date(START).toISOString()} is in flight.` })
  assert.deepEqual(machine.signals, [], 'the second asks nothing of the member')
  const read = theRequestOf(place, 'builder')
  assert.equal(read.kind === 'pending' && read.request.id, 'first', 'and the first request stands')
})

test('#312: a request file nobody can read refuses the stop rather than guessing', async () => {
  const place = aLifecyclePlace()
  assert.equal(place.keep('builder.json', '{"request": "not one"}'), undefined)
  const machine = aMachine({ 101: 'boot:1' })
  const { host } = aStoppingHost(place, [launchOf('builder', 101, 'boot:1')], machine.processes)
  const stopped = await stopAMember(host, ASKING)
  assert.equal(stopped.kind, 'refused')
  assert.match(stopped.told, /holds no lifecycle request/)
})
