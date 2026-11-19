// The host's usage on the refresh question, read strictly (martha#860 R5): its start, its unknown-price mark and its
// rate-limit windows, each well-formed, malformed or absent, and the billing read from those windows.
//
// What a reading is used for is the spend row's (../keep_what_a_session_spent); what this proves is that the question
// carries the host's figures as they came, refuses a malformed one by name, and never reads it as a host that said
// nothing. The mutant each test kills is named in its title.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theQuestionIn, type TheSessionsQuestion } from './the_refresh_flow.ts'

const STARTED_AT = 1_794_998_340_000

/** A turn's end as the mod asks it, with this usage. */
const askedWith = (usage: unknown): TheSessionsQuestion | string => theQuestionIn({ usage, turn_id: 'a-turn', answer: '' }, 'a-session')

/** A usage the host really sends: a start, a context share, a cost. */
const aUsage = (more: Record<string, unknown> = {}): Record<string, unknown> => ({ startedAt: STARTED_AT, context: { percent: 12 }, cost: { usd: 0.75 }, ...more })

function read(usage: unknown): TheSessionsQuestion {
  const question = askedWith(usage)
  assert.ok(typeof question !== 'string', `a well-formed usage was refused: ${String(question)}`)
  return question
}

test('#860 R5: the start, the cost and the unknown-price mark are carried as the host gave them (mutant: started_at dropped)', () => {
  const question = read(aUsage({ cost: { usd: 0.75, hasUnknownPrice: true } }))
  assert.deepEqual([question.percent, question.cost_usd, question.started_at, question.unknown_price], [12, 0.75, STARTED_AT, 1])
  assert.equal(read(aUsage()).unknown_price, 0, 'a cost with no unknown-price mark was read as one')
})

test('#860 R5: a usage with no start, or a start that is no number, is refused by name (mutant: the start check removed)', () => {
  for (const startedAt of [undefined, 'yesterday', Number.NaN]) {
    const question = askedWith(aUsage({ startedAt }))
    assert.equal(typeof question, 'string', `a usage whose start is ${String(startedAt)} was read`)
    assert.match(question as string, /start/, 'the refusal does not name the start')
  }
})

test('#860 R5: an unknown-price mark other than true is refused by name (mutant: the mark check removed)', () => {
  const question = askedWith(aUsage({ cost: { usd: 0.75, hasUnknownPrice: 1 } }))
  assert.equal(typeof question, 'string', 'a mark of 1 was read')
  assert.match(question as string, /unknown price/)
})

test('#860 R5: rate limits that are not a list of named windows are refused by name (mutant: the windows check removed)', () => {
  for (const rateLimits of [{ kind: 'five_hour' }, [{ percentUsed: 3 }], ['five_hour']]) {
    const question = askedWith(aUsage({ rateLimits }))
    assert.equal(typeof question, 'string', `rate limits ${JSON.stringify(rateLimits)} were read`)
    assert.match(question as string, /rate limits/)
  }
})

test('#860 R3: a subscription\'s window says subscription, an empty list after a response says metered, before one says unknown (mutant: billing always unknown)', () => {
  assert.equal(read(aUsage({ rateLimits: [{ kind: 'seven_day', percentUsed: 3 }] })).billing, 'subscription')
  assert.equal(read(aUsage({ rateLimits: [{ kind: 'five_hour', percentUsed: 3 }, { kind: 'spend_limit', percentUsed: 1 }] })).billing, 'subscription')
  assert.equal(read(aUsage({ rateLimits: [] })).billing, 'metered', 'an empty list after a response was not read as off a subscription')
  assert.equal(read(aUsage({ rateLimits: [{ kind: 'spend_limit', percentUsed: 1 }] })).billing, 'metered', 'a gateway\'s own window was read as a plan')
  assert.equal(read(aUsage({ rateLimits: undefined })).billing, 'metered', 'a usage carrying no list after a response was not read as off a subscription')
  assert.equal(read({ startedAt: STARTED_AT, context: {}, rateLimits: [] }).billing, 'unknown', 'an empty list before any response was read as off a subscription')
})

test('#860 R5: a question carrying no usage object is a host that said nothing, as before (mutant: no usage refused)', () => {
  for (const usage of [undefined, null, 'nothing']) {
    const question = read(usage)
    assert.deepEqual([question.percent, question.cost_usd, question.started_at, question.unknown_price, question.billing], [0, null, null, 0, 'unknown'])
  }
})
