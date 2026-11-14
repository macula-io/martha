// Restarting a member, as martha#312's design states it (tests 4 to 10): the asker's request, the launcher's hold that
// starts the member again, who may ask through the tool, and the storm window that stops a restart loop.
//
// The requests and the handovers are kept in the crew store the host really composes on a disk
// (../crew_files_directory), and the handovers are written and stamped by the host's own write (../write_my_handover),
// so what the hold reads is what a launch would have left. The processes and the start are the test's.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, mock, test } from 'node:test'

import { launchesIn, type MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_SESSION_EVENTS, startSession } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import { OWNER, RESTART_MEMBER } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, KeyedRow, Processes, RowStore } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import type { TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { STORM_WINDOW_MS } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { theResumePrompt } from '../wake_a_member/wake_a_member.ts'
import { CREW_HANDOVER_WRITTEN, HANDOVERS_PLACE, theHandoverFile, writeMyHandover } from '../write_my_handover/write_my_handover.ts'
import { holdTheMember, notRunningToRestart, restartAMember, restartByTool, type AStart, type HoldingHost } from './restart_a_member.ts'
import {
  ANSWER_DEADLINE_MS,
  LIFECYCLE_PLACE,
  LIFECYCLE_STREAM,
  MEMBER_RESTARTED,
  RESTART,
  RESTART_ANSWER_DEADLINE_MS,
  STOP,
  STOP_GRACE_MS,
  theRequestOf,
  watchForAStop,
  type LifecycleRequest,
  type StoppingHost,
} from './stop_and_restart_a_member.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-restart-'))
after(() => removeTheTree(home))

const NODE = 'a'.repeat(64)
const START = Date.parse('2026-11-13T10:00:00Z')
const LAUNCH = { pid: 101, process_started_at: 'boot:1' }

/** A fresh crew directory per test, so no request or handover of one test is read by another. */
let crews = 0
function aCrew() {
  const directory = join(home, `crew-${++crews}`)
  const crew = crewFilesDirectory(directory)
  const lifecycle = crew.place(LIFECYCLE_PLACE)
  if ('refusal' in lifecycle) throw new Error(lifecycle.refusal)
  return { crew, lifecycle, stamps: handoverStampsIn(directory) }
}

const launchOf = (member: string, pid: number, identity: string): KeyedRow => ({
  key: member,
  row: { member_name: member, node_id: NODE, pid, process_started_at: identity, checkout: `/work/${member}`, started_at: '2026-11-13T09:00:00.000Z' } satisfies MemberLaunch,
})

/** An asker's host whose clock moves when it waits, and a launcher stand-in that may answer while it does. */
function anAskingHost(lifecycle: CrewPlace, running: Record<number, string>, onWait: (now: number) => void = () => {}) {
  const test_host = hostForTests({ now: START, launches: [launchOf('builder', LAUNCH.pid, LAUNCH.process_started_at)] })
  const table = new Map(Object.entries(running).map(([pid, identity]) => [Number(pid), identity]))
  const processes: Pick<Processes, 'identityOf' | 'signalGroup'> = {
    identityOf: (pid) => table.get(pid) ?? null,
    signalGroup: () => assert.fail('a restart asker never signals: only the launcher ends the member'),
  }
  const host: StoppingHost = {
    stores: { lifecycle, rows: test_host.host.stores.rows },
    launches: () => launchesIn(test_host.host.stores.launches),
    processes,
    clock: test_host.host.clock,
    wait: async (ms) => {
      test_host.advanceClock(ms)
      onWait(test_host.host.clock.now())
    },
  }
  return { host, rows: test_host.host.stores.rows, advance: (ms: number) => test_host.advanceClock(ms) }
}

/** A pending restart for the builder's launch, as an asker keeps it. */
function keepARestart(lifecycle: CrewPlace, options: { fresh?: boolean; by?: string; id?: string } = {}): LifecycleRequest {
  const request: LifecycleRequest = { id: options.id ?? 'restart-1', act: RESTART, fresh: options.fresh ?? false, by: options.by ?? 'lead', reason: 'stalled', at: new Date(START).toISOString(), launch: LAUNCH }
  assert.equal(lifecycle.keep('builder.json', JSON.stringify({ request, outcome: null })), undefined)
  return request
}

