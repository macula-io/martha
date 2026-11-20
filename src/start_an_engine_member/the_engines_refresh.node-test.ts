// An engine member's refresh (martha#999 package 5): the crew's refresh question asked with the engine's usage at the
// session's start and after each turn, and the act it is answered with carried or told.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theHostsReadingIn } from '../keep_what_a_session_spent/the_hosts_usage.ts'
import { CARRY_A_MODEL, CARRY_A_TEXT, CARRY_THE_CLEAR, THE_REFRESH_ASK, theQuestionIn } from '../refresh_a_member/the_refresh_flow.ts'
import { CARRY_THE_END } from '../end_a_running_turn/end_the_running_turn.ts'
import type { AnAgentsUsage } from '../speak_acp_to_an_agent/the_acp_client.ts'
import {
  THE_ARRIVAL_OF_A_REFRESH_PROMPT,
  THE_CLEAR_WAITS,
  THE_CURRENCY_A_COST_IS_KEPT_IN,
  theEnginesRefresh,
  theEnginesUsageAsAHostsUsage,
  theLineOfAnActNotCarried,
  type Heard,
} from './the_engines_refresh.ts'

const MEMBER = 'a-member-a-test-names'
const SESSION = 'a-session-a-test-names'
/** A start time of this test's own: no clock's, so a usage read from a clock instead cannot pass. */
const STARTED_AT = 1_234_567
/** 3 of 8: a share no constant holds, so a reading taken from anywhere but the usage cannot pass. */
const A_USAGE: AnAgentsUsage = { used: 3_000, size: 8_000, cost: { amount: 0.42, currency: THE_CURRENCY_A_COST_IS_KEPT_IN } }
const A_SHARE = 37.5

interface Asked {
  readonly session_id: string
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
}

/** A refresh answered with `answer`, whose engine reported `usage`, or nothing at all for null. */
function aRefresh(answer: Heard, usage: AnAgentsUsage | null = A_USAGE) {
  const asked: Asked[] = []
  const told: string[] = []
  const refresh = theEnginesRefresh({
    member: MEMBER,
    session_id: SESSION,
    started_at: STARTED_AT,
    usageOf: (session_id) => (session_id === SESSION && usage !== null ? usage : undefined),
    ask: async (session_id, tool, args) => (asked.push({ session_id, tool, args }), answer),
    tell: (line) => void told.push(line),
  })
  return { refresh, asked, told }
}

const said = (order: unknown): Heard => ({ said: JSON.stringify(order) })

test('#999 package 5: the engine\'s usage reads as a host\'s usage: the share of its context, its cost in dollars, and the session\'s start (mutant: the share not times 100, or the cost dropped)', () => {
  const reading = theHostsReadingIn(theEnginesUsageAsAHostsUsage(A_USAGE, STARTED_AT))
  assert.deepEqual(reading, { percent: A_SHARE, cost_usd: 0.42, started_at: STARTED_AT, unknown_price: 0, billing: 'unknown' })
})

test('#999 package 5: a session the engine said nothing of has no share, and a cost in another currency is not read as dollars (mutant: the currency not checked)', () => {
  assert.deepEqual(theHostsReadingIn(theEnginesUsageAsAHostsUsage(undefined, STARTED_AT)), { percent: 0, cost_usd: null, started_at: STARTED_AT, unknown_price: 0, billing: 'unknown' })
  const euros = theHostsReadingIn(theEnginesUsageAsAHostsUsage({ ...A_USAGE, cost: { amount: 0.42, currency: 'EUR' } }, STARTED_AT))
  assert.ok(typeof euros !== 'string')
  assert.equal(euros.cost_usd, null)
  assert.equal(euros.percent, A_SHARE)
})

test('#999 package 5: after a turn, the refresh question goes as the session, with the usage, a turn id and the turn\'s text, and reads as the flow reads the mod\'s (mutant: the usage or the answer left out)', async () => {
  const { refresh, asked } = aRefresh(said({ carry: 'none' }))
  assert.equal(await refresh.afterATurn({ text: 'what the turn said' }), undefined)
  assert.equal(asked.length, 1)
  assert.equal(asked[0]?.session_id, SESSION)
  assert.equal(asked[0]?.tool, THE_REFRESH_ASK)
  const question = theQuestionIn(asked[0]?.args ?? {}, SESSION)
  assert.ok(typeof question !== 'string', String(question))
  assert.equal(question.percent, A_SHARE)
  assert.equal(question.answer, 'what the turn said')
  assert.equal(question.at_start, false)
  assert.equal(question.turn_running, false)
  assert.notEqual(question.turn_id, '')
})

test('#999 package 5: each turn is asked about under an id of its own (mutant: one id for every turn)', async () => {
  const { refresh, asked } = aRefresh(said({ carry: 'none' }))
  await refresh.afterATurn({ text: 'one' })
  await refresh.afterATurn({ text: 'two' })
  assert.notEqual(asked[0]?.args['turn_id'], asked[1]?.args['turn_id'])
})

test('#999 package 5: at the session\'s start the question carries no turn, which the flow reads as the first question (mutant: a turn id at the start)', async () => {
  const { refresh, asked } = aRefresh(said({ carry: 'none' }), null)
  assert.equal(await refresh.atTheStart(), undefined)
  const question = theQuestionIn(asked[0]?.args ?? {}, SESSION)
  assert.ok(typeof question !== 'string', String(question))
  assert.equal(question.at_start, true)
  assert.equal(question.percent, 0)
})

test('#999 package 5: a prompt the crew orders is the member\'s next turn, recorded as the crew mod\'s own prompt is (mutant: the prompt act not carried)', async () => {
  const { refresh, told } = aRefresh(said({ carry: CARRY_A_TEXT, text: 'write your handover' }))
  assert.deepEqual(await refresh.afterATurn({ text: '' }), { text: 'write your handover', arrival: THE_ARRIVAL_OF_A_REFRESH_PROMPT })
  assert.deepEqual(told, [])
})

test('#999 package 5: the clear, a model switch and the end of a running turn are told to the owner by name and never carried (mutant: an order dropped silently)', async () => {
  for (const [order, why] of [
    [{ carry: CARRY_THE_CLEAR }, THE_CLEAR_WAITS],
    [{ carry: CARRY_A_MODEL, model: 'm' }, `an engine member is not ordered to ${CARRY_A_MODEL}`],
    [{ carry: CARRY_THE_END, turn_id: 't' }, `an engine member is not ordered to ${CARRY_THE_END}`],
  ] as const) {
    const { refresh, told } = aRefresh(said(order))
    assert.equal(await refresh.afterATurn({ text: '' }), undefined)
    assert.deepEqual(told, [theLineOfAnActNotCarried(MEMBER, why)])
  }
})

test('#999 package 5: a question the crew tools could not answer is told, and an answer that is no order is nothing (mutant: the failure swallowed)', async () => {
  const failed = aRefresh({ why: 'the crew tools are not served' })
  assert.equal(await failed.refresh.afterATurn({ text: '' }), undefined)
  assert.deepEqual(failed.told, [theLineOfAnActNotCarried(MEMBER, 'the crew tools are not served')])
  for (const answer of [{ said: 'not json' }, said([1]), said({ carry: CARRY_A_TEXT, text: '' })]) {
    const { refresh, told } = aRefresh(answer)
    assert.equal(await refresh.afterATurn({ text: '' }), undefined)
    assert.deepEqual(told, [])
  }
})
