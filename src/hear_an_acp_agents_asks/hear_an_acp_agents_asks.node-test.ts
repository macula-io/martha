// The owner's asks of a Goose member, held until answered (macula-io/martha#541, package 9a). Each case that runs a
// turn starts the ACP stand-in as a child over real pipes, as the launcher starts the engine, and reads what the agent
// heard from the agent's own side of the wire. The row and the bell are the real owner's screen over an in-memory store.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { ALLOW_ONCE, REJECT_ONCE } from '../speak_acp_to_an_agent/answer_a_permission_once.ts'
import { AcpClient, type APermissionRequest, type ATurn, type Decide } from '../speak_acp_to_an_agent/the_acp_client.ts'
import type { AnAgentScript } from '../stand_in_for_an_acp_agent/the_stand_in_agents_script.ts'
import { theOwnersScreen, type TheScreenKeeper } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import type { WhatTheHostSaid } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'
import { theRowWithNothingSaid, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { ALREADY_ANSWERED, NOT_HELD, TOO_LATE, theOwnersAsks, theWayAfterTheGate, type AnAnswerHeard, type TheGate, type TheOwnersAsks } from './hear_an_acp_agents_asks.ts'

const STAND_IN = join(import.meta.dirname, '..', 'stand_in_for_an_acp_agent', 'main.ts')
/** A tool name of the test's own, so a list or a gate that named a real tool instead of the one asked cannot pass. */
const THE_TOOL = 'the-tests-own-tool'
const A_CALL = { id: 'call-9a', title: 'the-tests-own-tool: echo hi', input: { command: 'echo hi' } }
/** The key the owner answers A_CALL by in `session`: the call's own id and the session it was asked in, spelled out here. */
const theKeyIn = (session: string): string => `permission:${A_CALL.id}@${session}`
const MEMBER = 'Vesta'

const allowing: TheGate = () => ({ verdict: 'allow', tool: THE_TOOL })
const denying: TheGate = () => ({ verdict: 'deny', tool: THE_TOOL })

test('the way after the gate: a deny is refused even when listed, a listed allow runs, any other allow asks the owner', () => {
  assert.equal(theWayAfterTheGate({ verdict: 'deny', tool: THE_TOOL }, [THE_TOOL]), 'refuse-once')
  assert.equal(theWayAfterTheGate({ verdict: 'allow', tool: THE_TOOL }, [THE_TOOL]), 'run-once')
  assert.equal(theWayAfterTheGate({ verdict: 'allow', tool: THE_TOOL }, []), 'ask-the-owner')
  assert.equal(theWayAfterTheGate({ verdict: 'allow', tool: `${THE_TOOL}-too` }, [THE_TOOL]), 'ask-the-owner', 'a listed name is never a prefix')
  assert.equal(theWayAfterTheGate({ verdict: 'allow', tool: THE_TOOL }, [`${THE_TOOL}-too`]), 'ask-the-owner', 'nor is a call a prefix of a listed name')
})

/** A store that keeps one member's row in memory. */
function aStore(): DashboardStore & { row: () => DashboardRow | null } {
  let row: DashboardRow | null = { ...theRowWithNothingSaid(), member: MEMBER, session: 'a-session', at: 1, state: 'working', needs: 'my own words' }
  return {
    row: () => row,
    read: () => row,
    change: (_member, change) => {
      const next = change(row)
      if (next === null) return { kept: false, why: 'the change kept nothing' }
      row = next
      return { kept: true }
    },
    all: () => (row === null ? {} : { [row.member]: row }),
  }
}

/** The owner's real screen over `store`, with every thing it heard kept, and a wait for the first permission. */
function aWatchedScreen(store: DashboardStore, bells: string[]): { screen: TheScreenKeeper; heard: WhatTheHostSaid[]; asked: Promise<void> } {
  const real = theOwnersScreen({ beats: store, member: MEMBER, bells: { bell: true, notify: false }, muted: () => false, onTheOwnersTerminal: true, write: (bytes) => void bells.push(bytes) })
  const heard: WhatTheHostSaid[] = []
  let asked!: () => void
  const askedNow = new Promise<void>((settle) => (asked = settle))
  return {
    heard,
    asked: askedNow,
    screen: {
      held: real.held,
      heard: (session, said, at) => {
        heard.push(said)
        real.heard(session, said, at)
        if (said.said === 'permission') asked()
      },
    },
  }
}

interface ARun {
  readonly asks: TheOwnersAsks
  readonly store: ReturnType<typeof aStore>
  readonly bells: string[]
  readonly heard: WhatTheHostSaid[]
  readonly asked: Promise<void>
}

/** One launch's asks over the stand-in, with the owner act found when `acts` holds the answer's act id. */
async function withTheAsks(script: AnAgentScript, gate: TheGate, approved: readonly string[], run: (client: AcpClient, sessionId: string, at: ARun) => Promise<void>, acts: readonly string[] = []): Promise<void> {
  const store = aStore()
  const bells: string[] = []
  const watched = aWatchedScreen(store, bells)
  let clock = 100
  const asks = theOwnersAsks({ screen: watched.screen, now: () => (clock += 1), anOwnerActStandsBehind: (heard: AnAnswerHeard) => heard.act !== undefined && acts.includes(heard.act) })
  const child: ChildProcess = spawn(process.execPath, [STAND_IN, JSON.stringify(script)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  const client = AcpClient.overAChild(child, asks.decide(gate, approved))
  try {
    await client.initialize()
    const { sessionId } = await client.newSession('/')
    await run(client, sessionId, { asks, store, bells, heard: watched.heard, asked: watched.asked })
  } finally {
    client.end()
    if (child.exitCode === null) child.kill()
    await exited
  }
}

const heardFor = (turn: ATurn): unknown => turn.toolCalls[0]?.rawOutput

test('an allowed call off the list waits on the owner: the row asks, the bell rings once, the owner\'s allow runs it, the row clears', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [], async (client, sessionId, at) => {
    const turn = client.prompt(sessionId, 'go')
    await at.asked
    assert.deepEqual(at.asks.open().map((ask) => [ask.key, ask.tool, ask.title, ask.tool_call_id]), [[theKeyIn(sessionId), THE_TOOL, A_CALL.title, A_CALL.id]])
    const row = at.store.row()
    assert.ok(row !== null)
    assert.equal(whatTheOwnerIsShown(row).state, 'needs-you')
    assert.match(whatTheOwnerIsShown(row).needs, new RegExp(`permission for ${THE_TOOL}`))
    assert.equal(at.bells.length, 1, 'the bell rings once, on the change into needs-you')
    assert.deepEqual(at.asks.answer({ key: theKeyIn(sessionId), answer: 'allow', act: 'act-1' }), { did: 'answered', owner_act: true })
    assert.deepEqual(heardFor(await turn), { heard: ALLOW_ONCE, runs: 1, saves: 0 })
    assert.equal(whatTheOwnerIsShown(at.store.row()!).state, 'working', 'the row is the member\'s own again')
    assert.equal(at.bells.length, 1, 'and closing rings nothing')
    assert.deepEqual(at.asks.open(), [])
  }, ['act-1'])
})

test('the owner\'s reject refuses the call once', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [], async (client, sessionId, at) => {
    const turn = client.prompt(sessionId, 'go')
    await at.asked
    assert.equal(at.asks.answer({ key: theKeyIn(sessionId), answer: 'reject', act: 'act-2' }).did, 'answered')
    assert.deepEqual(heardFor(await turn), { heard: REJECT_ONCE, runs: 0, saves: 0 })
    assert.equal(whatTheOwnerIsShown(at.store.row()!).state, 'working')
  }, ['act-2'])
})