/** Writes and stamps a handover for the builder at `at`, through the host's own write; answers its file name. */
function handedOver(crew: ReturnType<typeof aCrew>, at: Date): string {
  const session = startSession({ read: () => undefined, write: () => {} }, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: `s-${at.getTime()}` })
  const written = writeMyHandover({ stores: { crew: crew.crew } }, { member: 'builder', content: 'What stands.', at, stamps: crew.stamps, session })
  assert.equal(written, CREW_HANDOVER_WRITTEN, `the host did not write the handover the test needed: ${written}`)
  return theHandoverFile('builder', at)
}

/** The launcher's hold over the test's stores: each start is recorded and answered as the test says. */
function aHold(crew: ReturnType<typeof aCrew>, starts: AStart<string>[], rows: RowStore, state: string | null = null, identity = LAUNCH.process_started_at) {
  const asked: (string | undefined)[] = []
  const told: string[] = []
  const identities = new Map<number, string>([[LAUNCH.pid, identity]])
  const host: HoldingHost<string> = {
    stores: { lifecycle: crew.lifecycle, rows, crew: crew.crew },
    stamps: crew.stamps,
    processes: { identityOf: (pid) => identities.get(pid) ?? null },
    clock: { now: () => START },
    rowStateOf: () => state,
    start: async (prompt) => {
      asked.push(prompt)
      const next = starts.shift() ?? { started: false, refusal: 'the test has no start left' }
      if (next.started) identities.set(next.pid, `boot:${next.pid}`)
      return next
    },
    tellOwner: (line) => void told.push(line),
  }
  return { host, asked, told }
}

const ended = (why: string) => ({ started: true as const, pid: LAUNCH.pid, stopped: Promise.resolve(why) })

// --- test 4: the restart resumes from the newest handover -------------------------------------------------------

test('#312 test 4: a restart starts the member again on the wake\'s prompt, naming the newest handover by stamp time', async () => {
  const crew = aCrew()
  const older = handedOver(crew, new Date(START - 2 * 86_400_000))
  const newest = handedOver(crew, new Date(START - 60_000))
  const request = keepARestart(crew.lifecycle)
  const { rows } = anAskingHost(crew.lifecycle, {})
  const { host, asked } = aHold(crew, [{ started: true, pid: 202, stopped: Promise.resolve('ended for good') }], rows)
  const held = await holdTheMember(host, 'builder', ended('restarted'))
  assert.deepEqual(held, { kind: 'ended', ended: 'ended for good' }, 'the hold ends with the second launch, not the first')
  assert.equal(asked.length, 1)
  assert.ok(asked[0]!.includes(newest), `the prompt names the newest handover: ${asked[0]}`)
  assert.ok(!asked[0]!.includes(older), 'and not an older one')
  assert.ok(asked[0]!.startsWith(theResumePrompt({ file: '', written_at: '' } as never, 'builder').split(' at ')[0]!), 'on the wake\'s own prompt')
  const read = theRequestOf(crew.lifecycle, 'builder')
  assert.ok(read.kind === 'answered' && read.outcome.id === request.id && read.outcome.restarted?.started === true, 'the restart is answered, started')
  const ledger = (await rows.read(LIFECYCLE_STREAM)).map((one) => one.row as Record<string, unknown>)
  assert.deepEqual(ledger.map((row) => [row['event'], row['by'], row['fresh'], row['started']]), [[MEMBER_RESTARTED, 'lead', false, true]])
})

test('#312 r=2: the launcher answers which handover the member was started on', async () => {
  const crew = aCrew()
  const newest = handedOver(crew, new Date(START - 60_000))
  keepARestart(crew.lifecycle)
  const { rows } = anAskingHost(crew.lifecycle, {})
  const { host } = aHold(crew, [{ started: true, pid: 202, stopped: Promise.resolve('done') }], rows)
  await holdTheMember(host, 'builder', ended('restarted'))
  const read = theRequestOf(crew.lifecycle, 'builder')
  const handovers = crew.crew.place(HANDOVERS_PLACE)
  assert.ok(!('refusal' in handovers))
  assert.equal(read.kind === 'answered' && read.outcome.resumed_from, join(handovers.path, newest))
})

test('#312 r=2: a member with no handover is answered as started on none, and the asker is not told of a handover', async () => {
  const crew = aCrew()
  keepARestart(crew.lifecycle)
  const asking = anAskingHost(crew.lifecycle, {})
  const { host, asked } = aHold(crew, [{ started: true, pid: 202, stopped: Promise.resolve('done') }], asking.rows)
  await holdTheMember(host, 'builder', ended('restarted'))
  assert.deepEqual(asked, [undefined])
  const held = theRequestOf(crew.lifecycle, 'builder')
  assert.ok(held.kind === 'answered' && held.outcome.resumed_from === null, 'the answer names no handover')
  const reading = aCrew()
  const asker = anAskingHost(reading.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at }, () => {
    const read = theRequestOf(reading.lifecycle, 'builder')
    if (read.kind !== 'pending') return
    reading.lifecycle.keep('builder.json', JSON.stringify({ request: read.request, outcome: held.kind === 'answered' ? { ...held.outcome, id: read.request.id } : null }))
  })
  const told = await restartAMember(asker.host, { member: 'builder', by: OWNER, reason: 'r', id: 'n', fresh: false })
  assert.deepEqual(told, { kind: 'restarted', told: 'builder is restarted with no handover, since it has handed nothing over.' })
})

test('#312 r=2: a fresh restart is told as fresh', async () => {
  const crew = aCrew()
  const { host } = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at }, () => {
    const read = theRequestOf(crew.lifecycle, 'builder')
    if (read.kind !== 'pending') return
    crew.lifecycle.keep('builder.json', JSON.stringify({ request: read.request, outcome: { id: read.request.id, ended_by: 'launcher', at: read.request.at, restarted: { started: true }, mid_turn: false, resumed_from: null } }))
  })
  assert.deepEqual(await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'f', fresh: true }), { kind: 'restarted', told: 'builder is restarted fresh, with no handover.' })
})

test('#312 r=2: a restart unanswered after its launch is gone does not say nothing was ended', async () => {
  const crew = aCrew()
  let ended_it = false
  const table: Record<number, string> = { [LAUNCH.pid]: LAUNCH.process_started_at }
  const { host } = anAskingHost(crew.lifecycle, table, () => {
    if (ended_it) return
    // The launcher ended the member and never answered: from here on the recorded launch is gone.
    ended_it = true
  })
  const processes = host.processes
  const gone: StoppingHost = { ...host, processes: { ...processes, identityOf: (pid) => (ended_it ? null : processes.identityOf(pid)) } }
  const told = await restartAMember(gone, { member: 'builder', by: OWNER, reason: 'r', id: 'g', fresh: false })
  assert.deepEqual(told, {
    kind: 'refused',
    told: 'builder was ended and its launcher has not said within 120 s that it started again. martha ls shows whether it is back, and martha wake builder starts it from its newest handover if it is not.',
  })
})

test('#312 r=2: a ledger that fails after a refused start says the member was not started again', async () => {
  const crew = aCrew()
  keepARestart(crew.lifecycle)
  const { rows } = anAskingHost(crew.lifecycle, {})
  const failing: RowStore = { ...rows, append: async () => Promise.reject(new Error('disk full')) }
  const { host, told } = aHold(crew, [{ started: false, refusal: 'not approved' }], failing)
  await holdTheMember(host, 'builder', ended('restarted'))
  assert.ok(told.includes('builder was ended and not started again, and the ledger did not keep it: disk full'), told.join(' | '))
})

test('#312 test 4: a fresh restart carries no handover', async () => {
  const crew = aCrew()
  handedOver(crew, new Date(START - 60_000))
  keepARestart(crew.lifecycle, { fresh: true })
  const { rows } = anAskingHost(crew.lifecycle, {})
  const { host, asked } = aHold(crew, [{ started: true, pid: 202, stopped: Promise.resolve('done') }], rows)
  await holdTheMember(host, 'builder', ended('restarted'))
  assert.deepEqual(asked, [undefined])
})

test('#312: a member that ends with no restart asked of its launch is not started again', async () => {
  const crew = aCrew()
  const { rows } = anAskingHost(crew.lifecycle, {})
  const { host, asked } = aHold(crew, [], rows)
  assert.deepEqual(await holdTheMember(host, 'builder', ended('the member exited')), { kind: 'ended', ended: 'the member exited' })
  assert.deepEqual(asked, [])
})