test('an allowed call on the list never waits: it runs once and the owner\'s screen hears nothing', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [THE_TOOL], async (client, sessionId, at) => {
    assert.deepEqual(heardFor(await client.prompt(sessionId, 'go')), { heard: ALLOW_ONCE, runs: 1, saves: 0 })
    assert.deepEqual(at.heard, [])
    assert.equal(at.bells.length, 0)
  })
})

test('a call the gate denies is refused once and no one is asked, even when its tool is listed', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, denying, [THE_TOOL], async (client, sessionId, at) => {
    assert.deepEqual(heardFor(await client.prompt(sessionId, 'go')), { heard: REJECT_ONCE, runs: 0, saves: 0 })
    assert.deepEqual(at.heard, [])
  })
})

test('a cancel while the owner has not answered: the agent hears cancelled, the row clears, a later answer is too late', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [], async (client, sessionId, at) => {
    const turn = client.prompt(sessionId, 'go')
    await at.asked
    client.cancel(sessionId)
    assert.deepEqual(heardFor(await turn), { heard: 'cancelled', runs: 0, saves: 0 })
    assert.equal(whatTheOwnerIsShown(at.store.row()!).state, 'working')
    assert.deepEqual(at.asks.open(), [])
    assert.deepEqual(at.asks.answer({ key: theKeyIn(sessionId), answer: 'allow', act: 'act-3' }), { did: 'answered-nothing', why: TOO_LATE })
    assert.deepEqual(at.asks.kept, [], 'a late answer is not kept as an answer')
  }, ['act-3'])
})

test('a turn that ends with the ask still open withdraws it: the row clears and a later answer is too late', async () => {
  // The agent stops waiting and ends its turn: the stand-in exits, which ends its output while the ask is open.
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [], async (client, sessionId, at) => {
    const turn = client.prompt(sessionId, 'go')
    await at.asked
    client.end()
    await assert.rejects(turn)
    assert.equal(whatTheOwnerIsShown(at.store.row()!).state, 'working')
    assert.deepEqual(at.asks.answer({ key: theKeyIn(sessionId), answer: 'allow', act: 'act-4' }), { did: 'answered-nothing', why: TOO_LATE })
  }, ['act-4'])
})

test('an answer naming a key that is not held answers nothing; one already answered answers nothing a second time', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [], async (client, sessionId, at) => {
    assert.deepEqual(at.asks.answer({ key: 'permission:no-such-call', answer: 'allow', act: 'act-5' }), { did: 'answered-nothing', why: NOT_HELD })
    const turn = client.prompt(sessionId, 'go')
    await at.asked
    assert.equal(at.asks.answer({ key: theKeyIn(sessionId), answer: 'reject', act: 'act-5' }).did, 'answered')
    assert.deepEqual(at.asks.answer({ key: theKeyIn(sessionId), answer: 'allow', act: 'act-5' }), { did: 'answered-nothing', why: ALREADY_ANSWERED })
    assert.deepEqual(heardFor(await turn), { heard: REJECT_ONCE, runs: 0, saves: 0 }, 'the second answer changed nothing')
  }, ['act-5'])
})

test('an answer with no owner act behind it is still applied, and is kept and noted as such', async () => {
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, allowing, [], async (client, sessionId, at) => {
    const turn = client.prompt(sessionId, 'go')
    await at.asked
    assert.deepEqual(at.asks.answer({ key: theKeyIn(sessionId), answer: 'allow', act: 'an-act-no-record-holds' }), { did: 'answered', owner_act: false })
    assert.deepEqual(heardFor(await turn), { heard: ALLOW_ONCE, runs: 1, saves: 0 })
    assert.deepEqual(at.asks.kept.map((kept) => [kept.key, kept.answer, kept.owner_act]), [[theKeyIn(sessionId), 'allow', false]])
    assert.match(at.asks.notes.join('\n'), new RegExp(`${theKeyIn(sessionId)} was answered allow with no owner act behind it`))
  })
})

test('a gate that throws is a refusal, and the owner is never asked', async () => {
  const throwing: TheGate = () => {
    throw new Error('the entry could not read the call')
  }
  await withTheAsks({ turns: [[{ call: A_CALL }]] }, throwing, [], async (client, sessionId, at) => {
    assert.deepEqual(heardFor(await client.prompt(sessionId, 'go')), { heard: REJECT_ONCE, runs: 0, saves: 0 })
    assert.deepEqual(at.heard, [])
  })
})

/** The asks of one launch with no agent behind them: each Decide is called by the test, as the ACP client would. */
function asksWithNoAgent(): { asks: TheOwnersAsks; decide: Decide } {
  const asks = theOwnersAsks({ screen: aWatchedScreen(aStore(), []).screen, now: () => 1, anOwnerActStandsBehind: () => true })
  return { asks, decide: asks.decide(allowing, []) }
}

/** A request for A_CALL's tool under the call id providers give in every session, asked in `session`. */
const askedIn = (session: string): APermissionRequest => ({ sessionId: session, toolCallId: 'call_1', title: A_CALL.title, rawInput: A_CALL.input })

/** Every promise already settled has run its callbacks: the gate is awaited before an ask is held. */
const settled = (): Promise<void> => new Promise((settle) => setImmediate(settle))

test('two sessions asking under the same call id are two asks: each is answered and withdrawn on its own', async () => {
  const { asks, decide } = asksWithNoAgent()
  const first = new AbortController()
  const second = new AbortController()
  const firstDecided = decide(askedIn('session-one'), first.signal)
  const secondDecided = decide(askedIn('session-two'), second.signal)
  await settled()
  assert.deepEqual(asks.open().map((ask) => [ask.key, ask.session_id]), [
    ['permission:call_1@session-one', 'session-one'],
    ['permission:call_1@session-two', 'session-two'],
  ])
  assert.deepEqual(asks.answer({ key: 'permission:call_1@session-one', answer: 'allow', act: 'act-6' }), { did: 'answered', owner_act: true })
  assert.equal(await firstDecided, 'allow', 'the answer reached the ask it named')
  assert.deepEqual(asks.open().map((ask) => ask.key), ['permission:call_1@session-two'], 'the other session still waits')
  second.abort()
  assert.equal(await secondDecided, 'reject', 'its withdrawal found it and closed it')
  assert.deepEqual(asks.open(), [])
})

test('a second ask under a key already held is refused once and noted; the held ask keeps its key and its answer', async () => {
  const { asks, decide } = asksWithNoAgent()
  const firstDecided = decide(askedIn('session-one'), new AbortController().signal)
  await settled()
  assert.equal(await decide(askedIn('session-one'), new AbortController().signal), 'reject', 'the second ask under a held key never waits')
  assert.match(asks.notes.join('\n'), /a second ask under permission:call_1@session-one was refused/)
  assert.deepEqual(asks.open().map((ask) => ask.key), ['permission:call_1@session-one'])
  asks.answer({ key: 'permission:call_1@session-one', answer: 'allow', act: 'act-7' })
  assert.equal(await firstDecided, 'allow', 'the ask held first is the one the answer reaches')
})