test('#312: a stop asked of the launch is not taken for a restart', async () => {
  const crew = aCrew()
  const request = { id: 's', act: STOP, fresh: false, by: OWNER, reason: 'r', at: new Date(START).toISOString(), launch: LAUNCH }
  assert.equal(crew.lifecycle.keep('builder.json', JSON.stringify({ request, outcome: null })), undefined)
  const { rows } = anAskingHost(crew.lifecycle, {})
  const { host, asked } = aHold(crew, [], rows)
  await holdTheMember(host, 'builder', ended('stopped'))
  assert.deepEqual(asked, [])
})

test('#312: a restart left from an earlier launch does not restart the launch running now', async () => {
  const crew = aCrew()
  keepARestart(crew.lifecycle)
  const { rows } = anAskingHost(crew.lifecycle, {})
  // The same pid, held by a later process: the launch running now is not the one the restart was asked of.
  const { host, asked } = aHold(crew, [], rows, null, 'boot:2')
  await holdTheMember(host, 'builder', ended('x'))
  assert.deepEqual(asked, [])
})

// --- the mid-turn note ------------------------------------------------------------------------------------------

test('#312: a restart that ended a member whose row read working says it ended mid-turn, so the asker re-sends', async () => {
  const crew = aCrew()
  keepARestart(crew.lifecycle, { fresh: true })
  const asker = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at }, () => {})
  const { host } = aHold(crew, [{ started: true, pid: 202, stopped: new Promise(() => {}) }], asker.rows, 'working')
  void holdTheMember(host, 'builder', ended('restarted'))
  await new Promise((resolve) => setImmediate(resolve))
  const read = theRequestOf(crew.lifecycle, 'builder')
  assert.equal(read.kind === 'answered' && read.outcome.mid_turn, true)
  const ledger = (await asker.rows.read(LIFECYCLE_STREAM)).map((one) => one.row as Record<string, unknown>)
  assert.equal(ledger[0]!['mid_turn'], true)
})

// --- test 5: a stale approval at the restart ---------------------------------------------------------------------

test('#312 test 5: a restart whose start is refused leaves the member ended, and the refusal is in the answer and the ledger', async () => {
  const crew = aCrew()
  keepARestart(crew.lifecycle, { fresh: true })
  const { rows } = anAskingHost(crew.lifecycle, {})
  const refusal = 'this checkout holds config that starts code by itself (.mcp.json), and you have not approved it as it is now. Run martha approve.'
  const { host } = aHold(crew, [{ started: false, refusal }], rows)
  assert.deepEqual(await holdTheMember(host, 'builder', ended('restarted')), { kind: 'not_restarted', refusal })
  const read = theRequestOf(crew.lifecycle, 'builder')
  assert.deepEqual(read.kind === 'answered' && read.outcome.restarted, { started: false, refusal })
  const ledger = (await rows.read(LIFECYCLE_STREAM)).map((one) => one.row as Record<string, unknown>)
  assert.deepEqual([ledger[0]!['started'], ledger[0]!['refusal']], [false, refusal])
})

test('#312 test 5: the asker reads a refused restart as not started, with the start\'s own words', async () => {
  const crew = aCrew()
  const refusal = 'you have not approved it as it is now. Run martha approve.'
  const { host } = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at }, () => {
    const read = theRequestOf(crew.lifecycle, 'builder')
    if (read.kind !== 'pending') return
    const outcome = { id: read.request.id, ended_by: 'launcher', at: read.request.at, restarted: { started: false, refusal }, mid_turn: false }
    crew.lifecycle.keep('builder.json', JSON.stringify({ request: read.request, outcome }))
  })
  assert.deepEqual(await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'x', fresh: false }), { kind: 'refused', told: `builder was ended and not started again: ${refusal}` })
})

test('#312: the asker reads a restart its launcher answered, and a launcher that never answers leaves the member be', async () => {
  const crew = aCrew()
  const answering = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at }, () => {
    const read = theRequestOf(crew.lifecycle, 'builder')
    if (read.kind !== 'pending') return
    crew.lifecycle.keep('builder.json', JSON.stringify({ request: read.request, outcome: { id: read.request.id, ended_by: 'launcher', at: read.request.at, restarted: { started: true }, mid_turn: true, resumed_from: '/crew/handovers/builder-1.md' } }))
  })
  const restarted = await restartAMember(answering.host, { member: 'builder', by: OWNER, reason: 'r', id: 'y', fresh: false })
  assert.deepEqual(restarted, { kind: 'restarted', told: 'builder is restarted from its handover at /crew/handovers/builder-1.md; it ended mid-turn, so send again what it was working on.' })
  const silent = aCrew()
  const { host } = anAskingHost(silent.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at })
  const unanswered = await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'z', fresh: true })
  assert.equal(unanswered.kind, 'refused')
  assert.match(unanswered.told, /no launcher answered the restart of builder within 120 s/)
  assert.ok(host.clock.now() - START > RESTART_ANSWER_DEADLINE_MS, 'it waited out the whole restart deadline')
})

// --- test 6: who may ask through the tool -----------------------------------------------------------------------

const THE_CREW: TheDeclaration = {
  members: [
    { name: 'lead', role: 'steward' },
    { name: 'builder', role: 'builder' },
    { name: 'reviewer', role: 'reviewer' },
  ],
  mode: { may: { [RESTART_MEMBER]: ['steward'] } },
}

test('#312 test 6: a member whose role the table does not grant restart_member is refused, naming the act, and nothing is written', async () => {
  const crew = aCrew()
  const { host } = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at })
  const refused = await restartByTool(host, { member: 'builder', by: 'reviewer', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.equal(refused.kind, 'refused')
  assert.match(refused.told, new RegExp(RESTART_MEMBER))
  assert.deepEqual(theRequestOf(crew.lifecycle, 'builder'), { kind: 'none' }, 'no request was written')
})

test('#312 test 6: a granted role is asked through, and a solo crew\'s owner, whose verb asks no table, may always', async () => {
  const crew = aCrew()
  const { host } = anAskingHost(crew.lifecycle, {})
  const asked = await restartByTool(host, { member: 'builder', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.deepEqual(asked, { kind: 'not_running', told: notRunningToRestart('builder') }, 'the granted caller reached the request')
  const owner = await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'o', fresh: false })
  assert.equal(owner.kind, 'not_running', 'the owner\'s verb is asked straight through')
})

test('#312: a member may not restart itself through the tool', async () => {
  const crew = aCrew()
  const { host } = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at })
  const refused = await restartByTool(host, { member: 'lead', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.equal(refused.kind, 'refused')
  assert.deepEqual(theRequestOf(crew.lifecycle, 'lead'), { kind: 'none' })
})

// --- test 7: the storm window -----------------------------------------------------------------------------------

async function aRestartKept(rows: RowStore, by: string, asked_at: number): Promise<void> {
  await rows.append(LIFECYCLE_STREAM, { event: MEMBER_RESTARTED, member: 'builder', by, reason: 'r', id: `kept-${asked_at}`, fresh: false, asked_at: new Date(asked_at).toISOString(), started: true, mid_turn: false, at: new Date(asked_at).toISOString() })
}

test('#312 test 7: a tool restart inside the storm window is refused, naming the last one; one at the window\'s edge is asked', async () => {
  const inside = aCrew()
  const one = anAskingHost(inside.lifecycle, {})
  await aRestartKept(one.rows, 'lead', START - STORM_WINDOW_MS + 1)
  const refused = await restartByTool(one.host, { member: 'builder', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.equal(refused.kind, 'refused')
  assert.match(refused.told, new RegExp(`restarted by lead at ${new Date(START - STORM_WINDOW_MS + 1).toISOString()}`))
  const edge = aCrew()
  const two = anAskingHost(edge.lifecycle, {})
  await aRestartKept(two.rows, 'lead', START - STORM_WINDOW_MS)
  const asked = await restartByTool(two.host, { member: 'builder', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.equal(asked.kind, 'not_running', 'a restart one window ago is outside it, so this one was asked')
})

test('#312 test 7: the owner\'s restarts are not counted against a tool, and the owner\'s verb is not limited', async () => {
  const crew = aCrew()
  const { host, rows } = anAskingHost(crew.lifecycle, {})
  await aRestartKept(rows, OWNER, START - 1)
  assert.equal((await restartByTool(host, { member: 'builder', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })).kind, 'not_running')
  await aRestartKept(rows, 'lead', START - 1)
  assert.equal((await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'o', fresh: false })).kind, 'not_running')
})

// --- test 8: two at once ----------------------------------------------------------------------------------------

test('#312 test 8: a restart while another request is in flight is answered with who asked and when, and asks nothing', async () => {
  const crew = aCrew()
  const first = keepARestart(crew.lifecycle, { by: 'lead', id: 'first' })
  const { host } = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at })
  assert.deepEqual(await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'second', fresh: false }), {
    kind: 'in_flight',
    told: `a ${RESTART} of builder asked by lead at ${first.at} is in flight.`,
  })
  const read = theRequestOf(crew.lifecycle, 'builder')
  assert.equal(read.kind === 'pending' && read.request.id, 'first')
})

test('#312 test 8: a restart is still in flight past a stop\'s deadline, since its answer waits for a whole start', async () => {
  const crew = aCrew()
  keepARestart(crew.lifecycle, { by: 'lead', id: 'first' })
  const { host, advance } = anAskingHost(crew.lifecycle, { [LAUNCH.pid]: LAUNCH.process_started_at })
  advance(ANSWER_DEADLINE_MS + 1)
  assert.equal((await restartAMember(host, { member: 'builder', by: OWNER, reason: 'r', id: 'second', fresh: false })).kind, 'in_flight')
})

// --- test 9: a member that is not running -----------------------------------------------------------------------

test('#312 test 9: the tool on a member that is not running starts nothing, writes nothing, and names martha wake', async () => {
  const crew = aCrew()
  const { host } = anAskingHost(crew.lifecycle, {})
  const said = await restartByTool(host, { member: 'builder', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.deepEqual(said, { kind: 'not_running', told: 'builder is not running, so nothing was restarted. martha wake builder starts it from its newest handover.' })
  assert.deepEqual(theRequestOf(crew.lifecycle, 'builder'), { kind: 'none' })
})

// --- the launcher's watch on a restart -----------------------------------------------------------------------------

test('#312: the launcher ends its member for a restart as for a stop, and leaves the answer to the start that follows', async () => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  try {
    const crew = aCrew()
    keepARestart(crew.lifecycle)
    const signals: string[] = []
    const stops: string[] = []
    const told: string[] = []
    const { rows } = anAskingHost(crew.lifecycle, {})
    let ended: (() => void) | undefined
    const stopped = new Promise<void>((resolve) => (ended = resolve))
    watchForAStop(
      { stores: { lifecycle: crew.lifecycle, rows }, processes: { signalGroup: (_pid, _identity, signal) => (signals.push(signal), { signalled: true }) }, clock: { now: () => START } },
      { member: 'builder', launch: LAUNCH, stop: (why) => void stops.push(why), stopped, tellOwner: (line) => void told.push(line) },
      1_000,
    )
    mock.timers.tick(1_000)
    assert.deepEqual(signals, ['SIGTERM'])
    assert.deepEqual(told, ['builder is being restarted, asked by lead: stalled'])
    mock.timers.tick(STOP_GRACE_MS)
    assert.deepEqual(stops, ['asked by lead: stalled'], 'a member that ignores the request is made to end after the grace')
    ended!()
    await stopped
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(theRequestOf(crew.lifecycle, 'builder').kind, 'pending', 'the restart stays pending for the hold to answer')
    assert.deepEqual(await rows.read(LIFECYCLE_STREAM), [], 'and no stop is kept in the ledger')
  } finally {
    mock.timers.reset()
  }
})

test('#312: a ledger that cannot be read refuses a tool restart, since it cannot say none was inside the window', async () => {
  const crew = aCrew()
  const { host } = anAskingHost(crew.lifecycle, {})
  const unreadable: StoppingHost = { ...host, stores: { ...host.stores, rows: { ...host.stores.rows, read: async () => Promise.reject(new Error('the stream is not this user\'s')) } } }
  const refused = await restartByTool(unreadable, { member: 'builder', by: 'lead', reason: 'r', id: 'x', fresh: false, declaration: THE_CREW })
  assert.equal(refused.kind, 'refused')
  assert.match(refused.told, /the ledger could not be read/)
})
